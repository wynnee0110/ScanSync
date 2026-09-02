import * as SQLite from 'expo-sqlite';

const DATABASE_NAME = 'attendance-manager.db';

let databasePromise: Promise<SQLite.SQLiteDatabase | null> | undefined;
let initializationPromise: Promise<void> | undefined;

async function openDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  const database = await SQLite.openDatabaseAsync(DATABASE_NAME);

  return database;
}

async function migrateDatabase(database: SQLite.SQLiteDatabase): Promise<void> {
  await database.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS sync_queue (
      id TEXT PRIMARY KEY NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      operation TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'syncing', 'synced', 'retry', 'review')),
      attempt_count INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TEXT,
      last_error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS sync_queue_ready_idx
      ON sync_queue (status, next_attempt_at, created_at);

    CREATE TABLE IF NOT EXISTS local_events (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      venue TEXT NOT NULL,
      starts_at TEXT NOT NULL,
      ends_at TEXT,
      academic_reference_year INTEGER NOT NULL CHECK (academic_reference_year BETWEEN 1900 AND 9999),
      status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'completed')),
      expected_attendees INTEGER NOT NULL DEFAULT 0 CHECK (expected_attendees >= 0),
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS local_events_start_idx
      ON local_events (starts_at DESC);

    CREATE TABLE IF NOT EXISTS local_attendance_records (
      id TEXT PRIMARY KEY NOT NULL,
      event_id TEXT NOT NULL REFERENCES local_events(id) ON DELETE CASCADE,
      participant_reference TEXT NOT NULL,
      participant_name TEXT,
      participant_program TEXT,
      qr_format TEXT NOT NULL DEFAULT 'opaque'
        CHECK (qr_format IN ('opaque', 'school_id')),
      year_level INTEGER CHECK (year_level BETWEEN 1 AND 4),
      method TEXT NOT NULL CHECK (method IN ('qr', 'manual')),
      recorded_at TEXT NOT NULL,
      sync_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (sync_status IN ('pending', 'synced', 'review')),
      UNIQUE (event_id, participant_reference)
    );

    CREATE INDEX IF NOT EXISTS local_attendance_event_time_idx
      ON local_attendance_records (event_id, recorded_at DESC);

    CREATE TABLE IF NOT EXISTS preferences (
      key TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);

  const eventColumns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(local_events)',
  );
  const eventColumnNames = new Set(eventColumns.map((column) => column.name));

  if (!eventColumnNames.has('ends_at')) {
    await database.execAsync('ALTER TABLE local_events ADD COLUMN ends_at TEXT;');
    await database.execAsync(`
      UPDATE local_events
      SET ends_at = datetime(starts_at, '+4 hours')
      WHERE ends_at IS NULL;
    `);
  }

  if (!eventColumnNames.has('created_by')) {
    await database.execAsync('ALTER TABLE local_events ADD COLUMN created_by TEXT;');
  }

  if (!eventColumnNames.has('academic_reference_year')) {
    await database.execAsync(
      'ALTER TABLE local_events ADD COLUMN academic_reference_year INTEGER;',
    );
    await database.execAsync(`
      UPDATE local_events
      SET academic_reference_year = CAST(substr(starts_at, 1, 4) AS INTEGER)
      WHERE academic_reference_year IS NULL;
    `);

    const queuedEvents = await database.getAllAsync<{
      id: string;
      entity_id: string;
      payload: string;
    }>(
      `SELECT id, entity_id, payload
       FROM sync_queue
       WHERE entity_type = 'event' AND operation IN ('insert', 'update') AND status <> 'synced'`,
    );
    for (const queuedEvent of queuedEvents) {
      const localEvent = await database.getFirstAsync<{ academic_reference_year: number | null }>(
        'SELECT academic_reference_year FROM local_events WHERE id = ?',
        queuedEvent.entity_id,
      );
      if (!localEvent?.academic_reference_year) continue;

      try {
        const parsedPayload = JSON.parse(queuedEvent.payload) as unknown;
        if (!parsedPayload || typeof parsedPayload !== 'object' || Array.isArray(parsedPayload)) {
          continue;
        }
        await database.runAsync(
          'UPDATE sync_queue SET payload = ?, updated_at = ? WHERE id = ?',
          JSON.stringify({
            ...(parsedPayload as Record<string, unknown>),
            academic_reference_year: localEvent.academic_reference_year,
          }),
          new Date().toISOString(),
          queuedEvent.id,
        );
      } catch {
        // Leave malformed legacy payloads untouched for the future sync worker to review.
      }
    }
  }

  const attendanceColumns = await database.getAllAsync<{ name: string }>(
    'PRAGMA table_info(local_attendance_records)',
  );
  const columnNames = new Set(attendanceColumns.map((column) => column.name));

  if (!columnNames.has('participant_name')) {
    await database.execAsync('ALTER TABLE local_attendance_records ADD COLUMN participant_name TEXT;');
  }
  if (!columnNames.has('participant_program')) {
    await database.execAsync(
      'ALTER TABLE local_attendance_records ADD COLUMN participant_program TEXT;',
    );
  }
  if (!columnNames.has('qr_format')) {
    await database.execAsync(
      "ALTER TABLE local_attendance_records ADD COLUMN qr_format TEXT NOT NULL DEFAULT 'opaque';",
    );
  }
  if (!columnNames.has('year_level')) {
    await database.execAsync(
      'ALTER TABLE local_attendance_records ADD COLUMN year_level INTEGER CHECK (year_level BETWEEN 1 AND 4);',
    );
  }

  await database.execAsync(`
    UPDATE sync_queue SET status = 'pending' WHERE status = 'review';
    UPDATE local_attendance_records SET sync_status = 'pending' WHERE sync_status = 'review';
  `);

  await database.execAsync(`
    CREATE INDEX IF NOT EXISTS local_attendance_event_year_idx
      ON local_attendance_records (event_id, year_level);
  `);
}

export function getLocalDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  databasePromise ??= openDatabase();
  return databasePromise;
}

export function initializeLocalDatabase(): Promise<void> {
  initializationPromise ??= (async () => {
    const database = await getLocalDatabase();
    if (database) {
      await migrateDatabase(database);
    }
  })();

  return initializationPromise;
}
