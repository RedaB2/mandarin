"""Shared generate interface: messages, model_id, stream -> yield chunks."""

from backend.services.web_search_mode import (
    WEB_SEARCH_MODE_NATIVE,
    WEB_SEARCH_MODE_OFF,
    WEB_SEARCH_MODE_TAVILY,
    normalize_web_search_mode,
)


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


def _web_search_tool_runner(name, args):
    """Run web_search tool; return (content_str for LLM, meta_entry for message.meta)."""
    from backend.services import web_search as web_search_svc
    from backend.services.tools_schema import WEB_SEARCH_TOOL
    if name != WEB_SEARCH_TOOL["name"]:
        return ("Unknown tool.", None)
    query = (args.get("query") or "").strip()
    if not query:
        return ("No query provided.", None)
    results = web_search_svc.search(query)
    if not results:
        content_str = "No results found (search may have failed or returned nothing)."
        return (content_str, {"query": query, "results": []})
    lines = [f"Search results for \"{query}\":", ""]
    for r in results:
        title = r.get("title") or "Untitled"
        url = r.get("url") or ""
        snippet = (r.get("snippet") or r.get("content") or "")[:500]
        lines.append(f"- [{title}]({url})")
        if snippet:
            lines.append(snippet[:500])
        lines.append("")
    content_str = "\n".join(lines).strip()
    return (content_str, {"query": query, "results": results})


def generate_with_web_search(messages, model_id, web_search_mode=WEB_SEARCH_MODE_TAVILY):
    """
    Run generate with web_search tool; non-streaming.
    Yields ("status", msg) when a search is about to run, then ("result", (final_content, web_search_meta)).
    """
    from backend.services.models_config import get_model_info
    mode = normalize_web_search_mode(web_search_mode, default=WEB_SEARCH_MODE_OFF)
    if mode == WEB_SEARCH_MODE_OFF:
        raise ValueError("Web search mode is off.")
    info = get_model_info(model_id)
    if not info:
        raise ValueError(f"Unknown or unavailable model: {model_id}")
    provider = info["provider"]
    model = info["model"]
    if provider == "openai":
        from backend.providers import openai_provider
        if mode == WEB_SEARCH_MODE_NATIVE:
            gen = openai_provider.generate_with_native_web_search(messages, model)
        elif mode == WEB_SEARCH_MODE_TAVILY:
            gen = openai_provider.generate_with_tavily_web_search(messages, model, _web_search_tool_runner)
        else:
            raise ValueError(f"Unsupported web search mode: {mode}")
    elif provider == "anthropic":
        from backend.providers import anthropic_provider
        if mode == WEB_SEARCH_MODE_NATIVE:
            gen = anthropic_provider.generate_with_native_web_search(messages, model)
        elif mode == WEB_SEARCH_MODE_TAVILY:
            gen = anthropic_provider.generate_with_tools(messages, model, None, _web_search_tool_runner)
        else:
            raise ValueError(f"Unsupported web search mode: {mode}")
    elif provider == "google":
        from backend.providers import google_provider
        if mode == WEB_SEARCH_MODE_NATIVE:
            gen = google_provider.generate_with_native_web_search(messages, model)
        elif mode == WEB_SEARCH_MODE_TAVILY:
            gen = google_provider.generate_with_tools(messages, model, None, _web_search_tool_runner)
        else:
            raise ValueError(f"Unsupported web search mode: {mode}")
    else:
        raise ValueError(f"Unknown provider: {provider}")
    yield from gen
