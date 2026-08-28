import { describe, expect, it, vi } from 'vitest';

import { processSyncQueue } from '@/lib/sync-worker';

vi.mock('@/lib/supabase', () => ({
  isSupabaseConfigured: false,
  supabase: null,
}));

vi.mock('expo-constants', () => ({
  default: {
    expoConfig: { hostUri: '192.168.1.1:8081' },
  },
}));

vi.mock('@/lib/export-api', () => ({
  requestCsvExport: vi.fn().mockResolvedValue({ ok: true, jobId: 'job-1', fileId: 'f-1', webLink: '', rowCount: 1, cached: false }),
}));

describe('sync-worker module', () => {
  it('returns zero counts and empty syncedEventIds when Supabase is not configured', async () => {
    const result = await processSyncQueue();
    expect(result.processedCount).toBe(0);
    expect(result.successCount).toBe(0);
    expect(result.errorCount).toBe(0);
    expect(result.syncedEventIds).toEqual([]);
  });

  it('throws Cannot sync offline error when device is offline', async () => {
    const originalOnLine = navigator.onLine;
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    try {
      await expect(processSyncQueue()).rejects.toThrow('Cannot sync offline');
    } finally {
      Object.defineProperty(navigator, 'onLine', { value: originalOnLine, configurable: true });
    }
  });
});
