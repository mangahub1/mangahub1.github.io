import os

import boto3
from botocore.exceptions import ClientError

MANGA_TABLE_NAME = os.environ.get("MANGA_TABLE_NAME", "Manga")
ddb = boto3.resource("dynamodb")
manga_table = ddb.Table(MANGA_TABLE_NAME)


def get_by_id(manga_id):
    item = manga_table.get_item(Key={"manga_id": manga_id}).get("Item")
    return item


def list_all():
    items = []
    scan_args = {}
    while True:
        result = manga_table.scan(**scan_args)
        items.extend(result.get("Items", []))
        last_evaluated_key = result.get("LastEvaluatedKey")
        if not last_evaluated_key:
            break
        scan_args["ExclusiveStartKey"] = last_evaluated_key
    return items


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
    manga_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(manga_id)",
    )
    return item


def delete_by_id(manga_id):
    result = manga_table.delete_item(
        Key={"manga_id": manga_id},
        ConditionExpression="attribute_exists(manga_id)",
        ReturnValues="ALL_OLD",
    )
    return result.get("Attributes")
