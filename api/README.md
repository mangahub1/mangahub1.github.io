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
