import type { RequestHandler } from 'express';
import type { ZodTypeAny } from 'zod';

interface Schemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

/**
 * Zod request validation. Parsed (coerced, defaulted, stripped) values are put on
 * req.validated so handlers never touch raw, unvalidated input.
 * ZodErrors are forwarded to the error handler, which renders a 400.
 */
export const validate =
  (schemas: Schemas): RequestHandler =>
  (req, _res, next) => {
    try {
      req.validated = {
        body: schemas.body ? schemas.body.parse(req.body) : undefined,
        query: schemas.query ? schemas.query.parse(req.query) : undefined,
        params: schemas.params ? schemas.params.parse(req.params) : undefined,
      };
      next();
    } catch (err) {
      next(err);
    }
  };

export function validated<T>(req: Express.Request, part: 'body' | 'query' | 'params'): T {
  return req.validated?.[part] as T;
}
