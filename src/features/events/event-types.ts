export type EventStatus = 'draft' | 'active' | 'completed';
export type YearLevel = 1 | 2 | 3 | 4;
export type YearLevelCounts = Record<YearLevel, number>;

export type LocalEvent = {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  academicReferenceYear: number;
  status: EventStatus;
  expectedAttendees: number;
  attendeeCount: number;
  yearLevelCounts: YearLevelCounts;
  unknownYearCount: number;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateEventInput = {
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  academicReferenceYear: number;
  status: EventStatus;
  expectedAttendees: number;
  createdBy?: string;
};

export type UpdateEventInput = {
  id: string;
  name: string;
  venue: string;
  startsAt: string;
  endsAt: string;
  academicReferenceYear: number;
  status: EventStatus;
  expectedAttendees: number;
  createdBy?: string;
};

export type DashboardStats = {
  totalAttendees: number;
  todayAttendees: number;
  totalEvents: number;
  activeEvents: number;
  pendingSync: number;
  yearLevelCounts: YearLevelCounts;
  unknownYearCount: number;
};

export type AttendanceQrFormat = 'opaque' | 'school_id';

export type AttendanceQrParticipant = {
  participantReference: string;
  claimedName: string | null;
  claimedProgram: string | null;
  qrFormat: AttendanceQrFormat;
};

export type AttendanceHistoryItem = {
  id: string;
  eventId: string;
  eventName: string;
  participantReference: string;
  participantName: string | null;
  participantProgram: string | null;
  qrFormat: AttendanceQrFormat;
  yearLevel: YearLevel | null;
  method: 'qr' | 'manual';
  recordedAt: string;
  syncStatus: 'pending' | 'synced';
};

export type AttendanceCaptureResult =
  | { status: 'recorded'; recordId: string }
  | { status: 'duplicate' };

export type UpdateAttendanceInput = {
  participantReference: string;
  participantName: string | null;
  participantProgram: string | null;
  yearLevel: YearLevel;
};

export type UpdateAttendanceResult = { status: 'updated' } | { status: 'duplicate' };

export function isEventCreatedByUser(
  createdBy: string | null | undefined,
  user?: { id?: string | null; email?: string | null } | null,
  localUser?: { id?: string | null; email?: string | null } | null,
): boolean {
  if (!createdBy) return false;
  const cb = createdBy.trim().toLowerCase();
  if (user?.id && cb === user.id.trim().toLowerCase()) return true;
  if (user?.email && cb === user.email.trim().toLowerCase()) return true;
  if (localUser?.id && cb === localUser.id.trim().toLowerCase()) return true;
  if (localUser?.email && cb === localUser.email.trim().toLowerCase()) return true;
  return false;
}
