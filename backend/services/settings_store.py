"""User settings: API keys and default model. Stored in data/settings.json.
Env vars (.env) take precedence for API keys if set; settings file overrides when env is empty."""
import json
from pathlib import Path

import config

SETTINGS_PATH = config.DATA_DIR / "settings.json"

_PROVIDER_ENV_KEYS = {
    "openai": "OPENAI_API_KEY",
    "anthropic": "ANTHROPIC_API_KEY",
    "google": "GOOGLE_API_KEY",
}

_PROVIDER_ENV_FALLBACK = {
    "google": "GEMINI_API_KEY",
}


def _load_raw():
    """Load settings dict from file. Returns {} if missing."""
    if not SETTINGS_PATH.exists():
        return {}
    try:
        data = json.loads(SETTINGS_PATH.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {}
    except (json.JSONDecodeError, OSError):
        return {}


def _save_raw(data):
    """Write settings dict to file."""
    config.ensure_data_dirs()
    SETTINGS_PATH.write_text(json.dumps(data, indent=2), encoding="utf-8")


def get_api_key(provider):
    """Return effective API key for provider. Checks env first, then settings file."""
    import os
    env_key = _PROVIDER_ENV_KEYS.get(provider)
    fallback_key = _PROVIDER_ENV_FALLBACK.get(provider)
    # Env takes precedence
    val = os.environ.get(env_key, "") if env_key else ""
    if not val and fallback_key:
        val = os.environ.get(fallback_key, "") or ""
    if val and val.strip():
        return val.strip()
    # Fall back to settings file
    data = _load_raw()
    keys = data.get("api_keys") or {}
    return (keys.get(provider) or "").strip()


def get_default_model():
    """Return saved default model id, or None."""
    data = _load_raw()
    return (data.get("default_model") or "").strip() or None


def mask_key(key):
    """Return masked representation (••••••••last4). Never expose full keys."""
    if not key or not isinstance(key, str) or len(key) < 4:
        return "••••••••" if key else ""
    return "••••••••" + key[-4:]


def get_settings_for_api():
    """Return settings safe for API response: default_model and masked API key status."""
    effective = {}
    for p in ("openai", "anthropic", "google"):
        k = get_api_key(p)
        effective[p] = {
            "set": bool(k),
            "masked": mask_key(k),
        }
    return {
        "default_model": get_default_model(),
        "api_keys": effective,
    }


def update_settings(updates):
    """Update settings. updates: { default_model?, api_keys? }."""
    data = _load_raw()
    if "default_model" in updates:
        data["default_model"] = (updates["default_model"] or "").strip() or None
    if "api_keys" in updates:
        new_keys = updates["api_keys"]
        if isinstance(new_keys, dict):
            current = data.get("api_keys") or {}
            for k, v in new_keys.items():
                if k in ("openai", "anthropic", "google") and v is not None:
                    v = (v or "").strip()
                    if v:
                        current[k] = v
                    elif k in current:
                        del current[k]
            data["api_keys"] = current
    _save_raw(data)


def invalidate_provider_clients():
    """Clear cached provider clients so they pick up new API keys."""
    try:
        from backend.providers import openai_provider
        openai_provider._client = None  # noqa
    except Exception:
        pass
    try:
        from backend.providers import anthropic_provider
        anthropic_provider._client = None  # noqa
    except Exception:
        pass
    try:
        from backend.providers import google_provider
        google_provider._client = None  # noqa
    except Exception:
        pass
