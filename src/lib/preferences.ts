import { getLocalDatabase, initializeLocalDatabase } from '@/lib/local-database';

export const SELECTED_EVENT_KEY = 'scanner.selected_event_id';

type PreferenceRow = { value: string };

async function requireDatabase() {
  await initializeLocalDatabase();
  const database = await getLocalDatabase();
  if (!database) {
    throw new Error('Local storage is unavailable on this platform.');
  }
  return database;
}

export async function getPreference(key: string): Promise<string | null> {
  const database = await requireDatabase();
  const row = await database.getFirstAsync<PreferenceRow>(
    'SELECT value FROM preferences WHERE key = ?',
    key,
  );
  return row?.value ?? null;
}

export async function setPreference(key: string, value: string): Promise<void> {
  const database = await requireDatabase();
  await database.runAsync(
    `INSERT INTO preferences (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    key,
    value,
  );
}