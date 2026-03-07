import base64
import json
import logging
import os
import re
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError
from content_model import EDITABLE_FIELDS, map_payload_keys, merge_editable_fields, normalize_content_record

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

USERS_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
CONTENT_TABLE_NAME = os.environ.get("CONTENT_TABLE_NAME", "Content")
CONTENT_BUCKET = os.environ.get("CONTENT_BUCKET", "blupetal-prototype")
PDF_PREFIX = os.environ.get("CONTENT_PDF_PREFIX", "content/pdfs")
THUMBNAIL_PREFIX = os.environ.get("CONTENT_THUMBNAIL_PREFIX", "content/thumbnails")
CONTENT_PUBLIC_BASE_URL = os.environ.get("CONTENT_PUBLIC_BASE_URL", "").strip().rstrip("/")
MAX_PDF_BYTES = int(os.environ.get("MAX_PDF_UPLOAD_BYTES", str(50 * 1024 * 1024)))
MAX_THUMBNAIL_BYTES = int(os.environ.get("MAX_THUMBNAIL_UPLOAD_BYTES", str(10 * 1024 * 1024)))
FILE_FORMAT_ALLOWED = {"pdf", "epub", "cbz", "cbr", "web"}

ddb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
users_table = ddb.Table(USERS_TABLE_NAME)
content_table = ddb.Table(CONTENT_TABLE_NAME)


def _cors_headers(event):
  headers_in = event.get("headers") or {}
  origin = headers_in.get("origin") or headers_in.get("Origin")

  single_origin = os.environ.get("CORS_ALLOW_ORIGIN", "*")
  origin_list = os.environ.get("CORS_ALLOW_ORIGINS", "")
  allowed = [entry.strip() for entry in origin_list.split(",") if entry.strip()]
  fallback_origin = allowed[0] if allowed else single_origin
  allow_origin = origin if origin and origin in allowed else fallback_origin

  return {
    "Access-Control-Allow-Origin": allow_origin,
    "Access-Control-Allow-Headers": "Authorization,Content-Type",
    "Access-Control-Allow-Methods": "OPTIONS,PUT",
    "Vary": "Origin",
    "Content-Type": "application/json",
  }


def _response(event, status_code, payload):
  return {
    "statusCode": status_code,
    "headers": _cors_headers(event),
    "body": json.dumps(payload),
  }


def _normalize_number(value, default=0):
  if value is None:
    return default
  if isinstance(value, Decimal):
    value = int(value)
  try:
    return int(value)
  except (TypeError, ValueError):
    return default


def _extract_claims(event):
  claims = (
    event.get("requestContext", {})
    .get("authorizer", {})
    .get("jwt", {})
    .get("claims", {})
  )
  if claims:
    return claims

  alt_claims = (
    event.get("requestContext", {})
    .get("authorizer", {})
    .get("claims", {})
  )
  return alt_claims or {}


def _extract_body(event):
  raw = event.get("body")
  if not raw:
    return {}

  if event.get("isBase64Encoded") and isinstance(raw, str):
    try:
      raw = base64.b64decode(raw).decode("utf-8")
    except Exception:
      LOG.exception("Failed to decode base64 request body")
      return {}

  try:
    body = json.loads(raw) if isinstance(raw, str) else raw
  except json.JSONDecodeError:
    return {}

  return body if isinstance(body, dict) else {}


def _is_admin(user_item):
  admin_flag = _normalize_number(user_item.get("admin"), default=0)
  role = str(user_item.get("role", "")).strip().lower()
  return admin_flag == 1 or role == "admin"


def _iso_utc_now():
  return datetime.now(timezone.utc).isoformat()


def _http_method(event):
  return (
    event.get("requestContext", {}).get("http", {}).get("method")
    or event.get("httpMethod")
    or ""
  )


def _clean_text(value):
  return str(value or "").strip()


def _safe_slug(value):
  lowered = _clean_text(value).lower()
  slug = re.sub(r"[^a-z0-9]+", "-", lowered).strip("-")
  return slug or "content"


def _to_public_http_url(value):
  raw = _clean_text(value)
  if not raw:
    return ""
  if raw.startswith("https://") or raw.startswith("http://"):
    return raw
  if raw.startswith("s3://"):
    without_scheme = raw[5:]
    if "/" not in without_scheme:
      return raw
    bucket, key = without_scheme.split("/", 1)
    key_encoded = "/".join(quote(part, safe="") for part in key.split("/"))
    return f"https://{bucket}.s3.amazonaws.com/{key_encoded}"
  return raw


def _s3_key_to_public_http_url(bucket, key):
  key_encoded = "/".join(quote(part, safe="") for part in str(key).split("/"))
  if CONTENT_PUBLIC_BASE_URL:
    return f"{CONTENT_PUBLIC_BASE_URL}/{key_encoded}"
  return f"https://{bucket}.s3.amazonaws.com/{key_encoded}"


def _decode_upload(upload_obj, expected_kind):
  if not isinstance(upload_obj, dict):
    return None, None, None

  encoded = str(upload_obj.get("base64", "")).strip()
  if not encoded:
    return None, None, None

  filename = _clean_text(upload_obj.get("name")) or (
    "upload.pdf" if expected_kind == "pdf" else "upload.png"
  )
  content_type = _clean_text(upload_obj.get("content_type")) or "application/octet-stream"

  try:
    blob = base64.b64decode(encoded, validate=True)
  except Exception as exc:
    raise ValueError(f"Invalid base64 upload for {expected_kind}.") from exc

  if expected_kind == "pdf" and len(blob) > MAX_PDF_BYTES:
    raise ValueError(f"PDF upload is too large. Max allowed is {MAX_PDF_BYTES} bytes.")
  if expected_kind == "thumbnail" and len(blob) > MAX_THUMBNAIL_BYTES:
    raise ValueError(f"Thumbnail upload is too large. Max allowed is {MAX_THUMBNAIL_BYTES} bytes.")

  if expected_kind == "pdf" and not content_type.lower().startswith("application/pdf"):
    # Some browsers send octet-stream for pdf uploads, so infer from filename too.
    if Path(filename).suffix.lower() != ".pdf":
      raise ValueError("PDF upload must be a PDF file.")

  return blob, filename, content_type


def _add_error(errors, field, message):
  errors.setdefault(field, []).append(message)


def _is_valid_date_yyyy_mm_dd(value):
  text = _clean_text(value)
  if not text:
    return True
  try:
    datetime.strptime(text, "%Y-%m-%d")
    return True
  except ValueError:
    return False


def _validate_payload(mapped_payload, merged):
  errors = {}

  content_type = _clean_text(merged.get("content_type"))
  if not content_type:
    _add_error(errors, "content_type", "content_type is required.")
  elif not re.fullmatch(r"[a-z0-9_]{1,40}", content_type):
    _add_error(errors, "content_type", "content_type must be lowercase snake_case (1-40 chars).")

  title = _clean_text(merged.get("title"))
  if not title:
    _add_error(errors, "title", "title is required.")
  elif len(title) > 240:
    _add_error(errors, "title", "title must be 240 characters or fewer.")

  publisher = _clean_text(merged.get("publisher"))
  if publisher and len(publisher) > 180:
    _add_error(errors, "publisher", "publisher must be 180 characters or fewer.")

  series = _clean_text(merged.get("series"))
  if series and len(series) > 180:
    _add_error(errors, "series", "series must be 180 characters or fewer.")

  if not _is_valid_date_yyyy_mm_dd(merged.get("release_date")):
    _add_error(errors, "release_date", "release_date must use YYYY-MM-DD.")

  for numeric_field in ("page_length", "contents_volume", "volume"):
    raw = _clean_text(merged.get(numeric_field))
    if not raw:
      continue
    try:
      value = int(raw)
      if value <= 0:
        raise ValueError()
    except ValueError:
      _add_error(errors, numeric_field, f"{numeric_field} must be a positive integer.")

  contents_id = _clean_text(merged.get("contents_id"))
  if contents_id:
    if len(contents_id) > 120:
      _add_error(errors, "contents_id", "contents_id must be 120 characters or fewer.")
    if not re.fullmatch(r"[A-Za-z0-9._:-]+", contents_id):
      _add_error(errors, "contents_id", "contents_id may only contain letters, numbers, '.', '_', ':', and '-'.")

  author = _clean_text(merged.get("author"))
  if author and len(author) > 180:
    _add_error(errors, "author", "author must be 180 characters or fewer.")

  price_raw = _clean_text(merged.get("price"))
  if price_raw:
    if not re.fullmatch(r"\d+(\.\d{1,2})?", price_raw):
      _add_error(errors, "price", "price must be a non-negative number with up to 2 decimals.")

  file_format = _clean_text(merged.get("file_format")).lower()
  if file_format and file_format not in FILE_FORMAT_ALLOWED:
    _add_error(
      errors,
      "file_format",
      f"file_format must be one of: {', '.join(sorted(FILE_FORMAT_ALLOWED))}.",
    )

  if "concluded" in mapped_payload:
    concluded_raw = _clean_text(mapped_payload.get("concluded")).lower()
    valid_values = {"0", "1", "true", "false", "yes", "no", "y", "n"}
    if concluded_raw not in valid_values:
      _add_error(errors, "concluded", "concluded must be 0 or 1.")

  for text_field, max_len in (
    ("keywords", 500),
    ("copyright", 240),
    ("bisac", 120),
    ("sales_restriction", 120),
    ("japanese_title", 240),
  ):
    value = _clean_text(merged.get(text_field))
    if value and len(value) > max_len:
      _add_error(errors, text_field, f"{text_field} must be {max_len} characters or fewer.")

  synopsis = _clean_text(merged.get("synopsis"))
  if synopsis and len(synopsis) > 5000:
    _add_error(errors, "synopsis", "synopsis must be 5000 characters or fewer.")

  pdf_url = _clean_text(merged.get("pdf_url"))
  if pdf_url and not (pdf_url.startswith("s3://") or pdf_url.startswith("https://") or pdf_url.startswith("http://")):
    _add_error(errors, "pdf_url", "pdf_url must be an s3:// or http(s) URL.")

  thumbnail_url = _clean_text(merged.get("thumbnail_url"))
  if thumbnail_url and not (thumbnail_url.startswith("s3://") or thumbnail_url.startswith("https://") or thumbnail_url.startswith("http://")):
    _add_error(errors, "thumbnail_url", "thumbnail_url must be an s3:// or http(s) URL.")

  return errors


def _extension_for_file(filename, content_type, default_ext):
  suffix = Path(_clean_text(filename)).suffix.lower().strip(".")
  if suffix:
    if suffix == "jpg":
      return "jpeg"
    return suffix

  content_type = _clean_text(content_type).lower()
  mapping = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  }
  return mapping.get(content_type, default_ext)


def _put_s3_object(key, blob, content_type):
  s3.put_object(
    Bucket=CONTENT_BUCKET,
    Key=key,
    Body=blob,
    ContentType=content_type,
  )
  return f"s3://{CONTENT_BUCKET}/{key}"


def _try_generate_thumbnail_from_pdf(pdf_blob):
  try:
    import fitz  # PyMuPDF
  except Exception:
    return None

  try:
    with fitz.open(stream=pdf_blob, filetype="pdf") as doc:
      if len(doc) <= 0:
        return None
      page = doc.load_page(0)
      pix = page.get_pixmap(matrix=fitz.Matrix(1.6, 1.6), alpha=False)
      return pix.tobytes("png")
  except Exception:
    LOG.exception("Automatic thumbnail generation from PDF failed")
    return None


def _build_base_content(existing_item, payload, content_id):
  now = _iso_utc_now()
  merged = merge_editable_fields(existing_item or {}, payload or {})
  incoming_pdf_url = _clean_text((payload or {}).get("pdf_url"))
  incoming_thumbnail_url = _clean_text((payload or {}).get("thumbnail_url"))
  existing_normalized = normalize_content_record(existing_item or {})

  merged["content_id"] = _clean_text(content_id)
  merged["content_type"] = _clean_text(merged.get("content_type")) or "manga"
  merged["pdf_url"] = _to_public_http_url(incoming_pdf_url or _clean_text(existing_normalized.get("pdf_url")))
  merged["thumbnail_url"] = _to_public_http_url(incoming_thumbnail_url or _clean_text(existing_normalized.get("thumbnail_url")))

  merged["updated_at"] = now
  merged["created_at"] = _clean_text(existing_normalized.get("created_at")) or now
  return merged


def lambda_handler(event, context):
  if _http_method(event) == "OPTIONS":
    return _response(event, 200, {"ok": True})

  claims = _extract_claims(event)
  caller_user_id = _clean_text(claims.get("sub"))
  if not caller_user_id:
    return _response(event, 401, {"ok": False, "message": "Unauthorized."})

  try:
    caller_item = users_table.get_item(Key={"user_id": caller_user_id}).get("Item")
  except ClientError as exc:
    LOG.exception("DynamoDB caller lookup failed")
    return _response(
      event,
      500,
      {
        "ok": False,
        "message": "Internal lookup failure.",
        "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
      },
    )

  if not caller_item or not _is_admin(caller_item):
    return _response(event, 403, {"ok": False, "message": "Admin access required."})

  payload = _extract_body(event)
  if not payload:
    return _response(event, 400, {"ok": False, "message": "A JSON body is required."})

  incoming_content_id = _clean_text(payload.get("content_id"))
  content_id = incoming_content_id or str(uuid.uuid4())
  existing_item = {}
  is_update = False

  if incoming_content_id:
    try:
      existing_item = content_table.get_item(Key={"content_id": content_id}).get("Item")
      is_update = bool(existing_item)
    except ClientError as exc:
      LOG.exception("DynamoDB content lookup failed")
      return _response(
        event,
        500,
        {
          "ok": False,
          "message": "Internal content lookup failure.",
          "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
        },
      )

  mapped_payload = map_payload_keys(payload)
  merged = _build_base_content(existing_item, mapped_payload, content_id)
  validation_errors = _validate_payload(mapped_payload, merged)
  if validation_errors:
    flat_errors = [
      f"{field}: {', '.join(messages)}"
      for field, messages in validation_errors.items()
    ]
    return _response(
      event,
      400,
      {
        "ok": False,
        "message": "Validation failed. " + " | ".join(flat_errors),
        "field_errors": validation_errors,
      },
    )

  # Persist custom metadata keys that are not managed base fields.
  reserved = set(EDITABLE_FIELDS) | {
    "content_id",
    "pdf_url",
    "thumbnail_url",
    "pdf_file",
    "thumbnail_file",
    "created_at",
    "updated_at",
  }
  for key, value in mapped_payload.items():
    if key not in reserved:
      merged[key] = value

  generated_thumbnail = False
  thumbnail_required = False

  try:
    pdf_blob, pdf_filename, pdf_content_type = _decode_upload(payload.get("pdf_file"), "pdf")
    if pdf_blob:
      pdf_ext = _extension_for_file(pdf_filename, pdf_content_type, "pdf")
      pdf_key = f"{PDF_PREFIX}/{_safe_slug(content_id)}.{pdf_ext}"
      _put_s3_object(pdf_key, pdf_blob, "application/pdf")
      merged["pdf_url"] = _s3_key_to_public_http_url(CONTENT_BUCKET, pdf_key)

    thumb_blob, thumb_filename, thumb_content_type = _decode_upload(payload.get("thumbnail_file"), "thumbnail")
    if thumb_blob:
      thumb_ext = _extension_for_file(thumb_filename, thumb_content_type, "png")
      thumb_key = f"{THUMBNAIL_PREFIX}/{_safe_slug(content_id)}.{thumb_ext}"
      _put_s3_object(thumb_key, thumb_blob, thumb_content_type or "image/png")
      merged["thumbnail_url"] = _s3_key_to_public_http_url(CONTENT_BUCKET, thumb_key)
    elif pdf_blob:
      auto_thumb = _try_generate_thumbnail_from_pdf(pdf_blob)
      if auto_thumb:
        thumb_key = f"{THUMBNAIL_PREFIX}/{_safe_slug(content_id)}.png"
        _put_s3_object(thumb_key, auto_thumb, "image/png")
        merged["thumbnail_url"] = _s3_key_to_public_http_url(CONTENT_BUCKET, thumb_key)
        generated_thumbnail = True
      else:
        thumbnail_required = True

    if is_update:
      content_table.put_item(Item=merged, ConditionExpression="attribute_exists(content_id)")
    else:
      content_table.put_item(Item=merged, ConditionExpression="attribute_not_exists(content_id)")
  except ValueError as exc:
    return _response(event, 400, {"ok": False, "message": str(exc)})
  except ClientError as exc:
    code = exc.response.get("Error", {}).get("Code", "UnknownError")
    if code == "ConditionalCheckFailedException":
      if is_update:
        return _response(event, 404, {"ok": False, "message": "Content record not found."})
      return _response(event, 409, {"ok": False, "message": "content_id already exists."})
    LOG.exception("Content update failed")
    return _response(
      event,
      500,
      {
        "ok": False,
        "message": "Internal content update failure.",
        "error": code,
      },
    )

  normalized = normalize_content_record(merged)
  return _response(
    event,
    200,
    {
      "ok": True,
      "is_update": is_update,
      "generated_thumbnail": generated_thumbnail,
      "thumbnail_required": thumbnail_required,
      "item": normalized,
    },
  )
