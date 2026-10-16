import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: Role;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId: string;
      user?: AuthUser;
      /** Parsed + validated payloads written by the validate() middleware */
      validated?: { body?: unknown; query?: unknown; params?: unknown };
    }
  }
}
