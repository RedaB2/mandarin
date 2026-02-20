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


def generate(messages, model, stream=True):
    """messages: list of { role, content }. Yields content deltas."""
    if not get_api_key("anthropic"):
        raise ValueError("ANTHROPIC_API_KEY not set")
    client = _get_client()
    system = ""
    chat_messages = []
    for m in messages:
        if m["role"] == "system":
            system += (m.get("content") or "") + "\n"
        else:
            chat_messages.append({"role": m["role"], "content": m["content"]})
    kwargs = {"system": system.strip()} if system else {}
    with client.messages.stream(
        model=model,
        max_tokens=4096,
        messages=chat_messages,
        **kwargs
    ) as stream_obj:
        for text in stream_obj.text_stream:
            yield text
