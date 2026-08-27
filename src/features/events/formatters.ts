import type { EventStatus } from '@/features/events/event-types';

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(value));
}

export function formatEventTimeRange(startsAt: string, endsAt?: string): string {
  const start = new Date(startsAt);
  if (isNaN(start.getTime())) return startsAt;

  const dateStr = new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(start);

  const startTimeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(start);

  if (!endsAt) return `${dateStr}, ${startTimeStr}`;

  const end = new Date(endsAt);
  if (isNaN(end.getTime())) return `${dateStr}, ${startTimeStr}`;

  const endTimeStr = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(end);

  return `${dateStr}, ${startTimeStr} – ${endTimeStr}`;
}

export function formatEventStatus(status: EventStatus): string {
  if (status === 'completed') return 'Ended';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

export function maskParticipantReference(reference: string): string {
  return reference.length <= 8 ? reference : `${reference.slice(0, 6)}...${reference.slice(-2)}`;
}
