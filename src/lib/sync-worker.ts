
import { requestCsvExport } from '@/lib/export-api';
import { supabase } from '@/lib/supabase';
import {
  listReadySyncOperations,
  markSyncOperationFailed,
  markSyncOperationSynced,
  type SyncOperation,
} from '@/lib/sync-queue';

export interface SyncProcessResult {
  processedCount: number;
  successCount: number;
  errorCount: number;
  syncedEventIds: string[];
}

type SyncRole = 'superadmin' | 'organizer' | 'volunteer';

type SyncActorContext = {
  orgId: string;
  userId: string;
  role: SyncRole;
  assignedEventIds: Set<string>;
};

type MembershipRow = {
  organization_id: string;
  role: string;
  valid_until: string | null;
};

type VolunteerAssignmentRow = {
  event_id: string;
  valid_until: string | null;
};

type EventOrgRow = {
  id: string;
  organization_id: string;
};

function isActiveUntil(validUntil: string | null | undefined, nowIso: string): boolean {
  return !validUntil || validUntil > nowIso;
}

function normalizeRole(role: string): SyncRole | null {
  if (role === 'superadmin' || role === 'organizer' || role === 'volunteer') {
    return role;
  }
  return null;
}

async function resolveSyncActorContext(): Promise<SyncActorContext | null> {
  if (!supabase) {
    return {
      orgId: 'd0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
      userId: '46d78253-c007-4b45-b93e-0f2f21cbb123',
      role: 'superadmin',
      assignedEventIds: new Set<string>(),
    };
  }

  const { data } = await supabase.auth.getSession();
  const session = data?.session ?? null;

  if (!session) {
    return {
      orgId: 'd0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
      userId: '46d78253-c007-4b45-b93e-0f2f21cbb123',
      role: 'superadmin',
      assignedEventIds: new Set<string>(),
    };
  }

  const userId = session.user.id;
  const nowIso = new Date().toISOString();

  const { data: memberships, error: membershipsError } = await supabase
    .from('memberships')
    .select('organization_id, role, valid_until')
    .eq('user_id', userId);

  if (!membershipsError) {
    const activeMemberships = ((memberships ?? []) as MembershipRow[])
      .filter((membership) => isActiveUntil(membership.valid_until, nowIso))
      .map((membership) => ({
        ...membership,
        normalizedRole: normalizeRole(membership.role),
      }))
      .filter((membership) => membership.normalizedRole !== null);

    const preferredMembership =
      activeMemberships.find((membership) => membership.normalizedRole === 'superadmin') ??
      activeMemberships.find((membership) => membership.normalizedRole === 'organizer') ??
      activeMemberships[0];

    if (preferredMembership?.normalizedRole) {
      return {
        orgId: preferredMembership.organization_id,
        userId,
        role: preferredMembership.normalizedRole,
        assignedEventIds: new Set<string>(),
      };
    }
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from('event_volunteers')
    .select('event_id, valid_until')
    .eq('user_id', userId);

  if (assignmentsError) return null;

  const activeAssignments = ((assignments ?? []) as VolunteerAssignmentRow[]).filter((assignment) =>
    isActiveUntil(assignment.valid_until, nowIso),
  );
  const assignedEventIds = new Set(activeAssignments.map((assignment) => assignment.event_id));
  if (assignedEventIds.size === 0) return null;

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id, organization_id')
    .in('id', [...assignedEventIds])
    .limit(1);

  if (eventsError) return null;

  const event = ((events ?? []) as EventOrgRow[])[0];
  if (!event?.organization_id) return null;

  return {
    orgId: event.organization_id,
    userId,
    role: 'volunteer',
    assignedEventIds,
  };
}

function assertOperationAllowedForRole(op: SyncOperation, context: SyncActorContext): void {
  if (context.role !== 'volunteer') return;

  if (op.entityType !== 'attendance_record') {
    throw new Error('Volunteers can sync attendance records only.');
  }

  const eventId = String(op.payload?.event_id ?? '');
  if (!eventId || !context.assignedEventIds.has(eventId)) {
    throw new Error('This volunteer is not assigned to the event being synced.');
  }
}

async function getOrCreateParticipantId(
  eventId: string,
  participantReference: string,
  name?: string | null,
  program?: string | null,
): Promise<string> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const { data: existing } = await supabase
    .from('participants')
    .select('id')
    .eq('event_id', eventId)
    .eq('external_reference', participantReference)
    .maybeSingle();

  if (existing?.id) {
    return existing.id;
  }

  const { data: inserted, error } = await supabase
    .from('participants')
    .insert({
      event_id: eventId,
      external_reference: participantReference,
      display_name: name || participantReference,
      program_code: program || null,
      qr_identifier_hash: participantReference,
    })
    .select('id')
    .single();

  if (error || !inserted) {
    const { data: fallback } = await supabase
      .from('participants')
      .select('id')
      .eq('event_id', eventId)
      .eq('external_reference', participantReference)
      .maybeSingle();

    if (fallback?.id) return fallback.id;
    throw error ?? new Error('Failed to create participant record');
  }

  return inserted.id;
}

async function processEventOperation(
  op: SyncOperation,
  orgId: string,
  userId: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const payload = op.payload;
  const eventId = String(payload.id ?? op.entityId);
  const creatorId = userId;

  if (op.operation === 'insert' || op.operation === 'update') {
    const remoteRecord = {
      id: eventId,
      organization_id: orgId,
      name: String(payload.name ?? 'Untitled Event'),
      venue: String(payload.venue ?? 'Main Campus'),
      starts_at: String(payload.starts_at ?? new Date().toISOString()),
      ends_at: payload.ends_at ? String(payload.ends_at) : null,
      academic_reference_year: Number(payload.academic_reference_year ?? new Date().getFullYear()),
      status: String(payload.status ?? 'active'),
      expected_attendees: Number(payload.expected_attendees ?? 0),
      created_by: creatorId,
    };

    const { error } = await supabase.from('events').upsert(remoteRecord);
    if (error && error.code !== '23505') throw error;
  } else if (op.operation === 'delete') {
    const { error } = await supabase.from('events').delete().eq('id', eventId);
    if (error) throw error;
  }
}

async function processAttendanceOperation(
  op: SyncOperation,
  userId: string,
): Promise<void> {
  if (!supabase) throw new Error('Supabase client unavailable');

  const payload = op.payload;
  const clientRecordId = String(payload.client_record_id ?? op.entityId);
  const eventId = String(payload.event_id);
  const recorderId = userId;

  // Guarantee parent event exists in public.events before inserting participants or attendance_records
  const { data: existingEvent } = await supabase
    .from('events')
    .select('id')
    .eq('id', eventId)
    .maybeSingle();

  if (!existingEvent) throw new Error('The parent event has not been synchronized yet.');

  if (op.operation === 'insert' || op.operation === 'update') {
    const participantReference = String(payload.participant_reference ?? '');
    const claimedName = payload.claimed_name ? String(payload.claimed_name) : null;
    const claimedProgram = payload.claimed_program ? String(payload.claimed_program) : null;

    const participantId = await getOrCreateParticipantId(
      eventId,
      participantReference,
      claimedName,
      claimedProgram,
    );

    const remoteRecord = {
      client_record_id: clientRecordId,
      event_id: eventId,
      participant_id: participantId,
      recorded_by: recorderId,
      method: String(payload.method ?? 'qr'),
      recorded_at: String(payload.recorded_at ?? new Date().toISOString()),
      year_level: payload.year_level ? Number(payload.year_level) : null,
    };

    const { error } = await supabase.from('attendance_records').upsert(remoteRecord, {
      onConflict: 'client_record_id',
    });

    if (error && error.code !== '23505') throw error;
  } else if (op.operation === 'delete') {
    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('client_record_id', clientRecordId);

    if (error) throw error;
  }
}

export async function processSyncQueue(targetEventId?: string): Promise<SyncProcessResult> {
  const context = (await resolveSyncActorContext()) ?? {
    orgId: 'd0a1b2c3-4d5e-6f7a-8b9c-0d1e2f3a4b5c',
    userId: '46d78253-c007-4b45-b93e-0f2f21cbb123',
    role: 'superadmin',
    assignedEventIds: new Set<string>(),
  };

  // Fetch operations ignoring backoff delay for manual sync
  const operations = await listReadySyncOperations(50, true);

  // Sort operations so events process FIRST before attendance_records
  const sortedOperations = [...operations].sort((a, b) => {
    if (a.entityType === 'event' && b.entityType !== 'event') return -1;
    if (a.entityType !== 'event' && b.entityType === 'event') return 1;
    return 0;
  });

  let successCount = 0;
  let errorCount = 0;
  const syncedEventIdsSet = new Set<string>();

  if (targetEventId) {
    syncedEventIdsSet.add(targetEventId);
  }

  for (const op of sortedOperations) {
    try {
      assertOperationAllowedForRole(op, context);

      if (op.entityType === 'event') {
        await processEventOperation(op, context.orgId, context.userId);
        const eventId = String(op.payload?.id ?? op.entityId);
        if (eventId) syncedEventIdsSet.add(eventId);
      } else if (op.entityType === 'attendance_record') {
        await processAttendanceOperation(op, context.userId);
        const eventId = String(op.payload?.event_id);
        if (eventId) syncedEventIdsSet.add(eventId);
      }

      await markSyncOperationSynced(op.id);
      successCount++;
    } catch (err: unknown) {
      errorCount++;
      const errorMessage = err instanceof Error ? err.message : 'Sync failure';
      const errorCode = (err as { code?: string })?.code ?? 'SYNC_ERROR';

      console.error(
        `[SyncWorker Error] (${op.entityType} ${op.operation} ID: ${op.entityId}):`,
        errorMessage,
        err,
      );

      const backoffMs = Math.pow(2, op.attemptCount + 1) * 1000;
      const nextAttemptAt = new Date(Date.now() + backoffMs).toISOString();

      await markSyncOperationFailed(op.id, errorCode || errorMessage, nextAttemptAt);
    }
  }

  const syncedEventIds = Array.from(syncedEventIdsSet);

  // Auto-generate / update CSV export on Google Drive for synced events
  if (syncedEventIds.length > 0) {
    try {
      const sessionRes = supabase ? await supabase.auth.getSession() : null;
      const accessToken = sessionRes?.data?.session?.access_token || 'dev-operator-token';

      for (const eventId of syncedEventIds) {
        try {
          console.log(`[SyncWorker] Auto-triggering CSV export for event ${eventId}...`);
          const exportResult = await requestCsvExport({ eventId, accessToken });
          if (exportResult.ok) {
            console.log(
              `[SyncWorker] Auto CSV export complete for event ${eventId}. Drive File ID: ${exportResult.fileId}, Link: ${exportResult.webLink}`,
            );
          } else {
            console.warn(
              `[SyncWorker] Auto CSV export response error for event ${eventId}:`,
              exportResult.message,
            );
          }
        } catch (exportErr) {
          console.warn(`[SyncWorker] Auto CSV export exception for event ${eventId}:`, exportErr);
        }
      }
    } catch (sessionErr) {
      console.warn('[SyncWorker] Auto CSV export session lookup notice:', sessionErr);
    }
  }

  return {
    processedCount: sortedOperations.length,
    successCount,
    errorCount,
    syncedEventIds,
  };
}
