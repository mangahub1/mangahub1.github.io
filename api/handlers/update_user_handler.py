import logging
import os
from datetime import datetime, timezone
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

from utils.api_gateway import http_method, parse_json_body
from utils.responses import response

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

DDB_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
ddb = boto3.resource("dynamodb")
users_table = ddb.Table(DDB_TABLE_NAME)


def _legacy(event, status_code, payload):
    return response(event, status_code, payload, methods="OPTIONS,PUT")


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


def _is_admin(user_item):
    admin_flag = _normalize_number(user_item.get("admin"), default=0)
    role = str(user_item.get("role", "")).strip().lower()
    return admin_flag == 1 or role == "admin"


def _iso_utc_now():
    return datetime.now(timezone.utc).isoformat()


def _normalize_user(item):
    return {
        "user_id": str(item.get("user_id", "")).strip(),
        "name": str(item.get("name", "")).strip(),
        "given_name": str(item.get("given_name", "")).strip(),
        "family_name": str(item.get("family_name", "")).strip(),
        "email": str(item.get("email", "")).strip().lower(),
        "status": _normalize_number(item.get("status"), default=-1),
        "admin": _normalize_number(item.get("admin"), default=0),
        "provider": str(item.get("provider", "")).strip(),
        "last_login": item.get("last_login"),
        "requested_at": item.get("requested_at"),
        "approved_at": item.get("approved_at"),
        "created_at": item.get("created_at"),
    }


def _update_one_user(user_id, next_status, next_admin):
    update_parts = ["#updated_at = :updated_at"]
    names = {"#updated_at": "updated_at"}
    values = {":updated_at": _iso_utc_now()}
    remove_parts = []

    if next_status is not None:
        names["#status"] = "status"
        update_parts.append("#status = :status")
        values[":status"] = next_status
        if next_status == 1:
            update_parts.append("#approved_at = :approved_at")
            names["#approved_at"] = "approved_at"
            values[":approved_at"] = _iso_utc_now()
        else:
            names["#approved_at"] = "approved_at"
            remove_parts.append("#approved_at")

    if next_admin is not None:
        names["#admin"] = "admin"
        update_parts.append("#admin = :admin")
        values[":admin"] = next_admin

    expression = "SET " + ", ".join(update_parts)
    if remove_parts:
        expression += " REMOVE " + ", ".join(remove_parts)

    result = users_table.update_item(
        Key={"user_id": user_id},
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
        ConditionExpression="attribute_exists(user_id)",
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes") or {}


def lambda_handler(event, context):
    if http_method(event) == "OPTIONS":
        return _legacy(event, 200, {"ok": True})

    claims = _extract_claims(event)
    caller_user_id = str(claims.get("sub", "")).strip()
    if not caller_user_id:
        return _legacy(event, 401, {"ok": False, "message": "Unauthorized."})

    try:
        caller_item = users_table.get_item(Key={"user_id": caller_user_id}).get("Item")
    except ClientError as exc:
        LOG.exception("DynamoDB caller lookup failed")
        return _legacy(
            event,
            500,
            {
                "ok": False,
                "message": "Internal lookup failure.",
                "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
            },
        )

    if not caller_item or not _is_admin(caller_item):
        return _legacy(event, 403, {"ok": False, "message": "Admin access required."})

    body, parse_error = parse_json_body(event)
    if parse_error:
        return _legacy(event, 400, {"ok": False, "message": parse_error})

    raw_user_id = str(body.get("user_id", "")).strip()
    raw_user_ids = body.get("user_ids")
    user_ids = []
    if raw_user_id:
        user_ids.append(raw_user_id)
    if isinstance(raw_user_ids, list):
        user_ids.extend([str(entry).strip() for entry in raw_user_ids if str(entry).strip()])
    user_ids = list(dict.fromkeys(user_ids))

    if not user_ids:
        return _legacy(event, 400, {"ok": False, "message": "Provide user_id or user_ids."})

    next_status = body.get("status")
    if next_status is not None:
        next_status = _normalize_number(next_status, default=999)
        if next_status not in (-1, 0, 1):
            return _legacy(event, 400, {"ok": False, "message": "status must be -1, 0, or 1."})

    next_admin = body.get("admin")
    if next_admin is not None:
        next_admin = _normalize_number(next_admin, default=999)
        if next_admin not in (0, 1):
            return _legacy(event, 400, {"ok": False, "message": "admin must be 0 or 1."})

    if next_status is None and next_admin is None:
        return _legacy(event, 400, {"ok": False, "message": "No updates were provided."})

    updated_users = []
    try:
        for user_id in user_ids:
            updated_item = _update_one_user(user_id, next_status, next_admin)
            updated_users.append(_normalize_user(updated_item))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return _legacy(event, 404, {"ok": False, "message": "One or more users were not found."})
        LOG.exception("DynamoDB update failed")
        return _legacy(
            event,
            500,
            {
                "ok": False,
                "message": "Internal user update failure.",
                "error": code,
            },
        )

    return _legacy(
        event,
        200,
        {
            "ok": True,
            "updatedCount": len(updated_users),
            "users": updated_users,
        },
    )
