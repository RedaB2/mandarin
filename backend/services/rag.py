"""Chroma vector store for memory. Embed with sentence-transformers; add/query by memory id.
If ChromaDB fails to import (e.g. Python 3.14), RAG is disabled and memory uses DB fallback only."""
import config

try:
    import chromadb
    from chromadb.config import Settings
    _chromadb_available = True
except Exception as e:
    _chromadb_available = False
    _chromadb_error = e
    print("RAG (ChromaDB) disabled:", e)
    print("  Memory will use DB fallback only. For vector search, use Python 3.12 or 3.13.")

_collection = None
_embed_fn = None
_model = None


def sync_memories_from_db(app):
    """Ensure Chroma has every memory from the DB (fixes empty/stale RAG after failed adds or old data)."""
    if not _chromadb_available:
        return
    with app.app_context():
        from backend.models import Memory
        for m in Memory.query.all():
            try:
                add_memory(m.id, m.content)
            except Exception as e:
                print(f"RAG sync: failed to index memory id={m.id}: {e}")


def _get_embed_fn():
    global _embed_fn, _model
    if _embed_fn is None:
        from sentence_transformers import SentenceTransformer
        model = SentenceTransformer(config.RAG_EMBEDDING_MODEL)
        _model = model

        def _embed(texts):
            arr = model.encode(texts)
            return arr.tolist() if hasattr(arr, "tolist") else list(arr)
        _embed_fn = _embed
    return _embed_fn


def _get_model():
    """Return the loaded SentenceTransformer model (for tokenizer / max_seq_length). Loads model if needed."""
    _get_embed_fn()
    return _model


def chunk_text_for_embedding(text, max_tokens=None):
    """Split long text into chunks that fit the embedding model's max length. Used for context dedup only.
    Returns list of non-empty strings. If tokenizer fails, returns [text] or []."""
    if not (text or "").strip():
        return []
    try:
        model = _get_model()
        tokenizer = model.tokenizer
        max_len = max_tokens if max_tokens is not None else model.max_seq_length
        encoded = tokenizer.encode(
            text.strip(),
            add_special_tokens=False,
            truncation=False,
            return_tensors=None,
        )
        if not encoded:
            return [text.strip()]
        chunks = []
        for i in range(0, len(encoded), max_len):
            chunk_ids = encoded[i : i + max_len]
            chunk_text = tokenizer.decode(chunk_ids, skip_special_tokens=True).strip()
            if chunk_text:
                chunks.append(chunk_text)
        return chunks if chunks else [text.strip()]
    except Exception:
        return [text.strip()] if text.strip() else []


def clear_memory_collection():
    """Remove all vectors from the Chroma memory collection. Used by the re-embed script after switching models."""
    if not _chromadb_available:
        return
    coll = _get_collection()
    res = coll.get()
    ids = res.get("ids") or []
    if ids:
        coll.delete(ids=ids)


def _get_collection():
    global _collection
    if _collection is None:
        config.CHROMA_DIR.mkdir(parents=True, exist_ok=True)
        client = chromadb.PersistentClient(path=str(config.CHROMA_DIR), settings=Settings(anonymized_telemetry=False))
        _collection = client.get_or_create_collection(
            "memory",
            metadata={"description": "LLM memory", "hnsw:space": "cosine"},
        )
    return _collection


def add_memory(memory_id, content):
    """Embed content and add to Chroma with id=str(memory_id)."""
    if not _chromadb_available:
        return
    coll = _get_collection()
    embed = _get_embed_fn()
    vec = embed([content])
    coll.upsert(ids=[str(memory_id)], embeddings=vec, documents=[content])


def delete_memory(memory_id):
    if not _chromadb_available:
        return
    try:
        _get_collection().delete(ids=[str(memory_id)])
    except Exception:
        pass


def query(query_text, top_k=5, min_similarity=None):
    """Return list of (memory_id, content) from Chroma. Only includes memories with similarity >= min_similarity (0–1).
    Uses config.RAG_SIMILARITY_THRESHOLD if min_similarity is None. Chroma returns cosine distance; we use similarity = 1 - distance."""
    if not _chromadb_available:
        return []
    threshold = min_similarity if min_similarity is not None else config.RAG_SIMILARITY_THRESHOLD
    coll = _get_collection()
    embed = _get_embed_fn()
    vec = embed([query_text])
    res = coll.query(
        query_embeddings=vec,
        n_results=min(top_k, 20),
        include=["documents", "distances"],
    )
    if not res or not res["ids"] or not res["ids"][0]:
        return []
    ids_list = res["ids"][0]
    docs_list = (res.get("documents") or [[]])[0]
    dists_list = (res.get("distances") or [[]])[0]
    out = []
    for i, id_ in enumerate(ids_list):
        doc = (docs_list[i] if i < len(docs_list) else "") or ""
        if i < len(dists_list):
            dist = dists_list[i]
            similarity = max(0.0, 1.0 - dist)
            if similarity < threshold:
                continue
        out.append((id_, doc))
    return out
