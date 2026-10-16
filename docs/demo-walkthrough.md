# Demo Walkthrough (10–15 minutes)

**Setup before the call:** `docker compose up --build` (or the four local processes), two browser windows side by side: left logged in as **Operator**, right as **Viewer**. Swagger open in a tab. `sample-data/sales.csv` and `sample-data/sales-with-errors.csv` at hand.

| Time | Section | Show | Say |
|---|---|---|---|
| 0:00–1:30 | **Context & architecture** | README architecture diagram, then `docs/diagrams/azure-architecture.png` | Three services: React SPA, Node API (the only public backend and the single security boundary), Python analytics behind it. PostgreSQL via Prisma. Why the analytics service stays in Python: it's the reporting team's stack. |
| 1:30–3:30 | **Module 1: API design** | `backend/src/modules/shipments/` (schemas → repository → service → routes), Swagger UI | Service/repository layering, composition root for DI, one Zod schema = validation + types + Swagger. Run *Create shipment* in Swagger with a bad body → structured 400. |
| 3:30–5:00 | **Domain decisions** | state machine diagram (`docs/architecture.md`), try Created → Delivered in Swagger → 422 with `allowedNextStatuses` | Status as a state machine, optimistic concurrency (409), soft delete with partial unique index, status history as audit trail. |
| 5:00–7:00 | **Modules 2 + 5: UI and real time** | Operator: create a customer (show validation), create a shipment, update its status. Viewer window: toast appears, bell increments, dashboard chart moves | React Query as the state layer; WebSocket events invalidate caches. WS auth before upgrade, origin check, heartbeat, reconnect with backoff. Mobile view (devtools 390px). Viewer has no edit buttons and the API returns 403 anyway. |
| 7:00–8:30 | **Module 3: analytics** | upload `sales.csv` (charts, stats, PNG download), then `sales-with-errors.csv` (warnings with line numbers) | Pandas validation, Plotly JSON rendered client-side, Kaleido PNG export, analytics reachable only through the API with a service key. |
| 8:30–10:30 | **Module 4: AI assistant** | ask "Where is SHP-DEMO001004?", then "and who is the customer?" (history), then "give me a summary" | Tool calling grounds answers in live data (no hallucinated statuses), read-only tools, prompt structure in `prompts.ts`, history window, error mapping. Mention mock vs Azure OpenAI switch via env. |
| 10:30–12:30 | **Module 6: Azure** | `docs/deployment-azure.md`, `infra/main.bicep`, `deploy.yml` | App Service with slots, Postgres Flexible Server with private endpoint and Entra auth, Key Vault references + managed identity, VNet integration, blue/green with backward-compatible migrations, OIDC CI/CD. |
| 12:30–14:00 | **Security & scalability recap** | security table in `docs/architecture.md` | RBAC, validation, rate limits, secrets. Scale-out: stateless API + Redis/Web PubSub backplane behind the existing `NotificationBus` interface; PgBouncer; async analytics jobs for big files. |
| 14:00–15:00 | **Bonuses & next steps** | `/announcements`, Fabric / voice docs | Fabric mirroring → medallion → Power BI; ACS + Voice Live voice agent reusing the same tools; SharePoint via Graph `Sites.Selected`. Next: MSAL in the SPA, streaming chat, E2E tests, OpenTelemetry. |

## Likely questions (and short answers)

* **Why not Socket.IO?** The requirement is WebSockets; native `ws` keeps the protocol minimal and maps to Azure Web PubSub. Socket.IO's extras (rooms, fallbacks) aren't needed yet.
* **How do you scale WebSockets?** ARR affinity per connection, Redis or Web PubSub backplane via the `NotificationBus` interface, autoscale on connections/CPU.
* **Why a state machine?** Prevents invalid data (e.g. Delivered → Created) and lets the UI show only legal actions.
* **What if the LLM is down?** Mapped errors, nothing persisted, UI keeps the message for retry; mock provider for dev/tests.
* **Why Prisma's driver adapter?** Rust-free client (WASM query compiler) → no native binaries in the image; uses the standard `pg` pool.
* **How are migrations safe with slot swaps?** Expand/contract: migrations are backward compatible with the version still running.
