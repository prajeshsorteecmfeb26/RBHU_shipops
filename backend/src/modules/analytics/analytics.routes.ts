import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../lib/asyncHandler';
import { env } from '../../config/env';
import { AppError, UpstreamError, ValidationError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { registry, z } from '../../lib/zod';

/**
 * Authenticated gateway to the Python analytics microservice.
 * The browser never talks to Flask directly: the API enforces auth, file-size
 * limits and CORS, then forwards the CSV with a service-to-service key.
 * In Azure the analytics App Service only accepts traffic from the VNET.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.csv')) return cb(new ValidationError('Only .csv files are accepted'));
    cb(null, true);
  },
});

const AnalyzeQuery = z.object({ includePng: z.enum(['true', 'false']).default('false') });

export function createAnalyticsRouter() {
  const router = Router();

  registry.registerPath({
    method: 'post', path: '/api/analytics/analyze', tags: ['Analytics'], security: [{ bearerAuth: [] }],
    summary: 'Upload sales CSV (salesperson,revenue,region) and get charts + summary statistics. Proxies to the Flask service POST /analyze.',
    request: {
      query: AnalyzeQuery,
      body: { content: { 'multipart/form-data': { schema: z.object({ file: z.any().openapi({ type: 'string', format: 'binary' }) }) } } },
    },
    responses: { 200: { description: 'Analysis result (Plotly figure JSON, optional base64 PNGs, statistics)' } },
  });
  router.post('/analyze', upload.single('file'), asyncHandler(async (req, res) => {
    if (!req.file) throw new ValidationError("Attach a CSV file in the 'file' form field");
    const { includePng } = AnalyzeQuery.parse(req.query);

    const form = new FormData();
    form.append('file', new Blob([req.file.buffer], { type: 'text/csv' }), req.file.originalname);

    let upstream: Response;
    try {
      upstream = await fetch(`${env.ANALYTICS_SERVICE_URL}/analyze?include_png=${includePng}`, {
        method: 'POST',
        body: form,
        headers: {
          ...(env.ANALYTICS_API_KEY ? { 'X-Internal-Api-Key': env.ANALYTICS_API_KEY } : {}),
          'X-Request-Id': req.requestId,
        },
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      logger.error({ err }, 'analytics service unreachable');
      throw new UpstreamError('Analytics service', 'unreachable, please try again later', 503);
    }

    const body = (await upstream.json().catch(() => null)) as { error?: { code?: string; message?: string; details?: unknown } } | null;
    if (!upstream.ok) {
      // 4xx from analytics are user errors (bad CSV) -> pass through; 5xx -> 502
      if (upstream.status >= 400 && upstream.status < 500) {
        throw new AppError(upstream.status, body?.error?.code ?? 'ANALYTICS_ERROR', body?.error?.message ?? 'Invalid file', body?.error?.details);
      }
      throw new UpstreamError('Analytics service', 'failed to analyze the file');
    }
    res.json(body);
  }));

  return router;
}
