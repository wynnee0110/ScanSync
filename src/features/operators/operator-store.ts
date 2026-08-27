/**
 * Module-level in-memory operator store.
 *
 * Operators created during a session survive tab navigation because this
 * module is evaluated once and its state lives at the module scope. The list
 * resets on a full app reload, which is acceptable until Supabase persistence
 * is wired up.
 */

import Constants from 'expo-constants';

import type { OperatorItem } from '@/features/operators/operator-types';
import { getPreference, setPreference } from '@/lib/preferences';
import { isSupabaseConfigured, supabase } from '@/lib/supabase';

export const OPERATORS_STORE_KEY = 'attendance_manager.operators_list';
const PENDING_OPERATOR_IDS_KEY = 'attendance_manager.pending_operator_ids';

// Module-scope mutable list — intentionally not React state.
let _operators: OperatorItem[] = [];

/** Subscribers notified whenever the list changes. */
const _listeners = new Set<() => void>();

function _notify() {
  _listeners.forEach((fn) => fn());
}

/** Loads operators persisted on the device (survives app restarts and page reloads). */
export async function loadStoredOperators(): Promise<OperatorItem[]> {
  try {
    const raw = await getPreference(OPERATORS_STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as OperatorItem[];
      if (Array.isArray(parsed)) {
        _operators = parsed;
        _notify();
        return _operators;
      }
    }
  } catch {
    // Keep the in-memory snapshot when local storage is unavailable.
  }
  return _operators;
}

/** Saves operators to local device storage. */
export async function persistStoredOperators(): Promise<void> {
  try {
    await setPreference(OPERATORS_STORE_KEY, JSON.stringify(_operators));
  } catch {
    // Non-fatal storage write notice
  }
}

// Auto-trigger storage load on module boot
void loadStoredOperators();

/** Resolves backend URL dynamically for local host, LAN, or production API. */
export function getBackendUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_URL;
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }
  const hostUri =
    Constants.expoConfig?.hostUri ||
    (Constants as unknown as { manifest?: { debuggerHost?: string } })?.manifest?.debuggerHost;
  if (typeof hostUri === 'string' && hostUri.length > 0) {
    const hostIp = hostUri.split(':')[0];
    if (hostIp && hostIp !== 'localhost' && hostIp !== '127.0.0.1') {
      return `http://${hostIp}:8000`;
    }
  }
  return envUrl || 'http://localhost:8000';
}

async function getBackendAuthorizationHeaders(): Promise<Record<string, string>> {
  if (!supabase) return {};
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {};
}


/** Returns a snapshot of the current operator list. */
export function getOperators(): OperatorItem[] {
  return _operators;
}

/** Prepends a new operator and notifies subscribers. */
export function addOperator(op: OperatorItem): void {
  _operators = [op, ..._operators];
  _notify();
  void persistStoredOperators();
  void markOperatorPending(op.id);
}

/** Updates an existing operator by ID and notifies subscribers. */
export function updateOperator(id: string, updates: Partial<OperatorItem>): void {
  _operators = _operators.map((op) => (op.id === id ? { ...op, ...updates } : op));
  _notify();
  void persistStoredOperators();
  void markOperatorPending(id);
}

/** Removes an operator by ID and notifies subscribers. */
export function removeOperator(id: string): void {
  _operators = _operators.filter((op) => op.id !== id);
  _notify();
  void persistStoredOperators();
  void removePendingOperator(id);
}

async function getPendingOperatorIds(): Promise<Set<string>> {
  try {
    const raw = await getPreference(PENDING_OPERATOR_IDS_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set();
  }
}

async function setPendingOperatorIds(ids: Set<string>): Promise<void> {
  await setPreference(PENDING_OPERATOR_IDS_KEY, JSON.stringify([...ids]));
}

async function markOperatorPending(id: string): Promise<void> {
  const pendingIds = await getPendingOperatorIds();
  pendingIds.add(id);
  await setPendingOperatorIds(pendingIds);
}

async function removePendingOperator(id: string): Promise<void> {
  const pendingIds = await getPendingOperatorIds();
  pendingIds.delete(id);
  await setPendingOperatorIds(pendingIds);
}

/** Syncs profiles and role assignments from Supabase into local store via server-side backend or direct client. */
export async function syncOperatorsFromSupabase(): Promise<void> {
  await loadStoredOperators();
  const pendingIds = await getPendingOperatorIds();
  const backendUrl = getBackendUrl();
  // 1. Try server backend API endpoint first
  try {
    const res = await fetch(`${backendUrl}/api/operators`, {
      headers: await getBackendAuthorizationHeaders(),
    });
    if (res.ok) {
      const data = (await res.json()) as OperatorItem[];
      if (Array.isArray(data)) {
        // The backend returns only Supabase Auth-backed users. Do not retain
        // stale device records once the authoritative request has succeeded.
        const pendingLocal = _operators.filter((operator) => pendingIds.has(operator.id));
        const remoteIds = new Set(data.map((operator) => operator.id));
        _operators = [...data, ...pendingLocal.filter((operator) => !remoteIds.has(operator.id))];
        _notify();
        void persistStoredOperators();
        return;
      }
    }
  } catch {
    // Fallback to client-side Supabase SDK below
  }

  // A public client cannot verify Auth users. Keeping a profile-only fallback
  // would reintroduce orphaned records into the dashboard.
}

/** Publishes only accounts explicitly created or edited on this device. */
export async function publishPendingOperators(): Promise<number> {
  const pendingIds = await getPendingOperatorIds();
  if (pendingIds.size === 0) return 0;

  let publishedCount = 0;
  for (const operator of _operators.filter((item) => pendingIds.has(item.id))) {
    const published = await saveOperatorToSupabase(operator);
    if (published) {
      pendingIds.delete(operator.id);
      publishedCount += 1;
    }
  }

  await setPendingOperatorIds(pendingIds);
  await syncOperatorsFromSupabase();
  return publishedCount;
}

/** Saves operator profile and role assignment to Supabase Cloud. */
export async function saveOperatorToSupabase(op: OperatorItem): Promise<boolean> {
  const backendUrl = getBackendUrl();
  // 1. Try server backend API endpoint first
  try {
    const res = await fetch(`${backendUrl}/api/operators`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await getBackendAuthorizationHeaders()) },
      body: JSON.stringify({
        id: op.id,
        name: op.name,
        email: op.email,
        role: op.role,
        password: op.generatedPasswordCode,
        assignedEventId: op.assignedEventId,
        assignedEventName: op.assignedEventName,
        generatedPasswordCode: op.generatedPasswordCode,
        createdBy: op.createdBy,
      }),
    });
    if (res.ok) {
      return true;
    }
  } catch {
    // Fallback to client-side Supabase SDK below
  }

  if (!isSupabaseConfigured || !supabase) return false;

  const defaultOrgId = '00000000-0000-0000-0000-000000000001';

  try {
    let authUserId = op.id;

    try {
      const { data: signUpData } = await supabase.auth.signUp({
        email: op.email,
        password: op.generatedPasswordCode,
        options: {
          data: { full_name: op.name, role: op.role },
        },
      });
      if (signUpData?.user?.id) {
        authUserId = signUpData.user.id;
      }
    } catch {
      // Non-fatal auth registration fallback
    }

    if (authUserId === op.id) {
      const { data: existingProf } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', op.email)
        .maybeSingle();
      if (existingProf?.id) {
        authUserId = existingProf.id as string;
      }
    }

    await supabase.from('profiles').upsert(
      {
        id: authUserId,
        full_name: op.name,
        email: op.email,
        access_code: op.generatedPasswordCode,
      },
      { onConflict: 'id' },
    );

    if (op.role === 'Superadmin' || op.role === 'Organizer') {
      const appRole = op.role === 'Superadmin' ? 'superadmin' : 'organizer';
      await supabase.from('memberships').upsert(
        {
          organization_id: defaultOrgId,
          user_id: authUserId,
          role: appRole,
        },
        { onConflict: 'organization_id,user_id' },
      );
    } else if (op.role === 'Volunteer' && op.assignedEventId) {
      await supabase.from('event_volunteers').upsert(
        {
          event_id: op.assignedEventId,
          user_id: authUserId,
          valid_until: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        },
        { onConflict: 'event_id,user_id' },
      );
    }

    return true;
  } catch (err) {
    console.warn('Operator Supabase cloud sync notice:', err);
    return false;
  }
}

/** Deletes operator profile and role assignments from Supabase Cloud. */
export async function deleteOperatorFromSupabase(id: string): Promise<void> {
  const backendUrl = getBackendUrl();
  // 1. Try server backend API endpoint first
  try {
    const res = await fetch(`${backendUrl}/api/operators/${id}`, {
      method: 'DELETE',
      headers: await getBackendAuthorizationHeaders(),
    });
    if (res.ok) {
      await syncOperatorsFromSupabase();
      return;
    }
  } catch {
    // Fallback to client-side Supabase SDK below
  }

  if (!isSupabaseConfigured || !supabase) return;

  try {
    const targetOp = _operators.find((op) => op.id === id);
    await supabase.from('event_volunteers').delete().eq('user_id', id);
    await supabase.from('memberships').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
    if (targetOp?.email) {
      await supabase.from('profiles').delete().eq('email', targetOp.email);
    }
    await syncOperatorsFromSupabase();
  } catch (err) {
    console.warn('Notice deleting operator from Supabase:', err);
  }
}


/**
 * Subscribes to store changes.
 * Returns an unsubscribe function — call it in a useEffect cleanup.
 */
export function subscribeOperators(listener: () => void): () => void {
  _listeners.add(listener);
  return () => {
    _listeners.delete(listener);
  };
}
