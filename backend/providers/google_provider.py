"""Google (Gemini) thin wrapper. generate(messages, model, stream=True) -> yield chunks.
Uses the google.genai package (not the deprecated google.generativeai)."""
import base64
import config
from google import genai
from google.genai import types

_client = None


def _get_client():
    global _client
    if _client is None:
        if not config.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY not set")
        _client = genai.Client(api_key=config.GOOGLE_API_KEY)
    return _client


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
