"""OpenAI thin wrapper. generate(messages, model, stream=True) -> yield chunks."""
from openai import OpenAI

from backend.services.settings_store import get_api_key

_client = None

def _get_client():
    global _client
    if _client is None:
        key = get_api_key("openai")
        _client = OpenAI(api_key=key or "sk-placeholder")
    return _client


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    if not get_api_key("openai"):
        raise ValueError("OPENAI_API_KEY not set")
    client = _get_client()
    stream_obj = client.chat.completions.create(
        model=model,
        messages=[{"role": m["role"], "content": m["content"]} for m in messages],
        stream=stream,
    )
    for chunk in stream_obj:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
