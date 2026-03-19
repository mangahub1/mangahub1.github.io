import logging

from botocore.exceptions import ClientError

from models.feature_category_item import (
    FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS,
    normalize_feature_category_item,
)
from repositories import feature_category_item_repository
from utils.api_gateway import get_param, http_method, parse_json_body, request_user_id
from utils.responses import error, success
from validators.feature_category_item_validator import (
    validate_feature_category_item_delete_payload,
    validate_feature_category_item_post_payload,
    validate_feature_category_item_put_payload,
    validate_item_type_requirements,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _item_order_value(item):
    try:
        value = int(item.get("display_order", 0))
    except (TypeError, ValueError):
        value = 0
    return value if value >= 0 else 0


def _handle_get(event):
    category_id = get_param(event, "category_id")
    sort_key = get_param(event, "sort_key")

    if not category_id:
        return error(event, 400, "category_id is required.")

    if sort_key:
        item = feature_category_item_repository.get_by_key(category_id, sort_key)
        if not item:
            return error(event, 404, "FeatureCategoryItem not found.")
        return success(event, normalize_feature_category_item(item))

    items = feature_category_item_repository.list_by_category_id(category_id)
    normalized = [normalize_feature_category_item(item) for item in items]
    normalized.sort(key=lambda item: (_item_order_value(item), item.get("sort_key", "").upper()))
    return success(event, {"items": normalized, "count": len(normalized)})


def _handle_put(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_item_put_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    category_id = str(payload.get("category_id", "")).strip()
    sort_key = str(payload.get("sort_key", "")).strip()
    editable_values = {
        key: payload[key]
        for key in FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS
        if key in payload
    }
    if not editable_values:
        return error(event, 400, "No editable fields were provided.")

    try:
        updated = feature_category_item_repository.update_existing(category_id, sort_key, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "FeatureCategoryItem not found.")
        LOG.exception("Failed to update feature category item")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category_item(updated))


def _handle_post(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_item_post_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    type_error = validate_item_type_requirements(payload)
    if type_error:
        return error(event, 400, type_error)

    category_id = str(payload.get("category_id", "")).strip()
    sort_key = str(payload.get("sort_key", "")).strip()
    editable_values = {
        key: payload[key]
        for key in FEATURE_CATEGORY_ITEM_EDITABLE_FIELDS
        if key in payload
    }

    try:
        created = feature_category_item_repository.create_new(category_id, sort_key, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 409, "FeatureCategoryItem already exists.")
        LOG.exception("Failed to create feature category item")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category_item(created))


def _handle_delete(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_feature_category_item_delete_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    category_id = str(payload.get("category_id", "")).strip()
    sort_key = str(payload.get("sort_key", "")).strip()
    deleted_by = request_user_id(event)
    try:
        deleted = feature_category_item_repository.soft_delete_by_key(
            category_id,
            sort_key,
            deleted_by=deleted_by,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "FeatureCategoryItem not found.")
        LOG.exception("Failed to delete feature category item")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_feature_category_item(deleted or {
        "category_id": category_id,
        "sort_key": sort_key,
    }))


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
