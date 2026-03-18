MANGA_EDITABLE_FIELDS = [
    "title",
    "publisher",
    "series",
    "age_rating",
    "synopsis",
    "keywords",
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

    keywords = item.get("keywords")
    if isinstance(keywords, list):
        normalized["keywords"] = [str(value).strip() for value in keywords if str(value).strip()]
    elif keywords in (None, ""):
        normalized["keywords"] = []
    else:
        normalized["keywords"] = [str(keywords).strip()]

    return normalized
