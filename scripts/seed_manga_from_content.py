#!/usr/bin/env python3
"""Seed Manga and MangaContent DynamoDB tables from content.json."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import boto3


REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONTENT_JSON = REPO_ROOT / "content.json"


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def normalize_url(value: str) -> str:
    text = str(value or "").strip()
    if text.startswith("./"):
        return text[2:]
    return text


def build_manga_record(item: dict) -> dict:
    manga_id = str(item.get("manga_id") or item.get("id") or "").strip()
    if not manga_id:
        raise ValueError(f"Missing manga_id for item: {item}")

    genres = item.get("genres") if isinstance(item.get("genres"), list) else []
    title = str(item.get("title") or "").strip()
    return {
        "manga_id": manga_id,
        "title": title,
        "publisher": "BluPetal",
        "series": title,
        "age_rating": str(item.get("ageRating") or "").strip(),
        "synopsis": str(item.get("description") or "").strip(),
        "keywords": [str(g).strip() for g in genres if str(g).strip()],
        "copyright": "",
        "bisac": "",
        "sales_restriction": "",
        "japanese_title": "",
        "cover_url": normalize_url(item.get("cover") or ""),
        "created_at": now_iso(),
        "updated_at": now_iso(),
    }


def build_content_records(item: dict) -> list[dict]:
    manga_id = str(item.get("manga_id") or item.get("id") or "").strip()
    if not manga_id:
        return []

    volumes = item.get("volumes") if isinstance(item.get("volumes"), list) else []
    if not volumes:
        default_pdf = normalize_url(item.get("pdf") or "")
        default_cover = normalize_url(item.get("cover") or "")
        volumes = [
            {
                "id": "v1",
                "title": "Volume 1",
                "pdf": default_pdf,
                "cover": default_cover,
                "synopsis": str(item.get("description") or "").strip(),
            }
        ]

    records = []
    for idx, volume in enumerate(volumes, start=1):
        records.append(
            {
                "manga_id": manga_id,
                "content_key": f"VOLUME#{idx:04d}",
                "content_type": "volume",
                "sequence_number": idx,
                "title": str(volume.get("title") or f"Volume {idx}").strip(),
                "external_content_id": str(volume.get("id") or f"v{idx}").strip(),
                "synopsis": str(volume.get("synopsis") or "").strip(),
                "author": str(item.get("author") or "").strip(),
                "price": "",
                "file_format": "pdf",
                "cover_url": normalize_url(volume.get("cover") or item.get("cover") or ""),
                "file_url": normalize_url(volume.get("pdf") or item.get("pdf") or ""),
                "created_at": now_iso(),
                "updated_at": now_iso(),
            }
        )
    return records


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Seed Manga and MangaContent from content.json")
    parser.add_argument("--content-json", default=str(DEFAULT_CONTENT_JSON))
    parser.add_argument("--manga-table", default=os.environ.get("MANGA_TABLE_NAME", "Manga"))
    parser.add_argument(
        "--manga-content-table",
        default=os.environ.get("MANGA_CONTENT_TABLE_NAME", "MangaContent"),
    )
    parser.add_argument("--region", default=os.environ.get("AWS_REGION") or os.environ.get("AWS_DEFAULT_REGION"))
    parser.add_argument("--apply", action="store_true", help="Write records to DynamoDB (default is dry-run).")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    content_path = Path(args.content_json)
    raw = json.loads(content_path.read_text(encoding="utf-8"))
    manga_items = raw.get("manga") if isinstance(raw.get("manga"), list) else []

    manga_records = [build_manga_record(item) for item in manga_items]
    content_records = [record for item in manga_items for record in build_content_records(item)]

    print(f"Manga records: {len(manga_records)}")
    print(f"MangaContent records: {len(content_records)}")

    if not args.apply:
        print("Dry-run only. Use --apply to write to DynamoDB.")
        return 0

    session = boto3.session.Session(region_name=args.region) if args.region else boto3.session.Session()
    ddb = session.resource("dynamodb")
    manga_table = ddb.Table(args.manga_table)
    manga_content_table = ddb.Table(args.manga_content_table)

    for record in manga_records:
        manga_table.put_item(Item=record)
    for record in content_records:
        manga_content_table.put_item(Item=record)

    print(f"Wrote {len(manga_records)} Manga records to {args.manga_table}")
    print(f"Wrote {len(content_records)} MangaContent records to {args.manga_content_table}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
