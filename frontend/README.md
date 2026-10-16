# ShipOps Web

React 18 · TypeScript · Vite · React Query · react-hook-form + Zod · Recharts · Plotly.js

```bash
npm install
npm run dev     # http://localhost:5173 (proxies /api and /ws to http://localhost:4000)
npm test
npm run build
```

```
src/
├── api/          fetch client (ApiError), React Query hooks, types
├── auth/         AuthContext (mock login; swap for MSAL with Entra ID)
├── realtime/     WebSocket provider: reconnect, toasts, cache invalidation
├── components/   Layout, DataTable, Modal, form fields, StatusBadge, StatCard, PlotlyChart, Toaster
├── pages/        Login, Dashboard, Customers, Shipments, Analytics, Assistant
├── lib/          formatting helpers, useDebounce
└── schemas.ts    Zod form schemas (mirror the API)
```
