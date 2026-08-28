import { describe, expect, it, vi } from 'vitest';

import { THIRTY_DAYS_MS } from '@/features/auth/auth-context';
import { env, isSupabaseConfigured } from '@/lib/env';

vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(() => Promise.resolve(null)),
  setItemAsync: vi.fn(() => Promise.resolve()),
  deleteItemAsync: vi.fn(() => Promise.resolve()),
}));

vi.mock('react-native', () => ({
  Platform: { OS: 'web' },
  NativeModules: {},
  TurboModuleRegistry: { get: () => null },
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

