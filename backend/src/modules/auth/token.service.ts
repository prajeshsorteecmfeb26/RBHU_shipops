import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';
import type { Role } from '@prisma/client';
import { env } from '../../config/env';
import { UnauthorizedError } from '../../lib/errors';

/**
 * Token handling for both auth modes.
 *  - local: HS256 JWTs issued by POST /api/auth/login (mock auth for the assessment)
 *  - entra: RS256 access tokens issued by Microsoft Entra ID, validated against the
 *           tenant's JWKS (signature, issuer, audience, expiry).
 */
export interface TokenClaims {
  sub: string;
  email: string;
  name: string;
  role: Role;
}

const secret = env.JWT_SECRET ? new TextEncoder().encode(env.JWT_SECRET) : undefined;

const entraJwks =
  env.AUTH_MODE === 'entra' && env.ENTRA_TENANT_ID
    ? createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/discovery/v2.0/keys`))
    : undefined;

export async function signLocalToken(claims: TokenClaims): Promise<string> {
  if (!secret) throw new Error('JWT_SECRET not configured');
  return new SignJWT({ email: claims.email, name: claims.name, role: claims.role })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(claims.sub)
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(env.JWT_EXPIRES_IN)
    .sign(secret);
}

/** Maps Entra app roles (configured on the app registration) to internal roles. */
export function mapEntraRoles(roles: unknown): Role {
  const list = Array.isArray(roles) ? roles.map(String) : [];
  if (list.includes('ShipOps.Admin')) return 'ADMIN';
  if (list.includes('ShipOps.Operator')) return 'OPERATOR';
  return 'VIEWER';
}

export interface VerifiedToken {
  claims: TokenClaims;
  /** True when identity comes from Entra and the user may need JIT provisioning */
  external: boolean;
}

export async function verifyToken(token: string): Promise<VerifiedToken> {
  try {
    if (env.AUTH_MODE === 'entra') {
      const { payload } = await jwtVerify(token, entraJwks!, {
        issuer: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0`,
        audience: env.ENTRA_API_AUDIENCE,
      });
      const p = payload as JWTPayload & { oid?: string; preferred_username?: string; name?: string; roles?: string[] };
      return {
        external: true,
        claims: {
          sub: String(p.oid ?? p.sub),
          email: String(p.preferred_username ?? ''),
          name: String(p.name ?? p.preferred_username ?? 'Entra user'),
          role: mapEntraRoles(p.roles),
        },
      };
    }

    const { payload } = await jwtVerify(token, secret!, {
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      algorithms: ['HS256'],
    });
    return {
      external: false,
      claims: {
        sub: String(payload.sub),
        email: String(payload.email),
        name: String(payload.name),
        role: payload.role as Role,
      },
    };
  } catch {
    throw new UnauthorizedError('Invalid or expired token');
  }
}
