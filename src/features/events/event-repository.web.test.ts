import { beforeEach, describe, expect, it } from 'vitest';

import {
  createEvent,
  deleteAttendanceRecord,
  getDashboardStats,
  getTodayAttendanceCountForEvent,
  listEvents,
  listAttendanceHistory,
  recordQrAttendance,
  updateAttendanceRecord,
  updateEvent,
} from './event-repository.web';

const EVENTS_KEY = 'attendance-manager.events';
const ATTENDANCE_KEY = 'attendance-manager.attendance';

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

describe('web attendance history mutations', () => {
  beforeEach(() => {
    const localStorage = new MemoryStorage();
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { localStorage },
    });
    localStorage.setItem(
      EVENTS_KEY,
      JSON.stringify([
        {
          id: 'event-1',
          name: 'Sample Event',
          venue: 'Hall',
          startsAt: '2026-08-15T00:00:00.000Z',
          status: 'active',
          expectedAttendees: 10,
          attendeeCount: 0,
          createdAt: '2026-08-15T00:00:00.000Z',
          updatedAt: '2026-08-15T00:00:00.000Z',
        },
      ]),
    );
    localStorage.setItem(
      ATTENDANCE_KEY,
      JSON.stringify([
        {
          id: 'record-1',
          eventId: 'event-1',
          participantReference: '2024000000',
          participantName: 'SAMPLE STUDENT',
          participantProgram: 'BSCpE',
          qrFormat: 'school_id',
          yearLevel: 1,
          method: 'qr',
          recordedAt: '2026-08-15T01:00:00.000Z',
          syncStatus: 'pending',
        },
      ]),
    );
  });

  it('updates editable attendance fields and year statistics', async () => {
    await expect(
      updateAttendanceRecord('record-1', {
        participantReference: '2024000001',
        participantName: 'UPDATED STUDENT',
        participantProgram: 'BSIT',
        yearLevel: 2,
      }),
    ).resolves.toEqual({ status: 'updated' });

    const [record] = await listAttendanceHistory();
    expect(record).toMatchObject({
      participantReference: '2024000001',
      participantName: 'UPDATED STUDENT',
      participantProgram: 'BSIT',
      yearLevel: 2,
    });
    await expect(getDashboardStats()).resolves.toMatchObject({
      totalAttendees: 1,
      yearLevelCounts: { 1: 0, 2: 1, 3: 0, 4: 0 },
    });
  });

  it('backfills the academic reference year for legacy browser events', async () => {
    const [event] = await listEvents();
    expect(event.academicReferenceYear).toBe(2026);
  });

  it('persists the academic reference year when creating and editing an event', async () => {
    const created = await createEvent({
      name: 'Cohort Test Event',
      venue: 'Sample Hall',
      startsAt: '2027-08-15T00:00:00.000Z',
      endsAt: '2027-08-15T04:00:00.000Z',
      academicReferenceYear: 2027,
      status: 'draft',
      expectedAttendees: 20,
    });
    expect(created.academicReferenceYear).toBe(2027);

    await updateEvent({
      id: created.id,
      name: created.name,
      venue: created.venue,
      startsAt: created.startsAt,
      endsAt: created.endsAt,
      academicReferenceYear: 2028,
      status: created.status,
      expectedAttendees: created.expectedAttendees,
    });

    const updated = (await listEvents()).find((event) => event.id === created.id);
    expect(updated?.academicReferenceYear).toBe(2028);
  });

  it('deletes attendance and removes it from statistics', async () => {
    await expect(deleteAttendanceRecord('record-1')).resolves.toBe(true);
    await expect(listAttendanceHistory()).resolves.toEqual([]);
    await expect(getDashboardStats()).resolves.toMatchObject({ totalAttendees: 0 });
  });

  it('counts only today attendance for the selected event', async () => {
    const before = await getTodayAttendanceCountForEvent('event-1');

    await expect(
      recordQrAttendance(
        'event-1',
        {
          participantReference: '2024000099',
          claimedName: 'TODAY STUDENT',
          claimedProgram: 'BSCpE',
          qrFormat: 'school_id',
        },
        2,
      ),
    ).resolves.toMatchObject({ status: 'recorded' });

    const after = await getTodayAttendanceCountForEvent('event-1');
    expect(after).toBe(before + 1);
  });
});
