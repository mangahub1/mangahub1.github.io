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
- `appAuthzConfig.getContentEndpoint`
- `appAuthzConfig.updateContentEndpoint`
- `appAuthzConfig.getContentUploadUrlEndpoint`

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

## Content APIs

### DynamoDB

Table: `Content`
- Partition key: `content_id` (String GUID)

Required env vars:
- `USERS_TABLE_NAME=Users`
- `CONTENT_TABLE_NAME=Content`
- `CONTENT_BUCKET=blupetal-prototype`
- `CONTENT_PDF_PREFIX=content/pdfs`
- `CONTENT_THUMBNAIL_PREFIX=content/thumbnails`
- `CORS_ALLOW_ORIGIN=*` (or explicit origin)

IAM for `get_content_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `dynamodb:Scan` on `Content`

IAM for `update_content_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `dynamodb:GetItem` on `Content`
- `dynamodb:PutItem` on `Content`
- `s3:PutObject` on `arn:aws:s3:::blupetal-prototype/content/*`

IAM for `get_content_upload_url_lambda.py`:
- `dynamodb:GetItem` on `Users`
- `s3:PutObject` on `arn:aws:s3:::blupetal-prototype/content/*`

### GET `/get-content`
- Lambda file: `get_content_lambda.py`
- Access: admin-only
- Query params:
  - optional `content_type` (for example `manga`)
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
  - plus system fields: `content_id`, `content_type`, `pdf_url`, `thumbnail_url`, `created_at`, `updated_at`
- Response:
  - `ok`
  - `items`: list of content records
  - `count`

### PUT `/update-content`
- Lambda file: `update_content_lambda.py`
- Access: admin-only
- Handles only one record per request.
- Create mode:
  - omit `content_id`
  - Lambda auto-generates GUID `content_id`
- Update mode:
  - provide `content_id`
  - record is replaced/updated using that partition key
- Body shape (example):
```json
{
  "content_id": "optional-guid-for-update",
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
  "thumbnail_file": {
    "name": "cover.png",
    "content_type": "image/png",
    "base64": "<base64-data>"
  }
}
```
- File behavior:
  - PDF uploads to `s3://blupetal-prototype/content/pdfs/...`
  - Thumbnail uploads to `s3://blupetal-prototype/content/thumbnails/...`
  - If thumbnail is not provided but PDF is uploaded, Lambda attempts first-page thumbnail generation (requires PyMuPDF in Lambda package/layer)
- Strict validation rules:
  - `content_type`: lowercase snake_case, 1-40 chars
  - `title`: required, max 240 chars
  - `release_date`: if provided, must be `YYYY-MM-DD`
  - `page_length`, `contents_volume`, `volume`: if provided, must be positive integers
  - `price`: if provided, must be non-negative numeric with up to 2 decimals
  - `file_format`: if provided, one of `pdf`, `epub`, `cbz`, `cbr`, `web`
  - `concluded`: if provided, must be `0` or `1` (also accepts true/false style input)
  - `pdf_url`: optional at record creation time (allows staged upload workflow), accepts `s3://` or `http(s)://`
  - Upload size limits: PDF <= `MAX_PDF_UPLOAD_BYTES` (default 50MB), thumbnail <= `MAX_THUMBNAIL_UPLOAD_BYTES` (default 10MB)
- Response:
  - `ok`
  - `item`
  - `generated_thumbnail`
  - `thumbnail_required`
  - On validation failure: `field_errors` object keyed by field name

### POST `/get-content-upload-url`
- Lambda file: `get_content_upload_url_lambda.py`
- Access: admin-only
- Purpose: return presigned S3 URL so frontend uploads large files directly to S3 (recommended)
- Body:
```json
{
  "content_id": "optional-guid",
  "file_kind": "pdf",
  "file_name": "book.pdf",
  "content_type": "application/pdf"
}
```
- Response:
  - `ok`
  - `content_id`
  - `upload_url`
  - `s3_url`
  - `file_url` (public HTTPS URL to the same object)
  - `key`

## Best Practice Upload Flow

1. Frontend calls `PUT /update-content` first to create the metadata record.
2. Frontend calls `POST /get-content-upload-url` for PDF using that `content_id`.
3. Frontend uploads PDF directly to `upload_url` with `PUT`.
4. Frontend calls `PUT /update-content` with `content_id` + `pdf_url`.
5. Frontend optionally repeats upload + update for thumbnail.

## S3 CORS (required for browser direct upload)

Bucket `blupetal-prototype` needs CORS allowing your app origin(s), `PUT`, and headers including `Content-Type`.
