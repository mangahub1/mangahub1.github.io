from utils.api_gateway import http_method
from utils.responses import error

from handlers.category_handler import lambda_handler as category_handler
from handlers.feature_category_handler import lambda_handler as feature_category_handler
from handlers.feature_category_item_handler import lambda_handler as feature_category_item_handler
from handlers.get_users_handler import lambda_handler as get_users_handler
from handlers.genre_handler import lambda_handler as genre_handler
from handlers.manga_content_handler import lambda_handler as manga_content_handler
from handlers.manga_content_upload_url_handler import (
    lambda_handler as manga_content_upload_url_handler,
)
from handlers.manga_handler import lambda_handler as manga_handler
from handlers.manga_upload_url_handler import lambda_handler as manga_upload_url_handler
from handlers.users_handler import lambda_handler as users_handler
from handlers.update_user_handler import lambda_handler as update_user_handler
from handlers.validate_user_handler import lambda_handler as validate_user_handler


def _normalize_path(event):
    raw_path = event.get("rawPath") or event.get("path") or "/"
    cleaned = str(raw_path).strip()
    if not cleaned.startswith("/"):
        cleaned = "/" + cleaned
    if len(cleaned) > 1:
        cleaned = cleaned.rstrip("/")
    return cleaned


ROUTES = {
    ("POST", "/auth/validate"): validate_user_handler,
    ("GET", "/users"): users_handler,
    ("PUT", "/users"): users_handler,
    ("GET", "/get-users"): get_users_handler,
    ("PUT", "/update-user"): update_user_handler,
    ("GET", "/feature-category"): feature_category_handler,
    ("POST", "/feature-category"): feature_category_handler,
    ("PUT", "/feature-category"): feature_category_handler,
    ("DELETE", "/feature-category"): feature_category_handler,
    ("GET", "/get-feature-category"): feature_category_handler,
    ("POST", "/create-feature-category"): feature_category_handler,
    ("PUT", "/update-feature-category"): feature_category_handler,
    ("DELETE", "/delete-feature-category"): feature_category_handler,
    ("GET", "/feature-category-item"): feature_category_item_handler,
    ("POST", "/feature-category-item"): feature_category_item_handler,
    ("PUT", "/feature-category-item"): feature_category_item_handler,
    ("DELETE", "/feature-category-item"): feature_category_item_handler,
    ("GET", "/get-feature-category-item"): feature_category_item_handler,
    ("POST", "/create-feature-category-item"): feature_category_item_handler,
    ("PUT", "/update-feature-category-item"): feature_category_item_handler,
    ("DELETE", "/delete-feature-category-item"): feature_category_item_handler,
    ("GET", "/category"): category_handler,
    ("POST", "/category"): category_handler,
    ("PUT", "/category"): category_handler,
    ("DELETE", "/category"): category_handler,
    ("GET", "/get-category"): category_handler,
    ("POST", "/create-category"): category_handler,
    ("PUT", "/update-category"): category_handler,
    ("DELETE", "/delete-category"): category_handler,
    ("GET", "/genre"): genre_handler,
    ("POST", "/genre"): genre_handler,
    ("PUT", "/genre"): genre_handler,
    ("DELETE", "/genre"): genre_handler,
    ("GET", "/get-genre"): genre_handler,
    ("POST", "/create-genre"): genre_handler,
    ("PUT", "/update-genre"): genre_handler,
    ("DELETE", "/delete-genre"): genre_handler,
    ("GET", "/manga"): manga_handler,
    ("POST", "/manga"): manga_handler,
    ("PUT", "/manga"): manga_handler,
    ("DELETE", "/manga"): manga_handler,
    ("GET", "/get-manga"): manga_handler,
    ("POST", "/create-manga"): manga_handler,
    ("PUT", "/update-manga"): manga_handler,
    ("DELETE", "/delete-manga"): manga_handler,
    ("POST", "/get-manga-upload-url"): manga_upload_url_handler,
    ("POST", "/manga/upload-url"): manga_upload_url_handler,
    ("GET", "/manga-content"): manga_content_handler,
    ("POST", "/manga-content"): manga_content_handler,
    ("PUT", "/manga-content"): manga_content_handler,
    ("DELETE", "/manga-content"): manga_content_handler,
    ("GET", "/get-manga-content"): manga_content_handler,
    ("POST", "/create-manga-content"): manga_content_handler,
    ("PUT", "/update-manga-content"): manga_content_handler,
    ("DELETE", "/delete-manga-content"): manga_content_handler,
    ("POST", "/get-manga-content-upload-url"): manga_content_upload_url_handler,
    ("POST", "/manga-content/upload-url"): manga_content_upload_url_handler,
}

PATH_HANDLERS = {
    "/auth/validate": validate_user_handler,
    "/users": users_handler,
    "/get-users": get_users_handler,
    "/update-user": update_user_handler,
    "/feature-category": feature_category_handler,
    "/get-feature-category": feature_category_handler,
    "/create-feature-category": feature_category_handler,
    "/update-feature-category": feature_category_handler,
    "/delete-feature-category": feature_category_handler,
    "/feature-category-item": feature_category_item_handler,
    "/get-feature-category-item": feature_category_item_handler,
    "/create-feature-category-item": feature_category_item_handler,
    "/update-feature-category-item": feature_category_item_handler,
    "/delete-feature-category-item": feature_category_item_handler,
    "/category": category_handler,
    "/get-category": category_handler,
    "/create-category": category_handler,
    "/update-category": category_handler,
    "/delete-category": category_handler,
    "/genre": genre_handler,
    "/get-genre": genre_handler,
    "/create-genre": genre_handler,
    "/update-genre": genre_handler,
    "/delete-genre": genre_handler,
    "/manga": manga_handler,
    "/get-manga": manga_handler,
    "/create-manga": manga_handler,
    "/update-manga": manga_handler,
    "/delete-manga": manga_handler,
    "/get-manga-upload-url": manga_upload_url_handler,
    "/manga/upload-url": manga_upload_url_handler,
    "/manga-content": manga_content_handler,
    "/get-manga-content": manga_content_handler,
    "/create-manga-content": manga_content_handler,
    "/update-manga-content": manga_content_handler,
    "/delete-manga-content": manga_content_handler,
    "/get-manga-content-upload-url": manga_content_upload_url_handler,
    "/manga-content/upload-url": manga_content_upload_url_handler,
}


def lambda_handler(event, context):
    method = http_method(event)
    path = _normalize_path(event)

    if method == "OPTIONS":
        path_handler = PATH_HANDLERS.get(path)
        if path_handler:
            return path_handler(event, context)
        return error(event, 404, f"Route not found: OPTIONS {path}")

    target = ROUTES.get((method, path))
    if not target:
        return error(event, 404, f"Route not found: {method} {path}")

    return target(event, context)
