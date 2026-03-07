import json
import logging
import os

import boto3
from botocore.exceptions import ClientError
from content_model import normalize_content_record

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

USERS_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
CONTENT_TABLE_NAME = os.environ.get("CONTENT_TABLE_NAME", "Content")

ddb = boto3.resource("dynamodb")
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
    "Access-Control-Allow-Methods": "OPTIONS,GET",
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


def lambda_handler(event, context):
  if _http_method(event) == "OPTIONS":
    return _response(event, 200, {"ok": True})

  claims = _extract_claims(event)
  caller_user_id = str(claims.get("sub", "")).strip()
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

  query_params = event.get("queryStringParameters") or {}
  requested_type = str(query_params.get("content_type", "")).strip().lower()

  items = []
  scan_args = {}

  try:
    while True:
      result = content_table.scan(**scan_args)
      chunk = result.get("Items", [])
      if requested_type:
        chunk = [
          item
          for item in chunk
          if str(item.get("content_type", "manga")).strip().lower() == requested_type
        ]
      items.extend(chunk)
      last_evaluated_key = result.get("LastEvaluatedKey")
      if not last_evaluated_key:
        break
      scan_args["ExclusiveStartKey"] = last_evaluated_key
  except ClientError as exc:
    LOG.exception("DynamoDB scan failed")
    return _response(
      event,
      500,
      {
        "ok": False,
        "message": "Internal content query failure.",
        "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
      },
    )

  normalized = [normalize_content_record(item) for item in items]
  normalized.sort(
    key=lambda entry: (
      str(entry.get("content_type", "manga")).lower(),
      str(entry.get("title", "")).lower(),
      str(entry.get("content_id", "")).lower(),
    )
  )

  return _response(event, 200, {"ok": True, "items": normalized, "count": len(normalized)})
