import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, configureApiClient } from '../api/client';
import type { Role, User } from '../api/types';

/**
 * Mock authentication flow (AUTH_MODE=local on the API).
 * The token lives in sessionStorage: it survives a refresh but not a closed tab,
 * which limits exposure compared with localStorage. With Entra ID, this provider
 * would be replaced by MSAL (@azure/msal-react) acquiring tokens silently.
 */
const STORAGE_KEY = 'shipops.session';

interface Session {
  token: string;
  user: User;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: (reason?: string) => void;
  can: (...roles: Role[]) => boolean;
  logoutReason: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readSession(): Session | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Session;
    // Drop expired tokens up front instead of waiting for a 401
    const exp = JSON.parse(atob(s.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
    return exp * 1000 > Date.now() ? s : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(readSession);
  const [logoutReason, setLogoutReason] = useState<string | null>(null);
  const qc = useQueryClient();

  const logout = useCallback(
    (reason?: string) => {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* storage unavailable */
      }
      setSession(null);
      setLogoutReason(reason ?? null);
      qc.clear();
    },
    [qc],
  );

  // Configure synchronously so child effects already send the token on first render
  configureApiClient({
    getToken: () => session?.token ?? null,
    onUnauthorized: () => logout('Your session expired. Please sign in again.'),
  });

  useEffect(() => {
    if (!session) return;
    // Auto-logout when the JWT expires while the app is open
    const exp = JSON.parse(atob(session.token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp as number;
    const t = window.setTimeout(() => logout('Your session expired. Please sign in again.'), exp * 1000 - Date.now());
    return () => window.clearTimeout(t);
  }, [session, logout]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<{ token: string; user: User }>('/api/auth/login', { email, password });
    const s = { token: res.token, user: res.user };
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* private mode: session lives in memory only */
    }
    setLogoutReason(null);
    setSession(s);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: session?.user ?? null,
      token: session?.token ?? null,
      login,
      logout,
      logoutReason,
      can: (...roles) => !!session && (session.user.role === 'ADMIN' || roles.includes(session.user.role)),
    }),
    [session, login, logout, logoutReason],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
