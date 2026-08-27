import { describe, expect, it } from 'vitest';

import type { LocalEvent } from '@/features/events/event-types';
import { getOperatorAccessStatus } from '@/features/operators/operator-helpers';
import type { OperatorItem } from '@/features/operators/operator-types';

describe('getOperatorAccessStatus time window testing', () => {
  const baseEvent: LocalEvent = {
    id: 'evt-100',
    name: 'Tech Symposium 2026',
    venue: 'Main Hall',
    startsAt: '2026-08-22T10:00:00.000Z',
    endsAt: '2026-08-22T18:00:00.000Z',
    academicReferenceYear: 2026,
    status: 'active',
    expectedAttendees: 100,
    attendeeCount: 10,
    yearLevelCounts: { 1: 5, 2: 3, 3: 2, 4: 0 },
    unknownYearCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };

  const volunteerOp: OperatorItem = {
    id: 'vol-1',
    name: 'Sample Volunteer',
    email: 'vol@icpep.org',
    role: 'Volunteer',
    assignedEventId: 'evt-100',
    assignedEventName: 'Tech Symposium 2026',
    generatedPasswordCode: 'VOL-9999',
    scansCount: 5,
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  it('returns ACTIVE for Superadmin regardless of events', () => {
    const admin: OperatorItem = {
      ...volunteerOp,
      role: 'Superadmin',
    };
    const status = getOperatorAccessStatus(admin, [baseEvent]);
    expect(status.label).toBe('ACTIVE');
    expect(status.isRevoked).toBe(false);
  });

  it('returns ACTIVE for Organizer regardless of assignedEventId being null', () => {
    const organizer: OperatorItem = {
      ...volunteerOp,
      role: 'Organizer',
      assignedEventId: null,
      assignedEventName: 'All Created Events',
    };
    const status = getOperatorAccessStatus(organizer, [baseEvent]);
    expect(status.label).toBe('ACTIVE');
    expect(status.isRevoked).toBe(false);
  });

  it('returns UNASSIGNED if no assignedEventId is present', () => {
    const unassigned: OperatorItem = {
      ...volunteerOp,
      assignedEventId: null,
    };
    const status = getOperatorAccessStatus(unassigned, [baseEvent]);
    expect(status.label).toBe('UNASSIGNED');
    expect(status.isRevoked).toBe(true);
  });

  it('returns EXPIRED (Event Ended) when event is completed', () => {
    const completedEvent: LocalEvent = {
      ...baseEvent,
      status: 'completed',
    };
    const status = getOperatorAccessStatus(volunteerOp, [completedEvent]);
    expect(status.label).toBe('EXPIRED (Event Ended)');
    expect(status.isRevoked).toBe(true);
  });
});
