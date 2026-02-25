"""Google (Gemini) thin wrapper. generate(messages, model, stream=True) -> yield chunks.
Uses the google.genai package (not the deprecated google.generativeai)."""
import base64
from google import genai
from google.genai import types

from backend.services.settings_store import get_api_key

_client = None


def _get_client():
    global _client
    if _client is None:
        key = get_api_key("google")
        if not key:
            raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not set")
        _client = genai.Client(api_key=key)
    return _client


def _obj_get(obj, key, default=None):
    if isinstance(obj, dict):
        return obj.get(key, default)
    return getattr(obj, key, default)


def _build_contents(messages):
    """Build list of Content for Gemini from messages (role, content or tool parts)."""
    system_parts = []
    rest = []
    for m in messages:
        if m.get("role") == "system":
            system_parts.append(m.get("content") or "")
        else:
            rest.append(m)
    system = "\n".join(system_parts).strip() if system_parts else None
    contents = []
    for m in rest:
        role = "model" if m["role"] == "assistant" else "user"
        content = m.get("content")
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, dict):
                    if part.get("type") == "text":
                        parts.append(types.Part.from_text(text=part.get("text", "")))
                    elif part.get("type") == "image_url":
                        url = (part.get("image_url") or {}).get("url") or ""
                        if url.startswith("data:") and ";base64," in url:
                            try:
                                header, b64 = url.split(";base64,", 1)
                                mime = header[5:].strip().lower() or "image/png"
                                data = base64.standard_b64decode(b64)
                                parts.append(types.Part.from_bytes(data=data, mime_type=mime))
                            except Exception:
                                pass
                    elif part.get("type") == "function_response":
                        parts.append(types.Part.from_function_response(
                            name=part.get("name", ""),
                            response=part.get("response", {}),
                        ))
                else:
                    if getattr(part, "text", None) is not None:
                        parts.append(types.Part.from_text(text=part.text))
                    elif getattr(part, "function_response", None) is not None:
                        fr = part.function_response
                        parts.append(types.Part.from_function_response(name=fr.name, response=fr.response or {}))
            if parts:
                contents.append(types.Content(role=role, parts=parts))
        else:
            contents.append(types.Content(role=role, parts=[types.Part.from_text(text=content or "")]))
    return system, contents


def _content_to_text(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and part.get("type") == "text":
                text = part.get("text") or ""
                if text:
                    parts.append(text)
            elif _obj_get(part, "text") is not None:
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


def _extract_response_text(response):
    text = _obj_get(response, "text") or ""
    if isinstance(text, str) and text.strip():
        return text
    pieces = []
    candidates = _obj_get(response, "candidates") or []
    for candidate in candidates:
        content = _obj_get(candidate, "content")
        if not content:
            continue
        for part in _obj_get(content, "parts") or []:
            part_text = _obj_get(part, "text") or ""
            if part_text:
                pieces.append(part_text)
    return "".join(pieces)


def _extract_native_web_search_meta(response, fallback_query):
    """
    Normalize Gemini grounding metadata into UI shape:
    [{ "query": "...", "results": [{title, url, snippet, content}] }]
    """
    queries = []
    results = []
    result_by_url = {}

    def _add_result(url, title="", snippet=""):
        clean_url = (url or "").strip()
        if not clean_url:
            return
        key = clean_url.lower()
        snippet_text = (snippet or "").strip()
        if key in result_by_url:
            if snippet_text and not result_by_url[key]["snippet"]:
                result_by_url[key]["snippet"] = snippet_text
                result_by_url[key]["content"] = snippet_text
            return
        entry = {
            "title": (title or clean_url).strip() or clean_url,
            "url": clean_url,
            "snippet": snippet_text,
            "content": snippet_text,
        }
        results.append(entry)
        result_by_url[key] = entry

    candidates = _obj_get(response, "candidates") or []
    for candidate in candidates:
        grounding = _obj_get(candidate, "grounding_metadata") or _obj_get(candidate, "groundingMetadata")
        if not grounding:
            continue

        raw_queries = _obj_get(grounding, "web_search_queries") or _obj_get(grounding, "webSearchQueries") or []
        for query in raw_queries:
            if isinstance(query, str) and query.strip():
                queries.append(query.strip())

        chunks = _obj_get(grounding, "grounding_chunks") or _obj_get(grounding, "groundingChunks") or []
        for chunk in chunks:
            web = _obj_get(chunk, "web") or {}
            _add_result(
                _obj_get(web, "uri") or _obj_get(web, "url") or "",
                _obj_get(web, "title") or "",
            )

        supports = _obj_get(grounding, "grounding_supports") or _obj_get(grounding, "groundingSupports") or []
        for support in supports:
            indices = _obj_get(support, "grounding_chunk_indices") or _obj_get(support, "groundingChunkIndices") or []
            segment = _obj_get(support, "segment") or {}
            snippet = (_obj_get(segment, "text") or "").strip()
            if not snippet:
                continue
            for index in indices:
                try:
                    chunk_idx = int(index)
                except (TypeError, ValueError):
                    continue
                if chunk_idx < 0 or chunk_idx >= len(chunks):
                    continue
                web = _obj_get(chunks[chunk_idx], "web") or {}
                url = (_obj_get(web, "uri") or _obj_get(web, "url") or "").strip()
                if not url:
                    continue
                _add_result(url, _obj_get(web, "title") or "", snippet)
                break

    query = queries[0] if queries else ((fallback_query or "").strip() or "web search")
    return [{"query": query, "results": results}] if results else []


def list_models():
    """Return normalized Gemini models list: [{ model, name, supported_actions }]."""
    if not get_api_key("google"):
        return []
    client = _get_client()
    out = []
    seen = set()
    for item in client.models.list():
        raw_name = (_obj_get(item, "name") or "").strip()
        if not raw_name:
            continue
        model_id = raw_name[7:] if raw_name.startswith("models/") else raw_name
        if not model_id or model_id in seen:
            continue
        seen.add(model_id)
        display_name = (
            (_obj_get(item, "display_name") or _obj_get(item, "displayName") or "").strip()
        )
        supported = _obj_get(item, "supported_actions") or _obj_get(item, "supportedActions") or []
        supported_actions = [str(action).strip() for action in supported if str(action).strip()]
        out.append(
            {
                "model": model_id,
                "name": display_name or model_id,
                "supported_actions": supported_actions,
            }
        )
    out.sort(key=lambda x: x["model"])
    return out


def _generate_with_native_web_search(messages, model):
    """Gemini native web search path using google_search grounding."""
    client = _get_client()
    system, contents = _build_contents(messages)
    config_kw = {"tools": [types.Tool(google_search=types.GoogleSearch())]}
    if system:
        config_kw["system_instruction"] = system
    response = client.models.generate_content(
        model=model,
        contents=contents,
        config=types.GenerateContentConfig(**config_kw),
    )
    final = (_extract_response_text(response) or "").strip()
    query_fallback = _last_user_query(messages)
    web_search_meta = _extract_native_web_search_meta(response, query_fallback)
    return final, web_search_meta


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    client = _get_client()
    system, contents = _build_contents(messages)
    config_kw = {}
    if system:
        config_kw["system_instruction"] = system
    if stream:
        for chunk in client.models.generate_content_stream(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kw) if config_kw else None,
        ):
            if chunk.text:
                yield chunk.text
    else:
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kw) if config_kw else None,
        )
        if response.text:
            yield response.text


def generate_with_native_web_search(messages, model):
    """
    Gemini native web search path only (no fallback).
    Yields ("status", msg), ("chunk", text), then ("result", (final_content, web_search_meta)).
    """
    if not get_api_key("google"):
        raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not set")

    print("Google web search path: native google_search grounding")
    yield ("status", "Searching the web...")
    final, web_search_meta = _generate_with_native_web_search(messages, model)
    total_sources = sum(len((entry or {}).get("results") or []) for entry in (web_search_meta or []))
    print(f"Google native web search succeeded (sources={total_sources})")
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
    client = _get_client()
    gemini_tools_list = tools_schema.gemini_tools()
    tool = types.Tool(function_declarations=gemini_tools_list)
    web_search_meta = []
    current = list(messages)

    while True:
        system, contents = _build_contents(current)
        config_kw = {"tools": [tool]}
        if system:
            config_kw["system_instruction"] = system
        response = client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(**config_kw),
        )
        text_parts = []
        function_calls = []
        candidates = getattr(response, "candidates", []) or []
        for candidate in candidates:
            content = getattr(candidate, "content", None)
            if not content:
                continue
            for part in getattr(content, "parts", []) or []:
                if getattr(part, "text", None) not in (None, ""):
                    text_parts.append(part.text)
                fc = getattr(part, "function_call", None)
                if fc is not None:
                    function_calls.append({
                        "name": getattr(fc, "name", "") or "",
                        "args": getattr(fc, "args", None) or {},
                    })
        if function_calls:
            # Append model turn with text
            model_content = [{"type": "text", "text": "".join(text_parts)}] if text_parts else []
            current.append({"role": "assistant", "content": "".join(text_parts)})
            # User turn with function responses
            user_content = []
            for fc in function_calls:
                if fc["name"] == WEB_SEARCH_TOOL["name"]:
                    yield ("status", "Searching the web...")
                content_str, meta_entry = tool_runner(fc["name"], fc["args"])
                if meta_entry:
                    web_search_meta.append(meta_entry)
                user_content.append({"type": "function_response", "name": fc["name"], "response": {"result": content_str}})
            current.append({"role": "user", "content": user_content})
            continue
        final = "".join(text_parts).strip()
        if final:
            # Stream the final response in chunks
            chunk_size = 50
            for i in range(0, len(final), chunk_size):
                yield ("chunk", final[i:i + chunk_size])
        yield ("result", (final, web_search_meta))
        return
