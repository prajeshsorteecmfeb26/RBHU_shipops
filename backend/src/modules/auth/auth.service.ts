import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { UnauthorizedError } from '../../lib/errors';
import { env } from '../../config/env';
import type { AuthUser } from '../../types/express';
import { signLocalToken, type VerifiedToken } from './token.service';
import type { LoginInput } from './auth.schemas';

// Pre-computed hash used to keep login timing constant when the email does not exist
const DUMMY_HASH = bcrypt.hashSync('timing-attack-mitigation', 10);

/** Small TTL cache so Entra JIT lookups do not hit the database on every request. */
const userCache = new Map<string, { user: AuthUser; expires: number }>();
const CACHE_TTL_MS = 60_000;

export const authService = {
  async login(input: LoginInput) {
    if (env.AUTH_MODE !== 'local') {
      throw new UnauthorizedError('Password login is disabled; sign in with Microsoft Entra ID');
    }
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = await bcrypt.compare(input.password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !ok || !user.isActive) throw new UnauthorizedError('Invalid email or password');

    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: user.role };
    const token = await signLocalToken({ sub: user.id, email: user.email, name: user.name, role: user.role });
    return { token, expiresIn: env.JWT_EXPIRES_IN, user: authUser };
  },

  /**
   * Turns verified token claims into the request user.
   * Local tokens are trusted as-is (signed by us). Entra users are provisioned
   * just-in-time so they can own conversations and appear in audit fields.
   */
  async resolveUser(verified: VerifiedToken): Promise<AuthUser> {
    const { claims } = verified;
    if (!verified.external) {
      return { id: claims.sub, email: claims.email, name: claims.name, role: claims.role };
    }

    const cached = userCache.get(claims.email);
    if (cached && cached.expires > Date.now()) return { ...cached.user, role: claims.role };

    const user = await prisma.user.upsert({
      where: { email: claims.email },
      update: { name: claims.name, role: claims.role },
      create: {
        email: claims.email,
        name: claims.name,
        role: claims.role,
        // Entra users never log in with a password; store an unusable hash
        passwordHash: `!entra:${randomUUID()}`,
      },
    });
    const authUser: AuthUser = { id: user.id, email: user.email, name: user.name, role: claims.role };
    userCache.set(claims.email, { user: authUser, expires: Date.now() + CACHE_TTL_MS });
    return authUser;
  },
};
