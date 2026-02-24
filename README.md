# Mandarin

![Mandarin logo](frontend/mandarin-logo.png)

A personal context manager for everyday LLM chats that uses your own context and memory to give relevant, personalized help.

---

## Overview

Mandarin is an AI chat interface that combines **written context** (background, preferences, situations), **LLM-saved memory** (facts stored over time), and **configurable rules and commands** into a single, streamlined experience.

---

## Features

- **Chat** — Multi-turn conversations with streaming, model selection, auto-generated titles, and per-chat context attachment.
- **Context** — Create and attach Markdown context files to chats so the assistant has relevant background.
- **Memory** — The LLM stores facts from conversations and retrieves them when relevant (RAG).
- **Rules** — Define Markdown rule snippets, reference them with `@rule-id`, or set them to always apply.
- **Commands** — Invoke with `/command-id`; each command has a task and success criteria, with optional retries and evaluation.
- **Attachments & Web Search** — Attach files to messages and optionally enable web search per chat.
- **Multi-Provider** — Supports multiple LLM providers.
- **UI** — Sidebar with chats, context picker, and command picker. Dark/light theme. Markdown and code rendering.

## Getting Started

Prerequisites:
- Python 3.12 or 3.13
- Node.js and npm

```bash
# Clone the repo
git clone https://github.com/chase12803/mandarin.git
cd mandarin

# Works on Linux, macOS, and Windows
python run.py

# If your machine exposes Python as python3 instead
python3 run.py
```

Deprecated OS-specific wrappers were moved to `scripts/legacy/`.

---

## Configuration

1. Add your LLM provider API keys to `.env` or set them in the app.
2. Create context files in the app to give the assistant background on you or your topics.
3. Optionally define rules and commands to customize behavior.

---

## Status

**Early development** — built for personal use and shared with a small group. Not intended for public release.

### Known Issues

- LLM-managed context selection is not functioning properly; the LLM may save irrelevant facts and deduplication doesn't work reliably.
