FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS = [
    "display_order",
    "item_type",
    "manga_id",
    "content_key",
    "title",
    "cover_url",
    "tags",
    "starts_at",
    "ends_at",
    "is_active",
]


def _to_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def _to_int(value, default=0):
    if value in (None, ""):
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def normalize_feature_category_item(item):
    if not item:
        return {}

    tags = item.get("tags")
    if isinstance(tags, list):
        normalized_tags = [str(value).strip() for value in tags if str(value).strip()]
    elif tags in (None, ""):
        normalized_tags = []
    else:
        normalized_tags = [str(tags).strip()]

    return {
        "category_id": str(item.get("category_id", "")).strip(),
        "sort_key": str(item.get("sort_key", "")).strip(),
        "display_order": _to_int(item.get("display_order"), 0),
        "item_type": str(item.get("item_type", "")).strip(),
        "manga_id": str(item.get("manga_id", "")).strip(),
        "content_key": str(item.get("content_key", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "cover_url": str(item.get("cover_url", "")).strip(),
        "tags": normalized_tags,
        "starts_at": item.get("starts_at"),
        "ends_at": item.get("ends_at"),
        "is_active": _to_bool(item.get("is_active"), default=True),
        "deleted_by": str(item.get("deleted_by", "")).strip(),
        "deleted_at": item.get("deleted_at"),
    }
