"""Canonical web_search tool definition and per-provider adapters."""

WEB_SEARCH_TOOL = {
    "name": "web_search",
    "description": "Search the web for up-to-date information. Call this when the user's question requires current or factual information from the web.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "The search query to execute."},
        },
        "required": ["query"],
    },
}


def openai_tools():
    """OpenAI format: list of tool specs with function schema."""
    return [
        {
            "type": "function",
            "function": {
                "name": WEB_SEARCH_TOOL["name"],
                "description": WEB_SEARCH_TOOL["description"],
                "parameters": WEB_SEARCH_TOOL["parameters"],
            },
        }
    ]


def anthropic_tools():
    """Anthropic format: list of tool definitions."""
    return [
        {
            "name": WEB_SEARCH_TOOL["name"],
            "description": WEB_SEARCH_TOOL["description"],
            "input_schema": WEB_SEARCH_TOOL["parameters"],
        }
    ]


def gemini_tools():
    """Gemini (Google) format: function declarations."""
    return [
        {
            "name": WEB_SEARCH_TOOL["name"],
            "description": WEB_SEARCH_TOOL["description"],
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query to execute.",
                    },
                },
                "required": ["query"],
            },
        }
    ]
