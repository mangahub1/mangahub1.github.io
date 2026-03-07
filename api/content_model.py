import re

EXCEL_HEADER_TO_FIELD = {
  "Title": "title",
  "Publisher": "publisher",
  "Series": "series",
  "Age Rating": "age_rating",
  "Release Date": "release_date",
  "Page Length": "page_length",
  "Contents Volume": "contents_volume",
  "Volume": "volume",
  "Contents Name": "contents_name",
  "Contents ID": "contents_id",
  "Synopsis": "synopsis",
  "Author": "author",
  "Price": "price",
  "File Format": "file_format",
  "Concluded\n0: No; 1: Yes": "concluded",
  "Keywords": "keywords",
  "Copyright": "copyright",
  "BISAC": "bisac",
  "Sales Restriction": "sales_restriction",
  "Japanese Title": "japanese_title",
}

MODEL_FIELDS = [
  "content_id",
  "content_type",
  "title",
  "publisher",
  "series",
  "age_rating",
  "release_date",
  "page_length",
  "contents_volume",
  "volume",
  "contents_name",
  "contents_id",
  "synopsis",
  "author",
  "price",
  "file_format",
  "concluded",
  "keywords",
  "copyright",
  "bisac",
  "sales_restriction",
  "japanese_title",
  "pdf_url",
  "thumbnail_url",
  "created_at",
  "updated_at",
]

EDITABLE_FIELDS = [
  "content_type",
  "title",
  "publisher",
  "series",
  "age_rating",
  "release_date",
  "page_length",
  "contents_volume",
  "volume",
  "contents_name",
  "contents_id",
  "synopsis",
  "author",
  "price",
  "file_format",
  "concluded",
  "keywords",
  "copyright",
  "bisac",
  "sales_restriction",
  "japanese_title",
]


def _clean_text(value):
  return str(value or "").strip()


def _snake_case(value):
  text = _clean_text(value)
  text = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_").lower()
  return text


def _parse_concluded(value):
  if value is None or value == "":
    return 0
  text = _clean_text(value).lower()
  if text in ("1", "true", "yes", "y"):
    return 1
  if text in ("0", "false", "no", "n"):
    return 0
  try:
    return 1 if int(float(text)) == 1 else 0
  except (TypeError, ValueError):
    return 0


def map_payload_keys(payload):
  mapped = {}
  for key, value in (payload or {}).items():
    clean_key = _clean_text(key)
    if clean_key in EXCEL_HEADER_TO_FIELD:
      mapped[EXCEL_HEADER_TO_FIELD[clean_key]] = value
      continue
    mapped[_snake_case(clean_key)] = value
  return mapped


def normalize_content_record(item):
  mapped = map_payload_keys(item or {})
  out = {}
  for field in MODEL_FIELDS:
    if field == "content_type":
      out[field] = _clean_text(mapped.get(field, "manga")) or "manga"
    elif field == "concluded":
      out[field] = _parse_concluded(mapped.get(field))
    else:
      out[field] = _clean_text(mapped.get(field))
  return out


def merge_editable_fields(existing_item, payload):
  existing = normalize_content_record(existing_item or {})
  incoming = map_payload_keys(payload or {})
  merged = dict(existing)

  for field in EDITABLE_FIELDS:
    if field in incoming:
      if field == "content_type":
        merged[field] = _clean_text(incoming.get(field)) or "manga"
      elif field == "concluded":
        merged[field] = _parse_concluded(incoming.get(field))
      else:
        merged[field] = _clean_text(incoming.get(field))

  if not merged.get("content_type"):
    merged["content_type"] = "manga"

  return merged
