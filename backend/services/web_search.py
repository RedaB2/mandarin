"""Web search via Tavily API. Cache by query similarity, retries on failure."""
import difflib
import re
import time
from typing import Any

import config

# ~1k tokens ≈ 4000 chars
MAX_CONTENT_CHARS = 4000

_cache: dict[str, list[dict[str, Any]]] = {}
_CACHE_SIMILARITY_THRESHOLD = 0.85


def _normalize_query(q: str) -> str:
    q = (q or "").strip().lower()
    q = re.sub(r"\s+", " ", q)
    return q


def _find_similar_cached_query(query: str) -> str | None:
    """Return cache key if a similar query exists, else None."""
    nq = _normalize_query(query)
    if not nq:
        return None
    for key in _cache:
        ratio = difflib.SequenceMatcher(None, nq, key).ratio()
        if ratio >= _CACHE_SIMILARITY_THRESHOLD:
            return key
    return None


def _truncate_content(text: str | None) -> str:
    if not text:
        return ""
    text = (text or "").strip()
    if len(text) <= MAX_CONTENT_CHARS:
        return text
    return text[: MAX_CONTENT_CHARS].rsplit(maxsplit=1)[0] + "…"


def _search_tavily_once(query: str) -> list[dict[str, Any]]:
    """Call Tavily API once. Returns list of {title, url, snippet, content}."""
    if not config.TAVILY_API_KEY:
        return []
    try:
        from tavily import TavilyClient
    except ImportError:
        return []
    client = TavilyClient(api_key=config.TAVILY_API_KEY)
    max_results = getattr(config, "TAVILY_MAX_RESULTS", 5)
    response = client.search(query=query, max_results=max_results)
    raw = response.get("results", []) if isinstance(response, dict) else getattr(response, "results", [])
    results = []
    for item in raw or []:
        if isinstance(item, dict):
            title = item.get("title") or ""
            url = item.get("url") or ""
            content = item.get("content") or item.get("snippet") or ""
        else:
            title = getattr(item, "title", "") or ""
            url = getattr(item, "url", "") or ""
            content = getattr(item, "content", None) or getattr(item, "snippet", "") or ""
        content = _truncate_content(content)
        snippet = (content[:500] + "…") if len(content) > 500 else content
        results.append({
            "title": title,
            "url": url,
            "snippet": snippet,
            "content": content,
        })
    return results


def search(query: str) -> list[dict[str, Any]]:
    """
    Search the web for the given query. Uses Tavily; results cached by query similarity.
    Returns list of dicts with keys: title, url, snippet, content (truncated ~1k tokens).
    On failure after retries, returns empty list.
    """
    query = (query or "").strip()
    if not query:
        return []

    # Check cache for similar query
    similar_key = _find_similar_cached_query(query)
    if similar_key is not None:
        return _cache[similar_key]

    last_error = None
    for attempt in range(3):
        try:
            results = _search_tavily_once(query)
            if results is not None:
                key = _normalize_query(query)
                _cache[key] = results
                return results
        except Exception as e:
            last_error = e
            if attempt < 2:
                time.sleep(1.0 + attempt * 0.5)
    # After retries, return empty so the flow continues without web context
    return []
