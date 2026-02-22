# Prompts

Markdown prompt templates used by the app. Placeholders are filled at runtime.

---

## `system.md`

Main assistant system prompt. Edit this file to change the base system prompt.

| Placeholder | Description |
|-------------|-------------|
| `{{DATE}}` | Full date, e.g. "Sunday, February 22, 2025". |
| `{{DAY}}` | Day of week, e.g. "Sunday". |
| `{{TIME}}` | Time of day in the app’s timezone (e.g. EST/EDT), e.g. "2:30 PM EST". |
| `{{USER_NAME}}` | Display name for the user from config/env; falls back to "the user" if unset. |

---

## `memory_extraction.md`

Prompt for the small model that decides whether the last exchange contains a fact worth storing in long-term memory. Sent as the **system** message (with a short user message asking for the reply) so the model follows instructions more reliably. Used after each assistant reply when memory extraction runs.

| Placeholder | Description |
|-------------|-------------|
| `{{EXISTING_MEMORIES}}` | Bullet list of existing memory snippets (from RAG over the user message) so the model avoids duplicates. |
| `{{EXISTING_CONTEXT}}` | Optional block: "Existing context (do not duplicate…)" plus the text of the current context files. Empty when no context is attached. |
| `{{USER_TEXT}}` | The user’s message in the turn being considered for extraction. |
| `{{ASSISTANT_TEXT}}` | The assistant’s reply in that turn. |

---

## `command_evaluation.md`

Prompt for the evaluation model that checks whether a command run met the command’s success criteria. Uses Python `.format()`-style placeholders (`{name}`).

| Placeholder | Description |
|-------------|-------------|
| `{task}` | The command’s Task section: what the assistant is supposed to do. |
| `{success_criteria}` | The command’s Success Criteria section: conditions for a passing response. |
| `{guidelines}` | The command’s Guidelines section: how the response should be written or structured. |
| `{user_instructions}` | The part of the user message after the `/command` invocation. |
| `{assistant_response}` | The full assistant reply being evaluated. |

---

## `command_task.md`

Body of the **user** message when executing a command. The full request still uses the main system prompt (`system.md` plus rules, context, memory) as the system message; this file is only the user-message content (task, guidelines, user instructions). On retries, previous evaluation feedback is prepended.

| Placeholder | Description |
|-------------|-------------|
| `{{PREVIOUS_FEEDBACK}}` | On retry: "Previous attempt did not meet success criteria. Evaluation feedback: … Please try again…". Empty on first attempt. |
| `{{TASK}}` | The command’s Task section (what to do). |
| `{{GUIDELINES}}` | The command’s Guidelines section. |
| `{{USER_INSTRUCTIONS}}` | The user’s text after the `/command` (e.g. after `/writecode`). |

---

## `chat_title.md`

Prompt used to generate a short (2–4 word) chat title from the start of the first user message.

| Placeholder | Description |
|-------------|-------------|
| `{{SNIPPET}}` | First ~100 characters of the first user message in the chat (no newlines). |
