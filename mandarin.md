# Mandarin

**Mandarin** is my personal-assistant chat app. It uses my own context and memory so the assistant can give me relevant, personalized help.

---

## Purpose

A single chat interface that combines my written context (background, preferences), facts the LLM has saved over time (memory), and optional rules and commands. I use multiple LLM providers. I can attach context files to chats and run commands with defined tasks and success criteria. Web search and file attachments are available.

---

## Current features

- **Chat** — Multi-turn chat with streaming, model selection, auto-generated chat titles, and per-chat context (I attach context files to a conversation).
- **Context** — Markdown context files I create and attach to chats so the assistant has background on me or the topic.
- **Memory** — The LLM stores facts from our conversations; relevant stored facts are retrieved and given to the model when they match the conversation.
- **Rules** — Markdown snippets I can reference (e.g. `@rule-id`) or set to always apply.
- **Commands** — I invoke with `/command-id`; each command has a task and success criteria, with optional retries and evaluation.
- **Attachments & web search** — I can attach files to messages and optionally enable web search per chat.
- **UI** — Sidebar (chats, context picker, command picker), dark/light theme, markdown and code rendering.

---

## Current bugs

1. **LLM managed context does not work** — The feature that would let the LLM manage or suggest which context is used is not functioning. The LLM often saves irrelevant facts and the existing deuplication measures do not work.
2. **Wide code blocks break the chat UI** — Very wide code in messages can break the layout (overflow or scroll) instead of staying contained.
