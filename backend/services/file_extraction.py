"""Extract text or image data from uploaded files for file-based prompting."""
import base64
from io import BytesIO

import config


# MIME types we treat as images (no text extraction; pass to vision API).
IMAGE_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp", ".gif"})
IMAGE_MIMES = frozenset({"image/png", "image/jpeg", "image/jpg", "image/webp", "image/gif"})


def _extension(filename: str) -> str:
    """Return lowercase extension including the dot, e.g. '.pdf'."""
    if "." in filename:
        return "." + filename.rsplit(".", 1)[-1].lower()
    return ""


def _is_image(ext: str, content_type: str | None) -> bool:
    return ext in IMAGE_EXTENSIONS or (content_type and content_type.split(";")[0].strip().lower() in IMAGE_MIMES)


def _mime_for_image(ext: str, content_type: str | None) -> str:
    if content_type:
        mime = content_type.split(";")[0].strip().lower()
        if mime.startswith("image/"):
            return mime
    return {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif"}.get(ext, "image/png")


def _truncate(text: str, max_chars: int) -> str:
    if len(text) <= max_chars:
        return text
    return text[:max_chars] + "\n\n[Truncated...]"


def _extract_pdf(data: bytes, max_chars: int) -> str:
    try:
        from pypdf import PdfReader
        reader = PdfReader(BytesIO(data))
        parts = []
        for page in reader.pages:
            if sum(len(p) for p in parts) >= max_chars:
                break
            parts.append(page.extract_text() or "")
        text = "\n\n".join(parts)
        return _truncate(text, max_chars)
    except Exception:
        return ""


def _extract_docx(data: bytes, max_chars: int) -> str:
    try:
        from docx import Document
        doc = Document(BytesIO(data))
        parts = [p.text for p in doc.paragraphs]
        text = "\n".join(parts)
        return _truncate(text, max_chars)
    except Exception:
        return ""


def _extract_plain_text(data: bytes, max_chars: int) -> str:
    try:
        text = data.decode("utf-8", errors="replace")
        return _truncate(text, max_chars)
    except Exception:
        return ""


def extract_attachments(files: list[tuple[bytes, str, str | None]]) -> tuple[list[dict], list[dict]]:
    """
    Process a list of (file_bytes, filename, content_type) and return:
    - attachments_for_db: list of { type, filename, extracted_text?, image_data? } for persistence.
    - content_parts_for_llm: list of { type: "text", text } or { type: "image_url", image_url: { url } } in order.

    Validates size (MAX_ATTACHMENT_SIZE_BYTES), count (MAX_ATTACHMENTS_PER_MESSAGE), and allowed extensions.
    Raises ValueError with a message if validation fails.
    """
    if len(files) > config.MAX_ATTACHMENTS_PER_MESSAGE:
        raise ValueError(f"Too many attachments (max {config.MAX_ATTACHMENTS_PER_MESSAGE})")

    max_chars = config.EXTRACTED_TEXT_MAX_CHARS
    attachments_for_db: list[dict] = []
    content_parts_for_llm: list[dict] = []

    for data, filename, content_type in files:
        if len(data) > config.MAX_ATTACHMENT_SIZE_BYTES:
            raise ValueError(f"File too large: {filename} (max {config.MAX_ATTACHMENT_SIZE_BYTES} bytes)")

        ext = _extension(filename)
        if ext not in config.ALLOWED_ATTACHMENT_EXTENSIONS:
            raise ValueError(f"File type not allowed: {filename} (extension {ext or 'none'})")

        if _is_image(ext, content_type):
            b64 = base64.standard_b64encode(data).decode("ascii")
            mime = _mime_for_image(ext, content_type)
            data_url = f"data:{mime};base64,{b64}"
            attachments_for_db.append({
                "type": "image",
                "filename": filename,
                "extracted_text": None,
                "image_data": b64,
            })
            content_parts_for_llm.append({"type": "image_url", "image_url": {"url": data_url}})
            continue

        # Document: extract text
        if ext == ".pdf":
            text = _extract_pdf(data, max_chars)
        elif ext == ".docx":
            text = _extract_docx(data, max_chars)
        else:
            # .txt, .md, .py or any other allowed doc type
            text = _extract_plain_text(data, max_chars)

        if not text.strip():
            text = f"[Could not extract: {filename}]"
        attachments_for_db.append({
            "type": "text",
            "filename": filename,
            "extracted_text": text,
            "image_data": None,
        })
        content_parts_for_llm.append({"type": "text", "text": f"[Attachment: {filename}]\n{text}"})

    return attachments_for_db, content_parts_for_llm
