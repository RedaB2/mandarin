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
    """Return list of { id, name, provider, model, available }."""
    data = _load_yaml()
    out = []
    for provider in _PROVIDERS:
        available = bool(get_api_key(provider))
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
