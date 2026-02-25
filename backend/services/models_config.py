"""Model catalog utilities with provider-fetched models and YAML fallback."""
from pathlib import Path
from threading import Lock
import time

import yaml

import config
from backend.services.settings_store import get_api_key

_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "models.yaml"
_PROVIDERS = ("openai", "anthropic", "google")
_PROVIDER_CACHE_TTL_SECONDS = 300
_PROVIDER_MODELS_CACHE = {}
_PROVIDER_CACHE_LOCK = Lock()

_OPENAI_CHAT_PREFIXES = ("gpt", "chatgpt", "o1", "o3", "o4")
_OPENAI_NON_CHAT_TOKENS = (
    "embedding",
    "whisper",
    "transcribe",
    "audio",
    "tts",
    "moderation",
    "image",
    "dall",
    "instruct",
    "realtime",
)
_GOOGLE_NON_CHAT_TOKENS = ("embedding", "imagen", "veo", "tts", "asr")


def invalidate_models_cache():
    """Clear cached provider model lists."""
    with _PROVIDER_CACHE_LOCK:
        _PROVIDER_MODELS_CACHE.clear()


def _load_yaml():
    if not _CONFIG_PATH.exists():
        return {}
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _write_yaml(data):
    with open(_CONFIG_PATH, "w", encoding="utf-8") as f:
        yaml.safe_dump(data, f, sort_keys=False, default_flow_style=False, allow_unicode=True)


def _fetch_provider_models(provider):
    if provider == "openai":
        from backend.providers import openai_provider
        return openai_provider.list_models()
    if provider == "anthropic":
        from backend.providers import anthropic_provider
        return anthropic_provider.list_models()
    if provider == "google":
        from backend.providers import google_provider
        return google_provider.list_models()
    return []


def _get_cached_provider_models(provider, force_refresh=False):
    now = time.monotonic()
    if not force_refresh:
        with _PROVIDER_CACHE_LOCK:
            cached = _PROVIDER_MODELS_CACHE.get(provider)
            if cached and cached.get("expires_at", 0) > now:
                if cached.get("error"):
                    raise RuntimeError(cached["error"])
                return list(cached.get("models") or [])
    try:
        models = _fetch_provider_models(provider)
    except Exception as e:
        with _PROVIDER_CACHE_LOCK:
            _PROVIDER_MODELS_CACHE[provider] = {
                "models": [],
                "error": str(e),
                "expires_at": now + _PROVIDER_CACHE_TTL_SECONDS,
            }
        raise
    with _PROVIDER_CACHE_LOCK:
        _PROVIDER_MODELS_CACHE[provider] = {
            "models": list(models or []),
            "error": None,
            "expires_at": now + _PROVIDER_CACHE_TTL_SECONDS,
        }
    return list(models or [])


def _normalize_provider_entries(provider, raw_models):
    out = []
    seen = set()
    for item in raw_models or []:
        model = ""
        name = ""
        meta = {}
        if isinstance(item, str):
            model = item.strip()
            name = model
        elif isinstance(item, dict):
            model = (item.get("model") or item.get("id") or "").strip()
            name = (
                (item.get("name") or item.get("display_name") or item.get("displayName") or model)
                .strip()
            )
            meta = dict(item)
        if not model:
            continue
        if provider == "google" and model.startswith("models/"):
            model = model[7:].strip()
        if not model:
            continue
        entry_id = f"{provider}/{model}"
        if entry_id in seen:
            continue
        seen.add(entry_id)
        out.append(
            {
                "id": entry_id,
                "name": name or model,
                "provider": provider,
                "model": model,
                "meta": meta,
            }
        )
    out.sort(key=lambda x: x["model"])
    return out


def _yaml_provider_entries(data, provider):
    out = []
    for item in data.get(provider, []) or []:
        if not isinstance(item, dict):
            continue
        entry_id = (item.get("id") or "").strip()
        model = (item.get("model") or "").strip()
        if not model and entry_id.startswith(f"{provider}/"):
            model = entry_id.split("/", 1)[1].strip()
        if not entry_id and model:
            entry_id = f"{provider}/{model}"
        if not entry_id or not model:
            continue
        out.append(
            {
                "id": entry_id,
                "name": (item.get("name") or entry_id).strip() or entry_id,
                "provider": provider,
                "model": model,
                "meta": {},
            }
        )
    return out


def _has_google_generate_content(actions):
    for action in actions or []:
        s = str(action).strip().lower()
        if "generatecontent" in s:
            return True
    return False


def _is_chat_capable(provider, entry):
    model = (entry.get("model") or "").strip().lower()
    name = (entry.get("name") or "").strip().lower()
    meta = entry.get("meta") or {}

    if provider == "openai":
        if not model:
            return False
        if any(token in model for token in _OPENAI_NON_CHAT_TOKENS):
            return False
        return model.startswith(_OPENAI_CHAT_PREFIXES)

    if provider == "anthropic":
        return model.startswith("claude") or "claude" in name

    if provider == "google":
        actions = meta.get("supported_actions") or meta.get("supportedActions") or []
        if actions:
            return _has_google_generate_content(actions)
        if any(token in model for token in _GOOGLE_NON_CHAT_TOKENS):
            return False
        return model.startswith("gemini") or "gemini" in model

    return False


def _build_provider_catalog(provider, data, force_refresh=False):
    available = bool(get_api_key(provider))
    yaml_entries = [
        entry for entry in _yaml_provider_entries(data, provider) if _is_chat_capable(provider, entry)
    ]

    fetched_entries = []
    if available:
        try:
            raw_models = _get_cached_provider_models(provider, force_refresh=force_refresh)
            fetched_entries = _normalize_provider_entries(provider, raw_models)
            fetched_entries = [
                entry for entry in fetched_entries if _is_chat_capable(provider, entry)
            ]
        except Exception:
            fetched_entries = []

    # UI list prefers fetched provider models; fallback to YAML if fetch failed or returned nothing.
    display_entries = fetched_entries if fetched_entries else yaml_entries

    # Lookup index merges fetched+fallback so configured special/default models keep resolving.
    merged_lookup = {}
    for entry in fetched_entries + yaml_entries:
        if entry["id"] not in merged_lookup:
            merged_lookup[entry["id"]] = entry

    return {
        "available": available,
        "display": display_entries,
        "lookup": list(merged_lookup.values()),
    }


def _build_lookup_index(force_refresh=False):
    data = _load_yaml()
    out = {}
    for provider in _PROVIDERS:
        catalog = _build_provider_catalog(provider, data, force_refresh=force_refresh)
        available = catalog["available"]
        for entry in catalog["lookup"]:
            if entry["id"] not in out:
                out[entry["id"]] = {
                    "provider": entry["provider"],
                    "model": entry["model"],
                    "available": available,
                }
    return out


def get_models_list(force_refresh=False):
    """Return list of { id, name, provider, model, available, default }."""
    data = _load_yaml()
    default_id = (data.get("default") or "").strip() or None
    out = []
    for provider in _PROVIDERS:
        catalog = _build_provider_catalog(provider, data, force_refresh=force_refresh)
        available = catalog["available"]
        for entry in catalog["display"]:
            entry_id = entry["id"]
            out.append(
                {
                    "id": entry_id,
                    "name": entry.get("name", entry_id) or entry_id,
                    "provider": provider,
                    "model": entry.get("model", ""),
                    "available": available,
                    "default": default_id is not None and entry_id == default_id,
                }
            )
    return out


def get_model_info(model_id, force_refresh=False):
    """Return { provider, model } for model_id or None."""
    model_id = (model_id or "").strip()
    if not model_id:
        return None
    lookup = _build_lookup_index(force_refresh=force_refresh)
    entry = lookup.get(model_id)
    if not entry or not entry["available"]:
        return None
    return {"provider": entry["provider"], "model": entry["model"]}


def get_chat_namer_model_id():
    """Return model id for chat title generation, or None if not configured or unavailable."""
    data = _load_yaml()
    model_id = (data.get("chat_namer") or "").strip() or None
    if not model_id or not get_model_info(model_id):
        return None
    return model_id


def get_memory_extractor_model_id():
    """Return model id for memory extraction, or None if not configured or unavailable."""
    data = _load_yaml()
    model_id = (data.get("memory_extractor") or "").strip() or None
    if model_id and get_model_info(model_id):
        return model_id
    return None


def get_default_model_id():
    """Return the default model id from models.yaml, or None."""
    data = _load_yaml()
    return (data.get("default") or "").strip() or None


def set_default_model(model_id):
    """Update the default model in models.yaml. model_id must match a known model id (or None to clear)."""
    model_id = (model_id or "").strip() or None
    data = _load_yaml()
    if model_id is not None:
        valid_ids = set(_build_lookup_index().keys())
        if model_id not in valid_ids:
            raise ValueError(f"Unknown model id: {model_id}")
    data["default"] = model_id
    _write_yaml(data)
