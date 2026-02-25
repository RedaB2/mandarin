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


def _obj_get(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


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


def _content_to_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                text = part.get("text") or ""
                if text:
                    parts.append(text)
        return "\n".join(parts).strip()
    return ""


def _last_user_query(messages):
    for m in reversed(messages or []):
        if m.get("role") != "user":
            continue
        text = _content_to_text(m.get("content"))
        if text:
            return text
    return "web search"


def _to_responses_content(content):
    """Convert app message content into Responses API content format."""
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for part in content:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type")
            if ptype == "text":
                text = part.get("text") or ""
                if text:
                    out.append({"type": "input_text", "text": text})
            elif ptype == "image_url":
                url = ((part.get("image_url") or {}).get("url") or "").strip()
                if url:
                    out.append({"type": "input_image", "image_url": url})
        return out if out else ""
    return str(content)


def _to_responses_input(messages):
    """Convert current message list to Responses API input messages."""
    out = []
    for m in messages:
        role = m.get("role")
        if role not in ("system", "user", "assistant"):
            continue
        content = _to_responses_content(m.get("content"))
        if role == "system" and not content:
            continue
        out.append({"role": role, "content": content})
    return out


def _extract_responses_text(response):
    text = _obj_get(response, "output_text") or ""
    if isinstance(text, str) and text.strip():
        return text

    pieces = []
    for item in (_obj_get(response, "output") or []):
        if _obj_get(item, "type") != "message":
            continue
        for content_item in (_obj_get(item, "content") or []):
            ctype = _obj_get(content_item, "type")
            if ctype not in ("output_text", "text"):
                continue
            t = _obj_get(content_item, "text") or ""
            if t:
                pieces.append(t)
    return "".join(pieces)


def _extract_web_search_meta(response, fallback_query):
    """
    Normalize native OpenAI web search metadata into existing UI shape:
    [{ "query": "...", "results": [{title, url, snippet, content}] }]
    """
    queries = []
    results = []
    seen_urls = set()

    def _add_result(url, title=""):
        clean_url = (url or "").strip()
        if not clean_url:
            return
        key = clean_url.lower()
        if key in seen_urls:
            return
        seen_urls.add(key)
        results.append(
            {
                "title": (title or clean_url).strip() or clean_url,
                "url": clean_url,
                "snippet": "",
                "content": "",
            }
        )

    output_items = _obj_get(response, "output") or []
    for item in output_items:
        itype = _obj_get(item, "type")
        if itype == "web_search_call":
            action = _obj_get(item, "action") or {}
            raw_queries = _obj_get(action, "queries") or []
            for q in raw_queries:
                if isinstance(q, str) and q.strip():
                    queries.append(q.strip())
                elif isinstance(q, dict):
                    q_text = (_obj_get(q, "query") or _obj_get(q, "text") or "").strip()
                    if q_text:
                        queries.append(q_text)
            raw_sources = _obj_get(action, "sources") or []
            for src in raw_sources:
                url = _obj_get(src, "url") or ""
                title = _obj_get(src, "title") or ""
                _add_result(url, title)
            continue

        if itype != "message":
            continue

        for content_item in (_obj_get(item, "content") or []):
            for ann in (_obj_get(content_item, "annotations") or []):
                ann_type = _obj_get(ann, "type")
                ann_payload = _obj_get(ann, "url_citation") or {}
                if ann_type != "url_citation" and not ann_payload:
                    continue
                url = (_obj_get(ann, "url") or _obj_get(ann_payload, "url") or "").strip()
                title = (_obj_get(ann, "title") or _obj_get(ann_payload, "title") or "").strip()
                _add_result(url, title)

    query = queries[0] if queries else ((fallback_query or "").strip() or "web search")
    return [{"query": query, "results": results}] if results else []


def list_models():
    """Return normalized OpenAI models list: [{ model, name }]."""
    if not get_api_key("openai"):
        return []
    client = _get_client()
    response = client.models.list()
    items = _obj_get(response, "data") or []
    out = []
    seen = set()
    for item in items:
        model_id = (_obj_get(item, "id") or "").strip()
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        out.append({"model": model_id, "name": model_id})
    out.sort(key=lambda x: x["model"])
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


def _generate_with_native_web_search(messages, model):
    """Primary OpenAI web search path using Responses API built-in web_search tool."""
    client = _get_client()
    response = client.responses.create(
        model=model,
        tools=[{"type": "web_search"}],
        tool_choice="auto",
        input=_to_responses_input(messages),
    )
    final = (_extract_responses_text(response) or "").strip()
    query_fallback = _last_user_query(messages)
    web_search_meta = _extract_web_search_meta(response, query_fallback)
    return final, web_search_meta


def _generate_with_tavily_tool_loop(messages, model, tool_runner):
    """Tavily path: existing function-tool loop backed by Tavily."""
    from backend.services.tools_schema import WEB_SEARCH_TOOL
    from backend.services import tools_schema

    print("OpenAI web search path: Tavily")
    client = _get_client()
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
            current.append(
                {
                    "role": "assistant",
                    "content": assistant_content,
                    "tool_calls": [
                        {"id": tc.id, "function": {"name": tc.function.name, "arguments": tc.function.arguments or "{}"}}
                        for tc in msg.tool_calls
                    ],
                }
            )
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
            chunk_size = 50
            for i in range(0, len(final), chunk_size):
                yield ("chunk", final[i : i + chunk_size])
        print(f"OpenAI Tavily search complete (search_calls={len(web_search_meta)})")
        yield ("result", (final, web_search_meta))
        return


def generate_with_native_web_search(messages, model):
    """
    OpenAI native web search path only (no fallback).
    Yields ("status", msg), ("chunk", text), then ("result", (final_content, web_search_meta)).
    """
    if not get_api_key("openai"):
        raise ValueError("OPENAI_API_KEY not set")

    print("OpenAI web search path: native Responses API (attempt)")
    yield ("status", "Searching the web...")
    final, web_search_meta = _generate_with_native_web_search(messages, model)
    total_sources = sum(len((entry or {}).get("results") or []) for entry in (web_search_meta or []))
    print(f"OpenAI native web search succeeded (sources={total_sources})")
    if final:
        chunk_size = 50
        for i in range(0, len(final), chunk_size):
            yield ("chunk", final[i : i + chunk_size])
    yield ("result", (final, web_search_meta))


def generate_with_tavily_web_search(messages, model, tool_runner):
    """
    OpenAI Tavily tool path only (no native attempt).
    Yields ("status", msg), ("chunk", text), then ("result", (final_content, web_search_meta)).
    """
    if not get_api_key("openai"):
        raise ValueError("OPENAI_API_KEY not set")
    yield from _generate_with_tavily_tool_loop(messages, model, tool_runner)


def generate_with_tools(messages, model, tools, tool_runner):
    """
    Backward-compatible entrypoint: preserved for callers that still use this symbol.
    Uses native mode only.
    """
    yield from generate_with_native_web_search(messages, model)
