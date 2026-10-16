# API Documentation

Interactive docs: **http://localhost:4000/api-docs** (Swagger UI). Machine-readable OpenAPI 3.0 spec: [`openapi.json`](openapi.json) (regenerate with `npm run openapi:export` in `backend/`). Both are generated from the same Zod schemas that validate requests.

## Conventions

* Base path `/api`. JSON in and out. All endpoints except login and health require `Authorization: Bearer <token>`.
* IDs are UUIDs. Timestamps are ISO-8601 UTC.
* Lists are paginated: `?page=1&pageSize=20` → `{ data: [...], meta: { page, pageSize, total, totalPages } }`.
* Every response has an `x-request-id` header; send your own to correlate.
* Errors use one envelope:

```json
{ "error": { "code": "CONFLICT", "message": "A customer with email 'a@b.in' already exists", "details": null, "requestId": "…" } }
```

| Status | `code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR`, `MALFORMED_JSON`, `UPLOAD_ERROR` | Zod validation failed (`details` lists `{path, message}`), bad JSON, bad upload |
| 401 | `UNAUTHORIZED` | missing/invalid/expired token, wrong credentials |
| 403 | `FORBIDDEN` | role not allowed |
| 404 | `NOT_FOUND` | resource missing (soft-deleted customers count as missing) |
| 409 | `CONFLICT` | duplicate email / tracking number, concurrent status change |
| 413 | `PAYLOAD_TOO_LARGE` | body or file too large |
| 422 | `UNPROCESSABLE`, `INVALID_CSV` | business rule violated (invalid transition, inactive customer), unusable CSV |
| 429 | `TOO_MANY_REQUESTS` | rate limit |
| 502/503/504 | `UPSTREAM_ERROR` | analytics or AI provider unavailable / timed out |

## Roles

| Endpoint group | VIEWER | OPERATOR | ADMIN |
|---|:-:|:-:|:-:|
| Read customers, shipments, dashboard, announcements | ✅ | ✅ | ✅ |
| Create/update customers, create shipments, update status | ❌ | ✅ | ✅ |
| Soft-delete customers | ❌ | ❌ | ✅ |
| Chat, analytics | ✅ | ✅ | ✅ |

## Endpoints

### Auth
| Method | Path | Description |
|---|---|---|
| POST | `/api/auth/login` | `{ email, password }` → `{ token, expiresIn, user }` (AUTH_MODE=local; rate-limited) |
| GET | `/api/auth/me` | current user from the token |

### Customers (Module 1)
| Method | Path | Description |
|---|---|---|
| GET | `/api/customers` | list; query `page, pageSize, search, status, sortBy (name/email/company/createdAt/updatedAt), sortOrder` |
| GET | `/api/customers/{id}` | one customer |
| POST | `/api/customers` | create `{ name, email, company, status? }` → 201 + `Location` |
| PATCH | `/api/customers/{id}` | partial update (at least one field) |
| DELETE | `/api/customers/{id}` | **soft delete** → 204 |

### Shipments (Module 1)
| Method | Path | Description |
|---|---|---|
| GET | `/api/shipments` | list; query `page, pageSize, status, customerId, search` |
| GET | `/api/shipments/{id}` | details incl. customer + `statusHistory` |
| GET | `/api/shipments/track/{trackingNumber}` | details by tracking number (case-insensitive) |
| POST | `/api/shipments` | create `{ customerId, origin, destination, trackingNumber? }` (tracking number auto-generated if omitted) |
| PATCH | `/api/shipments/{id}/status` | `{ status, note? }`; validates lifecycle; broadcasts `shipment_status_changed` |

### Dashboard
| GET | `/api/dashboard/stats` | `{ totalCustomers, totalShipments, statusDistribution: [{status, count}] }` |
|---|---|---|

### Analytics (Module 3, gateway)
| POST | `/api/analytics/analyze?includePng=true` | multipart `file` (CSV) → proxied to the Flask service |
|---|---|---|

The Flask service itself (internal only):

| Method | Path | Description |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/analyze?include_png=true` | multipart `file` → `{ summary, revenueByRegion, topSalespeople, charts, png?, warnings }` |
| POST | `/analyze/png/{revenue_by_region\|top_salespeople}` | returns `image/png` (Kaleido) |

Requires `X-Internal-Api-Key` when `INTERNAL_API_KEY` is set.

### AI assistant (Module 4)
| Method | Path | Description |
|---|---|---|
| POST | `/api/chat` | `{ message, conversationId? }` → `{ conversationId, message, meta: { provider, toolsUsed, promptTokens, outputTokens, latencyMs } }` |
| GET | `/api/chat/conversations` | caller's conversations |
| GET | `/api/chat/conversations/{id}` | messages of one conversation |
| DELETE | `/api/chat/conversations/{id}` | delete a conversation |

### Announcements (Bonus 3)
| GET | `/api/announcements` (also `/announcements`) | query `category, limit` → `{ source: "mock"\|"sharepoint", data: [...] }` |
|---|---|---|

### Health
| GET | `/health/live` | process up |
|---|---|---|
| GET | `/health/ready` | DB reachable (used by App Service health check) |

## Examples

```bash
API=http://localhost:4000
TOKEN=$(curl -s -X POST $API/api/auth/login -H 'content-type: application/json' \
  -d '{"email":"operator@shipops.local","password":"Operator@123"}' | jq -r .token)

# Create a customer
curl -s -X POST $API/api/customers -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"name":"Priya Sharma","email":"priya@acme.in","company":"Acme Logistics"}'

# Create a shipment
curl -s -X POST $API/api/shipments -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"customerId":"<uuid>","origin":"Mumbai, MH","destination":"Pune, MH"}'

# Move it along (invalid jumps return 422 with allowedNextStatuses)
curl -s -X PATCH $API/api/shipments/<id>/status -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"status":"PickedUp","note":"Collected from warehouse"}'

# Analyse sales CSV
curl -s -X POST "$API/api/analytics/analyze?includePng=false" -H "authorization: Bearer $TOKEN" \
  -F file=@sample-data/sales.csv | jq .summary

# Ask the assistant
curl -s -X POST $API/api/chat -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"message":"Where is SHP-DEMO001004?"}' | jq .message.content
```

## WebSocket protocol (Module 5)

* URL: `ws(s)://<api-host>/ws`
* Auth: subprotocols `["shipops.v1", "bearer.<jwt>"]` (browser) or `?token=<jwt>` (CLI). Unauthenticated upgrades get HTTP 401; disallowed origins 403.
* Server → client:

```json
{ "event": "connected", "clientId": "…", "timestamp": "…" }
{ "event": "shipment_status_changed", "shipmentId": "…", "trackingNumber": "SHP-…",
  "status": "Delivered", "previousStatus": "OutForDelivery", "changedBy": "operator@shipops.local", "timestamp": "…" }
{ "event": "shipment_created", "shipmentId": "…", "trackingNumber": "SHP-…", "status": "Created", "changedBy": "…", "timestamp": "…" }
{ "event": "pong", "timestamp": "…" }
```

* Client → server: `{ "type": "ping" }` (optional keep-alive). Anything else is ignored. Max message size 16 KB.
* The server pings every 30 s and drops clients that don't answer.
