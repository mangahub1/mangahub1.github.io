import logging
import os
from decimal import Decimal

import boto3
from botocore.exceptions import ClientError

from utils.api_gateway import http_method
from utils.responses import response

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

DDB_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
ddb = boto3.resource("dynamodb")
users_table = ddb.Table(DDB_TABLE_NAME)


def _legacy(event, status_code, payload):
    return response(event, status_code, payload, methods="OPTIONS,GET")


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


def _normalize_user(item):
    return {
        "user_id": str(item.get("user_id", "")).strip(),
        "name": str(item.get("name", "")).strip(),
        "given_name": str(item.get("given_name", "")).strip(),
        "family_name": str(item.get("family_name", "")).strip(),
        "email": str(item.get("email", "")).strip().lower(),
        "image": str(item.get("image", "")).strip(),
        "status": _normalize_number(item.get("status"), default=-1),
        "admin": _normalize_number(item.get("admin"), default=0),
        "provider": str(item.get("provider", "")).strip(),
        "last_login": item.get("last_login"),
        "requested_at": item.get("requested_at"),
        "approved_at": item.get("approved_at"),
        "created_at": item.get("created_at"),
    }


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

    users = []
    scan_args = {
        "ProjectionExpression": "#user_id, #name, given_name, family_name, email, image, #status, admin, provider, last_login, requested_at, approved_at, created_at",
        "ExpressionAttributeNames": {
            "#user_id": "user_id",
            "#name": "name",
            "#status": "status",
        },
    }

    try:
        while True:
            result = users_table.scan(**scan_args)
            users.extend(result.get("Items", []))
            last_evaluated_key = result.get("LastEvaluatedKey")
            if not last_evaluated_key:
                break
            scan_args["ExclusiveStartKey"] = last_evaluated_key
    except ClientError as exc:
        LOG.exception("DynamoDB scan failed")
        return _legacy(
            event,
            500,
            {
                "ok": False,
                "message": "Internal users query failure.",
                "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
            },
        )

    normalized = [_normalize_user(item) for item in users]
    normalized.sort(
        key=lambda user: (
            0 if user["status"] == -1 else 1,
            (
                f"{user['family_name']}, {user['given_name']}"
                if user["family_name"] and user["given_name"]
                else user["name"]
            )
            or user["email"]
            or user["user_id"],
        )
    )

    return _legacy(event, 200, {"ok": True, "users": normalized, "count": len(normalized)})
