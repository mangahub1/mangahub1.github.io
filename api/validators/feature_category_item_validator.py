from models.feature_category_item import FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS


def _validate_common(payload):
    errors = []

    if "display_order" in payload:
        try:
            value = int(payload.get("display_order"))
            if value < 0:
                errors.append("display_order must be a non-negative integer.")
        except (TypeError, ValueError):
            errors.append("display_order must be a non-negative integer.")

    if "item_type" in payload:
        item_type = str(payload.get("item_type", "")).strip().upper()
        if item_type not in {"MANGA", "MANGA_CONTENT"}:
            errors.append("item_type must be one of: MANGA, MANGA_CONTENT.")
    if "manga_id" in payload and not str(payload.get("manga_id", "")).strip():
        errors.append("manga_id must be non-empty when provided.")
    if "title" in payload and not str(payload.get("title", "")).strip():
        errors.append("title must be non-empty when provided.")
    if "cover_url" in payload and not isinstance(payload.get("cover_url"), str):
        errors.append("cover_url must be a string.")
    if "tags" in payload:
        tags = payload.get("tags")
        if not isinstance(tags, list) or any(not isinstance(value, str) for value in tags):
            errors.append("tags must be a list of strings.")
    if "is_active" in payload and not isinstance(payload.get("is_active"), bool):
        errors.append("is_active must be a boolean.")

    return errors


def validate_feature_category_item_keys(payload):
    errors = []
    category_id = str(payload.get("category_id", "")).strip()
    sort_key = str(payload.get("sort_key", "")).strip()
    if not category_id:
        errors.append("category_id is required.")
    if not sort_key:
        errors.append("sort_key is required.")
    return errors


def validate_item_type_requirements(payload):
    item_type = str(payload.get("item_type", "")).strip().upper()
    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    if not item_type:
        return "item_type is required."
    if not manga_id:
        return "manga_id is required."
    if item_type == "MANGA_CONTENT" and not content_key:
        return "content_key is required when item_type is MANGA_CONTENT."
    return None


def validate_feature_category_item_post_payload(payload):
    errors = []
    errors.extend(validate_feature_category_item_keys(payload))
    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"category_id", "sort_key"}:
            continue
        if key not in FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_feature_category_item_put_payload(payload):
    errors = []
    errors.extend(validate_feature_category_item_keys(payload))
    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"category_id", "sort_key"}:
            continue
        if key not in FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_feature_category_item_delete_payload(payload):
    return validate_feature_category_item_keys(payload)
