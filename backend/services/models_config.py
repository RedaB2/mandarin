"""Load model list from models.yaml; filter by available API keys."""
from pathlib import Path
import yaml

import config
from backend.services.settings_store import get_api_key

_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "models.yaml"
_PROVIDERS = ("openai", "anthropic", "google")


def _load_yaml():
    if not _CONFIG_PATH.exists():
        return {}
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f) or {}


def get_models_list():
    """Return list of { id, name, provider, model, available, default }."""
    data = _load_yaml()
    default_id = (data.get("default") or "").strip() or None
    out = []
    for provider in _PROVIDERS:
        available = bool(get_api_key(provider))
        for entry in data.get(provider, []):
            entry_id = entry.get("id", "")
            out.append({
                "id": entry_id,
                "name": entry.get("name", entry_id or ""),
                "provider": provider,
                "model": entry.get("model", ""),
                "available": available,
                "default": default_id is not None and entry_id == default_id,
            })
    return out


def get_model_info(model_id):
    """Return { provider, model } for model_id or None."""
    for m in get_models_list():
        if m["id"] == model_id:
            return {"provider": m["provider"], "model": m["model"]} if m["available"] else None
    return None


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
