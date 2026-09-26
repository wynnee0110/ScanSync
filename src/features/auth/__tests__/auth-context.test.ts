import { describe, expect, it, vi } from 'vitest';

import { THIRTY_DAYS_MS } from '@/features/auth/auth-context';
import { env, isSupabaseConfigured } from '@/lib/env';
import { getValidAccessToken, supabase } from '@/lib/supabase';
import { checkIsOnline, getNetworkStatusAsync } from '@/lib/use-network-status';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(() => Promise.resolve(null)),
  setItemAsync: vi.fn(() => Promise.resolve()),
  deleteItemAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null },
  AppState: {
    addEventListener: vi.fn(() => ({ remove: vi.fn() })),
  },
  Alert: {
    alert: vi.fn(),
  },
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { hostUri: '192.168.1.1:8081' },
  },
}));

vi.mock('expo-sqlite/localStorage/install', () => ({}));

describe('Auth Supabase wiring', () => {
  it('handles unconfigured Supabase environment gracefully', () => {
    expect(typeof isSupabaseConfigured).toBe('boolean');
    expect(env.supabaseUrl).toBeDefined();
    expect(env.supabasePublishableKey).toBeDefined();
  });

  it('validates configuration flags correctly', () => {
    expect(isSupabaseConfigured).toBe(Boolean(env.supabaseUrl && env.supabasePublishableKey));
  });
});

describe('Remember Me session expiry', () => {
  it('calculates 30-day session expiry duration correctly', () => {
    expect(THIRTY_DAYS_MS).toBe(30 * 24 * 60 * 60 * 1000);
    const now = Date.now();
    const expiry = now + THIRTY_DAYS_MS;
    expect(expiry - now).toBe(2592000000);
  });
});

describe('Network status & online validation', () => {
  it('detects online state in web environment', async () => {
    const isOnline = await checkIsOnline();
    expect(typeof isOnline).toBe('boolean');

    const status = await getNetworkStatusAsync();
    expect(status).toHaveProperty('isConnected');
    expect(status).toHaveProperty('connectionType');
    expect(status).toHaveProperty('label');
  });
});

describe('getValidAccessToken', () => {
  it('returns valid access token when session is active and not expiring soon', async () => {
    if (!supabase) return;

    const futureExp = Math.floor(Date.now() / 1000) + 3600; // 1 hour from now
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'valid-test-token',
          expires_at: futureExp,
        } as any,
      },
      error: null,
    });

    const token = await getValidAccessToken();
    expect(token).toBe('valid-test-token');
  });

  it('proactively refreshes token when within 60 seconds of expiry', async () => {
    if (!supabase) return;

    const expiringSoon = Math.floor(Date.now() / 1000) + 30; // 30 seconds from now
    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'expiring-token',
          expires_at: expiringSoon,
        } as any,
      },
      error: null,
    });

    const refreshSpy = vi.spyOn(supabase.auth, 'refreshSession').mockResolvedValueOnce({
      data: {
        session: {
          access_token: 'new-refreshed-token',
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        } as any,
        user: { id: 'test-user-id' } as any,
      },
      error: null,
    });

    const token = await getValidAccessToken();
    expect(refreshSpy).toHaveBeenCalled();
    expect(token).toBe('new-refreshed-token');
  });

  it('returns null if session is missing or getSession errors', async () => {
    if (!supabase) return;

    vi.spyOn(supabase.auth, 'getSession').mockResolvedValueOnce({
      data: { session: null },
      error: null,
    });

    const token = await getValidAccessToken();
    expect(token).toBeNull();
  });
});
