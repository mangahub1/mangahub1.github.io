import json
import logging
import os
import base64
from decimal import Decimal
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)

DDB_TABLE_NAME = os.environ.get("USERS_TABLE_NAME", "Users")
DEFAULT_PENDING_STATUS = int(os.environ.get("DEFAULT_PENDING_STATUS", "-1"))

ddb = boto3.resource("dynamodb")
users_table = ddb.Table(DDB_TABLE_NAME)


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
    if value is None:
        return default
    if isinstance(value, Decimal):
        value = int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _extract_claims(event):
    # HTTP API JWT authorizer shape
    claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("jwt", {})
        .get("claims", {})
    )
    if claims:
        return claims

    # REST API Cognito authorizer shape
    alt_claims = (
        event.get("requestContext", {})
        .get("authorizer", {})
        .get("claims", {})
    )
    if alt_claims:
        return alt_claims

    return {}


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

    if not isinstance(body, dict):
        return {}
    return body


def _iso_utc_now():
    return datetime.now(timezone.utc).isoformat()


def _build_response_payload(item):
    status = _normalize_number(item.get("status"), default=0)
    admin = _normalize_number(item.get("admin"), default=0)
    role = str(item.get("role", "")).strip()
    return {
        "ok": True,
        "user": {
            "user_id": str(item.get("user_id", "")).strip(),
            "email": str(item.get("email", "")).strip().lower(),
            "name": str(item.get("name", "")).strip(),
            "given_name": str(item.get("given_name", "")).strip(),
            "image": str(item.get("image", "")).strip(),
            "status": status,
            "admin": admin,
            "role": role,
            "provider": str(item.get("provider", "")).strip(),
            "created_at": item.get("created_at"),
            "requested_at": item.get("requested_at"),
            "approved_at": item.get("approved_at"),
            "last_login": item.get("last_login"),
        },
        "isApproved": status == 1,
        "isAdmin": admin == 1 or role.lower() == "admin",
        "message": (
            "Access granted."
            if status == 1
            else "Access request submitted for review."
            if status == -1
            else "Account is disabled."
        ),
    }


def _update_last_login(user_id, timestamp_iso):
    result = users_table.update_item(
        Key={"user_id": user_id},
        UpdateExpression="SET last_login = :last_login",
        ExpressionAttributeValues={":last_login": timestamp_iso},
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")


def _update_user_profile(user_id, timestamp_iso, name="", given_name="", image="", provider=""):
    update_parts = ["#last_login = :last_login"]
    values = {":last_login": timestamp_iso}
    names = {"#last_login": "last_login"}

    if name:
        update_parts.append("#name = :name")
        values[":name"] = name
        names["#name"] = "name"
    if given_name:
        update_parts.append("#given_name = :given_name")
        values[":given_name"] = given_name
        names["#given_name"] = "given_name"
    if image:
        update_parts.append("#image = :image")
        values[":image"] = image
        names["#image"] = "image"
    if provider:
        update_parts.append("#provider = :provider")
        values[":provider"] = provider
        names["#provider"] = "provider"

    params = {
        "Key": {"user_id": user_id},
        "UpdateExpression": "SET " + ", ".join(update_parts),
        "ExpressionAttributeValues": values,
        "ReturnValues": "ALL_NEW",
        "ExpressionAttributeNames": names,
    }

    result = users_table.update_item(**params)
    return result.get("Attributes")


def lambda_handler(event, context):
    if event.get("requestContext", {}).get("http", {}).get("method") == "OPTIONS":
        return _response(event, 200, {"ok": True})

    claims = _extract_claims(event)
    body = _extract_body(event)

    user_id = str(claims.get("sub", "")).strip()
    if not user_id:
        return _response(
            event,
            400,
            {
                "ok": False,
                "message": "Missing required claim: sub.",
            },
        )

    email_claim = str(claims.get("email", "")).strip().lower()
    name_claim = str(claims.get("name", "")).strip()
    given_name_claim = str(claims.get("given_name", "")).strip()
    image_claim = str(claims.get("picture", "")).strip() or str(claims.get("image", "")).strip()
    provider_claim = str(claims.get("identities", "")).strip()

    email_body = str(body.get("email", "")).strip().lower()
    name_body = str(body.get("name", "")).strip()
    given_name_body = str(body.get("given_name", "")).strip()
    image_body = str(body.get("image", "")).strip()

    email = email_claim or email_body
    name = name_claim or name_body
    given_name = given_name_claim or given_name_body
    image = image_claim or image_body
    provider = str(body.get("provider", "")).strip() or ("Google" if provider_claim else "")
    if not provider:
        provider = "Google"

    if email_claim and email_body and email_claim != email_body:
        return _response(
            event,
            403,
            {
                "ok": False,
                "message": "Email mismatch between token claim and request body.",
            },
        )

    now_iso = _iso_utc_now()

    try:
        result = users_table.get_item(Key={"user_id": user_id})
    except ClientError as exc:
        LOG.exception("DynamoDB get_item failed")
        return _response(
            event,
            500,
            {
                "ok": False,
                "message": "Internal authorization lookup failure.",
                "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
            },
        )

    item = result.get("Item")
    if item:
        try:
            updated_item = _update_user_profile(
                user_id,
                now_iso,
                name=name,
                given_name=given_name,
                image=image,
                provider=provider,
            )
            if updated_item:
                item = updated_item
        except ClientError:
            LOG.exception("DynamoDB update_item last_login failed")
            try:
                updated_item = _update_last_login(user_id, now_iso)
                if updated_item:
                    item = updated_item
            except ClientError:
                LOG.exception("DynamoDB update_item fallback last_login failed")
        item["last_login"] = now_iso
        if name:
            item["name"] = name
        if given_name:
            item["given_name"] = given_name
        if image:
            item["image"] = image
        return _response(event, 200, _build_response_payload(item))

    new_user = {
        "user_id": user_id,
        "email": email,
        "name": name,
        "given_name": given_name,
        "image": image,
        "admin": 0,
        "status": DEFAULT_PENDING_STATUS,
        "created_at": now_iso,
        "requested_at": now_iso,
        "last_login": now_iso,
        "provider": provider,
    }

    try:
        users_table.put_item(
            Item=new_user,
            ConditionExpression="attribute_not_exists(user_id)",
        )
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") == "ConditionalCheckFailedException":
            latest = users_table.get_item(Key={"user_id": user_id}).get("Item", new_user)
            return _response(event, 200, _build_response_payload(latest))
        LOG.exception("DynamoDB put_item failed")
        return _response(
            event,
            500,
            {
                "ok": False,
                "message": "Internal authorization create failure.",
                "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
            },
        )

    return _response(event, 200, _build_response_payload(new_user))
