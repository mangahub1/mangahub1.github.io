import os

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError

MANGA_CONTENT_TABLE_NAME = os.environ.get("MANGA_CONTENT_TABLE_NAME", "MangaContent")
ddb = boto3.resource("dynamodb")
manga_content_table = ddb.Table(MANGA_CONTENT_TABLE_NAME)


def get_by_key(manga_id, content_key):
    item = manga_content_table.get_item(
        Key={"manga_id": manga_id, "content_key": content_key}
    ).get("Item")
    return item


def list_by_manga_id(manga_id):
    items = []
    query_args = {
        "KeyConditionExpression": Key("manga_id").eq(manga_id),
    }

    while True:
        result = manga_content_table.query(**query_args)
        items.extend(result.get("Items", []))
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
    manga_content_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(manga_id) AND attribute_not_exists(content_key)",
    )
    return item


def delete_by_key(manga_id, content_key):
    result = manga_content_table.delete_item(
        Key={"manga_id": manga_id, "content_key": content_key},
        ConditionExpression="attribute_exists(manga_id) AND attribute_exists(content_key)",
        ReturnValues="ALL_OLD",
    )
    return result.get("Attributes")
