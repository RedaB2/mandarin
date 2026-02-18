"""API blueprint: chats, models, streaming, contexts, memory."""
import re
import json
import threading
from datetime import datetime
from pathlib import Path

import yaml
from flask import Blueprint, request, jsonify, Response, stream_with_context, current_app

from backend.models import db, Chat, Message, Memory
from backend.services.prompt_builder import (
    Rule,
    Command,
    build_system_message,
    get_command_body_if_invoked,
    list_contexts,
    load_rules,
    load_commands,
    resolve_active_rules,
)
from backend.services.prompt_builder import _context_name_from_first_line
from backend.services.models_config import get_models_list, get_model_info
import config

api_bp = Blueprint("api", __name__, url_prefix="/api")


@api_bp.route("/models", methods=["GET"])
def list_models():
    return jsonify(get_models_list())


def _safe_context_id(id_str):
    """Allow only alphanumeric, hyphen, underscore."""
    if not id_str or not isinstance(id_str, str):
        return None
    if not re.match(r"^[a-zA-Z0-9_-]+$", id_str):
        return None
    return id_str


def _safe_rule_or_command_id(id_str):
    """Allow only alphanumeric, hyphen, underscore for rule/command ids."""
    if not id_str or not isinstance(id_str, str):
        return None
    if not re.match(r"^[a-zA-Z0-9_-]+$", id_str):
        return None
    return id_str


@api_bp.route("/contexts", methods=["GET"])
def list_contexts_route():
    return jsonify(list_contexts())


@api_bp.route("/contexts/<id>", methods=["GET"])
def get_context(id):
    safe = _safe_context_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    path = config.CONTEXTS_DIR / f"{safe}.md"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    return Response(path.read_text(encoding="utf-8"), mimetype="text/markdown")


@api_bp.route("/contexts/<id>", methods=["PUT"])
def put_context(id):
    safe = _safe_context_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    path = config.CONTEXTS_DIR / f"{safe}.md"
    body = request.get_data(as_text=True) or ""
    path.write_text(body, encoding="utf-8")
    name = _context_name_from_first_line(body) if body else safe
    return jsonify({"id": safe, "name": name})


@api_bp.route("/contexts/<id>", methods=["DELETE"])
def delete_context(id):
    safe = _safe_context_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    path = config.CONTEXTS_DIR / f"{safe}.md"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return "", 204


# ----- Rules (file-backed) -----
@api_bp.route("/rules", methods=["GET"])
def list_rules_route():
    rules = load_rules()
    out = []
    for r in rules.values():
        out.append(
            {
                "id": r.id,
                "name": r.name,
                "always_on": r.always_on,
                "tags": r.tags,
            }
        )
    # Sort by name for stable UI.
    out.sort(key=lambda x: x["name"].lower())
    return jsonify(out)


@api_bp.route("/rules/<id>", methods=["GET"])
def get_rule(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    rules = load_rules()
    r = rules.get(safe)
    if not r:
        return jsonify({"error": "not found"}), 404
    return jsonify(
        {
            "id": r.id,
            "name": r.name,
            "always_on": r.always_on,
            "tags": r.tags,
            "body": r.body,
        }
    )


@api_bp.route("/rules/<id>", methods=["PUT"])
def put_rule(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    data = request.get_json() or {}
    name = (data.get("name") or "").strip() or safe
    always_on = bool(data.get("always_on", False))
    tags = data.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    body = (data.get("body") or "").rstrip()
    meta = {
        "id": safe,
        "name": name,
        "always_on": always_on,
        "tags": tags,
    }
    text = f"---\n{yaml.safe_dump(meta, sort_keys=False).strip()}\n---\n\n{body}\n"
    path = config.RULES_DIR / f"{safe}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    # Refresh cache by reloading.
    _ = load_rules()
    return jsonify(
        {
            "id": safe,
            "name": name,
            "always_on": always_on,
            "tags": tags,
        }
    )


@api_bp.route("/rules/<id>", methods=["DELETE"])
def delete_rule(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    path = config.RULES_DIR / f"{safe}.md"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return "", 204


# ----- Commands (file-backed) -----
@api_bp.route("/commands", methods=["GET"])
def list_commands_route():
    cmds = load_commands()
    out = []
    for c in cmds.values():
        out.append(
            {
                "id": c.id,
                "name": c.name,
                "description": c.description,
                "tags": c.tags,
            }
        )
    out.sort(key=lambda x: x["name"].lower())
    return jsonify(out)


@api_bp.route("/commands/<id>", methods=["GET"])
def get_command(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    cmds = load_commands()
    c = cmds.get(safe)
    if not c:
        return jsonify({"error": "not found"}), 404
    out = {
        "id": c.id,
        "name": c.name,
        "description": c.description,
        "tags": c.tags,
        "body": c.body,
    }
    if c.task is not None:
        out["task"] = c.task
    if c.success_criteria is not None:
        out["success_criteria"] = c.success_criteria
    if c.guidelines is not None:
        out["guidelines"] = c.guidelines
    if getattr(c, "context_ids", None) is not None:
        out["context_ids"] = c.context_ids
    return jsonify(out)


@api_bp.route("/commands/<id>", methods=["PUT"])
def put_command(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    data = request.get_json() or {}
    name = (data.get("name") or "").strip() or safe
    description = (data.get("description") or "").strip()
    tags = data.get("tags") or []
    if not isinstance(tags, list):
        tags = []
    # Accept structured sections or raw body (backward compatibility)
    task = (data.get("task") or "").strip()
    success_criteria = (data.get("success_criteria") or "").strip()
    guidelines = (data.get("guidelines") or "").strip()
    body = (data.get("body") or "").rstrip()
    if "task" in data or "success_criteria" in data or "guidelines" in data:
        body = f"## Task\n\n{task}\n\n## Success Criteria\n\n{success_criteria}\n\n## Guidelines\n\n{guidelines}\n"
    context_ids = data.get("context_ids")
    if context_ids is not None and not isinstance(context_ids, list):
        context_ids = []
    if context_ids is not None:
        context_ids = [str(x) for x in context_ids if x and re.match(r"^[a-zA-Z0-9_-]+$", str(x))]
    meta = {
        "id": safe,
        "name": name,
        "description": description,
        "tags": tags,
    }
    if context_ids is not None:
        meta["context_ids"] = context_ids
    text = f"---\n{yaml.safe_dump(meta, sort_keys=False).strip()}\n---\n\n{body}\n"
    path = config.COMMANDS_DIR / f"{safe}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")
    _ = load_commands()
    return jsonify(
        {
            "id": safe,
            "name": name,
            "description": description,
            "tags": tags,
        }
    )


@api_bp.route("/commands/<id>", methods=["DELETE"])
def delete_command(id):
    safe = _safe_rule_or_command_id(id)
    if not safe:
        return jsonify({"error": "invalid id"}), 400
    path = config.COMMANDS_DIR / f"{safe}.md"
    if not path.exists():
        return jsonify({"error": "not found"}), 404
    path.unlink()
    return "", 204


# ----- Memory (LLM-generated) -----
@api_bp.route("/memory", methods=["GET"])
def list_memory():
    tag = request.args.get("tag")
    mems = Memory.query.order_by(Memory.created_at.desc()).all()
    if tag:
        mems = [m for m in mems if m.tags and tag in m.tags]
    return jsonify([m.to_dict() for m in mems])


@api_bp.route("/memory", methods=["POST"])
def create_memory():
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    tags = data.get("tags")
    if not content:
        return jsonify({"error": "content is required"}), 400
    if tags is not None and not isinstance(tags, list):
        tags = []
    mem = Memory(content=content, tags=tags or [])
    db.session.add(mem)
    db.session.commit()
    try:
        from backend.services.rag import add_memory
        add_memory(mem.id, mem.content)
    except Exception as e:
        print(f"RAG add_memory failed for new memory id={mem.id}: {e}")
    return jsonify(mem.to_dict()), 201


@api_bp.route("/memory/<int:mem_id>", methods=["PATCH"])
def update_memory(mem_id):
    mem = Memory.query.get_or_404(mem_id)
    data = request.get_json() or {}
    if "content" in data:
        mem.content = (data["content"] or "").strip()
    if "tags" in data:
        mem.tags = data["tags"] if isinstance(data["tags"], list) else mem.tags
    db.session.commit()
    try:
        from backend.services.rag import add_memory, delete_memory as rag_delete
        rag_delete(mem_id)
        add_memory(mem.id, mem.content)
    except Exception as e:
        print(f"RAG update failed for memory id={mem_id}: {e}")
    return jsonify(mem.to_dict())


@api_bp.route("/memory/<int:mem_id>", methods=["DELETE"])
def delete_memory_route(mem_id):
    mem = Memory.query.get_or_404(mem_id)
    db.session.delete(mem)
    db.session.commit()
    try:
        from backend.services.rag import delete_memory
        delete_memory(mem_id)
    except Exception:
        pass
    return "", 204


@api_bp.route("/chats", methods=["GET"])
def list_chats():
    chats = Chat.query.order_by(Chat.updated_at.desc()).all()
    return jsonify([c.to_dict() for c in chats])


@api_bp.route("/chats", methods=["POST"])
def create_chat():
    data = request.get_json() or {}
    context_ids = data.get("context_ids", [])
    chat = Chat(title="New chat", context_ids=context_ids)
    db.session.add(chat)
    db.session.commit()
    return jsonify(chat.to_dict()), 201


@api_bp.route("/chats/<int:chat_id>", methods=["GET"])
def get_chat(chat_id):
    chat = Chat.query.get_or_404(chat_id)
    out = chat.to_dict()
    out["messages"] = [m.to_dict() for m in chat.messages]
    return jsonify(out)


@api_bp.route("/chats/<int:chat_id>", methods=["PATCH"])
def update_chat(chat_id):
    chat = Chat.query.get_or_404(chat_id)
    data = request.get_json() or {}
    if "context_ids" in data:
        chat.context_ids = data["context_ids"] if isinstance(data["context_ids"], list) else []
    if "title" in data:
        title = (data.get("title") or "").strip()
        chat.title = title[:80] if title else chat.title
    db.session.commit()
    return jsonify(chat.to_dict())


@api_bp.route("/chats/<int:chat_id>", methods=["DELETE"])
def delete_chat(chat_id):
    chat = Chat.query.get_or_404(chat_id)
    db.session.delete(chat)
    db.session.commit()
    return "", 204


def _title_fallback(first_user_content):
    """When LLM title generation is unavailable, use first ~40 chars of user message."""
    t = (first_user_content or "").strip().replace("\n", " ")[:40]
    return t.strip() or "New chat"


def _generate_title(first_user_content):
    """Use GPT-5 Nano (cheapest) to generate a short title from first ~100 chars. Sync."""
    from backend.providers import base as providers_base
    snippet = (first_user_content or "")[:100]
    messages = [
        {"role": "user", "content": f"Generate a very short chat title (few words) for this prompt. Reply with only the title, nothing else.\n\n{snippet}"}
    ]
    try:
        model_id = "openai/gpt-5-nano-2025-08-07"
        info = get_model_info(model_id)
        if not info:
            return _title_fallback(first_user_content)
        title_parts = list(providers_base.generate(messages, model_id, stream=True))
        title = "".join(title_parts).strip() or _title_fallback(first_user_content)
        return (title[:80] if title else _title_fallback(first_user_content))
    except Exception:
        return _title_fallback(first_user_content)


@api_bp.route("/chats/<int:chat_id>/messages/regenerate", methods=["POST"])
def regenerate_message(chat_id):
    """Stream a new assistant reply for an existing user message. Does not add a new user message."""
    chat = Chat.query.get_or_404(chat_id)
    data = request.get_json() or {}
    user_message_id = data.get("message_id")
    model_id = (data.get("model_id") or "").strip()
    if not user_message_id:
        return jsonify({"error": "message_id is required"}), 400
    if not model_id:
        return jsonify({"error": "model_id is required"}), 400
    if not get_model_info(model_id):
        return jsonify({"error": "model not available"}), 400
    user_msg = Message.query.filter_by(chat_id=chat_id, id=int(user_message_id)).first_or_404()
    if user_msg.role != "user":
        return jsonify({"error": "message_id must be a user message"}), 400
    content = user_msg.content
    cmd_name, cmd_body = get_command_body_if_invoked(content)
    if cmd_name is not None and cmd_body is None:
        return jsonify({"error": f"Command /{cmd_name} not found."}), 400
    user_content_for_llm = (
        f"Command instructions:\n{cmd_body}\n\nUser message: {content.split(None, 1)[1] if content.split() else content}"
        if cmd_body
        else content
    )
    fallback_memories = [m.content for m in Memory.query.order_by(Memory.created_at.desc()).limit(10).all()]
    # Resolve active rules for this request (original user content, plus any rules referenced in the command body).
    commands_used = [cmd_name] if cmd_name else []
    rules_for_request = resolve_active_rules(content, commands_used)
    cmds_regen = load_commands()
    cmd_regen = cmds_regen.get(cmd_name) if cmd_name else None
    effective_context_ids = list(chat.context_ids) if chat.context_ids else []
    if cmd_regen and getattr(cmd_regen, "context_ids", None):
        for cid in cmd_regen.context_ids:
            if cid not in effective_context_ids:
                effective_context_ids.append(cid)
    system = build_system_message(
        effective_context_ids,
        rag_query=content,
        fallback_memories=fallback_memories,
        rules_for_request=rules_for_request,
    )
    messages_for_llm = []
    if system:
        messages_for_llm.append({"role": "system", "content": system})
    for m in chat.messages:
        if m.role not in ("user", "assistant"):
            continue
        if m.id == user_msg.id:
            messages_for_llm.append({"role": "user", "content": user_content_for_llm})
            break
        messages_for_llm.append({"role": m.role, "content": m.content})

    def stream():
        from backend.providers import base as providers_base
        print("\n" + "=" * 60 + " LLM PROMPT (regenerate) " + "=" * 60)
        for msg in messages_for_llm:
            role = msg.get("role", "")
            content_preview = (msg.get("content") or "")[:2000]
            if len(msg.get("content") or "") > 2000:
                content_preview += "\n... [truncated]"
            print(f"\n--- {role.upper()} ---\n{content_preview}")
        print("=" * 60 + "\n")
        buffer = []
        try:
            yield f"data: {json.dumps({'t': 'started'})}\n\n"
            for chunk in providers_base.generate(messages_for_llm, model_id, stream=True):
                buffer.append(chunk)
                yield f"data: {json.dumps({'t': 'chunk', 'c': chunk})}\n\n"
            full_content = "".join(buffer)
            assistant_msg = Message(chat_id=chat_id, role="assistant", content=full_content)
            db.session.add(assistant_msg)
            db.session.commit()
            from backend.services.memory_store import extract_and_store
            threading.Thread(
                target=extract_and_store,
                args=(content, full_content, current_app._get_current_object()),
                kwargs={"context_ids": chat.context_ids or []},
                daemon=True,
            ).start()
            yield f"data: {json.dumps({'t': 'done', 'id': assistant_msg.id, 'title': chat.title})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'t': 'error', 'error': str(e)})}\n\n"

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@api_bp.route("/chats/<int:chat_id>/messages/<int:message_id>", methods=["PATCH"])
def patch_message(chat_id, message_id):
    """Update a message's content and delete all messages after it in the chat."""
    chat = Chat.query.get_or_404(chat_id)
    msg = Message.query.filter_by(chat_id=chat_id, id=message_id).first_or_404()
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    if content != msg.content:
        msg.content = content
    # Delete all messages after this one (by id order)
    Message.query.filter(Message.chat_id == chat_id, Message.id > message_id).delete(synchronize_session=False)
    db.session.commit()
    db.session.refresh(chat)
    out = [m.to_dict() for m in chat.messages]
    return jsonify(out)


@api_bp.route("/chats/<int:chat_id>/messages", methods=["POST"])
def add_message(chat_id):
    """Persist user message, stream assistant reply as SSE, persist assistant. Validate /command."""
    chat = Chat.query.get_or_404(chat_id)
    data = request.get_json() or {}
    content = (data.get("content") or "").strip()
    model_id = (data.get("model_id") or "").strip()
    if not content:
        return jsonify({"error": "content is required"}), 400

    # Command validation: if /name invoked, command must exist
    cmd_name, cmd_body = get_command_body_if_invoked(content)
    if cmd_name is not None and cmd_body is None:
        return jsonify({"error": f"Command /{cmd_name} not found. Please retry with a valid command or without a command."}), 400

    if not model_id:
        return jsonify({"error": "model_id is required"}), 400
    if not get_model_info(model_id):
        return jsonify({"error": "model not available"}), 400

    # Persist user message
    user_msg = Message(chat_id=chat_id, role="user", content=content)
    db.session.add(user_msg)
    db.session.commit()

    # Build user content for LLM: if command, prepend command body
    if cmd_body:
        user_content_for_llm = f"Command instructions:\n{cmd_body}\n\nUser message: {content.split(None, 1)[1] if content.split() else content}"
    else:
        user_content_for_llm = content

    fallback_memories = [m.content for m in Memory.query.order_by(Memory.created_at.desc()).limit(10).all()]
    # Resolve rules based on original user content and any command body.
    commands_used = [cmd_name] if cmd_name else []
    rules_for_request = resolve_active_rules(content, commands_used)
    # When a command is used, merge chat context_ids with command's context_ids (command contexts auto-included).
    cmds = load_commands()
    cmd = cmds.get(cmd_name) if cmd_name else None
    effective_context_ids = list(chat.context_ids) if chat.context_ids else []
    if cmd and getattr(cmd, "context_ids", None):
        for cid in cmd.context_ids:
            if cid not in effective_context_ids:
                effective_context_ids.append(cid)
    system = build_system_message(
        effective_context_ids,
        rag_query=content,
        fallback_memories=fallback_memories,
        rules_for_request=rules_for_request,
    )
    messages_for_llm = []
    if system:
        messages_for_llm.append({"role": "system", "content": system})
    for m in chat.messages:
        if m.id == user_msg.id:
            continue
        if m.role in ("user", "assistant"):
            messages_for_llm.append({"role": m.role, "content": m.content})
    messages_for_llm.append({"role": "user", "content": user_content_for_llm})

    cmds = load_commands()
    cmd = cmds.get(cmd_name) if cmd_name else None
    use_evaluation = (
        cmd is not None
        and getattr(cmd, "task", None)
        and getattr(cmd, "success_criteria", None)
    )
    user_instructions = content.split(None, 1)[1] if cmd_name and content.split() else (content or "")
    messages_before_user = [{"role": m["role"], "content": m["content"]} for m in messages_for_llm[:-1]]

    def stream():
        from backend.providers import base as providers_base
        from backend.services.command_evaluator import evaluate_command_response, execute_task_stream

        try:
            yield f"data: {json.dumps({'t': 'started'})}\n\n"

            if use_evaluation:
                yield f"data: {json.dumps({'t': 'executing', 'msg': 'Completing task...'})}\n\n"
                full_content = ""
                previous_feedback = None
                for attempt in range(1, 4):
                    # Collect chunks without yielding them yet - wait for evaluation
                    buffer = []
                    for chunk in execute_task_stream(
                        cmd,
                        user_instructions,
                        system,
                        messages_before_user,
                        model_id,
                        previous_feedback=previous_feedback,
                    ):
                        buffer.append(chunk)
                    attempt_content = "".join(buffer)

                    yield f"data: {json.dumps({'t': 'evaluating', 'attempt': attempt})}\n\n"
                    passed = False
                    feedback = ""
                    for eval_attempt in range(1, 4):
                        try:
                            passed, feedback = evaluate_command_response(
                                cmd.task,
                                cmd.success_criteria,
                                cmd.guidelines or "",
                                user_instructions,
                                attempt_content,
                                model_id,
                                timeout=60,
                            )
                            break
                        except (TimeoutError, Exception):
                            if eval_attempt >= 3:
                                passed = False
                                feedback = "Evaluation failed after multiple attempts"
                                break

                    if passed:
                        # Success: yield all chunks now, then break
                        for chunk in buffer:
                            yield f"data: {json.dumps({'t': 'chunk', 'c': chunk})}\n\n"
                        full_content = attempt_content
                        yield f"data: {json.dumps({'t': 'passed', 'attempt': attempt})}\n\n"
                        break
                    elif attempt < 3:
                        # Failed but more attempts left: don't show this attempt, retry
                        previous_feedback = feedback
                        yield f"data: {json.dumps({'t': 'retrying', 'attempt': attempt + 1})}\n\n"
                    else:
                        # Final attempt failed: show it anyway
                        for chunk in buffer:
                            yield f"data: {json.dumps({'t': 'chunk', 'c': chunk})}\n\n"
                        full_content = attempt_content
            else:
                print("\n" + "=" * 60 + " LLM PROMPT " + "=" * 60)
                for msg in messages_for_llm:
                    role = msg.get("role", "")
                    content_preview = (msg.get("content") or "")[:2000]
                    if len(msg.get("content") or "") > 2000:
                        content_preview += "\n... [truncated]"
                    print(f"\n--- {role.upper()} ---\n{content_preview}")
                print("=" * 60 + "\n")
                buffer = []
                for chunk in providers_base.generate(messages_for_llm, model_id, stream=True):
                    buffer.append(chunk)
                    yield f"data: {json.dumps({'t': 'chunk', 'c': chunk})}\n\n"
                full_content = "".join(buffer)

            assistant_msg = Message(chat_id=chat_id, role="assistant", content=full_content)
            db.session.add(assistant_msg)
            db.session.flush()
            msg_count = Message.query.filter_by(chat_id=chat_id).count()
            is_first_reply = msg_count == 2
            needs_title = (not chat.title or (chat.title or "").strip() == "New chat")
            if is_first_reply or needs_title:
                new_title = _generate_title(content)
                if new_title and new_title.strip() and (new_title.strip() != "New chat"):
                    title_to_send = new_title.strip()[:80]
                else:
                    title_to_send = _title_fallback(content)
                Chat.query.filter_by(id=chat_id).update(
                    {"title": title_to_send, "updated_at": datetime.utcnow()},
                    synchronize_session=False,
                )
            else:
                title_to_send = chat.title
            db.session.commit()
            from backend.services.memory_store import extract_and_store
            threading.Thread(
                target=extract_and_store,
                args=(content, full_content, current_app._get_current_object()),
                kwargs={"context_ids": chat.context_ids or []},
                daemon=True,
            ).start()
            yield f"data: {json.dumps({'t': 'done', 'id': assistant_msg.id, 'title': title_to_send})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'t': 'error', 'error': str(e)})}\n\n"

    return Response(
        stream_with_context(stream()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
