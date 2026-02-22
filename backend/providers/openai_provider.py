"""OpenAI thin wrapper. generate(messages, model, stream=True) -> yield chunks."""
import json
from openai import OpenAI

from backend.services.settings_store import get_api_key

_client = None

def _get_client():
    global _client
    if _client is None:
        key = get_api_key("openai")
        _client = OpenAI(api_key=key or "sk-placeholder")
    return _client


def _openai_messages(messages):
    """Convert to OpenAI message format (content only, no tool_calls). Content may be string or list of parts (multimodal)."""
    out = []
    for m in messages:
        content = m.get("content")
        if content is None:
            content = ""
        if m.get("role") == "system" and not content:
            continue
        out.append({"role": m["role"], "content": content})
    return out


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    if not get_api_key("openai"):
        raise ValueError("OPENAI_API_KEY not set")
    client = _get_client()
    stream_obj = client.chat.completions.create(
        model=model,
        messages=_openai_messages(messages),
        stream=stream,
    )
    for chunk in stream_obj:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content


def generate_with_tools(messages, model, tools, tool_runner):
    """
    Non-streaming tool loop. tool_runner(name, args_dict) -> (content_str, meta_entry | None).
    Yields ("status", "Searching the web...") only when about to run web_search; then yields ("result", (final_content, web_search_meta)).
    """
    from backend.services.tools_schema import WEB_SEARCH_TOOL
    from backend.services import tools_schema
    client = _get_client()
    if not get_api_key("openai"):
        raise ValueError("OPENAI_API_KEY not set")
    openai_tools = tools_schema.openai_tools()
    web_search_meta = []
    current = list(messages)

    while True:
        # Build OpenAI messages: may include assistant with tool_calls and tool messages
        api_messages = []
        for m in current:
            if m.get("role") == "tool":
                api_messages.append({"role": "tool", "content": m.get("content") or "", "tool_call_id": m.get("tool_call_id")})
            elif m.get("role") == "assistant" and m.get("tool_calls"):
                msg = {"role": "assistant", "content": m.get("content") or ""}
                msg["tool_calls"] = [
                    {"id": tc["id"], "type": "function", "function": {"name": tc["function"]["name"], "arguments": tc["function"].get("arguments") or "{}"}}
                    for tc in m["tool_calls"]
                ]
                api_messages.append(msg)
            else:
                content = m.get("content")
                if content is None:
                    content = ""
                if m.get("role") == "system" and not content:
                    continue
                api_messages.append({"role": m["role"], "content": content})

        response = client.chat.completions.create(
            model=model,
            messages=api_messages,
            tools=openai_tools,
            stream=False,
        )
        choice = response.choices[0] if response.choices else None
        if not choice:
            break
        msg = choice.message
        if getattr(msg, "tool_calls", None):
            # Append assistant message with tool_calls
            assistant_content = getattr(msg, "content", None) or ""
            current.append({
                "role": "assistant",
                "content": assistant_content,
                "tool_calls": [
                    {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"}}
                    for tc in msg.tool_calls
                ],
            })
            for tc in msg.tool_calls:
                name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments or "{}")
                except json.JSONDecodeError:
                    args = {}
                if name == WEB_SEARCH_TOOL["name"]:
                    yield ("status", "Searching the web...")
                content_str, meta_entry = tool_runner(name, args)
                if meta_entry:
                    web_search_meta.append(meta_entry)
                current.append({"role": "tool", "content": content_str, "tool_call_id": tc.id})
            continue
        # No tool calls: final text - stream it chunk by chunk
        final = (getattr(msg, "content", None) or "").strip()
        if final:
            # Stream the final response in chunks
            chunk_size = 50
            for i in range(0, len(final), chunk_size):
                yield ("chunk", final[i:i + chunk_size])
        yield ("result", (final, web_search_meta))
        return
