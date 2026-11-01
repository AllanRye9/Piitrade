'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import { User } from '@/lib/types';
import { api, API_URL } from '@/lib/api';
import {
  clearAuthSession,
  getAccessToken,
  hasStoredAuthSession,
  migrateLegacyAuthSession,
  setAuthSession,
  touchAuthActivity,
} from '@/lib/authStorage';
import { isCountrySwitching } from '@/lib/countrySwitch';
import { scheduleProactiveRefresh, cancelProactiveRefresh } from '@/lib/sessionRefreshScheduler';

const AUTH_ME_COOLDOWN_KEY = 'auth:meCooldownUntil';
const AUTH_ME_COOLDOWN_MS = 30_000;

let fetchMeRequest: Promise<void> | null = null;

interface AuthContextType {
  user: User | null;
  loading: boolean;
  /** `identifier` is an email address or a username. */
  login: (identifier: string, password: string) => Promise<User>;
  register: (data: RegisterData) => Promise<{ message: string }>;
  logout: () => Promise<void>;
  updateUser: (data: Partial<User>) => void;
  /** Re-fetches /users/me and syncs `user` — used after an inline re-login (see SessionExpiredModal) so the rest of the app picks up the restored session without a page reload. */
  refreshUser: () => Promise<void>;
}

interface RegisterData {
  email: string;
  username?: string;
  password: string;
  name: string;
  phone?: string;
  country: import('@/lib/types').Country;
  role?: import('@/lib/types').Role;
  companyName?: string;
  registrationNumber?: string;
  agentLicense?: string;
  agentType?: string;
  website?: string;
  businessDescription?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const destroySession = useCallback(async (revokeRemoteToken = true) => {
    try {
      if (revokeRemoteToken) {
        // The refresh token lives in an httpOnly cookie now — the browser
        // attaches it automatically, so there's nothing to read/send here.
        await axios.post(`${API_URL}/api/auth/logout`, {}, { withCredentials: true });
      }
    } finally {
      clearAuthSession();
      cancelProactiveRefresh();
      setUser(null);
      setLoading(false);
    }
  }, []);

  const fetchMe = useCallback(async () => {
    if (typeof window !== 'undefined') {
      const cooldownUntil = Number(sessionStorage.getItem(AUTH_ME_COOLDOWN_KEY) || '0');
      if (cooldownUntil > Date.now()) {
        setLoading(false);
        return;
      }
    }

    if (fetchMeRequest) {
      await fetchMeRequest;
      return;
    }

    fetchMeRequest = (async () => {
      try {
        const { data } = await api.get('/users/me');
        if (typeof window !== 'undefined') sessionStorage.removeItem(AUTH_ME_COOLDOWN_KEY);
        touchAuthActivity(true);
        setUser(data);
      } catch (error: unknown) {
        const status = (error as { response?: { status?: number } }).response?.status;
        if (typeof window !== 'undefined' && status === 429) {
          sessionStorage.setItem(AUTH_ME_COOLDOWN_KEY, String(Date.now() + AUTH_ME_COOLDOWN_MS));
        }
        if (status === 401 && typeof window !== 'undefined') {
          // Never destroy session during a country-switch — those requests may
          // 401 transiently because the country param changed mid-flight.
          if (isCountrySwitching()) {
            setLoading(false);
            return;
          }
          // Never destroy session on admin pages — a transient 401 (network hiccup,
          // CDN hop) should not silently log the admin out. The token refresh in
          // api.ts will handle real expiry and redirect to /admin/auth/login.
          if (window.location.pathname.startsWith('/admin')) {
            setLoading(false);
            return;
          }
          await destroySession(false);
          return;
        }
        setUser(null);
      } finally {
        fetchMeRequest = null;
        setLoading(false);
      }
    })();

    await fetchMeRequest;
  }, [destroySession]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    migrateLegacyAuthSession();

    if (!hasStoredAuthSession()) {
      setLoading(false);
      return;
    }

    touchAuthActivity(true);
    // Arm the silent background refresh against the token we already have,
    // so a page reload / reopened tab doesn't have to wait for a reactive
    // 401 before scheduling one — see sessionRefreshScheduler.ts.
    const existingToken = getAccessToken();
    if (existingToken) scheduleProactiveRefresh(existingToken);
    void fetchMe();
  }, [destroySession, fetchMe]);

  // Re-validate session when the tab becomes visible again (e.g. returning from
  // another tab) rather than forcing a full page reload.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && hasStoredAuthSession()) {
        void fetchMe();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [fetchMe]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !['accessToken', 'auth:lastActivityAt'].includes(event.key)) return;

      if (!hasStoredAuthSession()) {
        setUser(null);
        setLoading(false);
        return;
      }

      if (event.key === 'auth:lastActivityAt') return;

      setLoading(true);
      void fetchMe();
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [destroySession, fetchMe]);

  const login = async (identifier: string, password: string): Promise<User> => {
    // Deliberately a raw axios call, not the shared `api` instance — `api`
    // carries the 401-refresh-retry interceptor, and if this call fails
    // (e.g. wrong password) while a stale token from a previous session is
    // still sitting in storage, that interceptor would see it, think a
    // real session just expired, and kick off its own reauth flow
    // recursively on top of this one. Login/logout/refresh are all
    // "bootstrap" calls that must never route through that interceptor —
    // refreshAccessToken() and destroySession() below already follow this
    // same rule.
    const { data } = await axios.post(`${API_URL}/api/auth/login`, { identifier: identifier.trim(), password }, { withCredentials: true });
    setAuthSession(data.accessToken);
    scheduleProactiveRefresh(data.accessToken);
    setUser(data.user);
    return data.user as User;
  };

  const register = async (formData: RegisterData) => {
    const { data } = await api.post('/auth/register', formData);
    return { message: data.message as string };
  };

  const logout = async () => {
    await destroySession();
  };

  const updateUser = (data: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...data } : null));
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, updateUser, refreshUser: fetchMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
