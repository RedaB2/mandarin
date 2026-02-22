"""Build LLM message content from a Message (text or multimodal from attachments)."""


def _mime_from_filename(filename: str) -> str:
    if not filename or "." not in filename:
        return "image/png"
    ext = "." + filename.rsplit(".", 1)[-1].lower()
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "image/png")


def message_to_llm_content(msg) -> str | list[dict]:
    """
    Return content for the LLM for this message: either a string (no attachments)
    or a list of content parts (text + attachment parts in order).
    """
    attachments = getattr(msg, "attachments", None) or []
    if not attachments:
        return msg.content or ""

    parts = []
    # 1. User's typed text
    if msg.content and msg.content.strip():
        parts.append({"type": "text", "text": msg.content})

    # 2. Each attachment
    for att in attachments:
        atype = att.get("type") or "text"
        filename = att.get("filename") or "file"
        if atype == "image" and att.get("image_data"):
            mime = _mime_from_filename(filename)
            url = f"data:{mime};base64,{att['image_data']}"
            parts.append({"type": "image_url", "image_url": {"url": url}})
        elif atype == "text" and att.get("extracted_text"):
            parts.append({"type": "text", "text": f"[Attachment: {filename}]\n{att['extracted_text']}"})

    if not parts:
        return msg.content or ""
    if len(parts) == 1 and parts[0].get("type") == "text":
        return parts[0].get("text", "")
    return parts
