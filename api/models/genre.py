GENRE_EDITABLE_FIELDS = [
    "name",
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


def normalize_genre(item):
    if not item:
        return {}

    return {
        "genre_id": str(item.get("genre_id", "")).strip(),
        "name": str(item.get("name", "")).strip(),
        "is_active": _to_bool(item.get("is_active"), default=True),
        "deleted_by": str(item.get("deleted_by", "")).strip(),
        "deleted_at": item.get("deleted_at"),
    }
