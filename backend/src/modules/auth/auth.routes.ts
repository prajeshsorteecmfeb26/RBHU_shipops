import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate, validated } from '../../middleware/validate';
import { authenticate } from '../../middleware/auth';
import { errorResponses, registry } from '../../lib/zod';
import { LoginResponseSchema, LoginSchema, UserSchema, type LoginInput } from './auth.schemas';
import { authService } from './auth.service';
import { env } from '../../config/env';

export const authRouter = Router();

// Brute-force protection on the credential endpoint
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: { code: 'TOO_MANY_REQUESTS', message: 'Too many login attempts, try again later' } },
});

registry.registerPath({
  method: 'post',
  path: '/api/auth/login',
  tags: ['Auth'],
  summary: 'Mock login (AUTH_MODE=local). Returns a signed JWT.',
  request: { body: { content: { 'application/json': { schema: LoginSchema } } } },
  responses: {
    200: { description: 'Authenticated', content: { 'application/json': { schema: LoginResponseSchema } } },
    400: errorResponses[400],
    401: errorResponses[401],
  },
});
authRouter.post('/login', loginLimiter, validate({ body: LoginSchema }), async (req, res, next) => {
  try {
    res.json(await authService.login(validated<LoginInput>(req, 'body')));
  } catch (err) {
    next(err);
  }
});

registry.registerPath({
  method: 'get',
  path: '/api/auth/me',
  tags: ['Auth'],
  summary: 'Current user from the bearer token',
  security: [{ bearerAuth: [] }],
  responses: {
    200: { description: 'Current user', content: { 'application/json': { schema: UserSchema } } },
    401: errorResponses[401],
  },
});
authRouter.get('/me', authenticate, (req, res) => {
  res.json(req.user);
});
