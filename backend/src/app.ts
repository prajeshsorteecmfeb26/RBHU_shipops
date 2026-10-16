import express, { Router } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import swaggerUi from 'swagger-ui-express';
import { corsOrigins, env } from './config/env';
import { logger } from './lib/logger';
import { registry } from './lib/zod';
import { requestId } from './middleware/requestId';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import type { Container } from './container';
import { authRouter } from './modules/auth/auth.routes';
import { createCustomerRouter } from './modules/customers/customer.routes';
import { createShipmentRouter } from './modules/shipments/shipment.routes';
import { createDashboardRouter } from './modules/dashboard/dashboard.routes';
import { createChatRouter } from './modules/chat/chat.routes';
import { createAnalyticsRouter } from './modules/analytics/analytics.routes';
import { createAnnouncementsRouter } from './modules/announcements/announcements.routes';
import { getOpenApiDocument } from './docs/openapi';

export interface AppOptions {
  container: Container;
  /** Returns true when the database is reachable; used by the readiness probe */
  readinessCheck?: () => Promise<boolean>;
}

export function createApp({ container, readinessCheck }: AppOptions) {
  const app = express();
  app.disable('x-powered-by');
  // Behind Azure App Service / Front Door: trust the first proxy so req.ip and rate limiting use the client IP
  app.set('trust proxy', 1);

  // ---- Cross-cutting middleware ----
  app.use(requestId);
  app.use(
    pinoHttp({
      logger,
      genReqId: (req) => (req as express.Request).requestId,
      customLogLevel: (_req, res, err) => (err || res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'),
      autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
      serializers: { req: (req) => ({ id: req.id, method: req.method, url: req.url?.replace(/token=[^&]+/, 'token=[REDACTED]') }) },
    }),
  );
  app.use(
    helmet({
      // Swagger UI needs inline scripts/styles; everything else keeps helmet defaults
      contentSecurityPolicy: {
        directives: { 'script-src': ["'self'", "'unsafe-inline'"], 'style-src': ["'self'", "'unsafe-inline'", 'https:'] },
      },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => {
        // Allow same-origin / server-to-server (no Origin header) and the configured browser origins only
        if (!origin || corsOrigins.includes(origin)) return cb(null, true);
        return cb(null, false);
      },
      credentials: false,
      methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Location'],
      maxAge: 600,
    }),
  );
  app.use(express.json({ limit: '100kb' }));
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: env.RATE_LIMIT_PER_MINUTE,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Rate limit exceeded' } },
    }),
  );

  // ---- Health probes (App Service health check -> /health/ready) ----
  registry.registerPath({ method: 'get', path: '/health/live', tags: ['Health'], summary: 'Liveness probe', responses: { 200: { description: 'Process is up' } } });
  registry.registerPath({ method: 'get', path: '/health/ready', tags: ['Health'], summary: 'Readiness probe (checks DB)', responses: { 200: { description: 'Ready' }, 503: { description: 'Dependency down' } } });
  app.get('/health/live', (_req, res) => res.json({ status: 'ok' }));
  app.get('/health/ready', async (_req, res) => {
    const dbOk = readinessCheck ? await readinessCheck().catch(() => false) : true;
    res.status(dbOk ? 200 : 503).json({ status: dbOk ? 'ready' : 'degraded', checks: { database: dbOk ? 'ok' : 'down' }, aiProvider: container.aiProvider.name });
  });

  // ---- Public routes ----
  app.use('/api/auth', authRouter);

  // ---- Protected routes ----
  const announcements = createAnnouncementsRouter(container.announcements);
  const api = Router();
  api.use(authenticate);
  api.use('/dashboard', createDashboardRouter(container.customerRepo, container.shipmentRepo));
  api.use('/customers', createCustomerRouter(container.customerService));
  api.use('/shipments', createShipmentRouter(container.shipmentService));
  api.use('/chat', createChatRouter(container.chatService));
  api.use('/analytics', createAnalyticsRouter());
  api.use('/announcements', announcements);
  app.use('/api', api);
  // Bonus 3 asks for GET /announcements - expose the same handler at the root path too
  app.use('/announcements', authenticate, announcements);

  // ---- API documentation ----
  if (env.SWAGGER_ENABLED) {
    app.get('/api-docs/openapi.json', (_req, res) => res.json(getOpenApiDocument()));
    app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(undefined, {
      swaggerOptions: { url: '/api-docs/openapi.json', persistAuthorization: true },
      customSiteTitle: 'ShipOps API',
    }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
