import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { ForbiddenError, UnauthorizedError } from '../lib/errors';
import { verifyToken } from '../modules/auth/token.service';
import { authService } from '../modules/auth/auth.service';

function extractBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const [scheme, value] = header.split(' ');
  return scheme?.toLowerCase() === 'bearer' && value ? value : undefined;
}

/** Requires a valid JWT (local) or Entra ID access token. */
export const authenticate: RequestHandler = async (req, _res, next) => {
  try {
    const token = extractBearer(req.header('authorization'));
    if (!token) throw new UnauthorizedError();
    const verified = await verifyToken(token);
    req.user = await authService.resolveUser(verified);
    next();
  } catch (err) {
    next(err);
  }
};

/** Role-based authorization. ADMIN implicitly passes every check. */
export const authorize =
  (...roles: Role[]): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(new UnauthorizedError());
    if (req.user.role === 'ADMIN' || roles.includes(req.user.role)) return next();
    return next(new ForbiddenError());
  };
