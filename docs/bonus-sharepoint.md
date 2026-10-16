# Bonus 3: SharePoint Integration

## What's implemented

* `GET /announcements` (also `GET /api/announcements`), authenticated, query `category` and `limit`.
* Response: `{ "source": "mock" | "sharepoint", "data": Announcement[] }`, pinned first, newest first, cached for 5 minutes, `Cache-Control: private, max-age=60`.
* Two providers behind one interface (`backend/src/modules/announcements/announcements.provider.ts`):
  * `MockAnnouncementsProvider` (default): realistic intranet announcements.
  * `SharePointAnnouncementsProvider`: reads a SharePoint Online list through **Microsoft Graph**. Enabled with `ANNOUNCEMENTS_SOURCE=sharepoint`.
* The dashboard shows the feed with a "Mock data"/"SharePoint" chip.

```bash
curl -s "http://localhost:4000/announcements?limit=3" -H "authorization: Bearer $TOKEN"
```

```json
{
  "source": "mock",
  "data": [
    { "id": "ann-001", "title": "Diwali peak season: extended dispatch hours", "body": "…",
      "category": "Operations", "author": "Ops Control Tower", "publishedAt": "2026-10-14T…", "pinned": true }
  ]
}
```

## Integrating with SharePoint Online

### 1. SharePoint side

Create a list **Announcements** on the intranet site with columns:

| Column | Type |
|---|---|
| Title | Single line (built-in) |
| Body | Multiple lines (rich text) |
| Category | Choice: General, Operations, HR, IT, Safety |
| Pinned | Yes/No |
| PublishedDate | Date and time |

(Alternatively use **News posts** from the site pages library via `GET /sites/{id}/pages`; the provider interface stays the same.)

### 2. Identity and permissions (least privilege)

* Register an Entra app (or use the API's **managed identity**) and grant the Graph **application** permission **`Sites.Selected`**, not `Sites.Read.All`.
* An admin then grants read access to *only this site*:

```http
POST https://graph.microsoft.com/v1.0/sites/{site-id}/permissions
{ "roles": ["read"], "grantedToIdentities": [{ "application": { "id": "<client-id>", "displayName": "ShipOps API" } }] }
```

* Find the ids:

```http
GET https://graph.microsoft.com/v1.0/sites/contoso.sharepoint.com:/sites/intranet
GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists?$filter=displayName eq 'Announcements'
```

### 3. API configuration

```bash
ANNOUNCEMENTS_SOURCE=sharepoint
ENTRA_TENANT_ID=<tenant>
SHAREPOINT_SITE_ID=contoso.sharepoint.com,<site-guid>,<web-guid>
SHAREPOINT_LIST_ID=<list-guid>
GRAPH_CLIENT_ID=<app id>
GRAPH_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=.../graph-client-secret/)   # or drop it and use managed identity
```

The provider acquires an app-only token (client credentials, cached until expiry), calls

```http
GET /v1.0/sites/{site-id}/lists/{list-id}/items?expand=fields(select=Title,Body,Category,Pinned,PublishedDate)&$top=50
```

maps fields to the `Announcement` DTO, strips SharePoint rich-text HTML, and returns. Errors from Graph become `502 UPSTREAM_ERROR` with no token or tenant details leaked.

### 4. Production hardening

| Concern | Approach |
|---|---|
| Throttling (Graph 429) | 5-minute server cache (already in place); honour `Retry-After`; optionally Graph **change notifications** (webhooks) or delta queries to refresh only on change |
| Freshness | webhook on the list → invalidate cache → push a `announcement_published` WebSocket event to clients (reuses Module 5) |
| Security | `Sites.Selected` on one site; managed identity (no secret); output encoding in the UI (React escapes text); HTML stripped server-side |
| Per-user visibility | if items have item-level permissions, call Graph **on behalf of the user** (OBO flow with the user's Entra token) instead of app-only, so users only see what SharePoint allows them to |
| Resilience | serve stale cache if Graph is down; the dashboard shows the feed as optional content |

### 5. Other integration directions

* **Embed ShipOps in SharePoint/Teams**: an SPFx web part or Teams tab that loads the React app (Entra SSO) or calls `/api/dashboard/stats`.
* **Publish from ShipOps to SharePoint**: e.g. post a "service disruption" announcement when exceptions spike (Graph `POST /lists/{id}/items`, requires `write` on the site).
* **Power Automate**: trigger flows from the list (approvals before an announcement goes live).
