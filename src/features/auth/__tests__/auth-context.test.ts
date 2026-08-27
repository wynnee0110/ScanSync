import { describe, expect, it } from 'vitest';

import { env, isSupabaseConfigured } from '@/lib/env';

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
