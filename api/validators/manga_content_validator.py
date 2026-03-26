from models.manga_content import MANGA_CONTENT_EDITABLE_FIELDS
from utils.content_key import generate_content_key


def validate_manga_content_post_payload(payload):
    errors = []

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    if not manga_id:
        errors.append("manga_id is required.")
    if not content_key:
        errors.append("content_key is required.")
    title = str(payload.get("title", "")).strip()
    if not title:
        errors.append("title is required.")

    if "content_type" in payload and not isinstance(payload.get("content_type"), str):
        errors.append("content_type must be a string.")
    if "sequence_number" in payload:
        try:
            int(payload.get("sequence_number"))
        except (TypeError, ValueError):
            errors.append("sequence_number must be numeric.")
    if "cover_url" in payload and not isinstance(payload.get("cover_url"), str):
        errors.append("cover_url must be a string.")
    if "file_url" in payload and not isinstance(payload.get("file_url"), str):
        errors.append("file_url must be a string.")

    content_type = str(payload.get("content_type", "")).strip().lower()
    if content_type and content_type not in {"volume", "chapter"}:
        errors.append("content_type must be one of: volume, chapter.")

    for key in payload.keys():
        if key in {"manga_id", "content_key"}:
            continue
        if key not in MANGA_CONTENT_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_manga_content_put_payload(payload):
    errors = []

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    if not manga_id:
        errors.append("manga_id is required.")
    if not content_key:
        errors.append("content_key is required.")
    title = str(payload.get("title", "")).strip()
    if not title:
        errors.append("title is required.")

    if "content_type" in payload and not isinstance(payload.get("content_type"), str):
        errors.append("content_type must be a string.")
    if "sequence_number" in payload:
        try:
            int(payload.get("sequence_number"))
        except (TypeError, ValueError):
            errors.append("sequence_number must be numeric.")
    if "cover_url" in payload and not isinstance(payload.get("cover_url"), str):
        errors.append("cover_url must be a string.")
    if "file_url" in payload and not isinstance(payload.get("file_url"), str):
        errors.append("file_url must be a string.")

    content_type = str(payload.get("content_type", "")).strip().lower()
    if content_type and content_type not in {"volume", "chapter"}:
        errors.append("content_type must be one of: volume, chapter.")

    for key in payload.keys():
        if key in {"manga_id", "content_key"}:
            continue
        if key not in MANGA_CONTENT_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_content_key_matches(payload):
    content_type = str(payload.get("content_type", "")).strip()
    sequence_number = payload.get("sequence_number")
    content_key = str(payload.get("content_key", "")).strip()
    if not content_type or sequence_number in (None, "") or not content_key:
        return None

    try:
        expected = generate_content_key(content_type, sequence_number)
    except ValueError as exc:
        return str(exc)

    if expected != content_key:
        return f"content_key does not match content_type/sequence_number. Expected {expected}."

    return None


def validate_manga_content_delete_payload(payload):
    errors = []
    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    if not manga_id:
        errors.append("manga_id is required.")
    if not content_key:
        errors.append("content_key is required.")
    return errors
