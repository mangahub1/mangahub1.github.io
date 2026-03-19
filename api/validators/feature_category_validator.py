from models.feature_category import FEATURE_CATEGORY_EDITABLE_FIELDS


def _validate_common(payload):
    errors = []

    if "name" in payload and not str(payload.get("name", "")).strip():
        errors.append("name must be non-empty when provided.")
    if "slug" in payload and not str(payload.get("slug", "")).strip():
        errors.append("slug must be non-empty when provided.")
    if "page_key" in payload and not str(payload.get("page_key", "")).strip():
        errors.append("page_key must be non-empty when provided.")
    if "display_order" in payload:
        try:
            int(payload.get("display_order"))
        except (TypeError, ValueError):
            errors.append("display_order must be numeric.")
    if "is_active" in payload and not isinstance(payload.get("is_active"), bool):
        errors.append("is_active must be a boolean.")

    return errors


def validate_feature_category_post_payload(payload):
    errors = []
    category_id = str(payload.get("category_id", "")).strip()
    if not category_id:
        errors.append("category_id is required.")

    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"category_id"}:
            continue
        if key not in FEATURE_CATEGORY_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_feature_category_put_payload(payload):
    errors = []
    category_id = str(payload.get("category_id", "")).strip()
    if not category_id:
        errors.append("category_id is required.")

    errors.extend(_validate_common(payload))

    for key in payload.keys():
        if key in {"category_id"}:
            continue
        if key not in FEATURE_CATEGORY_EDITABLE_FIELDS:
            errors.append(f"Unsupported field: {key}")

    return errors


def validate_feature_category_delete_payload(payload):
    category_id = str(payload.get("category_id", "")).strip()
    if not category_id:
        return ["category_id is required."]
    return []
