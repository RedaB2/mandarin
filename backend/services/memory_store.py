"""Should we store? Small model decides from last turn; insert into Memory only when appropriate."""
from backend.models import db, Memory
from backend.services.models_config import get_model_info
from backend.providers import base as providers_base

_MIN_FACT_LENGTH = 10


def _pick_small_model():
    """Prefer GPT-5 Nano; fall back to smallest available model per provider from models.yaml."""
    if get_model_info("openai/gpt-5-nano-2025-08-07"):
        return "openai/gpt-5-nano-2025-08-07"
    # Smallest per provider = last in each provider's list in models.yaml
    from backend.services.models_config import get_models_list
    by_provider = {}
    for m in get_models_list():
        if not m["available"]:
            continue
        by_provider[m["provider"]] = m["id"]
    for mid in (by_provider.get("openai"), by_provider.get("anthropic"), by_provider.get("google")):
        if mid and get_model_info(mid):
            return mid
    return None


def _build_existing_memories_text(user_content):
    """Return formatted text of relevant existing memories (RAG query)."""
    try:
        from backend.services.rag import query as rag_query
        hits = rag_query(user_content, top_k=8)
    except Exception:
        return "No existing memories."
    if not hits:
        return "No existing memories."
    lines = [f"- {content}" for (_id, content) in hits]
    return "\n".join(lines)


def _build_existing_context_text(context_ids):
    """Return formatted text of human context files for given ids (full content, no truncation)."""
    if not context_ids:
        return ""
    from backend.services.prompt_builder import _read_context
    parts = []
    for cid in context_ids:
        parsed = _read_context(cid)
        if not parsed:
            continue
        name, content = parsed
        text = (content or "").strip()
        if text:
            parts.append(f"- [{name}]: {text}")
    if not parts:
        return ""
    return "\n".join(parts)


def _is_obvious_non_fact(raw):
    """Reject obvious non-facts: single Yes/No, or ends with ?"""
    s = raw.strip()
    if s.endswith("?"):
        return True
    if s.upper() in ("YES", "NO"):
        return True
    return False


def extract_and_store(user_content, assistant_content, app, context_ids=None):
    """Run in background: ask small model if there is a fact worth storing; if yes and not duplicate, insert Memory."""
    model_id = _pick_small_model()
    if not model_id:
        return

    # Phase 1: Data gathering (full content; no truncation)
    user_text = (user_content or "")
    assistant_text = (assistant_content or "")
    existing_memories_text = _build_existing_memories_text(user_content or "")
    existing_context_text = _build_existing_context_text(context_ids or [])

    # Phase 2: Build prompt (Concept B + C)
    prompt_parts = [
        "You are a memory filter for a personal assistant. After each conversation turn, you decide whether anything the USER said is worth storing as a long-term fact about them.",
        "",
        "SAVE only when the USER shared:",
        "- A concrete fact about their life (e.g. job, family, where they live, what they own, habits).",
        "- A clear preference or rule they want the assistant to follow in the future.",
        "- Important context that will help in future conversations (e.g. \"I'm allergic to X\", \"I use metric units\").",
        "",
        "Do NOT save when:",
        "- The user only asked a question or made a one-off request.",
        "- The exchange is casual chat, jokes, or opinions about external things (movies, news).",
        "- The \"fact\" is already obvious from the conversation (e.g. \"User asked about the weather\").",
        "- The assistant inferred something the user never stated.",
        "- The fact is already covered by an existing memory below (same information in different words counts as duplicate; e.g. do not save \"user is 6 foot 4\" if we already have a memory about their height).",
        "- The fact is already stated in the Existing context section below (that information is already available every time; do not duplicate it).",
        "- The fact is transient or troubleshooting (e.g. specific commands run, diagnostic steps, one-off fixes).",
        "- The fact is only relevant to a single session or task (e.g. \"user ran X command today\"); only save enduring facts that will still be useful in the future.",
        "",
        "Existing memories we already have (do not store something that repeats or is implied by these):",
        existing_memories_text,
    ]
    if existing_context_text:
        prompt_parts.extend([
            "",
            "Existing context (do not duplicate):",
            existing_context_text,
        ])
    prompt_parts.extend([
        "",
        "Reply with exactly one line:",
        "- If nothing is worth saving: NOTHING",
        "- If something is worth saving: the single fact in 1–2 short sentences (what we learned about the user, not about the world).",
        "",
        f"User: {user_text}",
        f"Assistant: {assistant_text}",
    ])
    prompt = "\n".join(prompt_parts)

    messages = [{"role": "user", "content": prompt}]
    try:
        with app.app_context():
            parts = list(providers_base.generate(messages, model_id, stream=True))
            raw = "".join(parts).strip()

            # Phase 3: Response parsing (plain-text)
            if not raw:
                return
            if len(raw) < _MIN_FACT_LENGTH:
                return
            if "NOTHING" in raw.upper():
                return
            if _is_obvious_non_fact(raw):
                return

            candidate_fact = raw.strip()

            # Phase 4: Dedupe check — skip if candidate is too similar to an existing memory
            try:
                from backend.services.rag import query as rag_query
                dup_hits = rag_query(candidate_fact, top_k=3, min_similarity=0.90)
                if dup_hits:
                    return  # treat as duplicate, do not save
            except Exception:
                pass

            # Phase 5: Persist and index
            mem = Memory(content=candidate_fact, tags=[])
            db.session.add(mem)
            db.session.commit()
            try:
                from backend.services.rag import add_memory
                add_memory(mem.id, mem.content)
            except Exception as e:
                print(f"RAG add_memory failed for extracted memory id={mem.id}: {e}")
    except Exception:
        pass
