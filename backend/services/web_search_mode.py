"""Shared helpers for web search mode normalization and compatibility."""

WEB_SEARCH_MODE_OFF = "off"
WEB_SEARCH_MODE_NATIVE = "native"
WEB_SEARCH_MODE_TAVILY = "tavily"

WEB_SEARCH_MODES = (
    WEB_SEARCH_MODE_OFF,
    WEB_SEARCH_MODE_NATIVE,
    WEB_SEARCH_MODE_TAVILY,
)


def parse_web_search_mode(value):
    """Return normalized mode string or None if invalid."""
    if value is None:
        return None
    mode = str(value).strip().lower()
    if mode in WEB_SEARCH_MODES:
        return mode
    return None


def normalize_web_search_mode(value, default=WEB_SEARCH_MODE_OFF):
    """Return normalized mode string, falling back to default when invalid."""
    parsed = parse_web_search_mode(value)
    if parsed is not None:
        return parsed
    return default


def mode_from_legacy_enabled(enabled):
    """Map legacy boolean toggle to explicit mode."""
    return WEB_SEARCH_MODE_TAVILY if bool(enabled) else WEB_SEARCH_MODE_OFF


def is_web_search_enabled(mode):
    """True when mode implies a web search call."""
    return normalize_web_search_mode(mode, default=WEB_SEARCH_MODE_OFF) != WEB_SEARCH_MODE_OFF


def resolve_chat_web_search_mode(chat):
    """
    Resolve chat mode with backward compatibility:
    - prefer explicit chat.web_search_mode when present/valid
    - otherwise derive from legacy chat.web_search_enabled
    """
    explicit = parse_web_search_mode(getattr(chat, "web_search_mode", None))
    if explicit is not None:
        return explicit
    return mode_from_legacy_enabled(getattr(chat, "web_search_enabled", False))


def is_command_web_search_mode_explicit(command):
    """True when command has an explicit mode set in metadata."""
    if command is None:
        return False
    explicit_flag = getattr(command, "web_search_mode_explicit", None)
    if explicit_flag is not None:
        return bool(explicit_flag)
    return parse_web_search_mode(getattr(command, "web_search_mode", None)) is not None


def command_web_search_mode_for_api(command):
    """
    Return a stable mode value for API responses.

    Legacy commands without explicit mode fall back to the old boolean field.
    """
    explicit = parse_web_search_mode(getattr(command, "web_search_mode", None))
    if explicit is not None:
        return explicit
    return mode_from_legacy_enabled(getattr(command, "web_search_enabled", False))


def resolve_command_web_search_mode(command, chat_mode=WEB_SEARCH_MODE_OFF):
    """
    Resolve command mode for execution.

    Rules:
    - explicit command mode wins
    - legacy command web_search_enabled=True inherits chat mode
    - otherwise off
    """
    explicit = parse_web_search_mode(getattr(command, "web_search_mode", None))
    if explicit is not None and is_command_web_search_mode_explicit(command):
        return explicit
    if bool(getattr(command, "web_search_enabled", False)):
        return normalize_web_search_mode(chat_mode, default=WEB_SEARCH_MODE_OFF)
    return WEB_SEARCH_MODE_OFF
