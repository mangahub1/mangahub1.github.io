import base64
import json


def http_method(event):
    return (
        event.get("requestContext", {}).get("http", {}).get("method")
        or event.get("httpMethod")
        or ""
    ).upper()


def query_params(event):
    return event.get("queryStringParameters") or {}


def path_params(event):
    return event.get("pathParameters") or {}


def parse_json_body(event):
    raw = event.get("body")
    if raw is None or raw == "":
        return {}, None

    if event.get("isBase64Encoded") and isinstance(raw, str):
        try:
            raw = base64.b64decode(raw).decode("utf-8")
        except Exception:
            return None, "Request body is not valid base64 data."

    try:
        body = json.loads(raw) if isinstance(raw, str) else raw
    except json.JSONDecodeError:
        return None, "Request body must be valid JSON."

    if not isinstance(body, dict):
        return None, "Request body must be a JSON object."

    return body, None


def get_param(event, key):
    path = path_params(event)
    query = query_params(event)
    value = path.get(key)
    if value not in (None, ""):
        return str(value).strip()
    value = query.get(key)
    if value not in (None, ""):
        return str(value).strip()
    return ""
