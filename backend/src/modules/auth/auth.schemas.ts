import { registry, z } from '../../lib/zod';

export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z.string().trim().toLowerCase().email().openapi({ example: 'admin@shipops.local' }),
    password: z.string().min(1).max(200).openapi({ example: 'Admin@123' }),
  }),
);

export const UserSchema = registry.register(
  'User',
  z.object({
    id: z.string().uuid(),
    email: z.string().email(),
    name: z.string(),
    role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
  }),
);

export const LoginResponseSchema = registry.register(
  'LoginResponse',
  z.object({ token: z.string(), expiresIn: z.string(), user: UserSchema }),
);

export type LoginInput = z.infer<typeof LoginSchema>;
