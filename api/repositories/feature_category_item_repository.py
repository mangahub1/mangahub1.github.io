import os
from datetime import datetime, timezone

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

FEATURE_CATEGORY_ITEM_TABLE_NAME = os.environ.get(
    "FEATURE_CATEGORY_ITEM_TABLE_NAME",
    "FeatureCategoryItem",
)
ddb = boto3.resource("dynamodb")
feature_category_item_table = ddb.Table(FEATURE_CATEGORY_ITEM_TABLE_NAME)


def _is_active(item):
    value = item.get("is_active", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def _to_int(value, default=0):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _bounded_order(value, minimum, maximum):
    return max(minimum, min(maximum, _to_int(value, minimum)))


def get_by_key(category_id, sort_key, include_inactive=False):
    item = feature_category_item_table.get_item(
        Key={"category_id": category_id, "sort_key": sort_key},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return None
    if include_inactive:
        return item
    if not _is_active(item):
        return None
    return item


def list_by_category_id(category_id, include_inactive=False):
    items = []
    query_args = {
        "KeyConditionExpression": Key("category_id").eq(category_id),
        "ConsistentRead": True,
    }

    while True:
        result = feature_category_item_table.query(**query_args)
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


def _update_display_order(category_id, sort_key, display_order):
    feature_category_item_table.update_item(
        Key={"category_id": category_id, "sort_key": sort_key},
        UpdateExpression="SET #display_order = :display_order",
        ExpressionAttributeNames={"#display_order": "display_order"},
        ExpressionAttributeValues={":display_order": int(display_order)},
        ConditionExpression="attribute_exists(category_id) AND attribute_exists(sort_key)",
    )


def _ordered_active_sort_keys(category_id):
    active_items = list_by_category_id(category_id, include_inactive=False)
    sortable = []
    for item in active_items:
        item_sort_key = str(item.get("sort_key", "")).strip()
        if not item_sort_key:
            continue
        sortable.append((item_sort_key, _to_int(item.get("display_order"), 0)))
    sortable.sort(key=lambda pair: (pair[1], pair[0]))
    return [sort_key for sort_key, _ in sortable]


def _apply_item_sequence(category_id, sort_keys):
    for index, item_sort_key in enumerate(sort_keys, start=1):
        _update_display_order(category_id, item_sort_key, index)


def update_existing(category_id, sort_key, attributes):
    if not attributes:
        raise ValueError("No editable fields were provided.")

    existing = get_by_key(category_id, sort_key, include_inactive=True)

    update_parts = []
    names = {}
    values = {}

    for field, value in attributes.items():
        if field == "display_order":
            value = _to_int(value, 0)
        name_key = f"#f_{field}"
        value_key = f":v_{field}"
        names[name_key] = field
        values[value_key] = value
        update_parts.append(f"{name_key} = {value_key}")

    requested_order = values.get(":v_display_order")
    if (
        existing
        and _is_active(existing)
        and requested_order is not None
    ):
        ordered_sort_keys = _ordered_active_sort_keys(category_id)
        if sort_key in ordered_sort_keys:
            remaining_sort_keys = [item_sort_key for item_sort_key in ordered_sort_keys if item_sort_key != sort_key]
            target_order = _bounded_order(requested_order, 1, len(remaining_sort_keys) + 1)
            remaining_sort_keys.insert(target_order - 1, sort_key)
            _apply_item_sequence(category_id, remaining_sort_keys)
            values[":v_display_order"] = target_order

    expression = "SET " + ", ".join(update_parts)
    try:
        result = feature_category_item_table.update_item(
            Key={"category_id": category_id, "sort_key": sort_key},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(category_id) AND attribute_exists(sort_key)",
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes")
    except ClientError:
        raise


def create_new(category_id, sort_key, attributes):
    if not category_id:
        raise ValueError("category_id is required.")
    if not sort_key:
        raise ValueError("sort_key is required.")

    item = {
        "category_id": category_id,
        "sort_key": sort_key,
    }
    item.update(attributes or {})
    active_items = list_by_category_id(category_id, include_inactive=False)
    item["display_order"] = len(active_items) + 1
    item["is_active"] = True
    feature_category_item_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(category_id) AND attribute_not_exists(sort_key)",
    )
    ordered_sort_keys = _ordered_active_sort_keys(category_id)
    _apply_item_sequence(category_id, ordered_sort_keys)
    return item


def soft_delete_by_key(category_id, sort_key, deleted_by=""):
    ordered_sort_keys = _ordered_active_sort_keys(category_id)

    deleted_at = datetime.now(timezone.utc).isoformat()
    deleted_by_value = str(deleted_by or "").strip()
    result = feature_category_item_table.update_item(
        Key={"category_id": category_id, "sort_key": sort_key},
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
            "attribute_exists(category_id) AND attribute_exists(sort_key) "
            "AND (attribute_not_exists(is_active) OR is_active = :active)"
        ),
        ReturnValues="ALL_NEW",
    )
    if sort_key in ordered_sort_keys:
        remaining_sort_keys = [item_sort_key for item_sort_key in ordered_sort_keys if item_sort_key != sort_key]
        _apply_item_sequence(category_id, remaining_sort_keys)
    return result.get("Attributes")
