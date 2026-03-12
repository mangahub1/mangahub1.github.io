import json
import os


def _cors_headers(event, methods):
    headers_in = event.get("headers") or {}
    origin = headers_in.get("origin") or headers_in.get("Origin")

    single_origin = os.environ.get("CORS_ALLOW_ORIGIN", "*")
    origin_list = os.environ.get("CORS_ALLOW_ORIGINS", "")
    allowed = [entry.strip() for entry in origin_list.split(",") if entry.strip()]
    fallback_origin = allowed[0] if allowed else single_origin
    allow_origin = origin if origin and origin in allowed else fallback_origin

    return {
        "Access-Control-Allow-Origin": allow_origin,
        "Access-Control-Allow-Headers": "Authorization,Content-Type",
        "Access-Control-Allow-Methods": methods,
        "Vary": "Origin",
        "Content-Type": "application/json",
    }


def response(event, status_code, payload, methods="OPTIONS,GET,PUT"):
    return {
        "statusCode": status_code,
        "headers": _cors_headers(event, methods),
        "body": json.dumps(payload),
    }


def success(event, data, status_code=200, methods="OPTIONS,GET,PUT"):
    return response(event, status_code, {"success": True, "data": data}, methods=methods)


def error(event, status_code, message, methods="OPTIONS,GET,PUT"):
    return response(event, status_code, {"success": False, "error": message}, methods=methods)
