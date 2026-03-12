import logging
import os

from botocore.exceptions import ClientError

from utils.api_gateway import http_method, parse_json_body
from utils.responses import error, success
from utils.s3_uploads import build_manga_content_file_key, generate_upload_url

LOG = logging.getLogger()
LOG.setLevel(logging.INFO)
MAX_MANGA_CONTENT_COVER_UPLOAD_BYTES = int(
    os.environ.get("MAX_MANGA_CONTENT_COVER_UPLOAD_BYTES", str(3 * 1024 * 1024))
)
MAX_MANGA_CONTENT_FILE_UPLOAD_BYTES = int(
    os.environ.get("MAX_MANGA_CONTENT_FILE_UPLOAD_BYTES", str(1536 * 1024 * 1024))
)


def lambda_handler(event, context):
    method = http_method(event)
    if method == "OPTIONS":
        return success(event, {"ok": True}, methods="OPTIONS,POST")
    if method != "POST":
        return error(event, 405, "Method not allowed.", methods="OPTIONS,POST")

    payload, parse_error = parse_json_body(event)
    if parse_error:
        return error(event, 400, parse_error, methods="OPTIONS,POST")

    manga_id = str(payload.get("manga_id", "")).strip()
    content_key = str(payload.get("content_key", "")).strip()
    file_kind = str(payload.get("file_kind", "")).strip().lower()
    file_name = str(payload.get("file_name", "")).strip()
    content_type = str(payload.get("content_type", "")).strip()
    file_size_raw = payload.get("file_size")
    manga_slug = str(payload.get("manga_slug", "")).strip()

    if not manga_id:
        return error(event, 400, "manga_id is required.", methods="OPTIONS,POST")
    if not content_key:
        return error(event, 400, "content_key is required.", methods="OPTIONS,POST")
    if file_kind not in {"cover", "file"}:
        return error(event, 400, "file_kind must be 'cover' or 'file'.", methods="OPTIONS,POST")
    if not file_name:
        return error(event, 400, "file_name is required.", methods="OPTIONS,POST")
    if not content_type:
        return error(event, 400, "content_type is required.", methods="OPTIONS,POST")
    try:
        file_size = int(file_size_raw)
    except (TypeError, ValueError):
        return error(event, 400, "file_size is required and must be an integer.", methods="OPTIONS,POST")
    if file_size <= 0:
        return error(event, 400, "file_size must be greater than 0.", methods="OPTIONS,POST")

    max_upload_bytes = (
        MAX_MANGA_CONTENT_COVER_UPLOAD_BYTES
        if file_kind == "cover"
        else MAX_MANGA_CONTENT_FILE_UPLOAD_BYTES
    )
    if file_size > max_upload_bytes:
        max_mb = max_upload_bytes / (1024 * 1024)
        return error(
            event,
            400,
            f"{file_kind.capitalize()} exceeds max upload size ({max_mb:g} MB).",
            methods="OPTIONS,POST",
        )

    try:
        key, normalized_content_type = build_manga_content_file_key(
            manga_id=manga_id,
            content_key=content_key,
            file_kind=file_kind,
            file_name=file_name,
            content_type=content_type,
            manga_slug=manga_slug,
        )
        upload_payload = generate_upload_url(key, normalized_content_type)
    except ValueError as exc:
        return error(event, 400, str(exc), methods="OPTIONS,POST")
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "UnknownError")
        LOG.exception("Failed to generate manga content upload URL")
        return error(event, 500, f"Internal error: {code}", methods="OPTIONS,POST")

    upload_payload["manga_id"] = manga_id
    upload_payload["content_key"] = content_key
    upload_payload["file_kind"] = file_kind
    upload_payload["max_upload_bytes"] = max_upload_bytes
    return success(event, upload_payload, methods="OPTIONS,POST")
