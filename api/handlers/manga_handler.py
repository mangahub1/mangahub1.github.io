import logging

from botocore.exceptions import ClientError

from models.manga import MANGA_EDITABLE_FIELDS, normalize_manga_item
from repositories import feature_category_item_repository, manga_repository, user_library_repository
from utils.api_gateway import get_param, http_method, parse_json_body, query_params, request_user_id
from utils.responses import error, success
from validators.manga_validator import validate_manga_put_payload
from validators.manga_validator import (
    validate_manga_delete_payload,
    validate_manga_post_payload,
)

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _parse_filter_ids(raw_value):
    return [
        value.strip()
        for value in str(raw_value or "").split(",")
        if value and value.strip()
    ]


def _feature_set_manga_ids(feature_category_ids):
    wanted_feature_ids = [value for value in (feature_category_ids or []) if str(value).strip()]
    if not wanted_feature_ids:
        return None

    manga_ids = set()
    for category_id in wanted_feature_ids:
        items = feature_category_item_repository.list_by_category_id(category_id)
        for item in items:
            manga_id = str(item.get("manga_id", "")).strip()
            if manga_id:
                manga_ids.add(manga_id)
    return manga_ids


def _to_bool(value):
    return str(value or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def _intersect_allowed_sets(*allowed_sets):
    intersected = None
    for allowed in allowed_sets:
        if allowed is None:
            continue
        clean = {str(value).strip() for value in allowed if str(value).strip()}
        if intersected is None:
            intersected = clean
        else:
            intersected = intersected.intersection(clean)
    return intersected


def _current_user_library_manga_ids(event):
    user_id = request_user_id(event)
    if not user_id:
        return set()
    return set(user_library_repository.list_manga_ids_for_user(user_id))


def _with_user_library_flag(item, user_library_ids):
    normalized = normalize_manga_item(item)
    manga_id = str(normalized.get("manga_id", "")).strip()
    normalized["in_user_library"] = manga_id in (user_library_ids or set())
    return normalized


def _handle_get(event):
    user_library_ids = _current_user_library_manga_ids(event)

    manga_id = get_param(event, "manga_id")
    if manga_id:
        item = manga_repository.get_by_id(manga_id)
        if not item:
            return error(event, 404, "Manga not found.")
        return success(event, _with_user_library_flag(item, user_library_ids))

    params = query_params(event)
    query = (
        get_param(event, "query")
        or get_param(event, "q")
        or get_param(event, "title")
    )
    genre_ids = _parse_filter_ids(get_param(event, "genre_ids") or get_param(event, "genre_id"))
    category_ids = _parse_filter_ids(
        get_param(event, "category_ids") or get_param(event, "category_id")
    )
    feature_category_ids = _parse_filter_ids(
        get_param(event, "feature_category_ids")
        or get_param(event, "feature_category_id")
        or get_param(event, "feature_set_ids")
        or get_param(event, "feature_set_id")
    )
    library_only = _to_bool(
        get_param(event, "user_library")
        or get_param(event, "library_only")
        or get_param(event, "my_library")
    )
    has_filters = bool(
        str(query or "").strip()
        or genre_ids
        or category_ids
        or feature_category_ids
        or library_only
        or (params and "q" in params)
    )

    if has_filters:
        feature_manga_ids = _feature_set_manga_ids(feature_category_ids)
        library_manga_ids = None
        if library_only:
            user_id = request_user_id(event)
            if not user_id:
                return error(event, 401, "Unauthorized: user identity is required for user library.")
            library_manga_ids = user_library_ids if user_library_ids else set(
                user_library_repository.list_manga_ids_for_user(user_id)
            )
        allowed_manga_ids = _intersect_allowed_sets(feature_manga_ids, library_manga_ids)
        items = manga_repository.list_filtered(
            query=query,
            genre_ids=genre_ids,
            category_ids=category_ids,
            allowed_manga_ids=allowed_manga_ids,
        )
    else:
        items = manga_repository.list_all()

    normalized = [_with_user_library_flag(item, user_library_ids) for item in items]
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
