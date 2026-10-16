import type { ErrorRequestHandler, RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { ZodError } from 'zod';
import { AppError, NotFoundError } from '../lib/errors';
import { logger } from '../lib/logger';
import { isProd } from '../config/env';

export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(new NotFoundError('Route', `${req.method} ${req.path}`));
};

function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;

  if (err instanceof ZodError) {
    return new AppError(400, 'VALIDATION_ERROR', 'Request validation failed',
      err.issues.map((i) => ({ path: i.path.join('.'), message: i.message, code: i.code })));
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case 'P2002':
        return new AppError(409, 'CONFLICT', 'A record with the same unique value already exists',
          { target: err.meta?.target });
      case 'P2025':
        return new AppError(404, 'NOT_FOUND', 'Record not found');
      case 'P2003':
        return new AppError(409, 'CONFLICT', 'Operation violates a relation constraint');
      default:
        return new AppError(500, 'DATABASE_ERROR', 'A database error occurred');
    }
  }

  if (err instanceof MulterError) {
    return new AppError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400, 'UPLOAD_ERROR', err.message);
  }

  // body-parser JSON syntax error / payload too large
  const e = err as { type?: string; status?: number; message?: string };
  if (e?.type === 'entity.parse.failed') return new AppError(400, 'MALFORMED_JSON', 'Request body is not valid JSON');
  if (e?.type === 'entity.too.large') return new AppError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');

  return new AppError(500, 'INTERNAL_ERROR', 'An unexpected error occurred');
}

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const appErr = toAppError(err);

  const logPayload = { err, requestId: req.requestId, method: req.method, path: req.originalUrl, userId: req.user?.id };
  if (appErr.statusCode >= 500) logger.error(logPayload, 'unhandled error');
  else logger.warn({ ...logPayload, err: undefined, code: appErr.code, message: appErr.message }, 'request failed');

  res.status(appErr.statusCode).json({
    error: {
      code: appErr.code,
      message: appErr.message,
      details: appErr.details,
      requestId: req.requestId,
      // Never leak stack traces outside development
      ...(!isProd && appErr.statusCode >= 500 && err instanceof Error ? { debug: err.message } : {}),
    },
  });
};
