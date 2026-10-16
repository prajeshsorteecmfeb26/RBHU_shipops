# ShipOps API

Node.js 22 · Express · TypeScript · Prisma 6 (pg driver adapter) · PostgreSQL · Zod · ws · OpenAI SDK

```bash
cp .env.example .env
npm install                 # runs prisma generate
npx prisma migrate deploy
npm run db:seed
npm run dev                 # http://localhost:4000  · docs: /api-docs · ws: /ws
```

| Script | Purpose |
|---|---|
| `npm run dev` | watch mode (tsx) |
| `npm run build && npm start` | production build |
| `npm test` | unit tests (add `RUN_INTEGRATION=1` + a migrated `DATABASE_URL` for HTTP/WebSocket integration tests) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run prisma:migrate` | create a migration in development |
| `npm run openapi:export` | write `../docs/openapi.json` |

Structure, design decisions and API reference: see the root [README](../README.md), [architecture](../docs/architecture.md) and [API docs](../docs/api.md).
