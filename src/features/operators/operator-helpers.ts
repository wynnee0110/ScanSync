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
        isRevoked: true,
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

export const INITIAL_OPERATORS: OperatorItem[] = [];

export type OperatorActivityLog = {
  id: string;
  participantName: string;
  studentId: string;
  eventName: string;
  timestamp: string;
  method: 'qr' | 'manual';
};

export const MOCK_OPERATOR_LOGS: Record<string, OperatorActivityLog[]> = {};
