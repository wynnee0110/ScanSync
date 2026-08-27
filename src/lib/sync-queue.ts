import { getLocalDatabase } from '@/lib/local-database';

export type SyncOperationKind = 'insert' | 'update' | 'delete';
export type SyncOperationStatus = 'pending' | 'syncing' | 'synced' | 'retry';

export type SyncOperation = {
  id: string;
  entityType: string;
  entityId: string;
  operation: SyncOperationKind;
  payload: Record<string, unknown>;
  status: SyncOperationStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  lastErrorCode: string | null;
  createdAt: string;
  updatedAt: string;
};

type SyncOperationRow = {
  id: string;
  entity_type: string;
  entity_id: string;
  operation: SyncOperationKind;
  payload: string;
  status: SyncOperationStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

export async function enqueueSyncOperation(
  operation: Omit<SyncOperation, 'status' | 'attemptCount' | 'nextAttemptAt' | 'lastErrorCode' | 'createdAt' | 'updatedAt'>,
): Promise<void> {
  const database = await getLocalDatabase();
  if (!database) {
    throw new Error('The offline sync queue is available only on Android and iOS.');
  }

  const now = new Date().toISOString();
  await database.runAsync(
    `INSERT INTO sync_queue (
      id, entity_type, entity_id, operation, payload, status,
      attempt_count, next_attempt_at, last_error_code, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'pending', 0, NULL, NULL, ?, ?)`,
    operation.id,
    operation.entityType,
    operation.entityId,
    operation.operation,
    JSON.stringify(operation.payload),
    now,
    now,
  );
}

export async function listReadySyncOperations(limit = 50, ignoreBackoff = false): Promise<SyncOperation[]> {
  const database = await getLocalDatabase();
  if (!database) {
    return [];
  }

  const now = new Date().toISOString();
  const rows = await database.getAllAsync<SyncOperationRow>(
    ignoreBackoff
      ? `SELECT * FROM sync_queue
         WHERE status IN ('pending', 'retry')
         ORDER BY created_at ASC
         LIMIT ?`
      : `SELECT * FROM sync_queue
         WHERE status IN ('pending', 'retry')
           AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY created_at ASC
         LIMIT ?`,
    ...(ignoreBackoff ? [limit] : [now, limit]),
  );

  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    operation: row.operation,
    payload: JSON.parse(row.payload) as Record<string, unknown>,
    status: row.status,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    lastErrorCode: row.last_error_code,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function markSyncOperationSynced(id: string): Promise<void> {
  const database = await getLocalDatabase();
  if (!database) return;

  const now = new Date().toISOString();
  await database.withTransactionAsync(async () => {
    const operation = await database.getFirstAsync<{ entity_type: string; entity_id: string }>(
      `SELECT entity_type, entity_id FROM sync_queue WHERE id = ?`,
      id,
    );

    await database.runAsync(
      `UPDATE sync_queue SET status = 'synced', updated_at = ? WHERE id = ?`,
      now,
      id,
    );

    if (operation && operation.entity_type === 'attendance_record') {
      await database.runAsync(
        `UPDATE local_attendance_records SET sync_status = 'synced' WHERE id = ?`,
        operation.entity_id,
      );
    }
  });
}

export async function markSyncOperationFailed(
  id: string,
  lastErrorCode: string,
  nextAttemptAt: string | null,
): Promise<void> {
  const database = await getLocalDatabase();
  if (!database) return;

  const now = new Date().toISOString();
  await database.runAsync(
    `UPDATE sync_queue
     SET status = 'retry',
         attempt_count = attempt_count + 1,
         last_error_code = ?,
         next_attempt_at = ?,
         updated_at = ?
     WHERE id = ?`,
    lastErrorCode,
    nextAttemptAt,
    now,
    id,
  );
}
