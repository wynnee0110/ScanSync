import { describe, expect, it } from 'vitest';

import type { LocalEvent } from '@/features/events/event-types';
import {
  canDeleteOperator,
  getOperatorAccessStatus,
  isIcpepAccount,
  isSuperadmin,
} from '@/features/operators/operator-helpers';
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

describe('isIcpepAccount and isSuperadmin testing', () => {
  it('correctly identifies official ICpEP email accounts', () => {
    expect(isIcpepAccount('operator@icpep.se')).toBe(true);
    expect(isIcpepAccount('icpepse@ustp.edu.ph')).toBe(true);
    expect(isIcpepAccount('admin@icpep.org')).toBe(true);
    expect(isIcpepAccount('chapter-icpep@university.edu')).toBe(true);
    expect(isIcpepAccount({ email: 'operator@icpep.se' })).toBe(true);
    expect(isIcpepAccount('volunteer@gmail.com')).toBe(false);
    expect(isIcpepAccount('')).toBe(false);
    expect(isIcpepAccount(null)).toBe(false);
  });

  it('determines superadmin rights correctly', () => {
    expect(isSuperadmin('Superadmin', 'user@gmail.com')).toBe(true);
    expect(isSuperadmin('Organizer', 'operator@icpep.se')).toBe(true);
    expect(isSuperadmin('Organizer', 'icpepse@ustp.edu.ph')).toBe(true);
    expect(isSuperadmin('Volunteer', 'volunteer@gmail.com')).toBe(false);
    expect(isSuperadmin('Organizer', 'organizer@gmail.com')).toBe(false);
  });
});

describe('canDeleteOperator permission and safety rules', () => {
  const icpepSuperadmin = {
    id: 'admin-001',
    email: 'operator@icpep.se',
    role: 'Superadmin' as const,
  };

  const otherSuperadmin: OperatorItem = {
    id: 'admin-002',
    name: 'Secondary Admin',
    email: 'admin2@school.edu',
    role: 'Superadmin',
    assignedEventId: null,
    assignedEventName: 'All Events (Superadmin)',
    generatedPasswordCode: 'ADM-1234',
    scansCount: 0,
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  const organizerOp: OperatorItem = {
    id: 'org-001',
    name: 'Event Organizer',
    email: 'org@school.edu',
    role: 'Organizer',
    assignedEventId: null,
    assignedEventName: 'All Created Events',
    generatedPasswordCode: 'ORG-5678',
    scansCount: 12,
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  const volunteerOp: OperatorItem = {
    id: 'vol-001',
    name: 'Event Volunteer',
    email: 'vol@school.edu',
    role: 'Volunteer',
    assignedEventId: 'evt-100',
    assignedEventName: 'Tech Symposium 2026',
    generatedPasswordCode: 'VOL-9999',
    scansCount: 30,
    createdAt: '2026-08-01T00:00:00.000Z',
  };

  it('allows the ICpEP account to delete any user (Superadmin, Organizer, Volunteer)', () => {
    // ICpEP superadmin deleting another superadmin
    const delAdmin = canDeleteOperator(icpepSuperadmin, otherSuperadmin);
    expect(delAdmin.allowed).toBe(true);

    // ICpEP superadmin deleting an organizer
    const delOrg = canDeleteOperator(icpepSuperadmin, organizerOp);
    expect(delOrg.allowed).toBe(true);

    // ICpEP superadmin deleting a volunteer
    const delVol = canDeleteOperator(icpepSuperadmin, volunteerOp);
    expect(delVol.allowed).toBe(true);
  });

  it('prevents self-deletion for the active account', () => {
    const selfDeleteById = canDeleteOperator(icpepSuperadmin, {
      ...otherSuperadmin,
      id: 'admin-001',
    });
    expect(selfDeleteById.allowed).toBe(false);
    expect(selfDeleteById.reason).toContain('own active account');

    const selfDeleteByEmail = canDeleteOperator(icpepSuperadmin, {
      ...otherSuperadmin,
      email: 'OPERATOR@icpep.se',
    });
    expect(selfDeleteByEmail.allowed).toBe(false);
    expect(selfDeleteByEmail.reason).toContain('own active account');
  });

  it('prevents non-ICpEP users from deleting the root ICpEP system account', () => {
    const nonIcpepOrganizer = {
      id: 'org-001',
      email: 'org@gmail.com',
      role: 'Organizer' as const,
    };
    const targetIcpep: OperatorItem = {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Lead Superadmin',
      email: 'operator@icpep.se',
      role: 'Superadmin',
      assignedEventId: null,
      assignedEventName: 'All Events (Superadmin)',
      generatedPasswordCode: '123456',
      scansCount: 0,
      createdAt: '2026-08-01T00:00:00.000Z',
    };

    const res = canDeleteOperator(nonIcpepOrganizer, targetIcpep);
    expect(res.allowed).toBe(false);
    expect(res.reason).toContain('protected');
  });

  it('restricts organizers from deleting superadmins or organizers', () => {
    const organizerViewer = {
      id: 'org-001',
      email: 'org@school.edu',
      role: 'Organizer' as const,
    };

    const delAdmin = canDeleteOperator(organizerViewer, otherSuperadmin);
    expect(delAdmin.allowed).toBe(false);
    expect(delAdmin.reason).toContain('Organizers can only manage');

    const delAnotherOrg = canDeleteOperator(organizerViewer, {
      ...organizerOp,
      id: 'org-999',
      email: 'another@school.edu',
    });
    expect(delAnotherOrg.allowed).toBe(false);

    // Organizers CAN delete volunteers
    const delVol = canDeleteOperator(organizerViewer, volunteerOp);
    expect(delVol.allowed).toBe(true);
  });
});
