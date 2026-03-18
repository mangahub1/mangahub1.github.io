# BluPetal Authorization API (Lambda)

Pattern A: allow Cognito login, then authorize user from DynamoDB.

## Contract

Request:
- Method: `POST /auth/validate`
- Header: `Authorization: Bearer <access_token>`
- Body (optional): `{"email":"user@example.com","name":"Jane User"}`

Response (`200` for approved/pending/disabled):
- `ok` (boolean)
- `user` object with:
  - `user_id` (Cognito `sub`)
  - `email`
  - `name`
  - `status` (`-1` pending, `0` disabled, `1` approved)
  - `admin` (`0` non-admin, `1` admin)
  - `role`
  - `provider`
  - timestamps
- `isApproved` (boolean)
- `isAdmin` (boolean)
- `message` (user-facing summary)

Errors:
- `400` if `sub` claim missing
- `500` for internal DynamoDB failures
- `401` for invalid/missing token is expected at API Gateway authorizer layer

## DynamoDB

Table: `Users`
- Partition key: `user_id` (String) = Cognito JWT `sub`
- Recommended attributes:
  - `email` (String)
  - `name` (String)
  - `status` (Number)
  - `admin` (Number `0/1`)
  - `role` (String)
  - `created_at` (String ISO)
  - `requested_at` (String ISO)
  - `approved_at` (String ISO, optional)
  - `last_login` (String ISO)
  - `provider` (String)

Behavior:
1. If user exists: update `last_login`, return current status.
2. If user does not exist: create with pending status (`DEFAULT_PENDING_STATUS`, default `-1`), then return pending response.

## AWS setup

1. Create Lambda from `validate_user_lambda.py`.
2. Set Lambda env vars:
   - `USERS_TABLE_NAME=Users`
   - `DEFAULT_PENDING_STATUS=-1`
   - `CORS_ALLOW_ORIGIN=*` (or explicit origin)
3. Give Lambda IAM permissions on `Users`:
   - `dynamodb:GetItem`
   - `dynamodb:PutItem`
   - `dynamodb:UpdateItem`
4. Create API Gateway HTTP API route:
   - `POST /auth/validate`
5. Attach JWT authorizer:
   - Issuer: `https://cognito-idp.<region>.amazonaws.com/<user_pool_id>`
   - Audience: `<app_client_id>`
6. Enable CORS in API Gateway:
   - `http://localhost:5173`
   - `https://d1wjiajokat0ou.cloudfront.net`
7. Deploy and copy endpoint URL.

## Frontend wiring

In `auth-config.js`, set:
- `appAuthzConfig.validateUserEndpoint`
- `appAuthzConfig.getUsersEndpoint`
- `appAuthzConfig.updateUserEndpoint`
- `appAuthzConfig.getMangaEndpoint`
- `appAuthzConfig.updateMangaEndpoint`
- `appAuthzConfig.getMangaUploadUrlEndpoint`

## Admin APIs

### GET `/get-users`
- Lambda file: `get_users_lambda.py`
- Access: admin-only (`admin=1` or `role=admin` on caller record)
- Response:
  - `ok`
  - `users`: list with `user_id`, `name`, `email`, `status`, `admin`, `provider`, timestamps

### PUT `/update-user`
- Lambda file: `update_user_lambda.py`
- Access: admin-only
- Body:
  - single update: `{"user_id":"<sub>","status":1,"admin":0}`
  - bulk update: `{"user_ids":["<sub1>","<sub2>"],"status":1}`
- Allowed values:
  - `status`: `-1`, `0`, `1`
  - `admin`: `0`, `1`

## Manga APIs

### DynamoDB

Table: `Manga` (or legacy `Content`)
- Partition key: `content_id` (String GUID)

Required env vars:
- `USERS_TABLE_NAME=Users`
- `MANGA_TABLE_NAME=Manga` (or legacy `CONTENT_TABLE_NAME=Content`)
- `CONTENT_BUCKET=blupetal-prototype`
- `CONTENT_BUCKET=blupetal-prototype`
- uploads are organized under `content/manga/{manga_id}-{manga_slug?}/...`
- `CORS_ALLOW_ORIGIN=*` (or explicit origin)

IAM for `get_manga_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `dynamodb:Scan` on `Manga`

IAM for `update_manga_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `dynamodb:GetItem` on `Manga`
- `dynamodb:PutItem` on `Manga`
- `s3:PutObject` on `arn:aws:s3:::blupetal-prototype/content/*`

IAM for `get_manga_upload_url_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `s3:PutObject` on `arn:aws:s3:::blupetal-prototype/content/*`

### GET `/get-manga`
- Lambda file: `get_manga_lambda.py`
- Access: admin-only
- Query params:
  - optional `manga_type` (or legacy `content_type`)
- Returned fields (snake_case, from `MangaDataExample.xlsx`):
  - `title`
  - `publisher`
  - `series`
  - `age_rating`
  - `release_date`
  - `page_length`
  - `contents_volume`
  - `volume`
  - `contents_name`
  - `contents_id`
  - `synopsis`
  - `author`
  - `price`
  - `file_format`
  - `concluded`
  - `keywords`
  - `copyright`
  - `bisac`
  - `sales_restriction`
  - `japanese_title`
  - plus system fields: `content_id` (alias `manga_id`), `content_type`, `pdf_url`, `cover_url`, `created_at`, `updated_at`
- Response:
  - `ok`
  - `items`: list of content records
  - `count`

### PUT `/update-manga`
- Lambda file: `update_manga_lambda.py`
- Access: admin-only
- Handles only one record per request.
- Create mode:
  - omit `manga_id` (or `content_id`)
  - Lambda auto-generates GUID
- Update mode:
  - provide `manga_id` (or `content_id`)
  - record is replaced/updated using that partition key
- Body shape (example):
```json
{
  "manga_id": "optional-guid-for-update",
  "content_type": "manga",
  "title": "Title",
  "publisher": "Publisher",
  "series": "Series",
  "age_rating": "18+",
  "release_date": "2026-01-15",
  "page_length": "220",
  "contents_volume": "1",
  "volume": "1",
  "contents_name": "Sample Name",
  "contents_id": "ABC-123",
  "synopsis": "Synopsis",
  "author": "Author",
  "price": "9.99",
  "file_format": "PDF",
  "concluded": 0,
  "keywords": "romance,drama",
  "copyright": "BluPetal",
  "bisac": "FIC000000",
  "sales_restriction": "none",
  "japanese_title": "サンプル",
  "pdf_file": {
    "name": "book.pdf",
    "content_type": "application/pdf",
    "base64": "<base64-data>"
  },
  "cover_file": {
    "name": "cover.png",
    "content_type": "image/png",
    "base64": "<base64-data>"
  }
}
```
- File behavior:
- Manga cover uploads to `s3://blupetal-prototype/content/manga/{manga_id[-slug]}/series/series-cover.*`
- MangaContent uploads to `s3://blupetal-prototype/content/manga/{manga_id[-slug]}/volumes/{nnnn}/...` (or `chapters/{nnnn}`)
  - If cover is not provided but PDF is uploaded, Lambda attempts first-page cover generation (requires PyMuPDF in Lambda package/layer)
- Strict validation rules:
  - `content_type`: lowercase snake_case, 1-40 chars
  - `title`: required, max 240 chars
  - `release_date`: if provided, must be `YYYY-MM-DD`
  - `page_length`, `contents_volume`, `volume`: if provided, must be positive integers
  - `price`: if provided, must be non-negative numeric with up to 2 decimals
  - `file_format`: if provided, one of `pdf`, `epub`, `cbz`, `cbr`, `web`
  - `concluded`: if provided, must be `0` or `1` (also accepts true/false style input)
  - `pdf_url`: optional at record creation time (allows staged upload workflow), accepts `s3://` or `http(s)://`
  - Upload size limits: PDF <= `MAX_PDF_UPLOAD_BYTES` (default 50MB), cover <= `MAX_COVER_UPLOAD_BYTES` (fallback `MAX_THUMBNAIL_UPLOAD_BYTES`, default 10MB)
- Response:
  - `ok`
  - `item`
  - `generated_cover`
  - `cover_required`
  - On validation failure: `field_errors` object keyed by field name

### POST `/get-manga-upload-url`
- Lambda file: `get_manga_upload_url_lambda.py`
- Access: admin-only
- Purpose: return presigned S3 URL so frontend uploads large files directly to S3 (recommended)
- Body:
```json
{
  "manga_id": "optional-guid",
  "file_kind": "pdf",
  "file_name": "book.pdf",
  "content_type": "application/pdf"
}
```
- Response:
  - `ok`
  - `manga_id` (alias `content_id`)
  - `upload_url`
  - `s3_url`
  - `file_url` (public HTTPS URL to the same object)
  - `key`

## Best Practice Upload Flow

1. Frontend calls `PUT /update-manga` first to create the metadata record.
2. Frontend calls `POST /get-manga-upload-url` for PDF using that `manga_id`.
3. Frontend uploads PDF directly to `upload_url` with `PUT`.
4. Frontend calls `PUT /update-manga` with `manga_id` + `pdf_url`.
5. Frontend optionally repeats upload + update for cover.

## S3 CORS (required for browser direct upload)

Bucket `blupetal-prototype` needs CORS allowing your app origin(s), `PUT`, and headers including `Content-Type`.

## Manga + MangaContent Scaffold (March 11, 2026)

### Recommended folder layout

```text
api/
  handlers/
    manga_handler.py
    manga_content_handler.py
    manga_upload_url_handler.py
    manga_content_upload_url_handler.py
  repositories/
    manga_repository.py
    manga_content_repository.py
  models/
    manga.py
    manga_content.py
  validators/
    manga_validator.py
    manga_content_validator.py
  utils/
    api_gateway.py
    responses.py
    content_key.py
    s3_uploads.py
  api_router_lambda.py
```

### Environment variables

- `MANGA_TABLE_NAME=Manga`
- `MANGA_CONTENT_TABLE_NAME=MangaContent`
- `CONTENT_BUCKET=blupetal-prototype`
- `UPLOAD_URL_TTL_SECONDS=900`
- `CONTENT_PUBLIC_BASE_URL=https://cdn.example.com` (optional)
- `CORS_ALLOW_ORIGIN=*` (or use `CORS_ALLOW_ORIGINS`)

### Lambda packaging pattern

Use one Lambda with one handler:

- `api_router_lambda.lambda_handler`

Deploy the full `api/` folder contents in that Lambda package so shared imports resolve.

### Recommended pattern: one router Lambda

To reduce operational overhead, use one Lambda for all API routes:

- Lambda handler: `api_router_lambda.lambda_handler`
- File: [api_router_lambda.py](c:/Users/jaycm/Projects/MangaHub/api/api_router_lambda.py)
- Router: [api_router_handler.py](c:/Users/jaycm/Projects/MangaHub/api/handlers/api_router_handler.py)

In API Gateway, point each route integration to that same Lambda.
You still keep separate routes in API Gateway, but no longer manage one Lambda per endpoint.

Supported route map in the router:

- `POST /auth/validate`
- `GET /get-users`
- `PUT /update-user`
- `GET /manga`
- `PUT /manga`
- `GET /get-manga` (legacy alias)
- `PUT /update-manga` (legacy alias)
- `POST /get-manga-upload-url`
- `POST /manga/upload-url` (alias)
- `GET /manga-content`
- `PUT /manga-content`
- `GET /get-manga-content` (legacy alias)
- `PUT /update-manga-content` (legacy alias)
- `POST /get-manga-content-upload-url`
- `POST /manga-content/upload-url` (alias)

Single-endpoint thin entrypoint files were removed; routing is now centralized in `api_router_handler.py`.

### Fast local deploy script

Use this helper script to deploy code updates to the same router Lambda without manually zipping:

- Script: [deploy-api-router.ps1](c:/Users/jaycm/Projects/MangaHub/scripts/deploy-api-router.ps1)

From repo root:

```powershell
.\scripts\deploy-api-router.ps1 -FunctionName mangahub-api-router -Region us-west-2
```

Optional flags:

- `-Profile my-aws-profile`
- `-Publish`
- `-NoWait`
- `-ApiDir c:\path\to\custom\api`

### Endpoint behavior

- `GET /manga`
  - Optional `manga_id` query/path param.
  - No `manga_id`: returns all active manga (scan isolated in repository layer).
- `PUT /manga`
  - Requires `manga_id`.
  - Updates only editable Manga attributes.
  - Returns `404` if `manga_id` does not exist.
- `POST /manga` (or `POST /create-manga`)
  - Creates a Manga row.
  - Returns `409` if `manga_id` already exists.
- `DELETE /manga` (or `DELETE /delete-manga`)
  - Soft-deletes a Manga row by `manga_id` by setting `is_active=false`.
  - Stores audit metadata: `deleted_at` and `deleted_by` (from auth token claims when available).
- `GET /manga-content`
  - Requires `manga_id`.
  - Optional `content_key` to fetch one child row.
  - Without `content_key`, uses DynamoDB `Query` by `manga_id` and returns active records only.
- `PUT /manga-content`
  - Requires `manga_id` + `content_key`.
  - Updates only editable MangaContent attributes.
  - Returns `404` if item does not exist.
- `POST /manga-content` (or `POST /create-manga-content`)
  - Creates a MangaContent row.
  - Returns `409` if key already exists.
- `DELETE /manga-content` (or `DELETE /delete-manga-content`)
  - Soft-deletes a MangaContent row by `manga_id` + `content_key` by setting `is_active=false`.
  - Stores audit metadata: `deleted_at` and `deleted_by` (from auth token claims when available).
- `POST /get-manga-upload-url`
  - Manga cover upload URL (`file_kind` must be `cover`).
- `POST /get-manga-content-upload-url`
  - MangaContent upload URL (`file_kind` is `cover` or `file`).
  - `cover`: JPG/PNG only, max size from `MAX_MANGA_CONTENT_COVER_UPLOAD_BYTES` (default 3MB).
  - `file`: PDF/EPUB only, max size from `MAX_MANGA_CONTENT_FILE_UPLOAD_BYTES` (default 1.5GB).
  - Body must include `file_size` in bytes.

### `content_key` helper

Use `utils/content_key.py`:

- `generate_content_key("volume", 1)` -> `VOLUME#0001`
- `generate_content_key("chapter", 7)` -> `CHAPTER#0007`

### Example requests

`PUT /manga`

```json
{
  "manga_id": "8f3a1d2c-1234-4567-8910-abcdef123456",
  "title": "Absolute Obedience ~If you don’t obey me~",
  "publisher": "Example Publisher",
  "series": "Absolute Obedience",
  "age_rating": "Mature",
  "synopsis": "Example synopsis",
  "keywords": ["Romance", "Yaoi", "Manga"],
  "copyright": "© Example",
  "bisac": "COMICS & GRAPHIC NOVELS / Manga / Romance",
  "sales_restriction": "18+",
  "japanese_title": "Japanese Title Here",
  "cover_url": "https://cdn.example.com/manga/abc123/series-cover.jpg"
}
```

`PUT /manga-content`

```json
{
  "manga_id": "8f3a1d2c-1234-4567-8910-abcdef123456",
  "content_key": "VOLUME#0001",
  "content_type": "volume",
  "sequence_number": 1,
  "title": "Absolute Obedience Volume 1",
  "external_content_id": "BT000076098300100101",
  "synopsis": "Volume synopsis",
  "author": "Example Author",
  "price": "9.99",
  "file_format": "ePDF",
  "cover_url": "https://cdn.example.com/manga/abc123/volumes/0001/cover.jpg",
  "file_url": "https://cdn.example.com/manga/abc123/volumes/0001/book.pdf"
}
```

`POST /get-manga-content-upload-url`

```json
{
  "manga_id": "8f3a1d2c-1234-4567-8910-abcdef123456",
  "content_key": "VOLUME#0001",
  "file_kind": "file",
  "file_name": "book.pdf",
  "content_type": "application/pdf",
  "file_size": 73400320
}
```

### Response shape

Success:

```json
{
  "success": true,
  "data": {}
}
```

Error:

```json
{
  "success": false,
  "error": "Message here"
}
```
