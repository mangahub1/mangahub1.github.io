import logging

from botocore.exceptions import ClientError

from models.manga import MANGA_EDITABLE_FIELDS, normalize_manga_item
from repositories import manga_repository
from utils.api_gateway import get_param, http_method, parse_json_body, request_user_id
from utils.responses import error, success
from validators.manga_validator import validate_manga_put_payload
from validators.manga_validator import (
    validate_manga_delete_payload,
    validate_manga_post_payload,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _handle_get(event):
    manga_id = get_param(event, "manga_id")
    if manga_id:
        item = manga_repository.get_by_id(manga_id)
        if not item:
            return error(event, 404, "Manga not found.")
        return success(event, normalize_manga_item(item))

    items = manga_repository.list_all()
    normalized = [normalize_manga_item(item) for item in items]
    normalized.sort(key=lambda item: item.get("title", "").lower())
    return success(event, {"items": normalized, "count": len(normalized)})


def _handle_put(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_put_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    manga_id = str(payload.get("manga_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in MANGA_EDITABLE_FIELDS
        if key in payload
    }
    if not editable_values:
        return error(event, 400, "No editable fields were provided.")

    try:
        updated = manga_repository.update_existing(manga_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "Manga not found.")
        LOG.exception("Failed to update manga")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_item(updated))


def _handle_post(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_post_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    manga_id = str(payload.get("manga_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in MANGA_EDITABLE_FIELDS
        if key in payload
    }

    try:
        created = manga_repository.create_new(manga_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 409, "Manga already exists.")
        LOG.exception("Failed to create manga")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_item(created))


def _handle_delete(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_delete_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    manga_id = str(payload.get("manga_id", "")).strip()
    deleted_by = request_user_id(event)
    try:
        deleted = manga_repository.soft_delete_by_id(manga_id, deleted_by=deleted_by)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "Manga not found.")
        LOG.exception("Failed to delete manga")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_item(deleted or {"manga_id": manga_id}))


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
