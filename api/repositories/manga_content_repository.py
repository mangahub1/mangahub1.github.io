import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

MANGA_CONTENT_TABLE_NAME = os.environ.get("MANGA_CONTENT_TABLE_NAME", "MangaContent")
ddb = boto3.resource("dynamodb")
manga_content_table = ddb.Table(MANGA_CONTENT_TABLE_NAME)


def _is_active(item):
    value = item.get("is_active", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def get_by_key(manga_id, content_key, include_inactive=False):
    item = manga_content_table.get_item(
        Key={"manga_id": manga_id, "content_key": content_key}
    ).get("Item")
    if not item:
        return None
    if include_inactive:
        return item
    if not _is_active(item):
        return None
    return item


def list_by_manga_id(manga_id, include_inactive=False):
    items = []
    query_args = {
        "KeyConditionExpression": Key("manga_id").eq(manga_id),
    }

    while True:
        result = manga_content_table.query(**query_args)
        page_items = result.get("Items", [])
        if include_inactive:
            items.extend(page_items)
        else:
            items.extend(item for item in page_items if _is_active(item))
        last_evaluated_key = result.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break
        query_args["ExclusiveStartKey"] = last_evaluated_key

    return items


def update_existing(manga_id, content_key, attributes):
    if not attributes:
        raise ValueError("No editable fields were provided.")

    update_parts = []
    names = {}
    values = {}

    for field, value in attributes.items():
        name_key = f"#f_{field}"
        value_key = f":v_{field}"
        names[name_key] = field
        values[value_key] = value
        update_parts.append(f"{name_key} = {value_key}")

    expression = "SET " + ", ".join(update_parts)
    try:
        result = manga_content_table.update_item(
            Key={"manga_id": manga_id, "content_key": content_key},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(manga_id) AND attribute_exists(content_key)",
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes")
    except ClientError:
        raise


def create_new(manga_id, content_key, attributes):
    if not manga_id:
        raise ValueError("manga_id is required.")
    if not content_key:
        raise ValueError("content_key is required.")

    item = {
        "manga_id": manga_id,
        "content_key": content_key,
    }
    item.update(attributes or {})
    item["is_active"] = True
    manga_content_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(manga_id) AND attribute_not_exists(content_key)",
    )
    return item


def soft_delete_by_key(manga_id, content_key, deleted_by=""):
    deleted_at = datetime.now(timezone.utc).isoformat()
    deleted_by_value = str(deleted_by or "").strip()
    result = manga_content_table.update_item(
        Key={"manga_id": manga_id, "content_key": content_key},
        UpdateExpression="SET #is_active = :inactive, #deleted_at = :deleted_at, #deleted_by = :deleted_by",
        ExpressionAttributeNames={
            "#is_active": "is_active",
            "#deleted_at": "deleted_at",
            "#deleted_by": "deleted_by",
        },
        ExpressionAttributeValues={
            ":inactive": False,
            ":active": True,
            ":deleted_at": deleted_at,
            ":deleted_by": deleted_by_value,
        },
        ConditionExpression=(
            "attribute_exists(manga_id) AND attribute_exists(content_key) "
            "AND (attribute_not_exists(is_active) OR is_active = :active)"
        ),
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")
