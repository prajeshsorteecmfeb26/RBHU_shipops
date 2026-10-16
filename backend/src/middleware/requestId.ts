import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

/** Propagates an incoming x-request-id (e.g. from Front Door / App Gateway) or creates one. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.header('x-request-id');
  req.requestId = incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('x-request-id', req.requestId);
  next();
};
