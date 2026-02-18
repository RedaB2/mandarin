"""App configuration. DATA_DIR and paths; API keys from environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root so API keys and DATA_DIR can be set there
load_dotenv(Path(__file__).resolve().parent / ".env")

# Base data directory (default ./data/)
DATA_DIR = Path(os.environ.get("DATA_DIR", os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")))

def ensure_data_dirs():
    """Create data dir and subdirs if missing."""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "contexts").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "commands").mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "rules").mkdir(parents=True, exist_ok=True)

# Paths
CONTEXTS_DIR = DATA_DIR / "contexts"
COMMANDS_DIR = DATA_DIR / "commands"
RULES_DIR = DATA_DIR / "rules"
RULES_PATH = DATA_DIR / "rules.md"
SYSTEM_PROMPT_PATH = DATA_DIR / "system_prompt.md"
DB_PATH = DATA_DIR / "app.db"
CHROMA_DIR = DATA_DIR / "chroma"

# User name for base system prompt (optional; from env)
USER_NAME = os.environ.get("USER_NAME", "").strip()

# API keys (from env)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")

# RAG: only include memories with similarity >= this (0–1). Chroma uses cosine distance; we use similarity = 1 - distance.
RAG_SIMILARITY_THRESHOLD = float(os.environ.get("RAG_SIMILARITY_THRESHOLD", "0.5"))
