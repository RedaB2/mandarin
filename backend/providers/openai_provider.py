"""OpenAI thin wrapper. generate(messages, model, stream=True) -> yield chunks."""
import config
from openai import OpenAI

_client = None

def _get_client():
    global _client
    if _client is None:
        _client = OpenAI(api_key=config.OPENAI_API_KEY or "sk-placeholder")
    return _client


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    client = _get_client()
    if not config.OPENAI_API_KEY:
        raise ValueError("OPENAI_API_KEY not set")
    stream_obj = client.chat.completions.create(
        model=model,
        messages=[{"role": m["role"], "content": m["content"]} for m in messages],
        stream=stream,
    )
    for chunk in stream_obj:
        if chunk.choices and chunk.choices[0].delta.content:
            yield chunk.choices[0].delta.content
