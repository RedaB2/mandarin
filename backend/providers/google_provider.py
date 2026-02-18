"""Google (Gemini) thin wrapper. generate(messages, model, stream=True) -> yield chunks.
Uses the google.genai package (not the deprecated google.generativeai)."""
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


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    client = _get_client()
    system_parts = []
    chat_messages = []
    for m in messages:
        if m["role"] == "system":
            system_parts.append(m.get("content") or "")
        else:
            chat_messages.append({"role": m["role"], "content": m.get("content") or ""})
    system = "\n".join(system_parts).strip() if system_parts else None
    # Build contents: list of Content(role='user'|'model', parts=[Part.from_text(...)])
    contents = []
    for m in chat_messages:
        role = "model" if m["role"] == "assistant" else "user"
        contents.append(types.Content(role=role, parts=[types.Part.from_text(text=m["content"])]))
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
