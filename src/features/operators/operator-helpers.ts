import { Palette } from '@/constants/palette';
import type { LocalEvent } from '@/features/events/event-types';
import type { AccessStatusInfo, OperatorItem, OperatorRole } from '@/features/operators/operator-types';

export function generateAccessCode(role: OperatorRole): string {
  const prefix = role === 'Superadmin' ? 'ADM' : role === 'Organizer' ? 'ORG' : 'VOL';
  const randomDigits = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${randomDigits}`;
}

export function getOperatorAccessStatus(
  op: OperatorItem,
  events: LocalEvent[],
): AccessStatusInfo {
  if (op.role === 'Superadmin' || op.role === 'Organizer') {
    return {
      label: 'ACTIVE',
      isRevoked: false,
      color: Palette.successText,
      bgColor: Palette.successSoft,
    };
  }

  if (!op.assignedEventId) {
    return {
      label: 'UNASSIGNED',
      isRevoked: true,
      color: Palette.textSecondary,
      bgColor: Palette.borderLight,
    };
  }

  // Check if event is ended/completed
  if (op.assignedEventId === 'mock-evt-completed') {
    return {
      label: 'EXPIRED (Event Ended)',
      isRevoked: true,
      color: Palette.danger,
      bgColor: '#FEE2E2',
    };
  }

  const assignedEvent = events.find((e) => e.id === op.assignedEventId);
  if (assignedEvent?.status === 'completed') {
    return {
      label: 'EXPIRED (Event Ended)',
      isRevoked: true,
      color: Palette.danger,
      bgColor: '#FEE2E2',
    };
  }

  // For Volunteers, strictly enforce event start to end time window
  if (op.role === 'Volunteer' && assignedEvent) {
    const now = Date.now();
    const startTime = new Date(assignedEvent.startsAt).getTime();
    const endTime = new Date(assignedEvent.endsAt).getTime();

    if (!isNaN(startTime) && now < startTime) {
      return {
        label: 'SCHEDULED (Not Started)',
        isRevoked: false,
        color: '#D97706',
        bgColor: '#FEF3C7',
      };
    }

    if (!isNaN(endTime) && now > endTime) {
      return {
        label: 'EXPIRED (Event Ended)',
        isRevoked: true,
        color: Palette.danger,
        bgColor: '#FEE2E2',
      };
    }
  }

  return {
    label: 'ACTIVE',
    isRevoked: false,
    color: Palette.successText,
    bgColor: Palette.successSoft,
  };
}

export const DEFAULT_ROOT_ICPEP_OPERATOR: OperatorItem = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'Lead Superadmin',
  email: 'operator@icpep.se',
  role: 'Superadmin',
  generatedPasswordCode: '123456',
  scansCount: 0,
  assignedEventId: null,
  assignedEventName: 'All Events (Superadmin)',
  createdAt: '2026-08-01T00:00:00.000Z',
};

export const INITIAL_OPERATORS: OperatorItem[] = [DEFAULT_ROOT_ICPEP_OPERATOR];

/**
 * Checks whether the given email or user object represents an official ICpEP account.
 */
export function isIcpepAccount(
  emailOrUser?: string | { email?: string | null } | null,
): boolean {
  if (!emailOrUser) return false;
  const rawEmail = typeof emailOrUser === 'string' ? emailOrUser : emailOrUser.email;
  if (!rawEmail) return false;
  const clean = rawEmail.trim().toLowerCase();
  return (
    clean === 'operator@icpep.se' ||
    clean === 'icpepse@ustp.edu.ph' ||
    clean.endsWith('@icpep.se') ||
    clean.endsWith('@icpep.org') ||
    clean.includes('icpep')
  );
}

/**
 * Checks if the role or email qualifies as a Superadmin.
 */
export function isSuperadmin(
  role?: OperatorRole | null,
  emailOrUser?: string | { email?: string | null } | null,
): boolean {
  return role === 'Superadmin' || isIcpepAccount(emailOrUser);
}

/**
 * Determines whether the active operator has permission to delete the target operator.
 * The ICpEP account / Superadmin can delete any user (Volunteers, Organizers, and other Superadmins),
 * except their own active account.
 */
export function canDeleteOperator(
  currentUser: { id?: string | null; email?: string | null; role?: OperatorRole | null },
  targetOp: OperatorItem,
): { allowed: boolean; reason?: string } {
  const currentEmail = (currentUser.email || '').trim().toLowerCase();
  const targetEmail = (targetOp.email || '').trim().toLowerCase();
  const currentId = (currentUser.id || '').trim().toLowerCase();
  const targetId = (targetOp.id || '').trim().toLowerCase();

  // 1. Prevent self-deletion
  if (
    (currentId && targetId && currentId === targetId) ||
    (currentEmail && targetEmail && currentEmail === targetEmail)
  ) {
    return {
      allowed: false,
      reason: 'You cannot delete or revoke your own active account.',
    };
  }

  // 2. Protect the root ICpEP account from non-ICpEP users
  if (isIcpepAccount(targetOp.email) && !isIcpepAccount(currentUser.email)) {
    return {
      allowed: false,
      reason: 'The primary ICpEP Superadmin account is protected and cannot be deleted.',
    };
  }

  // 3. The ICpEP account or Superadmin can delete any user
  if (currentUser.role === 'Superadmin' || isIcpepAccount(currentUser.email)) {
    return { allowed: true };
  }

  // 4. Organizer can only delete volunteers
  if (currentUser.role === 'Organizer') {
    if (targetOp.role === 'Volunteer') {
      return { allowed: true };
    }
    return {
      allowed: false,
      reason: 'Organizers can only manage and delete Volunteers assigned to their events.',
    };
  }

  // 5. Default restricted
  return {
    allowed: false,
    reason: 'Action Restricted: You do not have permission to delete operators.',
  };
}

export type OperatorActivityLog = {
  id: string;
  participantName: string;
  studentId: string;
  eventName: string;
  timestamp: string;
  method: 'qr' | 'manual';
};

export const MOCK_OPERATOR_LOGS: Record<string, OperatorActivityLog[]> = {};
