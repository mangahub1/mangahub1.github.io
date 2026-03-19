FEATURE_CATEGORY_EDITABLE_FIELDS = [
    "name",
    "slug",
    "description",
    "page_key",
    "display_order",
    "starts_at",
    "ends_at",
    "is_active",
]


def _to_number(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


def _to_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def normalize_feature_category(item):
    if not item:
        return {}

    return {
        "category_id": str(item.get("category_id", "")).strip(),
        "name": str(item.get("name", "")).strip(),
        "slug": str(item.get("slug", "")).strip(),
        "description": str(item.get("description", "")).strip(),
        "page_key": str(item.get("page_key", "")).strip(),
        "display_order": _to_number(item.get("display_order")),
        "starts_at": item.get("starts_at"),
        "ends_at": item.get("ends_at"),
        "is_active": _to_bool(item.get("is_active"), default=True),
        "deleted_by": str(item.get("deleted_by", "")).strip(),
        "deleted_at": item.get("deleted_at"),
    }
