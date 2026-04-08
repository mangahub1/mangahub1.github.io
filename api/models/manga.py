MANGA_EDITABLE_FIELDS = [
    "title",
    "publisher",
    "series",
    "age_rating",
    "synopsis",
    "category_ids",
    "genre_ids",
    "copyright",
    "bisac",
    "sales_restriction",
    "japanese_title",
    "cover_url",
]


def _to_bool(value, default=True):
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def normalize_manga_item(item):
    if not item:
        return {}

    normalized = {
        "manga_id": str(item.get("manga_id", "")).strip(),
        "title": str(item.get("title", "")).strip(),
        "publisher": str(item.get("publisher", "")).strip(),
        "series": str(item.get("series", "")).strip(),
        "age_rating": str(item.get("age_rating", "")).strip(),
        "synopsis": str(item.get("synopsis", "")).strip(),
        "copyright": str(item.get("copyright", "")).strip(),
        "bisac": str(item.get("bisac", "")).strip(),
        "sales_restriction": str(item.get("sales_restriction", "")).strip(),
        "japanese_title": str(item.get("japanese_title", "")).strip(),
        "cover_url": str(item.get("cover_url", "")).strip(),
        "is_active": _to_bool(item.get("is_active"), default=True),
        "deleted_by": str(item.get("deleted_by", "")).strip(),
        "deleted_at": item.get("deleted_at"),
    }

    category_ids = item.get("category_ids")
    if isinstance(category_ids, list):
        normalized["category_ids"] = [str(value).strip() for value in category_ids if str(value).strip()]
    elif category_ids in (None, ""):
        normalized["category_ids"] = []
    else:
        normalized["category_ids"] = [str(category_ids).strip()]

    genre_ids = item.get("genre_ids")
    if isinstance(genre_ids, list):
        normalized["genre_ids"] = [str(value).strip() for value in genre_ids if str(value).strip()]
    elif genre_ids in (None, ""):
        normalized["genre_ids"] = []
    else:
        normalized["genre_ids"] = [str(genre_ids).strip()]

    return normalized
