import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

FEATURE_CATEGORY_TABLE_NAME = os.environ.get("FEATURE_CATEGORY_TABLE_NAME", "FeatureCategory")
ddb = boto3.resource("dynamodb")
feature_category_table = ddb.Table(FEATURE_CATEGORY_TABLE_NAME)


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


def get_by_id(category_id, include_inactive=False):
    item = feature_category_table.get_item(
        Key={"category_id": category_id},
        ConsistentRead=True,
    ).get("Item")
    if not item:
        return None
    if include_inactive:
        return item
    if not _is_active(item):
        return None
    return item


def list_all(include_inactive=False):
    items = []
    scan_args = {"ConsistentRead": True}
    while True:
        result = feature_category_table.scan(**scan_args)
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


def _update_display_order(category_id, display_order):
    feature_category_table.update_item(
        Key={"category_id": category_id},
        UpdateExpression="SET #display_order = :display_order",
        ExpressionAttributeNames={"#display_order": "display_order"},
        ExpressionAttributeValues={":display_order": int(display_order)},
        ConditionExpression="attribute_exists(category_id)",
    )


def _ordered_active_category_ids():
    active_items = list_all(include_inactive=False)
    sortable = []
    for item in active_items:
        item_id = str(item.get("category_id", "")).strip()
        if not item_id:
            continue
        sortable.append((item_id, _to_int(item.get("display_order"), 0)))
    sortable.sort(key=lambda pair: (pair[1], pair[0]))
    return [category_id for category_id, _ in sortable]


def _apply_category_sequence(category_ids):
    for index, item_id in enumerate(category_ids, start=1):
        _update_display_order(item_id, index)


def update_existing(category_id, attributes):
    if not attributes:
        raise ValueError("No editable fields were provided.")

    existing = get_by_id(category_id, include_inactive=True)

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
    if existing and _is_active(existing) and requested_order is not None:
        ordered_ids = _ordered_active_category_ids()
        if category_id in ordered_ids:
            remaining_ids = [item_id for item_id in ordered_ids if item_id != category_id]
            target_order = _bounded_order(requested_order, 1, len(remaining_ids) + 1)
            remaining_ids.insert(target_order - 1, category_id)
            _apply_category_sequence(remaining_ids)
            values[":v_display_order"] = target_order

    expression = "SET " + ", ".join(update_parts)
    try:
        result = feature_category_table.update_item(
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
    ordered_ids = _ordered_active_category_ids()
    max_insert_order = len(ordered_ids) + 1
    requested_order = _to_int(item.get("display_order"), max_insert_order)
    target_order = _bounded_order(requested_order, 1, max_insert_order)
    item["display_order"] = target_order
    item["is_active"] = True
    feature_category_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(category_id)",
    )
    ordered_ids.insert(target_order - 1, category_id)
    _apply_category_sequence(ordered_ids)

    return item


def soft_delete_by_id(category_id, deleted_by=""):
    ordered_ids = _ordered_active_category_ids()

    deleted_at = datetime.now(timezone.utc).isoformat()
    deleted_by_value = str(deleted_by or "").strip()
    result = feature_category_table.update_item(
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
        ConditionExpression=(
            "attribute_exists(category_id) AND "
            "(attribute_not_exists(is_active) OR is_active = :active)"
        ),
        ReturnValues="ALL_NEW",
    )
    if category_id in ordered_ids:
        remaining_ids = [item_id for item_id in ordered_ids if item_id != category_id]
        _apply_category_sequence(remaining_ids)
    return result.get("Attributes")
