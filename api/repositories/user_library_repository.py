import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError
from boto3.dynamodb.conditions import Key

USER_LIBRARY_TABLE_NAME = os.environ.get("USER_LIBRARY_TABLE_NAME", "UserLibrary")

ddb = boto3.resource("dynamodb")
user_library_table = ddb.Table(USER_LIBRARY_TABLE_NAME)


def _is_active(item):
    value = item.get("is_active", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def add_manga(user_id, manga_id):
    now = datetime.now(timezone.utc).isoformat()
    item = {
        "user_id": str(user_id).strip(),
        "manga_id": str(manga_id).strip(),
        "is_active": True,
        "added_at": now,
        "updated_at": now,
    }
    try:
        user_library_table.put_item(
            Item=item,
            ConditionExpression="attribute_not_exists(user_id) AND attribute_not_exists(manga_id)",
        )
        return item
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code != "ConditionalCheckFailedException":
            raise

    # Existing mapping: restore it as active.
    result = user_library_table.update_item(
        Key={"user_id": str(user_id).strip(), "manga_id": str(manga_id).strip()},
        UpdateExpression="SET #is_active = :active, #updated_at = :updated_at",
        ExpressionAttributeNames={"#is_active": "is_active", "#updated_at": "updated_at"},
        ExpressionAttributeValues={":active": True, ":updated_at": now},
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes", item)


def remove_manga(user_id, manga_id):
    now = datetime.now(timezone.utc).isoformat()
    result = user_library_table.update_item(
        Key={"user_id": str(user_id).strip(), "manga_id": str(manga_id).strip()},
        UpdateExpression="SET #is_active = :inactive, #updated_at = :updated_at",
        ExpressionAttributeNames={"#is_active": "is_active", "#updated_at": "updated_at"},
        ExpressionAttributeValues={":inactive": False, ":updated_at": now, ":active": True},
        ConditionExpression="attribute_exists(user_id) AND attribute_exists(manga_id) AND #is_active = :active",
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")


def list_for_user(user_id, include_inactive=False):
    items = []
    query_args = {
        "KeyConditionExpression": Key("user_id").eq(str(user_id).strip()),
    }
    while True:
        response = user_library_table.query(**query_args)
        page = response.get("Items", [])
        if include_inactive:
            items.extend(page)
        else:
            items.extend(item for item in page if _is_active(item))
        last_evaluated_key = response.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break
        query_args["ExclusiveStartKey"] = last_evaluated_key
    return items


def list_manga_ids_for_user(user_id):
    return [
        str(item.get("manga_id", "")).strip()
        for item in list_for_user(user_id, include_inactive=False)
        if str(item.get("manga_id", "")).strip()
    ]
