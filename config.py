"""App configuration. DATA_DIR and paths; API keys from environment."""
import os
from pathlib import Path

from dotenv import load_dotenv

# Load .env from project root so API keys and DATA_DIR can be set there
load_dotenv(Path(__file__).resolve().parent / ".env")

# Base data directory (default ./data/)
_DATA_ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", os.path.join(_DATA_ROOT, "data")))

# Built-in prompts (markdown files with placeholders); overrides live in data/
PROMPTS_DIR = _DATA_ROOT / "prompts"

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
DB_PATH = DATA_DIR / "app.db"
CHROMA_DIR = DATA_DIR / "chroma"

# User name for base system prompt (optional; from env)
USER_NAME = os.environ.get("USER_NAME", "").strip()

# API keys (from env)
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY", "")
GOOGLE_API_KEY = os.environ.get("GOOGLE_API_KEY", "") or os.environ.get("GEMINI_API_KEY", "")
TAVILY_API_KEY = os.environ.get("TAVILY_API_KEY", "")

# Web search (Tavily)
TAVILY_MAX_RESULTS = int(os.environ.get("TAVILY_MAX_RESULTS", "5"))

# RAG: embedding model for memory indexing and retrieval (sentence-transformers model name).
RAG_EMBEDDING_MODEL = os.environ.get("RAG_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")

# RAG: only include memories with similarity >= this (0–1). Chroma uses cosine distance; we use similarity = 1 - distance.
RAG_SIMILARITY_THRESHOLD = float(os.environ.get("RAG_SIMILARITY_THRESHOLD", "0.5"))

# File attachments (file-based prompting)
MAX_ATTACHMENT_SIZE_BYTES = int(os.environ.get("MAX_ATTACHMENT_SIZE_BYTES", str(10 * 1024 * 1024)))  # 10 MB
MAX_ATTACHMENTS_PER_MESSAGE = int(os.environ.get("MAX_ATTACHMENTS_PER_MESSAGE", "3"))
EXTRACTED_TEXT_MAX_CHARS = int(os.environ.get("EXTRACTED_TEXT_MAX_CHARS", "60000"))
ALLOWED_ATTACHMENT_EXTENSIONS = frozenset(
    ext.strip().lower()
    for ext in (os.environ.get("ALLOWED_ATTACHMENT_EXTENSIONS", ".pdf,.docx,.txt,.md,.py,.png,.jpg,.jpeg,.webp").split(","))
    if ext.strip()
)
