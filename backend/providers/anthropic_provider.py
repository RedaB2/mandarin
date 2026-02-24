"""Anthropic thin wrapper. generate(messages, model, stream=True) -> yield chunks."""
import anthropic

from backend.services.settings_store import get_api_key

_client = None


def _get_client():
    global _client
    if _client is None:
        key = get_api_key("anthropic")
        _client = anthropic.Anthropic(api_key=key or "placeholder")
    return _client


def _obj_get(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


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


def _content_to_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict):
                if part.get("type") == "text":
                    text = part.get("text") or ""
                    if text:
                        parts.append(text)
            elif _obj_get(part, "type") == "text":
                text = _obj_get(part, "text") or ""
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


def _build_anthropic_messages(messages):
    """Build Anthropic messages while preserving image/tool_result blocks."""
    system, chat_messages = _split_system(messages)
    anthropic_messages = []
    for m in chat_messages:
        if m.get("role") == "tool":
            anthropic_messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": m.get("tool_call_id"),
                            "content": m.get("content") or "",
                        }
                    ],
                }
            )
            continue
        content = _to_anthropic_content(m)
        if m["role"] == "assistant" and isinstance(content, list):
            anthropic_messages.append({"role": "assistant", "content": content})
        else:
            anthropic_messages.append({"role": m["role"], "content": content})
    return system, anthropic_messages


def _extract_response_text(response):
    blocks = _obj_get(response, "content") or []
    parts = []
    for block in blocks:
        if _obj_get(block, "type") != "text":
            continue
        text = _obj_get(block, "text") or ""
        if text:
            parts.append(text)
    return "".join(parts).strip()


def _extract_native_web_search_meta(response, fallback_query):
    """
    Normalize Anthropic native web search metadata into UI shape:
    [{ "query": "...", "results": [{title, url, snippet, content}] }]
    """
    queries = []
    results = []
    seen_urls = set()

    def _add_result(url, title="", snippet=""):
        clean_url = (url or "").strip()
        if not clean_url:
            return
        key = clean_url.lower()
        if key in seen_urls:
            return
        seen_urls.add(key)
        snippet_text = (snippet or "").strip()
        results.append(
            {
                "title": (title or clean_url).strip() or clean_url,
                "url": clean_url,
                "snippet": snippet_text,
                "content": snippet_text,
            }
        )

    blocks = _obj_get(response, "content") or []
    for block in blocks:
        btype = _obj_get(block, "type")
        if btype in ("server_tool_use", "tool_use"):
            name = (_obj_get(block, "name") or "").strip()
            if name and name != "web_search":
                continue
            input_payload = _obj_get(block, "input") or _obj_get(block, "arguments") or {}
            query = ""
            if isinstance(input_payload, dict):
                query = (_obj_get(input_payload, "query") or _obj_get(input_payload, "q") or "").strip()
            elif isinstance(input_payload, str):
                query = input_payload.strip()
            if query:
                queries.append(query)
            continue

        if btype == "web_search_tool_result":
            tool_content = _obj_get(block, "content") or []
            if isinstance(tool_content, dict):
                continue
            for item in tool_content:
                if _obj_get(item, "type") != "web_search_result":
                    continue
                _add_result(
                    _obj_get(item, "url") or "",
                    _obj_get(item, "title") or "",
                    _obj_get(item, "snippet") or _obj_get(item, "cited_text") or "",
                )
            continue

        if btype != "text":
            continue
        citations = _obj_get(block, "citations") or []
        for citation in citations:
            ctype = _obj_get(citation, "type")
            if ctype and ctype not in ("web_search_result_location", "url_citation"):
                continue
            url = (_obj_get(citation, "url") or "").strip()
            title = (_obj_get(citation, "title") or "").strip()
            snippet = (_obj_get(citation, "cited_text") or "").strip()
            nested = _obj_get(citation, "web_search_result_location") or _obj_get(citation, "url_citation") or {}
            if not url:
                url = (_obj_get(nested, "url") or "").strip()
            if not title:
                title = (_obj_get(nested, "title") or "").strip()
            if not snippet:
                snippet = (_obj_get(nested, "cited_text") or "").strip()
            _add_result(url, title, snippet)

    query = queries[0] if queries else ((fallback_query or "").strip() or "web search")
    return [{"query": query, "results": results}] if results else []


def _generate_with_native_web_search(messages, model):
    """Anthropic native web search path using built-in web_search tool."""
    client = _get_client()
    system, anthropic_messages = _build_anthropic_messages(messages)
    kwargs = {"system": system} if system else {}
    response = client.messages.create(
        model=model,
        max_tokens=20000,
        messages=anthropic_messages,
        tools=[{"type": "web_search_20260209", "name": "web_search"}],
        **kwargs,
    )
    final = _extract_response_text(response)
    query_fallback = _last_user_query(messages)
    web_search_meta = _extract_native_web_search_meta(response, query_fallback)
    return final, web_search_meta


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    if not get_api_key("anthropic"):
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = _get_client()
    system, anthropic_messages = _build_anthropic_messages(messages)
    kwargs = {"system": system} if system else {}
    with client.messages.stream(
        model=model,
        max_tokens=20000,
        messages=anthropic_messages,
        **kwargs
    ) as stream_obj:
        for text in stream_obj.text_stream:
            yield text


def generate_with_native_web_search(messages, model):
    """
    Anthropic native web search path only (no fallback).
    Yields ("status", msg), ("chunk", text), then ("result", (final_content, web_search_meta)).
    """
    if not get_api_key("anthropic"):
        raise ValueError("ANTHROPIC_API_KEY not set")

    print("Anthropic web search path: native web_search_20260209")
    yield ("status", "Searching the web...")
    final, web_search_meta = _generate_with_native_web_search(messages, model)
    total_sources = sum(len((entry or {}).get("results") or []) for entry in (web_search_meta or []))
    print(f"Anthropic native web search succeeded (sources={total_sources})")
    if final:
        chunk_size = 50
        for i in range(0, len(final), chunk_size):
            yield ("chunk", final[i:i + chunk_size])
    yield ("result", (final, web_search_meta))


def generate_with_tools(messages, model, tools, tool_runner):
    """
    Non-streaming tool loop. tool_runner(name, args_dict) -> (content_str, meta_entry | None).
    Yields ("status", "Searching the web...") only when about to run web_search; then yields ("result", (final_content, web_search_meta)).
    """
    from backend.services.tools_schema import WEB_SEARCH_TOOL
    from backend.services import tools_schema
    if not get_api_key("anthropic"):
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
