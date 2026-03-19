import logging

from botocore.exceptions import ClientError

from models.feature_category import FEATURE_CATEGORY_EDITABLE_FIELDS, normalize_feature_category
from repositories import feature_category_repository
from utils.api_gateway import get_param, http_method, parse_json_body, request_user_id
from utils.responses import error, success
from validators.feature_category_validator import (
    validate_feature_category_delete_payload,
    validate_feature_category_post_payload,
    validate_feature_category_put_payload,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _handle_get(event):
    category_id = get_param(event, "category_id")
    if category_id:
        item = feature_category_repository.get_by_id(category_id)
        if not item:
            return error(event, 404, "FeatureCategory not found.")
        return success(event, normalize_feature_category(item))

    items = feature_category_repository.list_all()
    normalized = [normalize_feature_category(item) for item in items]
    normalized.sort(
        key=lambda item: (
            item.get("display_order")
            if isinstance(item.get("display_order"), int)
            else 10**9,
            item.get("name", "").lower(),
        )
    )
    return success(event, {"items": normalized, "count": len(normalized)})


def _handle_put(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_put_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    category_id = str(payload.get("category_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in FEATURE_CATEGORY_EDITABLE_FIELDS
        if key in payload
    }
    if not editable_values:
        return error(event, 400, "No editable fields were provided.")

    try:
        updated = feature_category_repository.update_existing(category_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "FeatureCategory not found.")
        LOG.exception("Failed to update feature category")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category(updated))


def _handle_post(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_post_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    category_id = str(payload.get("category_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in FEATURE_CATEGORY_EDITABLE_FIELDS
        if key in payload
    }

    try:
        created = feature_category_repository.create_new(category_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 409, "FeatureCategory already exists.")
        LOG.exception("Failed to create feature category")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category(created))


def _handle_delete(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_delete_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    category_id = str(payload.get("category_id", "")).strip()
    deleted_by = request_user_id(event)
    try:
        deleted = feature_category_repository.soft_delete_by_id(category_id, deleted_by=deleted_by)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "FeatureCategory not found.")
        LOG.exception("Failed to delete feature category")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category(deleted or {"category_id": category_id}))


def lambda_handler(event, context):
    method = http_method(event)
    if method == "OPTIONS":
        return success(event, {"ok": True})
    if method == "GET":
        return _handle_get(event)
    if method == "POST":
        return _handle_post(event)
    if method == "PUT":
        return _handle_put(event)
    if method == "DELETE":
        return _handle_delete(event)
    return error(event, 405, "Method not allowed.")
