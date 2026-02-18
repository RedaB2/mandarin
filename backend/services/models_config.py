"""Load model list from models.yaml; filter by available API keys."""
import os
from pathlib import Path
import yaml

import config

_CONFIG_PATH = Path(__file__).resolve().parent.parent.parent / "models.yaml"
_KEY_MAP = {
    "openai": ("OPENAI_API_KEY", config.OPENAI_API_KEY),
    "anthropic": ("ANTHROPIC_API_KEY", config.ANTHROPIC_API_KEY),
    "google": ("GOOGLE_API_KEY", config.GOOGLE_API_KEY),
}


def _load_yaml():
    if not _CONFIG_PATH.exists():
        return {}
    with open(_CONFIG_PATH) as f:
        return yaml.safe_load(f) or {}


def get_models_list():
    """Return list of { id, name, provider, model, available }."""
    data = _load_yaml()
    out = []
    for provider, key_name_and_value in _KEY_MAP.items():
        key_name, key_value = key_name_and_value
        available = bool(key_value and key_value.strip())
        for entry in data.get(provider, []):
            out.append({
                "id": entry.get("id", ""),
                "name": entry.get("name", entry.get("id", "")),
                "provider": provider,
                "model": entry.get("model", ""),
                "available": available,
            })
    return out


def get_model_info(model_id):
    """Return { provider, model } for model_id or None."""
    for m in get_models_list():
        if m["id"] == model_id:
            return {"provider": m["provider"], "model": m["model"]} if m["available"] else None
    return None
