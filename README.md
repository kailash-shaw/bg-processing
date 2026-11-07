## Two-Command Setup & Run (Reviewer Quickstart)

Reviewers can start the entire stack with two commands:

```bash
# Command 1: Start PostgreSQL and Redis containers
docker compose up -d

# Command 2: Start the application (auto-runs prisma db push and boots NestJS)
npm run start:dev
```

The service will be live on `http://localhost:3000`.

### Database Seeding & Testing

```bash
# Seed default test tenants and investors
npm run seed

# Run automated integration test suite covering all status codes (200, 400, 401, 403, 404)
npm run test:apis

# Run Jest unit test suite
npm test
```

---

## Environment Variables

Configured in `.env` (sample provided in `.env.example`):

```dotenv
DATABASE_URL="postgresql://postgres:postgres@localhost:5432/kyc_webhook?schema=public"
REDIS_URL="redis://localhost:6379"
KYC_WEBHOOK_SECRET="local-dev-kyc-secret"
JWT_SECRET="local-dev-jwt-secret"
PORT=3000
```

---

## API Specifications

### 1. `POST /webhooks/kyc`

#### Payload

```json
{
  "event_id": "evt-uuid-abc123",
  "investor_id": "inv-uuid-456",
  "new_status": "approved",
  "timestamp": "2026-06-20T14:30:00Z"
}
```

#### Signature Header

- Header: `X-KYC-Signature`
- Value: HMAC SHA-256 hex digest of the raw request body signed with `KYC_WEBHOOK_SECRET`. Supports raw hex and optional `sha256=` prefix.

#### Ingestion Lifecycle & Idempotency Pattern

1. **DTO Validation:** Fast-path payload validation with `class-validator` → `400 Bad Request` if missing required fields or invalid enum format.
2. **HMAC Verification:** Recomputes HMAC over `req.rawBody` with `crypto.timingSafeEqual` → `401 Unauthorized` on mismatch or missing signature (logged as security warning).
3. **Idempotency Guard:** Checks Redis (`kyc:webhook:<event_id>`) and PostgreSQL (`WebhookEvent.event_id`). If already received or processed, short-circuits with `200 OK` (`{"received": true}`) without duplicate enqueueing.
4. **Immediate Acknowledgment:** Atomically acquires Redis lock (`SET NX EX 86400`), enqueues job to BullMQ queue `kyc-status-update` with `jobId = event_id`, and immediately responds `200 OK` (`{"received": true}`) without waiting for the DB write.
5. **Asynchronous Worker:** BullMQ worker executes `prisma.$transaction`:
   - Updates `investor.kyc_status` in PostgreSQL.
   - Creates `WebhookEvent` audit log.
   - Clears the Redis processing key upon successful processing as specified.

#### Response Requirements

| Code                   | Condition                      | Behavior                                                                    |
| :--------------------- | :----------------------------- | :-------------------------------------------------------------------------- |
| `200 OK`             | Webhook already processed      | Return `200 OK` immediately (`{"received": true}`) without reprocessing |
| `200 OK`             | Webhook processed successfully | Return `200 OK` immediately (`{"received": true}`) after enqueueing     |
| `400 Bad Request`    | Invalid payload                | Missing required fields or invalid format                                   |
| `401 Unauthorized`   | Invalid signature              | HMAC signature does not match or missing signature (logged)                 |
| `500 Internal Error` | Unexpected failure             | Return `500`, do not acknowledge                                          |

---

### 2. `GET /investors/:id/kyc-status`

Returns the investor's current verification status and the timestamp of their most recent webhook event.

#### Authentication & Tenant Isolation

- Header: `Authorization: Bearer <JWT_TOKEN>`
- Token Claims Required: `tenant_id` and `investor_id` (signed with `JWT_SECRET`).
- **Tenant Isolation Enforcement:** The authenticated `tenant_id` claim is matched against the database `investor.tenant_id`. If they do not match, the request is rejected with `403 Forbidden` (`"Investor does not belong to the authenticated tenant"`).

#### Response (`200 OK`)

```json
{
  "id": "inv-uuid-456",
  "investor_id": "inv-uuid-456",
  "email": "investor.meridian@example.com",
  "kyc_status": "approved",
  "last_webhook_event_at": "2026-06-20T14:30:00.000Z"
}
```

#### Status Codes

| Code                   | Condition               | Behavior                                                             |
| :--------------------- | :---------------------- | :------------------------------------------------------------------- |
| `200 OK`             | Authorized              | Returns investor ID, email, kyc_status, and last event timestamp     |
| `401 Unauthorized`   | Missing / invalid token | Missing Bearer token, signature mismatch, or missing required claims |
| `403 Forbidden`      | Tenant mismatch         | Authenticated `tenant_id` does not match the investor's tenant     |
| `404 Not Found`      | Investor missing        | Investor ID does not exist in the database                           |
| `500 Internal Error` | Unexpected error        | Return 500 error                                                     |

---

## Testing Tools & Helper Scripts

We provide interactive CLI helpers for testing with `curl` or Postman:

### 1. Generate HMAC Signature

```bash
npx ts-node scripts/generate-signature.ts '{"event_id":"evt-1","investor_id":"inv-uuid-456","new_status":"approved","timestamp":"2026-06-20T14:30:00Z"}'
```

### 2. Generate JWT Token

```bash
# Syntax: npx ts-node scripts/generate-token.ts <investor_id> <tenant_id>
npx ts-node scripts/generate-token.ts inv-uuid-456 tenant-meridian-1
```

### 3. Run Automated End-to-End Suite

```bash
npm run test:apis
```

Runs a complete suite of 14 assertions testing valid flows, duplicate replay attacks, missing signatures, tampered bodies, invalid enums, tenant mismatch (403), non-existent investors (404), and unauthenticated access (401).

---

## Postman Collection & Environment

You can easily import and run the preconfigured Postman collection and environment files located in the [`docs/`](docs/) directory:

- **Collection:** [`docs/postman_collection.json`](docs/postman_collection.json) — Contains 8 preconfigured requests covering all status codes (`200`, `400`, `401`, `403`, `404`), automatic HMAC SHA-256 signature generation, and idempotency tests.
- **Environment:** [`docs/KYC.postman_environment.json`](docs/KYC.postman_environment.json) — Configured with `baseUrl` (`http://localhost:3000`) and `KYC_WEBHOOK_SECRET` (`local-dev-kyc-secret`).

### Quick Import in Postman:

1. In Postman, click **Import** (top left).
2. Select both `docs/postman_collection.json` and `docs/KYC.postman_environment.json`.
3. In the top right environment dropdown, select **KYC**.
4. Execute individual requests or run the entire suite using **Run Collection**.
