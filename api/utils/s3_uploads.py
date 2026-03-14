import os
from pathlib import Path
from urllib.parse import quote

import boto3

from utils.content_key import sanitize_for_s3

s3 = boto3.client("s3")

CONTENT_BUCKET = os.environ.get("CONTENT_BUCKET", "blupetal-prototype")
UPLOAD_URL_TTL_SECONDS = int(os.environ.get("UPLOAD_URL_TTL_SECONDS", "900"))
CONTENT_PUBLIC_BASE_URL = os.environ.get("CONTENT_PUBLIC_BASE_URL", "").strip().rstrip("/")


def _normalize_ext(file_name, content_type):
    suffix = Path(str(file_name or "").strip()).suffix.lower().strip(".")
    if suffix == "jpg":
        return "jpeg"
    if suffix:
        return suffix

    ctype = str(content_type or "").strip().lower()
    mapping = {
        "application/pdf": "pdf",
        "image/png": "png",
        "image/jpeg": "jpeg",
        "image/jpg": "jpeg",
        "image/webp": "webp",
        "image/svg+xml": "svg",
    }
    return mapping.get(ctype, "bin")


def _manga_root(manga_id, manga_slug=""):
    manga_part = sanitize_for_s3(manga_id)
    slug_part = sanitize_for_s3(manga_slug)
    if slug_part:
        return f"content/manga/{manga_part}-{slug_part}"
    return f"content/manga/{manga_part}"


def _content_location(content_key):
    normalized = str(content_key or "").strip().upper()
    if "#" not in normalized:
        return "content", sanitize_for_s3(content_key)
    content_type, sequence = normalized.split("#", 1)
    sequence = "".join(ch for ch in sequence if ch.isdigit()) or sanitize_for_s3(sequence)
    if content_type == "VOLUME":
        return "volumes", sequence
    if content_type == "CHAPTER":
        return "chapters", sequence
    return sanitize_for_s3(content_type), sequence


def s3_key_to_public_http_url(bucket, key):
    key_encoded = "/".join(quote(part, safe="") for part in str(key).split("/"))
    if CONTENT_PUBLIC_BASE_URL:
        return f"{CONTENT_PUBLIC_BASE_URL}/{key_encoded}"
    # Default to a root-relative URL so callers can resolve against the app/CDN origin.
    return f"/{key_encoded}"


def build_manga_cover_key(manga_id, file_name, content_type, manga_slug=""):
    ext = _normalize_ext(file_name, content_type)
    if ext not in {"png", "jpeg"}:
        raise ValueError("Unsupported cover content type. Use JPG or PNG.")
    root = _manga_root(manga_id, manga_slug)
    return f"{root}/series/series-cover.{ext}", content_type


def build_manga_content_file_key(manga_id, content_key, file_kind, file_name, content_type, manga_slug=""):
    ext = _normalize_ext(file_name, content_type)
    root = _manga_root(manga_id, manga_slug)
    section, sequence = _content_location(content_key)
    item_label = "volume" if section == "volumes" else "chapter" if section == "chapters" else "content"

    if file_kind == "cover":
        if ext not in {"png", "jpeg"}:
            raise ValueError("Unsupported cover content type. Use JPG or PNG.")
        normalized_content_type = "image/png" if ext == "png" else "image/jpeg"
        return f"{root}/{section}/{sequence}/{item_label}-cover.{ext}", normalized_content_type

    if file_kind == "file":
        if ext not in {"pdf", "epub"}:
            raise ValueError("Unsupported content file type. Use PDF or EPUB.")
        normalized_content_type = "application/pdf" if ext == "pdf" else "application/epub+zip"
        return f"{root}/{section}/{sequence}/{item_label}.{ext}", normalized_content_type

    raise ValueError("file_kind must be 'cover' or 'file'.")


def generate_upload_url(key, content_type):
    upload_url = s3.generate_presigned_url(
        ClientMethod="put_object",
        Params={
            "Bucket": CONTENT_BUCKET,
            "Key": key,
            "ContentType": content_type,
        },
        ExpiresIn=UPLOAD_URL_TTL_SECONDS,
    )
    return {
        "bucket": CONTENT_BUCKET,
        "key": key,
        "content_type": content_type,
        "upload_url": upload_url,
        "s3_url": f"s3://{CONTENT_BUCKET}/{key}",
        "file_url": s3_key_to_public_http_url(CONTENT_BUCKET, key),
    }
