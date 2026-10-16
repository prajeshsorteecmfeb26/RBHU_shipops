import { createServer } from 'node:http';
import { env } from './config/env';
import { logger } from './lib/logger';
import { prisma } from './lib/prisma';
import { buildContainer } from './container';
import { createApp } from './app';
import { attachWebSocketServer } from './realtime/wsServer';

async function main() {
  await prisma.$connect();
  const container = buildContainer(prisma);

  const app = createApp({
    container,
    readinessCheck: async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    },
  });

  const server = createServer(app);
  // Long-lived WebSockets + App Service load balancer idle timeout (230s): keep HTTP keep-alive above it
  server.keepAliveTimeout = 240_000;
  server.headersTimeout = 241_000;

  const realtime = attachWebSocketServer(server, container.bus);

  server.listen(env.PORT, () => {
    logger.info(
      { port: env.PORT, env: env.NODE_ENV, authMode: env.AUTH_MODE, aiProvider: container.aiProvider.name },
      `ShipOps API listening on http://localhost:${env.PORT} (docs: /api-docs, ws: /ws)`,
    );
  });

  // Graceful shutdown: App Service sends SIGTERM on restarts/slot swaps
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await realtime.close();
    server.close(async () => {
      await prisma.$disconnect();
      logger.info('shutdown complete');
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => logger.error({ reason }, 'unhandled promise rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'failed to start');
  process.exit(1);
});
