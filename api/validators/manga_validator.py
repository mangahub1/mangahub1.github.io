from models.manga import MANGA_EDITABLE_FIELDS


def validate_manga_post_payload(payload):
    errors = []
    manga_id = str(payload.get("manga_id", "")).strip()
    if not manga_id:
        errors.append("manga_id is required.")

    title = str(payload.get("title", "")).strip()
    if not title:
        errors.append("title is required.")

    if "category_ids" in payload:
        category_ids = payload.get("category_ids")
        if not isinstance(category_ids, list) or any(not isinstance(value, str) for value in category_ids):
            errors.append("category_ids must be a list of strings.")

    if "genre_ids" in payload:
        genre_ids = payload.get("genre_ids")
        if not isinstance(genre_ids, list) or any(not isinstance(value, str) for value in genre_ids):
            errors.append("genre_ids must be a list of strings.")

    if "cover_url" in payload and not isinstance(payload.get("cover_url"), str):
        errors.append("cover_url must be a string.")

    for key in payload.keys():
        if key in {"manga_id"}:
            continue
        if key not in MANGA_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_manga_put_payload(payload):
    errors = []
    manga_id = str(payload.get("manga_id", "")).strip()
    if not manga_id:
        errors.append("manga_id is required.")

    if "title" in payload and not str(payload.get("title", "")).strip():
        errors.append("title must be non-empty when provided.")

    if "category_ids" in payload:
        category_ids = payload.get("category_ids")
        if not isinstance(category_ids, list) or any(not isinstance(value, str) for value in category_ids):
            errors.append("category_ids must be a list of strings.")

    if "genre_ids" in payload:
        genre_ids = payload.get("genre_ids")
        if not isinstance(genre_ids, list) or any(not isinstance(value, str) for value in genre_ids):
            errors.append("genre_ids must be a list of strings.")

    if "cover_url" in payload and not isinstance(payload.get("cover_url"), str):
        errors.append("cover_url must be a string.")

    for key in payload.keys():
        if key in {"manga_id"}:
            continue
        if key not in MANGA_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_manga_delete_payload(payload):
    manga_id = str(payload.get("manga_id", "")).strip()
    if not manga_id:
        return ["manga_id is required."]
    return []
