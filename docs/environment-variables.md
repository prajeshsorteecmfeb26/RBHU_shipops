# Environment Variable Guide

Each service ships a `.env.example`. Copy it to `.env` for local development. `.env` files are git-ignored. In Azure, values are **App Service application settings**; anything secret is a **Key Vault reference** (`@Microsoft.KeyVault(SecretUri=https://kv-shipops.vault.azure.net/secrets/<name>/)`) resolved with the app's managed identity, so secrets never sit in the portal, pipeline or repository.

The API validates its whole configuration with Zod at startup and refuses to boot with a clear list of problems (e.g. `JWT_SECRET is required when AUTH_MODE=local`).

## API (`backend/.env`)

| Variable | Required | Default | Secret | Description |
|---|:-:|---|:-:|---|
| `NODE_ENV` | | `development` | | `development` \| `test` \| `production` |
| `PORT` | | `4000` | | HTTP port (App Service sets `PORT`/`WEBSITES_PORT`) |
| `LOG_LEVEL` | | `info` | | pino level |
| `DATABASE_URL` | ✅ | | ✅ | `postgresql://user:pass@host:5432/db?schema=public` (add `&sslmode=require` on Azure) |
| `CORS_ORIGINS` | | `http://localhost:5173` | | comma-separated browser origins; also used for the WebSocket Origin check |
| `AUTH_MODE` | | `local` | | `local` (mock login + HS256 JWT) \| `entra` (Microsoft Entra ID tokens) |
| `JWT_SECRET` | if `local` | | ✅ | ≥32 chars random |
| `JWT_EXPIRES_IN` | | `8h` | | token lifetime |
| `JWT_ISSUER` / `JWT_AUDIENCE` | | `shipops-api` / `shipops-web` | | claims checked on every request |
| `ENTRA_TENANT_ID` | if `entra` | | | directory (tenant) id |
| `ENTRA_API_AUDIENCE` | if `entra` | | | API app id URI, e.g. `api://shipops-api` |
| `AI_PROVIDER` | | `mock` | | `mock` \| `openai` \| `azure` |
| `OPENAI_API_KEY` | if `openai` | | ✅ | |
| `OPENAI_MODEL` | | `gpt-4o-mini` | | |
| `AZURE_OPENAI_ENDPOINT` | if `azure` | | | `https://<resource>.openai.azure.com` |
| `AZURE_OPENAI_API_KEY` | | | ✅ | omit in Azure and use managed identity (Cognitive Services OpenAI User role) |
| `AZURE_OPENAI_DEPLOYMENT` | if `azure` | | | deployment name |
| `AZURE_OPENAI_API_VERSION` | | `2024-10-21` | | |
| `AI_TIMEOUT_MS` | | `30000` | | per-call timeout |
| `AI_MAX_HISTORY_MESSAGES` | | `20` | | sliding context window |
| `ANALYTICS_SERVICE_URL` | | `http://localhost:5001` | | private URL of the Flask service |
| `ANALYTICS_API_KEY` | | | ✅ | must equal the analytics `INTERNAL_API_KEY` |
| `ANNOUNCEMENTS_SOURCE` | | `mock` | | `mock` \| `sharepoint` |
| `SHAREPOINT_SITE_ID` / `SHAREPOINT_LIST_ID` | if `sharepoint` | | | Graph ids of the site and list |
| `GRAPH_CLIENT_ID` / `GRAPH_CLIENT_SECRET` | if `sharepoint` | | secret ✅ | app registration for Graph (or managed identity) |
| `WS_HEARTBEAT_MS` | | `30000` | | WebSocket ping interval |
| `RATE_LIMIT_PER_MINUTE` | | `300` | | per IP for `/api` |
| `SWAGGER_ENABLED` | | `true` | | set `false` to hide docs in production if desired |

## Analytics (`analytics/.env`)

| Variable | Default | Secret | Description |
|---|---|:-:|---|
| `INTERNAL_API_KEY` | *(empty = no auth, dev only)* | ✅ | shared key expected in `X-Internal-Api-Key` |
| `MAX_UPLOAD_MB` | `5` | | upload limit (413 above) |
| `MAX_ROWS` | `200000` | | row limit (422 above) |
| `TOP_N_SALESPEOPLE` | `10` | | size of the top-salespeople chart |
| `ENABLE_PNG_EXPORT` | `true` | | Kaleido PNG rendering |
| `CORS_ORIGINS` | *(empty)* | | only if browsers call the service directly |
| `LOG_LEVEL` | `INFO` | | |
| `PORT`, `WEB_CONCURRENCY`, `GUNICORN_THREADS` | `5001`, `2`, `2` | | gunicorn settings |

## Web (`frontend/.env`)

Build-time variables (Vite inlines them; never put secrets here).

| Variable | Default | Description |
|---|---|---|
| `VITE_API_URL` | *(empty → same origin, dev proxy)* | API base URL, e.g. `https://app-shipops-api.azurewebsites.net` |
| `VITE_WS_URL` | *(derived)* | override the WebSocket URL |

## Generating secrets

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"   # JWT_SECRET
python -c "import secrets; print(secrets.token_urlsafe(32))"                        # ANALYTICS_API_KEY
```

Store them in Key Vault: `az keyvault secret set --vault-name kv-shipops --name jwt-secret --value <value>`.
