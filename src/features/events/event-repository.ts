import type {
  AttendanceCaptureResult,
  AttendanceHistoryItem,
  AttendanceQrParticipant,
  CreateEventInput,
  DashboardStats,
  EventStatus,
  LocalEvent,
  UpdateAttendanceInput,
  UpdateAttendanceResult,
  UpdateEventInput,
  YearLevel,
} from '@/features/events/event-types';
import { createEmptyYearLevelCounts, isYearLevel } from '@/features/attendance/year-level';
import { getLocalDatabase, initializeLocalDatabase } from '@/lib/local-database';
import { createUuid } from '@/lib/uuid';

type EventRow = {
  id: string;
  name: string;
  venue: string;
  starts_at: string;
  ends_at: string | null;
  academic_reference_year: number;
  status: EventStatus;
  expected_attendees: number;
  attendee_count: number;
  first_year_count: number;
  second_year_count: number;
  third_year_count: number;
  fourth_year_count: number;
  unknown_year_count: number;
  created_by?: string;
  created_at: string;
  updated_at: string;
};

type CountRow = { count: number };
type YearCountRow = { year_level: number | null; count: number };
type QueueRow = { id: string; operation: 'insert' | 'update' | 'delete' };

type AttendanceRow = {
  id: string;
  event_id: string;
  event_name: string;
  participant_reference: string;
  participant_name: string | null;
  participant_program: string | null;
  qr_format: 'opaque' | 'school_id';
  year_level: number | null;
  method: 'qr' | 'manual';
  recorded_at: string;
  sync_status: 'pending' | 'synced';
};

function mapEvent(row: EventRow): LocalEvent {
  const fallbackEndsAt = new Date(
    new Date(row.starts_at).getTime() + 4 * 60 * 60 * 1000,
  ).toISOString();

  return {
    id: row.id,
    name: row.name,
    venue: row.venue,
    startsAt: row.starts_at,
    endsAt: row.ends_at ?? fallbackEndsAt,
    academicReferenceYear: row.academic_reference_year,
    status: row.status,
    expectedAttendees: row.expected_attendees,
    attendeeCount: row.attendee_count,
    yearLevelCounts: {
      1: row.first_year_count,
      2: row.second_year_count,
      3: row.third_year_count,
      4: row.fourth_year_count,
    },
    unknownYearCount: row.unknown_year_count,
    createdBy: row.created_by ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function requireDatabase() {
  await initializeLocalDatabase();
  const database = await getLocalDatabase();
  if (!database) {
    throw new Error('Local storage is unavailable on this platform.');
  }
  return database;
}

export async function listEvents(): Promise<LocalEvent[]> {
  const database = await requireDatabase();
  const rows = await database.getAllAsync<EventRow>(`
    SELECT event.*,
      COUNT(attendance.id) AS attendee_count,
      SUM(CASE WHEN attendance.year_level = 1 THEN 1 ELSE 0 END) AS first_year_count,
      SUM(CASE WHEN attendance.year_level = 2 THEN 1 ELSE 0 END) AS second_year_count,
      SUM(CASE WHEN attendance.year_level = 3 THEN 1 ELSE 0 END) AS third_year_count,
      SUM(CASE WHEN attendance.year_level = 4 THEN 1 ELSE 0 END) AS fourth_year_count,
      SUM(CASE WHEN attendance.id IS NOT NULL AND attendance.year_level IS NULL THEN 1 ELSE 0 END)
        AS unknown_year_count
    FROM local_events event
    LEFT JOIN local_attendance_records attendance ON attendance.event_id = event.id
    GROUP BY event.id
    ORDER BY event.starts_at DESC
  `);
  return rows.map(mapEvent);
}

export async function listActiveEvents(): Promise<LocalEvent[]> {
  const events = await listEvents();
  return events.filter((event) => event.status === 'active');
}

export async function getEventById(id: string): Promise<LocalEvent | null> {
  const events = await listEvents();
  return events.find((event) => event.id === id) ?? null;
}

export async function createEvent(input: CreateEventInput): Promise<LocalEvent> {
  const database = await requireDatabase();
  const id = createUuid();
  const now = new Date().toISOString();
  const createdBy = input.createdBy ? input.createdBy.trim().toLowerCase() : null;

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `INSERT INTO local_events (
        id, name, venue, starts_at, ends_at, academic_reference_year, status,
        expected_attendees, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.name.trim(),
      input.venue.trim(),
      input.startsAt,
      input.endsAt,
      input.academicReferenceYear,
      input.status,
      input.expectedAttendees,
      createdBy,
      now,
      now,
    );

    await database.runAsync(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, payload, status,
        attempt_count, next_attempt_at, last_error_code, created_at, updated_at
      ) VALUES (?, 'event', ?, 'insert', ?, 'pending', 0, NULL, NULL, ?, ?)`,
      createUuid(),
      id,
      JSON.stringify({
        id,
        name: input.name.trim(),
        venue: input.venue.trim(),
        starts_at: input.startsAt,
        ends_at: input.endsAt,
        academic_reference_year: input.academicReferenceYear,
        status: input.status,
        expected_attendees: input.expectedAttendees,
        created_by: createdBy,
      }),
      now,
      now,
    );
  });

  return {
    id,
    ...input,
    name: input.name.trim(),
    venue: input.venue.trim(),
    createdBy: createdBy ?? undefined,
    attendeeCount: 0,
    yearLevelCounts: createEmptyYearLevelCounts(),
    unknownYearCount: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const database = await requireDatabase();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const [totalAttendees, todayAttendees, totalEvents, activeEvents, pendingSync, yearRows] = await Promise.all([
    database.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM local_attendance_records'),
    database.getFirstAsync<CountRow>(
      'SELECT COUNT(*) AS count FROM local_attendance_records WHERE recorded_at >= ? AND recorded_at < ?',
      startOfToday.toISOString(),
      endOfToday.toISOString(),
    ),
    database.getFirstAsync<CountRow>('SELECT COUNT(*) AS count FROM local_events'),
    database.getFirstAsync<CountRow>(
      "SELECT COUNT(*) AS count FROM local_events WHERE status = 'active'",
    ),
    database.getFirstAsync<CountRow>(
      "SELECT COUNT(*) AS count FROM sync_queue WHERE status IN ('pending', 'retry')",
    ),
    database.getAllAsync<YearCountRow>(
      'SELECT year_level, COUNT(*) AS count FROM local_attendance_records GROUP BY year_level',
    ),
  ]);

  const yearLevelCounts = createEmptyYearLevelCounts();
  let unknownYearCount = 0;
  yearRows.forEach((row) => {
    if (isYearLevel(row.year_level)) {
      yearLevelCounts[row.year_level] = row.count;
    } else {
      unknownYearCount += row.count;
    }
  });

  return {
    totalAttendees: totalAttendees?.count ?? 0,
    todayAttendees: todayAttendees?.count ?? 0,
    totalEvents: totalEvents?.count ?? 0,
    activeEvents: activeEvents?.count ?? 0,
    pendingSync: pendingSync?.count ?? 0,
    yearLevelCounts,
    unknownYearCount,
  };
}

export async function recordQrAttendance(
  eventId: string,
  participant: AttendanceQrParticipant,
  yearLevel: YearLevel | null,
  method: 'qr' | 'manual' = 'qr',
): Promise<AttendanceCaptureResult> {
  const database = await requireDatabase();
  const recordId = createUuid();
  const now = new Date().toISOString();
  let inserted = false;

  await database.withTransactionAsync(async () => {
    const result = await database.runAsync(
      `INSERT OR IGNORE INTO local_attendance_records (
        id, event_id, participant_reference, participant_name, participant_program,
        qr_format, year_level, method, recorded_at, sync_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      recordId,
      eventId,
      participant.participantReference,
      participant.claimedName,
      participant.claimedProgram,
      participant.qrFormat,
      yearLevel,
      method,
      now,
      'pending',
    );

    inserted = result.changes > 0;
    if (!inserted) {
      return;
    }

    await database.runAsync(
      `INSERT INTO sync_queue (
        id, entity_type, entity_id, operation, payload, status,
        attempt_count, next_attempt_at, last_error_code, created_at, updated_at
      ) VALUES (?, 'attendance_record', ?, 'insert', ?, ?, 0, NULL, NULL, ?, ?)`,
      createUuid(),
      recordId,
      JSON.stringify({
        client_record_id: recordId,
        event_id: eventId,
        participant_reference: participant.participantReference,
        claimed_name: participant.claimedName,
        claimed_program: participant.claimedProgram,
        qr_format: participant.qrFormat,
        year_level: yearLevel,
        method: 'qr',
        recorded_at: now,
      }),
      'pending',
      now,
      now,
    );
  });

  return inserted
    ? { status: 'recorded', recordId }
    : { status: 'duplicate' };
}

export async function listAttendanceHistory(
  limit = 50,
  eventId?: string,
): Promise<AttendanceHistoryItem[]> {
  const database = await requireDatabase();
  const rows = await database.getAllAsync<AttendanceRow>(
    eventId
      ? `SELECT attendance.*, event.name AS event_name
         FROM local_attendance_records attendance
         JOIN local_events event ON event.id = attendance.event_id
         WHERE attendance.event_id = ?
         ORDER BY attendance.recorded_at DESC
         LIMIT ?`
      : `SELECT attendance.*, event.name AS event_name
         FROM local_attendance_records attendance
         JOIN local_events event ON event.id = attendance.event_id
         ORDER BY attendance.recorded_at DESC
         LIMIT ?`,
    ...(eventId ? [eventId, limit] : [limit]),
  );

  return rows.map((row) => ({
    id: row.id,
    eventId: row.event_id,
    eventName: row.event_name,
    participantReference: row.participant_reference,
    participantName: row.participant_name,
    participantProgram: row.participant_program,
    qrFormat: row.qr_format,
    yearLevel: isYearLevel(row.year_level) ? row.year_level : null,
    method: row.method,
    recordedAt: row.recorded_at,
    syncStatus: row.sync_status,
  }));
}

export async function updateAttendanceRecord(
  recordId: string,
  input: UpdateAttendanceInput,
): Promise<UpdateAttendanceResult> {
  const database = await requireDatabase();
  const now = new Date().toISOString();
  let result: UpdateAttendanceResult = { status: 'updated' };

  await database.withTransactionAsync(async () => {
    const current = await database.getFirstAsync<AttendanceRow>(
      `SELECT attendance.*, event.name AS event_name
       FROM local_attendance_records attendance
       JOIN local_events event ON event.id = attendance.event_id
       WHERE attendance.id = ?`,
      recordId,
    );
    if (!current) {
      throw new Error('Attendance record no longer exists.');
    }

    const duplicate = await database.getFirstAsync<{ id: string }>(
      `SELECT id FROM local_attendance_records
       WHERE event_id = ? AND participant_reference = ? AND id <> ?`,
      current.event_id,
      input.participantReference,
      recordId,
    );
    if (duplicate) {
      result = { status: 'duplicate' };
      return;
    }

    const syncStatus = 'pending' as const;
    await database.runAsync(
      `UPDATE local_attendance_records
       SET participant_reference = ?, participant_name = ?, participant_program = ?,
           year_level = ?, sync_status = ?
       WHERE id = ?`,
      input.participantReference,
      input.participantName,
      input.participantProgram,
      input.yearLevel,
      syncStatus,
      recordId,
    );

    const payload = JSON.stringify({
      client_record_id: recordId,
      event_id: current.event_id,
      participant_reference: input.participantReference,
      claimed_name: input.participantName,
      claimed_program: input.participantProgram,
      qr_format: current.qr_format,
      year_level: input.yearLevel,
      method: current.method,
      recorded_at: current.recorded_at,
    });
    const queuedMutation = await database.getFirstAsync<QueueRow>(
      `SELECT id, operation FROM sync_queue
       WHERE entity_type = 'attendance_record' AND entity_id = ?
         AND operation IN ('insert', 'update') AND status <> 'synced'
       ORDER BY created_at ASC LIMIT 1`,
      recordId,
    );

    if (queuedMutation) {
      await database.runAsync(
        `UPDATE sync_queue
         SET payload = ?, status = ?, attempt_count = 0, next_attempt_at = NULL,
             last_error_code = NULL, updated_at = ?
         WHERE id = ?`,
        payload,
        syncStatus,
        now,
        queuedMutation.id,
      );
    } else {
      await database.runAsync(
        `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, status,
          attempt_count, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'attendance_record', ?, 'update', ?, ?, 0, NULL, NULL, ?, ?)`,
        createUuid(),
        recordId,
        payload,
        syncStatus,
        now,
        now,
      );
    }
  });

  return result;
}

export async function deleteAttendanceRecord(recordId: string): Promise<boolean> {
  const database = await requireDatabase();
  const now = new Date().toISOString();
  let deleted = false;

  await database.withTransactionAsync(async () => {
    const current = await database.getFirstAsync<AttendanceRow>(
      `SELECT attendance.*, event.name AS event_name
       FROM local_attendance_records attendance
       JOIN local_events event ON event.id = attendance.event_id
       WHERE attendance.id = ?`,
      recordId,
    );
    if (!current) {
      return;
    }

    const pendingInsert = await database.getFirstAsync<QueueRow>(
      `SELECT id, operation FROM sync_queue
       WHERE entity_type = 'attendance_record' AND entity_id = ?
         AND operation = 'insert' AND status <> 'synced'
       LIMIT 1`,
      recordId,
    );

    await database.runAsync(
      `DELETE FROM sync_queue
       WHERE entity_type = 'attendance_record' AND entity_id = ? AND status <> 'synced'`,
      recordId,
    );
    await database.runAsync('DELETE FROM local_attendance_records WHERE id = ?', recordId);

    if (!pendingInsert) {
      await database.runAsync(
        `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, status,
          attempt_count, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'attendance_record', ?, 'delete', ?, 'pending', 0, NULL, NULL, ?, ?)`,
        createUuid(),
        recordId,
        JSON.stringify({ client_record_id: recordId, event_id: current.event_id }),
        now,
        now,
      );
    }
    deleted = true;
  });

  return deleted;
}

/**
 * Updates an existing local event record and queues an idempotent sync operation.
 * If an unsynced insert operation exists in sync_queue for this event, its payload is updated in-place.
 */
export async function updateEvent(input: UpdateEventInput): Promise<void> {
  const database = await requireDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `UPDATE local_events
       SET name = ?, venue = ?, starts_at = ?, ends_at = ?, academic_reference_year = ?, status = ?,
           expected_attendees = ?, updated_at = ?
       WHERE id = ?`,
      input.name.trim(),
      input.venue.trim(),
      input.startsAt,
      input.endsAt,
      input.academicReferenceYear,
      input.status,
      input.expectedAttendees,
      now,
      input.id,
    );

    const pendingInsert = await database.getFirstAsync<QueueRow>(
      `SELECT id, operation FROM sync_queue
       WHERE entity_type = 'event' AND entity_id = ?
         AND operation = 'insert' AND status <> 'synced'
       LIMIT 1`,
      input.id,
    );

    const payload = JSON.stringify({
      id: input.id,
      name: input.name.trim(),
      venue: input.venue.trim(),
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      academic_reference_year: input.academicReferenceYear,
      status: input.status,
      expected_attendees: input.expectedAttendees,
    });

    if (pendingInsert) {
      await database.runAsync(
        `UPDATE sync_queue SET payload = ?, updated_at = ? WHERE id = ?`,
        payload,
        now,
        pendingInsert.id,
      );
    } else {
      await database.runAsync(
        `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, status,
          attempt_count, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'event', ?, 'update', ?, 'pending', 0, NULL, NULL, ?, ?)`,
        createUuid(),
        input.id,
        payload,
        now,
        now,
      );
    }
  });
}

/**
 * Toggles an event status ('active', 'draft', or 'completed') and updates sync queue.
 */
export async function toggleEventStatus(id: string, newStatus: EventStatus): Promise<void> {
  const database = await requireDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    await database.runAsync(
      `UPDATE local_events SET status = ?, updated_at = ? WHERE id = ?`,
      newStatus,
      now,
      id,
    );

    const currentEvent = await database.getFirstAsync<EventRow>(
      `SELECT * FROM local_events WHERE id = ?`,
      id,
    );

    if (!currentEvent) return;

    const pendingInsert = await database.getFirstAsync<QueueRow>(
      `SELECT id, operation FROM sync_queue
       WHERE entity_type = 'event' AND entity_id = ?
         AND operation = 'insert' AND status <> 'synced'
       LIMIT 1`,
      id,
    );

    const payload = JSON.stringify({
      id: currentEvent.id,
      name: currentEvent.name,
      venue: currentEvent.venue,
      starts_at: currentEvent.starts_at,
      academic_reference_year: currentEvent.academic_reference_year,
      status: newStatus,
      expected_attendees: currentEvent.expected_attendees,
    });

    if (pendingInsert) {
      await database.runAsync(
        `UPDATE sync_queue SET payload = ?, updated_at = ? WHERE id = ?`,
        payload,
        now,
        pendingInsert.id,
      );
    } else {
      await database.runAsync(
        `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, status,
          attempt_count, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'event', ?, 'update', ?, 'pending', 0, NULL, NULL, ?, ?)`,
        createUuid(),
        id,
        payload,
        now,
        now,
      );
    }
  });
}

export async function deleteEvent(id: string): Promise<boolean> {
  const database = await requireDatabase();
  const now = new Date().toISOString();
  let deleted = false;

  await database.withTransactionAsync(async () => {
    const pendingInsert = await database.getFirstAsync<QueueRow>(
      `SELECT id, operation FROM sync_queue
       WHERE entity_type = 'event' AND entity_id = ?
         AND operation = 'insert' AND status <> 'synced'
       LIMIT 1`,
      id,
    );

    await database.runAsync(
      `DELETE FROM sync_queue WHERE entity_type = 'event' AND entity_id = ? AND status <> 'synced'`,
      id,
    );
    await database.runAsync(`DELETE FROM local_attendance_records WHERE event_id = ?`, id);
    await database.runAsync(`DELETE FROM local_events WHERE id = ?`, id);

    if (!pendingInsert) {
      await database.runAsync(
        `INSERT INTO sync_queue (
          id, entity_type, entity_id, operation, payload, status,
          attempt_count, next_attempt_at, last_error_code, created_at, updated_at
        ) VALUES (?, 'event', ?, 'delete', ?, 'pending', 0, NULL, NULL, ?, ?)`,
        createUuid(),
        id,
        JSON.stringify({ id }),
        now,
        now,
      );
    }
    deleted = true;
  });

  return deleted;
}

/** Returns the total number of attendance records awaiting sync for a specific event. */
export async function getPendingSyncCountForEvent(eventId: string): Promise<number> {
  const database = await requireDatabase();
  const row = await database.getFirstAsync<CountRow>(
    "SELECT COUNT(*) AS count FROM local_attendance_records WHERE event_id = ? AND sync_status = 'pending'",
    eventId,
  );
  return row?.count ?? 0;
}

/** Returns the total number of attendance records awaiting sync across all events. */
export async function getPendingSyncCount(): Promise<number> {
  const database = await requireDatabase();
  const row = await database.getFirstAsync<CountRow>(
    "SELECT COUNT(*) AS count FROM local_attendance_records WHERE sync_status = 'pending'",
  );
  return row?.count ?? 0;
}

/** Returns the number of attendance records captured today for a specific event. */
export async function getTodayAttendanceCountForEvent(eventId: string): Promise<number> {
  const database = await requireDatabase();
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);

  const row = await database.getFirstAsync<CountRow>(
    `SELECT COUNT(*) AS count FROM local_attendance_records
     WHERE event_id = ? AND recorded_at >= ? AND recorded_at < ?`,
    eventId,
    startOfToday.toISOString(),
    endOfToday.toISOString(),
  );
  return row?.count ?? 0;
}

export type RemoteEventInput = {
  id: string;
  name: string;
  venue: string;
  starts_at: string;
  ends_at: string | null;
  academic_reference_year: number;
  status: EventStatus;
  expected_attendees: number;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type RemoteAttendanceInput = {
  client_record_id: string;
  event_id: string;
  participant_reference: string;
  participant_name: string | null;
  participant_program: string | null;
  qr_format?: 'opaque' | 'school_id';
  year_level: number | null;
  method: 'qr' | 'manual';
  recorded_at: string;
};

/** Upserts remote events from Supabase into local SQLite database. */
export async function upsertRemoteEventsLocal(remoteEvents: RemoteEventInput[]): Promise<void> {
  if (remoteEvents.length === 0) return;
  const database = await requireDatabase();
  const now = new Date().toISOString();

  await database.withTransactionAsync(async () => {
    const pendingRows = await database.getAllAsync<{ entity_id: string }>(
      "SELECT entity_id FROM sync_queue WHERE entity_type = 'event' AND status <> 'synced'",
    );
    const pendingIds = new Set(pendingRows.map((r) => r.entity_id));

    for (const event of remoteEvents) {
      if (pendingIds.has(event.id)) {
        continue;
      }
      const createdAt = event.created_at ?? now;
      const updatedAt = event.updated_at ?? now;
      await database.runAsync(
        `INSERT INTO local_events (
          id, name, venue, starts_at, ends_at, academic_reference_year, status,
          expected_attendees, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          venue = excluded.venue,
          starts_at = excluded.starts_at,
          ends_at = excluded.ends_at,
          academic_reference_year = excluded.academic_reference_year,
          status = excluded.status,
          expected_attendees = excluded.expected_attendees,
          created_by = excluded.created_by,
          updated_at = excluded.updated_at`,
        event.id,
        event.name.trim(),
        event.venue.trim(),
        event.starts_at,
        event.ends_at,
        event.academic_reference_year,
        event.status,
        event.expected_attendees,
        event.created_by ?? null,
        createdAt,
        updatedAt,
      );
    }
  });
}

/** Upserts remote attendance records from Supabase into local SQLite database. */
export async function upsertRemoteAttendanceLocal(
  remoteAttendance: RemoteAttendanceInput[],
): Promise<void> {
  if (remoteAttendance.length === 0) return;
  const database = await requireDatabase();

  await database.withTransactionAsync(async () => {
    const pendingRows = await database.getAllAsync<{ entity_id: string }>(
      "SELECT entity_id FROM sync_queue WHERE entity_type = 'attendance_record' AND status <> 'synced'",
    );
    const pendingIds = new Set(pendingRows.map((r) => r.entity_id));

    for (const rec of remoteAttendance) {
      if (pendingIds.has(rec.client_record_id)) {
        continue;
      }
      await database.runAsync(
        `INSERT INTO local_attendance_records (
          id, event_id, participant_reference, participant_name, participant_program,
          qr_format, year_level, method, recorded_at, sync_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'synced')
        ON CONFLICT(id) DO UPDATE SET
          participant_reference = excluded.participant_reference,
          participant_name = excluded.participant_name,
          participant_program = excluded.participant_program,
          qr_format = excluded.qr_format,
          year_level = excluded.year_level,
          method = excluded.method,
          recorded_at = excluded.recorded_at,
          sync_status = 'synced'`,
        rec.client_record_id,
        rec.event_id,
        rec.participant_reference,
        rec.participant_name ?? null,
        rec.participant_program ?? null,
        rec.qr_format ?? 'opaque',
        rec.year_level,
        rec.method,
        rec.recorded_at,
      );
    }
  });
}

