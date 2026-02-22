"""Load prompt templates from the prompts directory (markdown files with placeholders)."""
import config


def load_prompt(name: str) -> str:
    """Load prompt from prompts/<name>.md. Returns empty string if file is missing."""
    path = config.PROMPTS_DIR / f"{name}.md"
    if not path.exists():
        return ""
    return path.read_text(encoding="utf-8").strip()
