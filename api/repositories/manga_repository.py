import os
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

MANGA_TABLE_NAME = os.environ.get("MANGA_TABLE_NAME", "Manga")
ddb = boto3.resource("dynamodb")
manga_table = ddb.Table(MANGA_TABLE_NAME)


def _is_active(item):
    value = item.get("is_active", True)
    if isinstance(value, str):
        return value.strip().lower() not in {"0", "false", "no", "inactive"}
    return bool(value)


def get_by_id(manga_id, include_inactive=False):
    item = manga_table.get_item(Key={"manga_id": manga_id}).get("Item")
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
        result = manga_table.scan(**scan_args)
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


def _normalize_id_list(value):
    if isinstance(value, list):
        return {str(entry).strip() for entry in value if str(entry).strip()}
    if value in (None, ""):
        return set()
    clean = str(value).strip()
    return {clean} if clean else set()


def _matches_query(item, query):
    clean_query = str(query or "").strip().lower()
    if not clean_query:
        return True
    title = str(item.get("title", "")).strip().lower()
    japanese_title = str(item.get("japanese_title", "")).strip().lower()
    series = str(item.get("series", "")).strip().lower()
    return (
        clean_query in title
        or clean_query in japanese_title
        or clean_query in series
    )


def list_filtered(
    include_inactive=False,
    query="",
    genre_ids=None,
    category_ids=None,
    allowed_manga_ids=None,
):
    wanted_genres = {str(value).strip() for value in (genre_ids or []) if str(value).strip()}
    wanted_categories = {str(value).strip() for value in (category_ids or []) if str(value).strip()}
    allowed_ids = (
        {str(value).strip() for value in (allowed_manga_ids or []) if str(value).strip()}
        if allowed_manga_ids is not None
        else None
    )

    filtered = []
    for item in list_all(include_inactive=include_inactive):
        manga_id = str(item.get("manga_id", "")).strip()
        if allowed_ids is not None and manga_id not in allowed_ids:
            continue

        if not _matches_query(item, query):
            continue

        item_genres = _normalize_id_list(item.get("genre_ids"))
        if wanted_genres and not item_genres.intersection(wanted_genres):
            continue

        item_categories = _normalize_id_list(item.get("category_ids"))
        if wanted_categories and not item_categories.intersection(wanted_categories):
            continue

        filtered.append(item)

    return filtered


def update_existing(manga_id, attributes):
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
        result = manga_table.update_item(
            Key={"manga_id": manga_id},
            UpdateExpression=expression,
            ExpressionAttributeNames=names,
            ExpressionAttributeValues=values,
            ConditionExpression="attribute_exists(manga_id)",
            ReturnValues="ALL_NEW",
        )
        return result.get("Attributes")
    except ClientError:
        raise


def create_new(manga_id, attributes):
    if not manga_id:
        raise ValueError("manga_id is required.")

    item = {"manga_id": manga_id}
    item.update(attributes or {})
    item["is_active"] = True
    manga_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(manga_id)",
    )
    return item


def soft_delete_by_id(manga_id, deleted_by=""):
    deleted_at = datetime.now(timezone.utc).isoformat()
    deleted_by_value = str(deleted_by or "").strip()
    result = manga_table.update_item(
        Key={"manga_id": manga_id},
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
        ConditionExpression="attribute_exists(manga_id) AND (attribute_not_exists(is_active) OR is_active = :active)",
        ReturnValues="ALL_NEW",
    )
    return result.get("Attributes")
