MANGA_CONTENT_EDITABLE_FIELDS = [
    "content_type",
    "sequence_number",
    "title",
    "external_content_id",
    "synopsis",
    "author",
    "price",
    "file_format",
    "cover_url",
    "file_url",
]


def _to_number(value):
    if value in (None, ""):
        return None
    try:
        integer_value = int(value)
        return integer_value
    except (TypeError, ValueError):
        return value


def normalize_manga_content_item(item):
    if not item:
        return {}

    return {
        "manga_id": str(item.get("manga_id", "")).strip(),
        "content_key": str(item.get("content_key", "")).strip(),
        "content_type": str(item.get("content_type", "")).strip(),
        "sequence_number": _to_number(item.get("sequence_number")),
        "title": str(item.get("title", "")).strip(),
        "external_content_id": str(item.get("external_content_id", "")).strip(),
        "synopsis": str(item.get("synopsis", "")).strip(),
        "author": str(item.get("author", "")).strip(),
        "price": str(item.get("price", "")).strip(),
        "file_format": str(item.get("file_format", "")).strip(),
        "cover_url": str(item.get("cover_url", "")).strip(),
        "file_url": str(item.get("file_url", "")).strip(),
    }
