# LLM-Managed Memory

This document describes how the application’s **LLM-managed memory** works: how facts are extracted, stored, retrieved, and used in chat.

---

## Overview

- **Storage**: Facts live in the SQLite DB (`Memory` model) and in a Chroma vector store for semantic search.
- **Extraction**: After each assistant reply, a small/cheap model runs in the background to decide whether the last user/assistant exchange contains one fact worth storing. If so, and it passes deduplication checks, it is written to the DB and embedded in Chroma.
- **Retrieval**: When building the system message for a new user message, the current user message (optionally expanded) is used to query the vector store. Retrieved memories are injected into the system prompt under `## Relevant memory`. If RAG fails or returns nothing, a fallback list of recent memories from the DB is used instead.
- **Manual memory**: Users can create, edit, and delete memories via the API/UI; those are also indexed in Chroma.

---

## Data Model

**`Memory` (backend/models.py)**

| Column       | Type   | Description                          |
|-------------|--------|--------------------------------------|
| `id`        | int    | Primary key (used as Chroma document id) |
| `content`   | text   | Single fact, one or two short sentences |
| `tags`      | JSON   | Optional list of strings (for filtering; retrieval is semantic, not tag-based) |
| `created_at`| datetime | When the memory was created        |

- **SQLite**: All memories are in `app.db` in the `memory` table.
- **Chroma**: Each memory is stored as one document with `id = str(memory_id)`, embedding from `content`, and cosine similarity. Collection name: `"memory"`, space: `"cosine"`.

---

## Extraction Pipeline

Extraction runs **asynchronously** in a daemon thread after an assistant message is fully streamed and saved. It is triggered in two places:

1. **POST /chats/:id/messages** — after the first assistant reply in the stream is committed.
2. **POST /chats/:id/messages/regenerate** — after the regenerated assistant message is committed.

**Entry point**: `backend/services/memory_store.extract_and_store(user_content, assistant_content, app, context_ids=None)`.

### Step 1: Model selection

- Prefer the model set in `models.yaml` under `memory_extractor` (e.g. `google/gemini-3-flash-preview`), if it exists and is available.
- Otherwise `_pick_small_model()`: prefer `openai/gpt-5-nano-2025-08-07`, else the smallest available model per provider from `models.yaml`.

If no model is available, extraction exits without doing anything.

### Step 2: Data gathering

- **User and assistant text**: Full `user_content` and `assistant_content` from the last exchange (no truncation).
- **Existing memories for the prompt**: RAG query with the user message, `top_k=8`, to get relevant existing memories so the extractor can avoid duplicates. Rendered as a bullet list.
- **Existing context for the prompt**: Full content of all context files attached to the current chat (`context_ids`). Rendered so the model knows not to store facts that are already in “context” (those are always available when that context is attached).

### Step 3: Prompt and LLM call

- **Template**: `prompts/memory_extraction.md` (see `prompts/README.md` for placeholders).
- **Placeholders**:  
  `{{EXISTING_MEMORIES}}`, `{{EXISTING_CONTEXT}}`, `{{USER_TEXT}}`, `{{ASSISTANT_TEXT}}`.
- **Messages**: One system message (filled template) + one user message:  
  `"Reply with exactly one line: NOTHING or the single fact. No explanation."`
- The model is called with `stream=True`; the full reply is concatenated and trimmed.

### Step 4: Response parsing and filtering

- Empty or too short (< 10 characters) → discard.
- Reply contains `"NOTHING"` (case-insensitive) → discard.
- `_is_obvious_non_fact(raw)`: reject if the line is exactly "Yes"/"No" or ends with `?` → discard.
- Otherwise the line is treated as the **candidate fact**.

### Step 5: Deduplication

Two checks; if either indicates a duplicate, the candidate is **not** stored.

1. **Similarity to existing memories**  
   RAG query with the candidate as query text, `top_k=5`, `min_similarity=0.90`. If any hit is returned, the candidate is considered a duplicate of an existing memory.

2. **Similarity to any context file**  
   For every context file (all contexts in the app, not only the current chat), the candidate is compared to the context text. For long texts, the context is chunked with the same tokenizer/max length as the embedding model (`backend/services/rag.chunk_text_for_embedding`), and the candidate is compared to each chunk via embedding cosine similarity with threshold `0.9`. If any chunk is similar enough, or if a simple substring match (candidate in context or context in candidate) holds, the candidate is treated as already present in context and is not stored.

### Step 6: Persist and index

- Insert into DB: `Memory(content=candidate_fact, tags=[])`.
- Commit.
- Call `backend/services/rag.add_memory(mem.id, mem.content)` to embed and upsert into Chroma.

Any exception in the extraction pipeline is caught and ignored (no crash; extraction is best-effort).

---

## Retrieval (Injection into the system message)

**Entry point**: `backend/services/prompt_builder.build_system_message(context_ids=..., rag_query=..., fallback_memories=..., rules_for_request=...)`.

When the client sends a new user message (e.g. POST /chats/:id/messages), the API builds the system message and passes:

- **rag_query**: The raw user message text (or command-stripped content used for the turn).
- **fallback_memories**: The 10 most recent memories by `created_at` from the DB (content only). Used when RAG is not used or returns no hits.

### When there are few memories (≤ 5)

- If `fallback_memories` has at most 5 items, the system **does not** run RAG.  
- It uses all of `fallback_memories` as the “Relevant memory” section.  
- This avoids sparse/unreliable retrieval when the memory set is small.

### When there are more than 5 memories

1. **Query expansion** (optional): `_expand_rag_query_for_retrieval(rag_query)`  
   - If the user message is non-empty and ≤ 100 characters and contains first-person phrasing (e.g. “ i ”, “ my ”, “ me ”, “am i”, “do i”, “what’s my”, “what is my”), the query is expanded by appending:  
     `" height weight physical attributes user facts"`.  
   - This helps retrieve relevant personal facts for short questions like “How tall am I?”.

2. **RAG query**:  
   - `backend/services/rag.query(expanded_query, top_k=5)`  
   - Uses the configured embedding model to embed the query and fetch the 5 nearest memories from Chroma (cosine similarity).
   - Only memories with similarity ≥ `config.RAG_SIMILARITY_THRESHOLD` (default `0.5`) are kept.

3. **Fallback**:  
   - If the RAG call throws or returns no hits, the system uses `fallback_memories` (the 10 most recent from DB) as the memory section.

The chosen memory lines are formatted as a single block under the heading `## Relevant memory` in the system message. The main system prompt (`prompts/system.md`) instructs the assistant to use this section when provided.

---

## RAG (Chroma + sentence-transformers)

**Module**: `backend/services/rag`.

- **Vector store**: Chroma, persistent, in `config.CHROMA_DIR` (default `data/chroma`).
- **Collection**: Name `"memory"`, distance metric `hnsw:space = "cosine"`. Documents are the memory `content`; ids are `str(memory_id)`.
- **Embeddings**: `sentence_transformers.SentenceTransformer(config.RAG_EMBEDDING_MODEL)`. Default model: `BAAI/bge-small-en-v1.5` (overridable via env `RAG_EMBEDDING_MODEL`).
- **Similarity**: Chroma returns cosine *distance*; the code converts to similarity as `1 - distance` and filters by `RAG_SIMILARITY_THRESHOLD` (env `RAG_SIMILARITY_THRESHOLD`, default `0.5`).

**Functions used by memory:**

- **add_memory(memory_id, content)** — Embed `content` and upsert one document with id `str(memory_id)`.
- **delete_memory(memory_id)** — Remove the document with id `str(memory_id)` from the collection.
- **query(query_text, top_k=5, min_similarity=None)** — Embed `query_text`, run similarity search, return list of `(memory_id, content)` with similarity ≥ `min_similarity` (or config default). `memory_id` in results is the string id from Chroma.

If Chroma or sentence-transformers are unavailable (e.g. import error), RAG is disabled and memory retrieval relies only on the DB fallback (recent memories).

---

## Startup: Syncing Chroma with the DB

On application startup, `app.py` calls `backend.services.rag.sync_memories_from_db(app)`.

- For every `Memory` in the DB, it calls `add_memory(m.id, m.content)`.
- This repopulates or repairs the Chroma collection so it matches the DB (e.g. after a previous run where RAG writes failed, or when restoring from a DB backup).

---

## Re-embedding after changing the embedding model

If you change `RAG_EMBEDDING_MODEL` (or env `RAG_EMBEDDING_MODEL`), existing vectors in Chroma were built with the old model and are inconsistent.

- **Script**: `scripts/reembed_memories.py`
- **Behavior**: Clears the Chroma memory collection, then re-adds every `Memory` from the DB using the current embedding model.
- **Usage**: From project root, `python scripts/reembed_memories.py`. Use `--dry-run` to only print how many memories would be re-embedded.

---

## Manual memory API (and indexing)

- **GET /api/memory** — List all memories (optional `?tag=...` to filter by tag). Order: newest first.
- **POST /api/memory** — Create a memory (`content` required, optional `tags`). The new row is committed, then `rag.add_memory(mem.id, mem.content)` is called so it is indexed.
- **PATCH /api/memory/:id** — Update content and/or tags. The code deletes the old vector and re-adds with `rag.add_memory(mem.id, mem.content)` so Chroma stays in sync.
- **DELETE /api/memory/:id** — Delete the memory from the DB and call `rag.delete_memory(mem_id)` so the vector is removed.

Same storage and retrieval path as extracted memories: DB + Chroma, and they appear in RAG results and fallback the same way.

---

## Configuration summary

| What | Where | Default / note |
|------|--------|-----------------|
| Memory extractor model | `models.yaml` → `memory_extractor` | e.g. `google/gemini-3-flash-preview`; fallback: smallest available model |
| Embedding model | `config.RAG_EMBEDDING_MODEL` / env `RAG_EMBEDDING_MODEL` | `BAAI/bge-small-en-v1.5` |
| Similarity threshold | `config.RAG_SIMILARITY_THRESHOLD` / env `RAG_SIMILARITY_THRESHOLD` | `0.5` (0–1) |
| Chroma directory | `config.CHROMA_DIR` | `DATA_DIR/chroma` (e.g. `data/chroma`) |
| Extraction prompt | `prompts/memory_extraction.md` | See file for guidelines and placeholders |
| Min fact length | `memory_store._MIN_FACT_LENGTH` | 10 characters |
| Dedupe similarity (extraction) | In code | 0.90 vs existing memories and context chunks |
| RAG retrieval top_k | In code | 5 for system message; 8 for existing memories in extraction prompt |

---

## File reference

| File | Role |
|------|------|
| `backend/models.py` | `Memory` model (DB schema) |
| `backend/services/memory_store.py` | Extraction: `extract_and_store`, model choice, dedupe, DB + RAG add |
| `backend/services/rag.py` | Chroma collection, embed model, `add_memory` / `delete_memory` / `query`, `chunk_text_for_embedding`, `sync_memories_from_db`, `clear_memory_collection` |
| `backend/services/prompt_builder.py` | `build_system_message`: RAG vs fallback, `_expand_rag_query_for_retrieval` |
| `backend/routes/api.py` | Memory CRUD endpoints; calls to `extract_and_store` after stream/regenerate; building system message with `rag_query` and `fallback_memories` |
| `backend/services/models_config.py` | `get_memory_extractor_model_id()` from `models.yaml` |
| `prompts/memory_extraction.md` | Extraction prompt template and guidelines |
| `prompts/system.md` | Base system prompt; describes “Relevant memory” section |
| `config.py` | `RAG_EMBEDDING_MODEL`, `RAG_SIMILARITY_THRESHOLD`, `CHROMA_DIR` |
| `scripts/reembed_memories.py` | Re-embed all memories after changing embedding model |
| `app.py` | Calls `sync_memories_from_db(app)` on startup |
