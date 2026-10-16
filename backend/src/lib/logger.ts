import pino from 'pino';
import { env, isProd } from '../config/env';

/**
 * Structured JSON logging (pino). In Azure, stdout is collected by App Service
 * and shipped to Log Analytics / Application Insights.
 * Sensitive fields are redacted so tokens and passwords never reach logs.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: 'shipops-api' },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-internal-api-key"]',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
  transport:
    !isProd && env.NODE_ENV !== 'test'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } }
      : undefined,
});
