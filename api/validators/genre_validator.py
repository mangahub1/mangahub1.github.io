from models.genre import GENRE_EDITABLE_FIELDS


def _validate_common(payload):
    errors = []
    if "name" in payload and not str(payload.get("name", "")).strip():
        errors.append("name must be non-empty when provided.")
    if "is_active" in payload and not isinstance(payload.get("is_active"), bool):
        errors.append("is_active must be a boolean.")
    return errors


def validate_genre_post_payload(payload):
    errors = []
    genre_id = str(payload.get("genre_id", "")).strip()
    if not genre_id:
        errors.append("genre_id is required.")

    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"genre_id"}:
            continue
        if key not in GENRE_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_genre_put_payload(payload):
    errors = []
    genre_id = str(payload.get("genre_id", "")).strip()
    if not genre_id:
        errors.append("genre_id is required.")

    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"genre_id"}:
            continue
        if key not in GENRE_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_genre_delete_payload(payload):
    genre_id = str(payload.get("genre_id", "")).strip()
    if not genre_id:
        return ["genre_id is required."]
    return []
