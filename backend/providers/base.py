"""Shared generate interface: messages, model_id, stream -> yield chunks."""

def generate(messages, model_id, stream=True):
    """Dispatch to the right provider. Yields text chunks."""
    from backend.services.models_config import get_model_info
    info = get_model_info(model_id)
    if not info:
        raise ValueError(f"Unknown or unavailable model: {model_id}")
    provider = info["provider"]
    model = info["model"]
    if provider == "openai":
        from backend.providers import openai_provider
        yield from openai_provider.generate(messages, model, stream=stream)
    elif provider == "anthropic":
        from backend.providers import anthropic_provider
        yield from anthropic_provider.generate(messages, model, stream=stream)
    elif provider == "google":
        from backend.providers import google_provider
        yield from google_provider.generate(messages, model, stream=stream)
    else:
        raise ValueError(f"Unknown provider: {provider}")
