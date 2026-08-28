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
import { countYearLevels, createEmptyYearLevelCounts, isYearLevel } from '@/features/attendance/year-level';
import { createUuid } from '@/lib/uuid';

const EVENTS_KEY = 'attendance-manager.events';
const ATTENDANCE_KEY = 'attendance-manager.attendance';

type WebAttendanceRecord = Omit<AttendanceHistoryItem, 'eventName'>;

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }
  try {
    const value = window.localStorage.getItem(key);
    return value ? (JSON.parse(value) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  window.localStorage.setItem(key, JSON.stringify(value));
}

function getLegacyAcademicReferenceYear(event: LocalEvent): number {
  if (Number.isInteger(event.academicReferenceYear)) {
    return event.academicReferenceYear;
  }

  const startYear = new Date(event.startsAt).getFullYear();
  return Number.isInteger(startYear) ? startYear : new Date().getFullYear();
}

export async function listEvents(): Promise<LocalEvent[]> {
  const events = readJson<LocalEvent[]>(EVENTS_KEY, []);
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  return events
    .map((event) => {
      const eventAttendance = attendance.filter((record) => record.eventId === event.id);
      const yearStats = countYearLevels(eventAttendance.map((record) => record.yearLevel));
      const fallbackEndsAt = new Date(
        new Date(event.startsAt).getTime() + 4 * 60 * 60 * 1000,
      ).toISOString();

      return {
        ...event,
        endsAt: event.endsAt ?? fallbackEndsAt,
        academicReferenceYear: getLegacyAcademicReferenceYear(event),
        attendeeCount: eventAttendance.length,
        yearLevelCounts: yearStats.counts,
        unknownYearCount: yearStats.unknown,
      };
    })
    .sort((a, b) => b.startsAt.localeCompare(a.startsAt));
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
  const events = await listEvents();
  const now = new Date().toISOString();
  const event: LocalEvent = {
    id: createUuid(),
    ...input,
    name: input.name.trim(),
    venue: input.venue.trim(),
    attendeeCount: 0,
    yearLevelCounts: createEmptyYearLevelCounts(),
    unknownYearCount: 0,
    createdAt: now,
    updatedAt: now,
  };
  writeJson(EVENTS_KEY, [event, ...events]);
  return event;
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const events = await listEvents();
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const today = new Date().toDateString();
  const yearStats = countYearLevels(attendance.map((record) => record.yearLevel));
  return {
    totalAttendees: attendance.length,
    todayAttendees: attendance.filter(
      (record) => new Date(record.recordedAt).toDateString() === today,
    ).length,
    totalEvents: events.length,
    activeEvents: events.filter((event) => event.status === 'active').length,
    pendingSync:
      attendance.filter((record) => record.syncStatus === 'pending').length + events.length,
    yearLevelCounts: yearStats.counts,
    unknownYearCount: yearStats.unknown,
  };
}

export async function recordQrAttendance(
  eventId: string,
  participant: AttendanceQrParticipant,
  yearLevel: YearLevel | null,
  method: 'qr' | 'manual' = 'qr',
): Promise<AttendanceCaptureResult> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  if (
    attendance.some(
      (record) =>
        record.eventId === eventId &&
        record.participantReference === participant.participantReference,
    )
  ) {
    return { status: 'duplicate' };
  }

  const recordId = createUuid();
  attendance.unshift({
    id: recordId,
    eventId,
    participantReference: participant.participantReference,
    participantName: participant.claimedName,
    participantProgram: participant.claimedProgram,
    qrFormat: participant.qrFormat,
    yearLevel,
    method,
    recordedAt: new Date().toISOString(),
    syncStatus: 'pending',
  });
  writeJson(ATTENDANCE_KEY, attendance);
  return { status: 'recorded', recordId };
}

export async function listAttendanceHistory(
  limit = 50,
  eventId?: string,
): Promise<AttendanceHistoryItem[]> {
  const events = await listEvents();
  const eventNames = new Map(events.map((event) => [event.id, event.name]));
  return readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, [])
    .filter((record) => !eventId || record.eventId === eventId)
    .slice(0, limit)
    .map((record) => ({
      ...record,
      participantName: record.participantName ?? null,
      participantProgram: record.participantProgram ?? null,
      qrFormat: record.qrFormat ?? 'opaque',
      yearLevel: record.yearLevel ?? null,
      eventName: eventNames.get(record.eventId) ?? 'Unknown event',
    }));
}

export async function updateAttendanceRecord(
  recordId: string,
  input: UpdateAttendanceInput,
): Promise<UpdateAttendanceResult> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const recordIndex = attendance.findIndex((record) => record.id === recordId);
  if (recordIndex < 0) {
    throw new Error('Attendance record no longer exists.');
  }

  const current = attendance[recordIndex];
  if (
    attendance.some(
      (record) =>
        record.id !== recordId &&
        record.eventId === current.eventId &&
        record.participantReference === input.participantReference,
    )
  ) {
    return { status: 'duplicate' };
  }

  attendance[recordIndex] = {
    ...current,
    participantReference: input.participantReference,
    participantName: input.participantName,
    participantProgram: input.participantProgram,
    yearLevel: input.yearLevel,
    syncStatus: 'pending',
  };
  writeJson(ATTENDANCE_KEY, attendance);
  return { status: 'updated' };
}

export async function deleteAttendanceRecord(recordId: string): Promise<boolean> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const nextAttendance = attendance.filter((record) => record.id !== recordId);
  if (nextAttendance.length === attendance.length) {
    return false;
  }
  writeJson(ATTENDANCE_KEY, nextAttendance);
  return true;
}

export async function updateEvent(input: UpdateEventInput): Promise<void> {
  const events = readJson<LocalEvent[]>(EVENTS_KEY, []);
  const index = events.findIndex((e) => e.id === input.id);
  if (index < 0) return;
  const now = new Date().toISOString();
  events[index] = {
    ...events[index],
    name: input.name.trim(),
    venue: input.venue.trim(),
    startsAt: input.startsAt,
    academicReferenceYear: input.academicReferenceYear,
    status: input.status,
    expectedAttendees: input.expectedAttendees,
    updatedAt: now,
  };
  writeJson(EVENTS_KEY, events);
}

export async function toggleEventStatus(id: string, newStatus: EventStatus): Promise<void> {
  const events = readJson<LocalEvent[]>(EVENTS_KEY, []);
  const index = events.findIndex((e) => e.id === id);
  if (index < 0) return;
  events[index] = {
    ...events[index],
    status: newStatus,
    updatedAt: new Date().toISOString(),
  };
  writeJson(EVENTS_KEY, events);
}

export async function deleteEvent(id: string): Promise<boolean> {
  const events = readJson<LocalEvent[]>(EVENTS_KEY, []);
  const filteredEvents = events.filter((e) => e.id !== id);
  if (filteredEvents.length === events.length) return false;
  writeJson(EVENTS_KEY, filteredEvents);

  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const filteredAttendance = attendance.filter((a) => a.eventId !== id);
  writeJson(ATTENDANCE_KEY, filteredAttendance);

  return true;
}

export async function getPendingSyncCountForEvent(eventId: string): Promise<number> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  return attendance.filter(
    (a) => a.eventId === eventId && a.syncStatus === 'pending',
  ).length;
}

export async function getPendingSyncCount(): Promise<number> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  return attendance.filter((a) => a.syncStatus === 'pending').length;
}

export async function getTodayAttendanceCountForEvent(eventId: string): Promise<number> {
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(startOfToday);
  endOfToday.setDate(endOfToday.getDate() + 1);
  return attendance.filter(
    (a) =>
      a.eventId === eventId &&
      new Date(a.recordedAt) >= startOfToday &&
      new Date(a.recordedAt) < endOfToday,
  ).length;
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

export async function upsertRemoteEventsLocal(remoteEvents: RemoteEventInput[]): Promise<void> {
  if (remoteEvents.length === 0) return;
  const events = readJson<LocalEvent[]>(EVENTS_KEY, []);
  const now = new Date().toISOString();
  const eventMap = new Map(events.map((e) => [e.id, e]));

  for (const remote of remoteEvents) {
    const existing = eventMap.get(remote.id);
    const fallbackEndsAt = new Date(
      new Date(remote.starts_at).getTime() + 4 * 60 * 60 * 1000,
    ).toISOString();

    const merged: LocalEvent = {
      id: remote.id,
      name: remote.name.trim(),
      venue: remote.venue.trim(),
      startsAt: remote.starts_at,
      endsAt: remote.ends_at ?? fallbackEndsAt,
      academicReferenceYear: remote.academic_reference_year,
      status: remote.status,
      expectedAttendees: remote.expected_attendees,
      attendeeCount: existing?.attendeeCount ?? 0,
      yearLevelCounts: existing?.yearLevelCounts ?? createEmptyYearLevelCounts(),
      unknownYearCount: existing?.unknownYearCount ?? 0,
      createdBy: remote.created_by ?? existing?.createdBy,
      createdAt: remote.created_at ?? existing?.createdAt ?? now,
      updatedAt: remote.updated_at ?? now,
    };
    eventMap.set(remote.id, merged);
  }

  writeJson(EVENTS_KEY, Array.from(eventMap.values()));
}

export async function upsertRemoteAttendanceLocal(
  remoteAttendance: RemoteAttendanceInput[],
): Promise<void> {
  if (remoteAttendance.length === 0) return;
  const attendance = readJson<WebAttendanceRecord[]>(ATTENDANCE_KEY, []);
  const attMap = new Map(attendance.map((a) => [a.id, a]));

  for (const remote of remoteAttendance) {
    const yearLevel: YearLevel | null = isYearLevel(remote.year_level) ? remote.year_level : null;
    attMap.set(remote.client_record_id, {
      id: remote.client_record_id,
      eventId: remote.event_id,
      participantReference: remote.participant_reference,
      participantName: remote.participant_name ?? null,
      participantProgram: remote.participant_program ?? null,
      qrFormat: remote.qr_format ?? 'opaque',
      yearLevel,
      method: remote.method,
      recordedAt: remote.recorded_at,
      syncStatus: 'synced',
    });
  }

  writeJson(ATTENDANCE_KEY, Array.from(attMap.values()));
}

