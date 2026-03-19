from handlers.get_users_handler import lambda_handler as get_users_handler
from handlers.update_user_handler import lambda_handler as update_user_handler
from utils.api_gateway import http_method
from utils.responses import error, response


def lambda_handler(event, context):
    method = http_method(event)
    if method == "OPTIONS":
        return response(event, 200, {"ok": True}, methods="OPTIONS,GET,PUT")
    if method == "GET":
        return get_users_handler(event, context)
    if method == "PUT":
        return update_user_handler(event, context)
    return error(event, 405, "Method not allowed.", methods="OPTIONS,GET,PUT")
