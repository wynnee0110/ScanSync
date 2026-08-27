import { beforeEach, describe, expect, it } from 'vitest';

import { getPreference, setPreference } from './preferences.web';

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe('web preference persistence', () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage },
    });
  });

  it('round-trips a stored preference', async () => {
    await setPreference('scanner.selected_event_id', 'event-123');
    await expect(getPreference('scanner.selected_event_id')).resolves.toBe('event-123');
  });

  it('overwrites an existing preference value', async () => {
    await setPreference('scanner.selected_event_id', 'event-123');
    await setPreference('scanner.selected_event_id', 'event-456');
    await expect(getPreference('scanner.selected_event_id')).resolves.toBe('event-456');
  });

  it('returns null for a missing preference', async () => {
    await expect(getPreference('scanner.selected_event_id')).resolves.toBeNull();
  });
});