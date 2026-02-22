"""Anthropic thin wrapper. generate(messages, model, stream=True) -> yield chunks."""
import json
import config
import anthropic

_client = None


def _get_client():
    global _client
    if _client is None:
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY or "placeholder")
    return _client


def _split_system(messages):
    """Return (system_str, list of user/assistant messages)."""
    system_parts = []
    rest = []
    for m in messages:
        if m.get("role") == "system":
            system_parts.append(m.get("content") or "")
        else:
            rest.append(m)
    return "\n".join(system_parts).strip(), rest


def _parse_data_url(url: str):
    """Parse data URL (data:image/png;base64,...) -> (media_type, base64_data). Returns (None, None) on failure."""
    if not url or not url.startswith("data:"):
        return None, None
    rest = url[5:].strip()
    if ";base64," in rest:
        media_type, b64 = rest.split(";base64,", 1)
        return media_type.strip().lower() or "image/png", b64
    return None, None


def _to_anthropic_content(m):
    """Convert message to Anthropic content (string or list of blocks). Maps image_url parts to Anthropic image blocks."""
    if m.get("role") == "tool":
        return m.get("content") or ""
    if m.get("role") == "assistant" and m.get("tool_blocks"):
        return m["tool_blocks"]
    c = m.get("content") or ""
    if isinstance(c, list):
        blocks = []
        for part in c:
            if not isinstance(part, dict):
                continue
            if part.get("type") == "text":
                blocks.append({"type": "text", "text": part.get("text", "")})
            elif part.get("type") == "image_url":
                url = (part.get("image_url") or {}).get("url") or ""
                media_type, b64 = _parse_data_url(url)
                if media_type and b64:
                    blocks.append({"type": "image", "source": {"type": "base64", "media_type": media_type, "data": b64}})
        return blocks if blocks else ""
    return c


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    if not config.ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = _get_client()
    system, chat_messages = _split_system(messages)
    anthropic_messages = []
    for m in chat_messages:
        if m.get("role") == "tool":
            anthropic_messages.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": m.get("tool_call_id"), "content": m.get("content") or ""}]})
        else:
            content = _to_anthropic_content(m)
            if m["role"] == "assistant" and isinstance(content, list):
                anthropic_messages.append({"role": "assistant", "content": content})
            else:
                anthropic_messages.append({"role": m["role"], "content": content})
    kwargs = {"system": system} if system else {}
    with client.messages.stream(
        model=model,
        max_tokens=20000,
        messages=anthropic_messages,
        **kwargs
    ) as stream_obj:
        for text in stream_obj.text_stream:
            yield text


def generate_with_tools(messages, model, tools, tool_runner):
    """
    Non-streaming tool loop. tool_runner(name, args_dict) -> (content_str, meta_entry | None).
    Yields ("status", "Searching the web...") only when about to run web_search; then yields ("result", (final_content, web_search_meta)).
    """
    from backend.services.tools_schema import WEB_SEARCH_TOOL
    from backend.services import tools_schema
    if not config.ANTHROPIC_API_KEY:
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = _get_client()
    system, rest = _split_system(messages)
    anthropic_tools = tools_schema.anthropic_tools()
    web_search_meta = []
    current = list(rest)

    while True:
        # Build message list for API: user/assistant with content as string or blocks
        api_messages = []
        for m in current:
            if m.get("role") == "user" and isinstance(m.get("content"), list):
                api_messages.append({"role": "user", "content": m["content"]})
            elif m.get("role") == "assistant" and isinstance(m.get("content"), list):
                api_messages.append({"role": "assistant", "content": m["content"]})
            else:
                api_messages.append({"role": m["role"], "content": m.get("content") or ""})

        kwargs = {"system": system} if system else {}
        response = client.messages.create(
            model=model,
            max_tokens=20000,
            messages=api_messages,
            tools=anthropic_tools,
            **kwargs,
        )
        content_blocks = list(response.content) if response.content else []
        text_parts = []
        tool_use_blocks = []
        for block in content_blocks:
            btype = block.get("type") if isinstance(block, dict) else getattr(block, "type", None)
            if btype == "text":
                text_parts.append(block.get("text", "") if isinstance(block, dict) else (getattr(block, "text", "") or ""))
            elif btype == "tool_use":
                tool_use_blocks.append({
                    "id": block.get("id", "") if isinstance(block, dict) else getattr(block, "id", ""),
                    "name": block.get("name", "") if isinstance(block, dict) else getattr(block, "name", ""),
                    "input": block.get("input", {}) if isinstance(block, dict) else (getattr(block, "input", None) or {}),
                })

        if tool_use_blocks:
            # Append assistant message with tool_use blocks
            assistant_content = [{"type": "text", "text": "".join(text_parts)}] if text_parts else []
            for b in tool_use_blocks:
                assistant_content.append({"type": "tool_use", "id": b["id"], "name": b["name"], "input": b["input"]})
            current.append({"role": "assistant", "content": assistant_content})
            tool_results = []
            for b in tool_use_blocks:
                name = b["name"]
                args = b["input"] if isinstance(b["input"], dict) else {}
                if name == WEB_SEARCH_TOOL["name"]:
                    yield ("status", "Searching the web...")
                content_str, meta_entry = tool_runner(name, args)
                if meta_entry:
                    web_search_meta.append(meta_entry)
                tool_results.append({"type": "tool_result", "tool_use_id": b["id"], "content": content_str})
            current.append({"role": "user", "content": tool_results})
            continue
        final = "".join(text_parts).strip()
        if final:
            # Stream the final response in chunks
            chunk_size = 50
            for i in range(0, len(final), chunk_size):
                yield ("chunk", final[i:i + chunk_size])
        yield ("result", (final, web_search_meta))
        return
