import base64
import json
import logging
import os
import re
import uuid
from pathlib import Path
from urllib.parse import quote

import boto3
from botocore.exceptions import ClientError

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

USERS_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
CONTENT_BUCKET = os.environ.get("CONTENT_BUCKET", "blupetal-prototype")
PDF_PREFIX = os.environ.get("CONTENT_PDF_PREFIX", "content/pdfs")
THUMBNAIL_PREFIX = os.environ.get("CONTENT_THUMBNAIL_PREFIX", "content/thumbnails")
CONTENT_PUBLIC_BASE_URL = os.environ.get("CONTENT_PUBLIC_BASE_URL", "").strip().rstrip("/")
UPLOAD_URL_TTL_SECONDS = int(os.environ.get("UPLOAD_URL_TTL_SECONDS", "900"))

ddb = boto3.resource("dynamodb")
s3 = boto3.client("s3")
users_table = ddb.Table(USERS_TABLE_NAME)


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
    "Access-Control-Allow-Methods": "OPTIONS,POST",
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
    raw = base64.b64decode(raw).decode("utf-8")
  try:
    body = json.loads(raw) if isinstance(raw, str) else raw
  except json.JSONDecodeError:
    return {}
  return body if isinstance(body, dict) else {}


def _is_admin(user_item):
  admin_flag = _normalize_number(user_item.get("admin"), default=0)
  role = str(user_item.get("role", "")).strip().lower()
  return admin_flag == 1 or role == "admin"


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


def _normalize_ext(file_name, content_type):
  suffix = Path(_clean_text(file_name)).suffix.lower().strip(".")
  if suffix == "jpg":
    return "jpeg"
  if suffix:
    return suffix
  ctype = _clean_text(content_type).lower()
  mapping = {
    "application/pdf": "pdf",
    "image/png": "png",
    "image/jpeg": "jpeg",
    "image/jpg": "jpeg",
    "image/webp": "webp",
    "image/svg+xml": "svg",
  }
  return mapping.get(ctype, "bin")


def _s3_key_to_public_http_url(bucket, key):
  key_encoded = "/".join(quote(part, safe="") for part in str(key).split("/"))
  if CONTENT_PUBLIC_BASE_URL:
    return f"{CONTENT_PUBLIC_BASE_URL}/{key_encoded}"
  return f"https://{bucket}.s3.amazonaws.com/{key_encoded}"


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

  body = _extract_body(event)
  file_kind = _clean_text(body.get("file_kind")).lower()
  file_name = _clean_text(body.get("file_name"))
  content_type = _clean_text(body.get("content_type"))
  content_id = _clean_text(body.get("content_id")) or str(uuid.uuid4())

  if file_kind not in {"pdf", "thumbnail"}:
    return _response(event, 400, {"ok": False, "message": "file_kind must be 'pdf' or 'thumbnail'."})
  if not file_name:
    return _response(event, 400, {"ok": False, "message": "file_name is required."})
  if not content_type:
    return _response(event, 400, {"ok": False, "message": "content_type is required."})

  ext = _normalize_ext(file_name, content_type)
  if file_kind == "pdf":
    if ext != "pdf" and content_type.lower() != "application/pdf":
      return _response(event, 400, {"ok": False, "message": "PDF uploads must use .pdf/application/pdf."})
    key = f"{PDF_PREFIX}/{_safe_slug(content_id)}.pdf"
    normalized_content_type = "application/pdf"
  else:
    if ext not in {"png", "jpeg", "webp", "svg"}:
      return _response(event, 400, {"ok": False, "message": "Unsupported thumbnail type."})
    key = f"{THUMBNAIL_PREFIX}/{_safe_slug(content_id)}.{ext}"
    normalized_content_type = content_type

  try:
    upload_url = s3.generate_presigned_url(
      ClientMethod="put_object",
      Params={
        "Bucket": CONTENT_BUCKET,
        "Key": key,
        "ContentType": normalized_content_type,
      },
      ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )
  except ClientError as exc:
    LOG.exception("Failed to generate presigned URL")
    return _response(
      event,
      500,
      {
        "ok": False,
        "message": "Could not create upload URL.",
        "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
      },
    )

  return _response(
    event,
    200,
    {
      "ok": True,
      "content_id": content_id,
      "file_kind": file_kind,
      "content_type": normalized_content_type,
      "key": key,
      "upload_url": upload_url,
      "s3_url": f"s3://{CONTENT_BUCKET}/{key}",
      "file_url": _s3_key_to_public_http_url(CONTENT_BUCKET, key),
    },
  )
