import logging

from botocore.exceptions import ClientError

from repositories import manga_repository, user_library_repository
from utils.api_gateway import get_param, http_method, parse_json_body, request_user_id
from utils.responses import error, success

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)


def _require_user_id(event):
    user_id = request_user_id(event)
    if not user_id:
        return "", error(event, 401, "Unauthorized: user identity is required.")
    return user_id, None


def _handle_get(event):
    user_id, auth_error = _require_user_id(event)
    if auth_error:
        return auth_error

    items = user_library_repository.list_for_user(user_id)
    normalized = [
        {
            "user_id": str(item.get("user_id", "")).strip(),
            "manga_id": str(item.get("manga_id", "")).strip(),
            "added_at": item.get("added_at"),
            "updated_at": item.get("updated_at"),
        }
        for item in items
        if str(item.get("manga_id", "")).strip()
    ]
    return success(
        event,
        {
            "items": normalized,
            "manga_ids": [item["manga_id"] for item in normalized],
            "count": len(normalized),
        },
    )


def _handle_post(event):
    user_id, auth_error = _require_user_id(event)
    if auth_error:
        return auth_error

    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    manga_id = str(
        payload.get("manga_id", "")
        or get_param(event, "manga_id")
    ).strip()
    if not manga_id:
        return error(event, 400, "manga_id is required.")

    manga = manga_repository.get_by_id(manga_id)
    if not manga:
        return error(event, 404, "Manga not found.")

    try:
        mapping = user_library_repository.add_manga(user_id, manga_id)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        LOG.exception("Failed to add user library item")
        return error(event, 500, f"Internal error: {code}")

    return success(
        event,
        {
            "user_id": str(mapping.get("user_id", user_id)).strip(),
            "manga_id": str(mapping.get("manga_id", manga_id)).strip(),
            "added_at": mapping.get("added_at"),
            "updated_at": mapping.get("updated_at"),
            "in_library": True,
        },
    )


def _handle_delete(event):
    user_id, auth_error = _require_user_id(event)
    if auth_error:
        return auth_error

    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error)

    manga_id = str(
        payload.get("manga_id", "")
        or get_param(event, "manga_id")
    ).strip()
    if not manga_id:
        return error(event, 400, "manga_id is required.")

    try:
        mapping = user_library_repository.remove_manga(user_id, manga_id)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        if code == "ConditionalCheckFailedException":
            return error(event, 404, "Library item not found.")
        LOG.exception("Failed to remove user library item")
        return error(event, 500, f"Internal error: {code}")

    return success(
        event,
        {
            "user_id": str(mapping.get("user_id", user_id)).strip(),
            "manga_id": str(mapping.get("manga_id", manga_id)).strip(),
            "in_library": False,
        },
    )


def lambda_handler(event, context):
    method = http_method(event)
    if method == "OPTIONS":
        return success(event, {"ok": True})
    if method == "GET":
        return _handle_get(event)
    if method == "POST":
        return _handle_post(event)
    if method == "DELETE":
        return _handle_delete(event)
    return error(event, 405, "Method not allowed.")
