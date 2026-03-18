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
DEFAULT_PENDING_STATUS = int(os.environ.get("DEFAULT_PENDING_STATUS", "-1"))

ddb = boto3.resource("dynamodb")
users_table = ddb.Table(DDB_TABLE_NAME)


def _legacy(event, status_code, payload):
    return response(event, status_code, payload, methods="OPTIONS,POST")


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
    if alt_claims:
        return alt_claims
    return {}


def _iso_utc_now():
    return datetime.now(timezone.utc).isoformat()


def _infer_family_name(name, given_name, family_name):
    explicit = str(family_name or "").strip()
    if explicit:
        return explicit

    full_name = str(name or "").strip()
    first_name = str(given_name or "").strip()
    if not full_name:
        return ""

    if "," in full_name:
        maybe_last = full_name.split(",", 1)[0].strip()
        if maybe_last:
            return maybe_last

    if first_name and full_name.lower().startswith(f"{first_name.lower()} "):
        remainder = full_name[len(first_name) :].strip()
        if remainder:
            return remainder

    parts = [part for part in full_name.split() if part]
    if len(parts) > 1:
        return parts[-1]
    return ""


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
            "family_name": str(item.get("family_name", "")).strip(),
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


def _update_user_profile(
    user_id,
    timestamp_iso,
    name="",
    given_name="",
    family_name="",
    image="",
    provider="",
):
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
    if family_name:
        update_parts.append("#family_name = :family_name")
        values[":family_name"] = family_name
        names["#family_name"] = "family_name"
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
    if http_method(event) == "OPTIONS":
        return _legacy(event, 200, {"ok": True})

    claims = _extract_claims(event)
    body, parse_error = parse_json_body(event)
    if parse_error:
        return _legacy(event, 400, {"ok": False, "message": parse_error})

    user_id = str(claims.get("sub", "")).strip()
    if not user_id:
        return _legacy(
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
    family_name_claim = str(claims.get("family_name", "")).strip()
    image_claim = str(claims.get("picture", "")).strip() or str(claims.get("image", "")).strip()
    provider_claim = str(claims.get("identities", "")).strip()

    email_body = str(body.get("email", "")).strip().lower()
    name_body = str(body.get("name", "")).strip()
    given_name_body = str(body.get("given_name", "")).strip()
    family_name_body = str(body.get("family_name", "")).strip()
    image_body = str(body.get("image", "")).strip()

    email = email_claim or email_body
    name = name_claim or name_body
    given_name = given_name_claim or given_name_body
    family_name = _infer_family_name(
        name_claim or name_body,
        given_name_claim or given_name_body,
        family_name_claim or family_name_body,
    )
    image = image_claim or image_body
    provider = str(body.get("provider", "")).strip() or ("Google" if provider_claim else "")
    if not provider:
        provider = "Google"

    if email_claim and email_body and email_claim != email_body:
        return _legacy(
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
        return _legacy(
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
        updated_item = None
        try:
            updated_item = _update_user_profile(
                user_id,
                now_iso,
                name=name,
                given_name=given_name,
                family_name=family_name,
                image=image,
                provider=provider,
            )
        except ClientError:
            LOG.exception("DynamoDB update_item last_login failed")
            try:
                updated_item = _update_last_login(user_id, now_iso)
            except ClientError:
                LOG.exception("DynamoDB update_item fallback last_login failed")
                return _legacy(
                    event,
                    500,
                    {
                        "ok": False,
                        "message": "Internal authorization update failure.",
                    },
                )

        if updated_item:
            item = updated_item

        if not item.get("last_login"):
            item["last_login"] = now_iso
        return _legacy(event, 200, _build_response_payload(item))

    new_user = {
        "user_id": user_id,
        "email": email,
        "name": name,
        "given_name": given_name,
        "family_name": family_name,
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
            return _legacy(event, 200, _build_response_payload(latest))
        LOG.exception("DynamoDB put_item failed")
        return _legacy(
            event,
            500,
            {
                "ok": False,
                "message": "Internal authorization create failure.",
                "error": exc.response.get("Error", {}).get("Code", "UnknownError"),
            },
        )

    return _legacy(event, 200, _build_response_payload(new_user))
