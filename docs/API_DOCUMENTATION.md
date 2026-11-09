# KYC Webhook Integration Service — API & Usage Guide

Comprehensive reference for running, migrating, testing, and integrating with the KYC Webhook Integration Service.

---

## 1. Quick Start

### Prerequisites
- Node.js >= 20.x
- Docker & Docker Compose (or local PostgreSQL 16+ and Redis 7+)

### Run with Two Commands (Reviewer Quickstart)
```bash
# 1. Start PostgreSQL & Redis in background
docker compose up -d

# 2. Start service (automatically runs prisma db push and boots NestJS)
npm run start:dev
```

Alternatively, to run the database migrations and seed sample records:
```bash
npm run seed          # Seeds tenants and investors for testing
npm run test:apis     # Executes full end-to-end suite verifying all status codes
npm test              # Executes Jest unit test suite
```

---

## 2. Environment Variables

Create `.env` based on `.env.example`:

| Variable | Description | Default (Local Dev) |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/kyc_webhook?schema=public` |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `KYC_WEBHOOK_SECRET` | Secret used to sign/verify HMAC SHA-256 webhooks | `local-dev-kyc-secret` |
| `JWT_SECRET` | Secret used to sign and verify Bearer JWT tokens | `local-dev-jwt-secret` |
| `PORT` | HTTP server listening port | `3000` |

---

## 3. Database Schema & Migration

### Migration Commands
- **Apply migrations in production / CI:**
  ```bash
  npx prisma migrate deploy
  ```
- **Push schema directly in development:**
  ```bash
  npm run prestart:dev # executes `prisma db push`
  ```
- **Seed initial data:**
  ```bash
  npm run seed
  ```

---

## 4. API Endpoints Reference

### Endpoint 1: `POST /webhooks/kyc`

Receives signed status change events from the KYC identity verification provider.

#### Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Content-Type` | `string` | Yes | `application/json` |
| `X-KYC-Signature` | `string` | Yes | HMAC SHA-256 hex digest of the raw request body signed with `KYC_WEBHOOK_SECRET` |

#### Request Payload
```json
{
  "event_id": "evt-uuid-abc123",
  "investor_id": "inv-uuid-456",
  "new_status": "approved",
  "timestamp": "2026-06-20T14:30:00Z"
}
```

#### Supported Statuses
- `approved`
- `rejected`
- `pending`

#### Execution Lifecycle
1. **Payload Validation:** Typed `class-validator` DTO checks presence and format. Missing or invalid fields return `400 Bad Request`.
2. **HMAC Signature Check:** Recomputes HMAC SHA-256 over raw request buffer using timing-safe comparison (`crypto.timingSafeEqual`). Invalid or missing signatures return `401 Unauthorized` and log the attempt.
3. **Idempotency Check:** Checks Redis key `kyc:webhook:<event_id>` and PostgreSQL `WebhookEvent` table. If already received or processed, returns `200 OK` (`{"received": true}`) immediately without re-enqueuing.
4. **Immediate Acknowledgment:** Acquires Redis lock (`SET ... EX 86400 NX`), enqueues job onto BullMQ queue `kyc-status-update` with `jobId = event_id`, and returns `200 OK` (`{"received": true}`) without waiting for the DB write.
5. **Asynchronous Worker:** BullMQ worker picks up job:
   - Updates `investor.kyc_status` in PostgreSQL.
   - Writes `WebhookEvent` record for audit trail.
   - Executed atomically inside a database transaction (`prisma.$transaction`).
   - Clears the Redis idempotency key after successful processing as per specification.

#### Response Codes
| Status Code | Condition | Response Body |
| :--- | :--- | :--- |
| `200 OK` | Webhook enqueued or already processed | `{"received": true}` |
| `400 Bad Request` | Missing required fields or invalid format | `{"statusCode": 400, "message": [...]}` |
| `401 Unauthorized` | Missing or invalid HMAC SHA-256 signature | `{"statusCode": 401, "message": "Invalid KYC webhook signature"}` |
| `500 Internal Error` | Unexpected server failure | `{"statusCode": 500, "message": "Internal server error"}` |

---

### Endpoint 2: `GET /investors/:id/kyc-status`

Retrieves the current KYC status and last webhook event timestamp of an investor.

#### Headers
| Header | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `Authorization` | `string` | Yes | `Bearer <JWT_TOKEN>` |

#### JWT Requirements
The JWT must be signed with `JWT_SECRET` and contain:
- `tenant_id`: The ID of the authenticated tenant.
- `investor_id`: The ID of the authenticated investor.
- `sub`: Subject identifier.

#### Tenant Isolation
The handler extracts `tenant_id` from the verified token and compares it against the requested investor's `tenant_id`.
- If the tenant does not match: returns `403 Forbidden` (`"Investor does not belong to the authenticated tenant"`).
- If the investor is not found: returns `404 Not Found`.

#### Response Body (`200 OK`)
```json
{
  "id": "inv-uuid-456",
  "investor_id": "inv-uuid-456",
  "email": "investor.meridian@example.com",
  "kyc_status": "approved",
  "last_webhook_event_at": "2026-11-06T18:10:59.000Z"
}
```
*Note: `last_webhook_event_at` is `null` if no webhook events have occurred for this investor.*

#### Response Codes
| Status Code | Condition | Response Body |
| :--- | :--- | :--- |
| `200 OK` | Success | Investor KYC status object |
| `401 Unauthorized` | Missing, invalid, or expired Bearer token, or missing required claims | `{"statusCode": 401, "message": "Unauthorized"}` |
| `403 Forbidden` | Investor does not belong to authenticated tenant | `{"statusCode": 403, "message": "Investor does not belong to the authenticated tenant"}` |
| `404 Not Found` | Investor ID not found | `{"statusCode": 404, "message": "Investor with id ... was not found"}` |
| `500 Internal Error` | Unexpected failure | `{"statusCode": 500, "message": "Internal server error"}` |

---

## 5. Testing Guide & Examples

### Generating Helper Signatures & Tokens

We provide two CLI utilities:

#### 1. Generate HMAC Signature
```bash
# Run with sample payload
npx ts-node scripts/generate-signature.ts

# Or pass custom JSON
npx ts-node scripts/generate-signature.ts '{"event_id":"evt-101","investor_id":"inv-uuid-456","new_status":"approved","timestamp":"2026-06-20T14:30:00Z"}'
```

#### 2. Generate JWT Bearer Token
```bash
# Syntax: npx ts-node scripts/generate-token.ts <investor_id> <tenant_id>
npx ts-node scripts/generate-token.ts inv-uuid-456 tenant-meridian-1
```

---

### Step-by-Step cURL Walkthrough

#### Step A: Send KYC Webhook (`POST /webhooks/kyc`)

```bash
# Payload
PAYLOAD='{"event_id":"evt-uuid-demo-1","investor_id":"inv-uuid-456","new_status":"approved","timestamp":"2026-06-20T14:30:00Z"}'

# Generate signature
SIG=$(node -e "console.log(require('crypto').createHmac('sha256', 'local-dev-kyc-secret').update('$PAYLOAD').digest('hex'))")

# POST Webhook
curl -X POST http://localhost:3000/webhooks/kyc \
  -H "Content-Type: application/json" \
  -H "X-KYC-Signature: $SIG" \
  -d "$PAYLOAD"
```

Expected Response:
```json
{"received":true}
```

#### Step B: Send Duplicate Webhook (Test Idempotency)
Re-run the exact same curl command. It returns `200 OK` (`{"received": true}`) immediately without re-enqueuing or re-executing.

#### Step C: Query Investor KYC Status (`GET /investors/:id/kyc-status`)

```bash
# Generate JWT
TOKEN=$(npx ts-node scripts/generate-token.ts inv-uuid-456 tenant-meridian-1 | tail -n 1)

# Query status
curl -X GET http://localhost:3000/investors/inv-uuid-456/kyc-status \
  -H "Authorization: Bearer $TOKEN"
```

Expected Response:
```json
{
  "id": "inv-uuid-456",
  "investor_id": "inv-uuid-456",
  "email": "investor.meridian@example.com",
  "kyc_status": "approved",
  "last_webhook_event_at": "2026-11-06T18:10:59.000Z"
}
```

#### Step D: Test Tenant Isolation (Forbidden 403)
Generate a token for a different tenant (`tenant-global-2`) and attempt to access `inv-uuid-456` (which belongs to `tenant-meridian-1`):

```bash
CROSS_TENANT_TOKEN=$(npx ts-node scripts/generate-token.ts inv-uuid-other tenant-global-2 | tail -n 1)

curl -X GET http://localhost:3000/investors/inv-uuid-456/kyc-status \
  -H "Authorization: Bearer $CROSS_TENANT_TOKEN"
```

Expected Response (`403 Forbidden`):
```json
{
  "statusCode": 403,
  "message": "Investor does not belong to the authenticated tenant",
  "error": "Forbidden"
}
```

