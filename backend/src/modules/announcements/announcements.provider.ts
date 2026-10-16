import { env } from '../../config/env';
import { UpstreamError } from '../../lib/errors';

export interface Announcement {
  id: string;
  title: string;
  body: string;
  category: 'General' | 'Operations' | 'HR' | 'IT' | 'Safety';
  author: string;
  publishedAt: string;
  pinned: boolean;
  url?: string;
}

export interface AnnouncementsProvider {
  readonly source: 'mock' | 'sharepoint';
  list(): Promise<Announcement[]>;
}

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();

/** Bonus 3: mocked intranet announcements (shape mirrors a SharePoint list). */
export class MockAnnouncementsProvider implements AnnouncementsProvider {
  readonly source = 'mock' as const;

  async list(): Promise<Announcement[]> {
    return [
      { id: 'ann-001', title: 'Diwali peak season: extended dispatch hours', body: 'Mumbai and Pune hubs run a second dispatch shift (18:00-02:00) until 15 Nov. Plan pickups accordingly.', category: 'Operations', author: 'Ops Control Tower', publishedAt: daysAgo(1), pinned: true },
      { id: 'ann-002', title: 'New SLA for OutForDelivery exceptions', body: 'Exceptions raised while OutForDelivery must be triaged within 2 hours. The ShipOps dashboard now highlights them in real time.', category: 'Operations', author: 'Head of Last-Mile', publishedAt: daysAgo(3), pinned: false },
      { id: 'ann-003', title: 'Mandatory MFA rollout via Microsoft Entra ID', body: 'All internal apps, including ShipOps, will require Entra ID sign-in with MFA from next month.', category: 'IT', author: 'IT Security', publishedAt: daysAgo(5), pinned: false },
      { id: 'ann-004', title: 'Warehouse forklift safety refresher', body: 'All floor staff must complete the 30-minute refresher module on the LMS by Friday.', category: 'Safety', author: 'EHS Team', publishedAt: daysAgo(8), pinned: false },
      { id: 'ann-005', title: 'Quarterly town hall', body: 'Join the Q3 town hall on Teams. Agenda: growth numbers, Fabric analytics roadmap, open Q&A.', category: 'General', author: 'Leadership Office', publishedAt: daysAgo(12), pinned: false },
    ];
  }
}

/**
 * SharePoint Online integration via Microsoft Graph (app-only, client credentials).
 * Reads items from an "Announcements" list:
 *   GET https://graph.microsoft.com/v1.0/sites/{site-id}/lists/{list-id}/items?expand=fields
 * Required Graph application permission: Sites.Selected (granted to this one site)
 * In Azure, prefer Managed Identity + Sites.Selected over a client secret.
 * See docs/bonus-sharepoint.md for setup.
 */
export class SharePointAnnouncementsProvider implements AnnouncementsProvider {
  readonly source = 'sharepoint' as const;
  private token?: { value: string; expires: number };

  private async getToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await fetch(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.GRAPH_CLIENT_ID ?? '',
        client_secret: env.GRAPH_CLIENT_SECRET ?? '',
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new UpstreamError('SharePoint', 'could not obtain Graph token');
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.token = { value: json.access_token, expires: Date.now() + json.expires_in * 1000 };
    return json.access_token;
  }

  async list(): Promise<Announcement[]> {
    const token = await this.getToken();
    const url =
      `https://graph.microsoft.com/v1.0/sites/${env.SHAREPOINT_SITE_ID}/lists/${env.SHAREPOINT_LIST_ID}/items` +
      `?expand=fields(select=Title,Body,Category,Pinned,PublishedDate)&$top=50`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new UpstreamError('SharePoint', `Graph returned ${res.status}`);
    const json = (await res.json()) as {
      value: { id: string; webUrl: string; createdBy?: { user?: { displayName?: string } }; fields: Record<string, unknown> }[];
    };
    return json.value.map((item) => ({
      id: item.id,
      title: String(item.fields.Title ?? ''),
      body: String(item.fields.Body ?? '').replace(/<[^>]+>/g, ''), // strip SharePoint rich-text HTML
      category: (item.fields.Category as Announcement['category']) ?? 'General',
      author: item.createdBy?.user?.displayName ?? 'SharePoint',
      publishedAt: String(item.fields.PublishedDate ?? new Date().toISOString()),
      pinned: Boolean(item.fields.Pinned),
      url: item.webUrl,
    }));
  }
}

export function createAnnouncementsProvider(): AnnouncementsProvider {
  return env.ANNOUNCEMENTS_SOURCE === 'sharepoint' ? new SharePointAnnouncementsProvider() : new MockAnnouncementsProvider();
}
