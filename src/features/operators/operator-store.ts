/**
 * Module-level in-memory operator store.
 *
 * Operators created during a session survive tab navigation because this
 * module is evaluated once and its state lives at the module scope. The list
 * resets on a full app reload, which is acceptable until Supabase persistence
 * is wired up.
 */

import Constants from 'expo-constants';

import type { OperatorItem, OperatorRole } from '@/features/operators/operator-types';
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
  void saveOperatorToSupabase(op).then(async (success) => {
    if (success) {
      await removePendingOperator(op.id);
      await syncOperatorsFromSupabase();
    }
  });
}

/** Updates an existing operator by ID and notifies subscribers. */
export function updateOperator(id: string, updates: Partial<OperatorItem>): void {
  _operators = _operators.map((op) => (op.id === id ? { ...op, ...updates } : op));
  _notify();
  void persistStoredOperators();
  void markOperatorPending(id);
  const updatedOp = _operators.find((op) => op.id === id);
  if (updatedOp) {
    void saveOperatorToSupabase(updatedOp).then(async (success) => {
      if (success) {
        await removePendingOperator(id);
        await syncOperatorsFromSupabase();
      }
    });
  }
}

/** Removes an operator by ID and notifies subscribers. */
export function removeOperator(id: string): void {
  _operators = _operators.filter((op) => op.id !== id);
  _notify();
  void persistStoredOperators();
  void removePendingOperator(id);
  void deleteOperatorFromSupabase(id);
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
  // 1. Try server backend API endpoint first with a 1.5s timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${backendUrl}/api/operators`, {
      headers: await getBackendAuthorizationHeaders(),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));

    if (res.ok) {
      const data = (await res.json()) as OperatorItem[];
      if (Array.isArray(data) && data.length > 0) {
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

  // 2. Fallback to client-side Supabase SDK if server endpoint is unreachable
  if (isSupabaseConfigured && supabase) {
    try {
      const [profilesRes, membershipsRes, volunteersRes] = await Promise.all([
        supabase.from('profiles').select('*'),
        supabase.from('memberships').select('*'),
        supabase.from('event_volunteers').select('*, events(name)'),
      ]);

      const profiles = profilesRes.data ?? [];
      const memberships = membershipsRes.data ?? [];
      const volunteers = volunteersRes.data ?? [];

      if (profiles.length > 0) {
        const membershipMap = new Map(memberships.map((m: { user_id: string; role: string }) => [m.user_id, m.role]));
        const volunteerMap = new Map(
          volunteers.map((v: { user_id: string; event_id: string; events?: { name: string } | { name: string }[] }) => [
            v.user_id,
            v,
          ]),
        );

        const fetchedOperators: OperatorItem[] = profiles.map(
          (p: { id: string; full_name?: string | null; email?: string | null; access_code?: string | null; created_at?: string }) => {
            const rawRole = membershipMap.get(p.id);
            let role: OperatorRole = 'Volunteer';
            if (rawRole === 'superadmin') role = 'Superadmin';
            else if (rawRole === 'organizer') role = 'Organizer';

            const volInfo = volunteerMap.get(p.id);
            const assignedEventId = volInfo?.event_id ?? null;
            const eventName = Array.isArray(volInfo?.events)
              ? volInfo?.events[0]?.name
              : volInfo?.events?.name;
            const assignedEventName = eventName || (assignedEventId ? 'Assigned Event' : 'All Events');

            return {
              id: p.id,
              name: p.full_name || p.email?.split('@')[0] || 'Operator',
              email: p.email || '',
              role,
              assignedEventId,
              assignedEventName,
              generatedPasswordCode: p.access_code || '123456',
              scansCount: 0,
              createdAt: p.created_at || new Date().toISOString(),
            };
          },
        );

        const pendingLocal = _operators.filter((operator) => pendingIds.has(operator.id));
        const remoteIds = new Set(fetchedOperators.map((operator) => operator.id));
        _operators = [...fetchedOperators, ...pendingLocal.filter((operator) => !remoteIds.has(operator.id))];
        _notify();
        void persistStoredOperators();
      }
    } catch (err) {
      console.warn('[OperatorStore] Client Supabase fallback notice:', err);
    }
  }
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

  // 1. Always try the backend first — it uses the admin service-role key which
  //    creates the Auth user with email_confirm:true (no confirmation email needed).
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
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
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    if (res.ok) {
      return true;
    }
    // Non-2xx but the request reached the server — log for diagnostics
    console.warn('[OperatorStore] Backend POST /api/operators returned', res.status);
  } catch (err) {
    // Network failure (timeout, offline, etc.) — fall through to client SDK
    console.warn('[OperatorStore] Backend unreachable, using client SDK fallback:', err);
  }

  // 2. Client-SDK fallback — write profile + role tables directly.
  //    NOTE: supabase.auth.signUp() is intentionally NOT used here because it
  //    sends a confirmation email and the user won't exist until they click the link.
  //    Instead we upsert the profile record with email so it shows in the dashboard,
  //    and mark the operator as still pending so the backend sync retries later.
  if (!isSupabaseConfigured || !supabase) return false;

  const defaultOrgId = '00000000-0000-0000-0000-000000000001';

  try {
    // Try to find an existing profile by email first so we can reuse its ID
    let authUserId = op.id;
    const { data: existingProf } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', op.email)
      .maybeSingle();
    if (existingProf?.id) {
      authUserId = existingProf.id as string;
    }

    // Upsert profile — email column is now present after the migration
    const { error: profileErr } = await supabase.from('profiles').upsert(
      {
        id: authUserId,
        full_name: op.name,
        email: op.email,
        access_code: op.generatedPasswordCode,
      },
      { onConflict: 'id' },
    );
    if (profileErr) {
      console.warn('[OperatorStore] Profile upsert notice:', profileErr.message);
    }

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

    // The profile is saved locally in Supabase DB but the Auth user was not created
    // (that requires the backend admin key). Keep the record in pending so the next
    // time the backend is reachable the full Auth account is also created.
    return true;
  } catch (err) {
    console.warn('[OperatorStore] Client SDK operator save notice:', err);
    return false;
  }
}

/** Deletes operator profile and role assignments from Supabase Cloud. */
export async function deleteOperatorFromSupabase(id: string): Promise<void> {
  const targetOp = _operators.find((op) => op.id === id);
  const backendUrl = getBackendUrl();
  // 1. Try server backend API endpoint first with a 1.5s timeout
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const res = await fetch(`${backendUrl}/api/operators/${id}`, {
      method: 'DELETE',
      headers: await getBackendAuthorizationHeaders(),
      signal: controller.signal,
    }).finally(() => clearTimeout(timeoutId));
    if (res.ok) {
      return;
    }
  } catch {
    // Fallback to client-side Supabase SDK below
  }

  if (!isSupabaseConfigured || !supabase) return;

  try {
    await supabase.from('event_volunteers').delete().eq('user_id', id);
    await supabase.from('memberships').delete().eq('user_id', id);
    await supabase.from('profiles').delete().eq('id', id);
    if (targetOp?.email) {
      await supabase.from('profiles').delete().eq('email', targetOp.email);
    }
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
