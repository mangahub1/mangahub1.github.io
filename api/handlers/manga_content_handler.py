import logging

from botocore.exceptions import ClientError

from models.manga_content import MANGA_CONTENT_EDITABLE_FIELDS, normalize_manga_content_item
from repositories import manga_content_repository
from utils.api_gateway import get_param, http_method, parse_json_body
from utils.responses import error, success
from validators.manga_content_validator import (
    validate_content_key_matches,
    validate_manga_content_delete_payload,
    validate_manga_content_post_payload,
    validate_manga_content_put_payload,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _handle_get(event):
    manga_id = get_param(event, "manga_id")
    content_key = get_param(event, "content_key")

    if not manga_id:
        return error(event, 400, "manga_id is required.")

    if content_key:
        item = manga_content_repository.get_by_key(manga_id, content_key)
        if not item:
            return error(event, 404, "MangaContent not found.")
        return success(event, normalize_manga_content_item(item))

    items = manga_content_repository.list_by_manga_id(manga_id)
    normalized = [normalize_manga_content_item(item) for item in items]
    normalized.sort(key=lambda item: item.get("content_key", "").upper())
    return success(event, {"items": normalized, "count": len(normalized)})


def _handle_put(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_content_put_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    mismatch_error = validate_content_key_matches(payload)
    if mismatch_error:
        return error(event, 400, mismatch_error)

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    editable_values = {
        key: payload[key]
        for key in MANGA_CONTENT_EDITABLE_FIELDS
        if key in payload
    }
    if not editable_values:
        return error(event, 400, "No editable fields were provided.")

    try:
        updated = manga_content_repository.update_existing(manga_id, content_key, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "MangaContent not found.")
        LOG.exception("Failed to update manga content")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_content_item(updated))


def _handle_post(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_content_post_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    mismatch_error = validate_content_key_matches(payload)
    if mismatch_error:
        return error(event, 400, mismatch_error)

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    editable_values = {
        key: payload[key]
        for key in MANGA_CONTENT_EDITABLE_FIELDS
        if key in payload
    }

    try:
        created = manga_content_repository.create_new(manga_id, content_key, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 409, "MangaContent already exists.")
        LOG.exception("Failed to create manga content")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_content_item(created))


def _handle_delete(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_manga_content_delete_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    try:
        deleted = manga_content_repository.delete_by_key(manga_id, content_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "MangaContent not found.")
        LOG.exception("Failed to delete manga content")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_manga_content_item(deleted or {
        "manga_id": manga_id,
        "content_key": content_key,
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
