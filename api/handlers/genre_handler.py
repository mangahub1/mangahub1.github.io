import logging

from botocore.exceptions import ClientError

from models.genre import GENRE_EDITABLE_FIELDS, normalize_genre
from repositories import genre_repository
from utils.api_gateway import get_param, http_method, parse_json_body, request_user_id
from utils.responses import error, success
from validators.genre_validator import (
    validate_genre_delete_payload,
    validate_genre_post_payload,
    validate_genre_put_payload,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _handle_get(event):
    genre_id = get_param(event, "genre_id")
    if genre_id:
        item = genre_repository.get_by_id(genre_id)
        if not item:
            return error(event, 404, "Genre not found.")
        return success(event, normalize_genre(item))

    items = genre_repository.list_all()
    normalized = [normalize_genre(item) for item in items]
    normalized.sort(key=lambda item: item.get("name", "").lower())
    return success(event, {"items": normalized, "count": len(normalized)})


def _handle_put(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_genre_put_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    genre_id = str(payload.get("genre_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in GENRE_EDITABLE_FIELDS
        if key in payload
    }
    if not editable_values:
        return error(event, 400, "No editable fields were provided.")

    try:
        updated = genre_repository.update_existing(genre_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "Genre not found.")
        LOG.exception("Failed to update genre")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_genre(updated))


def _handle_post(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_genre_post_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    genre_id = str(payload.get("genre_id", "")).strip()
    editable_values = {
        key: payload[key]
        for key in GENRE_EDITABLE_FIELDS
        if key in payload
    }

    try:
        created = genre_repository.create_new(genre_id, editable_values)
    except ValueError as exc:
        return error(event, 400, str(exc))
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 409, "Genre already exists.")
        LOG.exception("Failed to create genre")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_genre(created))


def _handle_delete(event):
    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    validation_errors = validate_genre_delete_payload(payload)
    if validation_errors:
        return error(event, 400, " | ".join(validation_errors))

    genre_id = str(payload.get("genre_id", "")).strip()
    deleted_by = request_user_id(event)
    try:
        deleted = genre_repository.soft_delete_by_id(genre_id, deleted_by=deleted_by)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "Genre not found.")
        LOG.exception("Failed to delete genre")
        return error(event, 500, f"Internal error: {code}")

    return success(event, normalize_genre(deleted or {"genre_id": genre_id}))


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
