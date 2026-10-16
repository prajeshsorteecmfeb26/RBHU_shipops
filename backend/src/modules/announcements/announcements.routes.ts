import { Router } from 'express';
import { asyncHandler } from '../../lib/asyncHandler';
import { registry, z } from '../../lib/zod';
import { validate, validated } from '../../middleware/validate';
import type { Announcement, AnnouncementsProvider } from './announcements.provider';

const CATEGORIES = ['General', 'Operations', 'HR', 'IT', 'Safety'] as const;

const QuerySchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

const AnnouncementSchema = registry.register(
  'Announcement',
  z.object({
    id: z.string(),
    title: z.string(),
    body: z.string(),
    category: z.enum(CATEGORIES),
    author: z.string(),
    publishedAt: z.string(),
    pinned: z.boolean(),
    url: z.string().optional(),
  }),
);

/** Simple TTL cache: intranet content changes rarely, Graph has throttling limits. */
const CACHE_TTL_MS = 5 * 60_000;

export function createAnnouncementsRouter(provider: AnnouncementsProvider) {
  const router = Router();
  let cache: { at: number; items: Announcement[] } | undefined;

  registry.registerPath({
    method: 'get', path: '/api/announcements', tags: ['Announcements (SharePoint PoC)'], security: [{ bearerAuth: [] }],
    summary: 'Intranet announcements. Mocked by default; ANNOUNCEMENTS_SOURCE=sharepoint reads a SharePoint Online list via Microsoft Graph.',
    request: { query: QuerySchema },
    responses: {
      200: {
        description: 'Announcements (pinned first, newest first)',
        content: { 'application/json': { schema: z.object({ source: z.string(), data: z.array(AnnouncementSchema) }) } },
      },
    },
  });
  router.get('/', validate({ query: QuerySchema }), asyncHandler(async (req, res) => {
    const q = validated<z.infer<typeof QuerySchema>>(req, 'query');
    if (!cache || Date.now() - cache.at > CACHE_TTL_MS) cache = { at: Date.now(), items: await provider.list() };

    const data = cache.items
      .filter((a) => !q.category || a.category === q.category)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishedAt.localeCompare(a.publishedAt))
      .slice(0, q.limit);

    res.setHeader('Cache-Control', 'private, max-age=60');
    res.json({ source: provider.source, data });
  }));

  return router;
}
