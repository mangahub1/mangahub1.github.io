import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

CATEGORY_TABLE_NAME = os.environ.get("CATEGORY_TABLE_NAME", "Category")
ddb = boto3.resource("dynamodb")
category_table = ddb.Table(CATEGORY_TABLE_NAME)


def _is_active(item):
    value = item.get("is_active", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def get_by_id(category_id, include_inactive=False):
    item = category_table.get_item(Key={"category_id": category_id}).get("Item")
    if not item:
        return None
    if include_inactive:
        return item
    if not _is_active(item):
        return None
    return item


def list_all(include_inactive=False):
    items = []
    scan_args = {}
    while True:
        result = category_table.scan(**scan_args)
        page_items = result.get("Items", [])
        if include_inactive:
            items.extend(page_items)
        else:
            items.extend(item for item in page_items if _is_active(item))
        last_evaluated_key = result.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break
        scan_args["ExclusiveStartKey"] = last_evaluated_key
    return items


def update_existing(category_id, attributes):
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
        result = category_table.update_item(
            Key={"category_id": category_id},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(category_id)",
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes")
    except ClientError:
        raise


def create_new(category_id, attributes):
    if not category_id:
        raise ValueError("category_id is required.")

    item = {"category_id": category_id}
    item.update(attributes or {})
    item["is_active"] = True
    category_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(category_id)",
    )
    return item


def soft_delete_by_id(category_id, deleted_by=""):
    deleted_at = datetime.now(timezone.utc).isoformat()
    deleted_by_value = str(deleted_by or "").strip()
    result = category_table.update_item(
        Key={"category_id": category_id},
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
        ConditionExpression="attribute_exists(category_id) AND (attribute_not_exists(is_active) OR is_active = :active)",
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")
