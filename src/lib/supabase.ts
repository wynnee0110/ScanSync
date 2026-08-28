import 'react-native-url-polyfill/auto';
import 'expo-sqlite/localStorage/install';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

import { env, isSupabaseConfigured } from '@/lib/env';

export { isSupabaseConfigured };

/**
 * Platform-aware storage adapter for Supabase auth session persistence.
 * - Native (Android/iOS): uses expo-secure-store (encrypted key-value store).
 * - Web: falls back to localStorage (browser-only).
 *
 * expo-secure-store keys must be <= 255 chars and contain only [A-Za-z0-9._-].
 */
const MAX_SECURE_STORE_VAL_LEN = 2000;

async function setSecureStoreItem(key: string, value: string): Promise<void> {
  if (value.length <= MAX_SECURE_STORE_VAL_LEN) {
    await SecureStore.setItemAsync(key, value);
    await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => {});
    return;
  }
  const chunkCount = Math.ceil(value.length / 1800);
  await SecureStore.setItemAsync(`${key}_chunks`, String(chunkCount));
  for (let i = 0; i < chunkCount; i++) {
    const chunk = value.substring(i * 1800, (i + 1) * 1800);
    await SecureStore.setItemAsync(`${key}_chunk_${i}`, chunk);
  }
  await SecureStore.deleteItemAsync(key).catch(() => {});
}

async function getSecureStoreItem(key: string): Promise<string | null> {
  const chunksCountStr = await SecureStore.getItemAsync(`${key}_chunks`).catch(() => null);
  if (chunksCountStr) {
    const count = parseInt(chunksCountStr, 10);
    if (!isNaN(count) && count > 0) {
      let full = '';
      for (let i = 0; i < count; i++) {
        const chunk = await SecureStore.getItemAsync(`${key}_chunk_${i}`);
        if (!chunk) return null;
        full += chunk;
      }
      return full;
    }
  }
  return SecureStore.getItemAsync(key);
}

async function removeSecureStoreItem(key: string): Promise<void> {
  await SecureStore.deleteItemAsync(key).catch(() => {});
  const chunksCountStr = await SecureStore.getItemAsync(`${key}_chunks`).catch(() => null);
  if (chunksCountStr) {
    const count = parseInt(chunksCountStr, 10);
    for (let i = 0; i < count; i++) {
      await SecureStore.deleteItemAsync(`${key}_chunk_${i}`).catch(() => {});
    }
    await SecureStore.deleteItemAsync(`${key}_chunks`).catch(() => {});
  }
}

/**
 * Platform-aware storage adapter for Supabase auth session persistence.
 * - Native (Android/iOS): uses chunked expo-secure-store (prevents 2048-byte Android limit).
 * - Web: falls back to localStorage (browser-only).
 */
const secureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    if (Platform.OS === 'web') {
      if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
        return null;
      }
      return localStorage.getItem(key);
    }
    return getSecureStoreItem(key);
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.setItem(key, value);
      }
      return;
    }
    await setSecureStoreItem(key, value);
  },
  removeItem: async (key: string): Promise<void> => {
    if (Platform.OS === 'web') {
      if (typeof window !== 'undefined' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(key);
      }
      return;
    }
    await removeSecureStoreItem(key);
  },
};

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(env.supabaseUrl, env.supabasePublishableKey, {
      auth: {
        storage: secureStoreAdapter,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase is not configured. Copy .env.example to .env and add public keys.');
  }

  return supabase;
}
