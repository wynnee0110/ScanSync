import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';

import type { OperatorRole } from '@/features/operators/operator-types';
import { isSupabaseConfigured, requireSupabase, supabase } from '@/lib/supabase';

import { listEvents } from '@/features/events/event-repository';
import { getOperatorAccessStatus } from '@/features/operators/operator-helpers';
import { getOperators, loadStoredOperators, subscribeOperators } from '@/features/operators/operator-store';
import { getPreference, setPreference } from '@/lib/preferences';

export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface LocalUser {
  id: string;
  email: string;
  name?: string;
  role?: OperatorRole;
  assignedEventId?: string | null;
  expiresAt?: number;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  localUser: LocalUser | null;
  role: OperatorRole | null;
  assignedEventId: string | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInLocally: (user: LocalUser, rememberMe?: boolean) => void;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  localUser: null,
  role: null,
  assignedEventId: null,
  loading: true,
  isConfigured: false,
  signInWithEmail: async () => ({ error: new Error('Supabase is not configured') }),
  signInLocally: () => {},
  signOut: async () => ({ error: new Error('Supabase is not configured') }),
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [localUser, setLocalUser] = useState<LocalUser | null>(null);
  const [dbRole, setDbRole] = useState<OperatorRole | null>(null);
  const [dbEventId, setDbEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function initAuth() {
      try {
        const rawLocalUser = await getPreference('auth.local_user');
        if (isMounted && rawLocalUser) {
          try {
            const parsed = JSON.parse(rawLocalUser) as LocalUser;
            // Check 30-day session expiration
            if (parsed.expiresAt && Date.now() > parsed.expiresAt) {
              void setPreference('auth.local_user', '').catch(() => {});
            } else {
              // Verify operator access status is valid and not revoked
              const allOps = await loadStoredOperators();
              const realEvents = await listEvents().catch(() => []);
              const matchingOp = allOps.find(
                (op) =>
                  (parsed.id && op.id === parsed.id) ||
                  (parsed.email && op.email.toLowerCase() === parsed.email.toLowerCase()),
              );

              if (matchingOp) {
                const accessStatus = getOperatorAccessStatus(matchingOp, realEvents);
                if (accessStatus.isRevoked) {
                  void setPreference('auth.local_user', '').catch(() => {});
                } else if (isMounted) {
                  setLocalUser(parsed);
                }
              }
            }
          } catch {}
        }
      } catch {}

      if (supabase) {
        try {
          const { data: { session: initialSession } } = await supabase.auth.getSession();
          if (isMounted) setSession(initialSession);
        } catch (error: unknown) {
          console.warn('Failed to retrieve initial session:', error);
        }
      }

      if (isMounted) {
        setLoading(false);
        void import('@/lib/sync-worker').then(({ processSyncQueue }) => processSyncQueue().catch(() => {}));
      }
    }

    void initAuth();

    if (supabase) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, currentSession) => {
        if (isMounted) {
          setSession(currentSession);
          setLoading(false);
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }
  }, []);

  useEffect(() => {
    if (!localUser?.id && !localUser?.email) return;
    const unsub = subscribeOperators(() => {
      const allOps = getOperators();
      const matchingOp = allOps.find(
        (op) =>
          (localUser.id && op.id === localUser.id) ||
          (localUser.email && op.email.toLowerCase() === localUser.email.toLowerCase()),
      );

      if (!matchingOp) {
        // Operator account was deleted from operator store: evict session immediately
        void signOut();
        return;
      }

      void (async () => {
        try {
          const realEvents = await listEvents().catch(() => []);
          const accessStatus = getOperatorAccessStatus(matchingOp, realEvents);
          if (accessStatus.isRevoked) {
            void signOut();
            return;
          }
        } catch {}

        setLocalUser((prev) => {
          if (!prev) return null;
          if (
            prev.role !== matchingOp.role ||
            prev.assignedEventId !== matchingOp.assignedEventId ||
            prev.email !== matchingOp.email ||
            prev.name !== matchingOp.name
          ) {
            return {
              ...prev,
              id: matchingOp.id,
              name: matchingOp.name,
              email: matchingOp.email,
              role: matchingOp.role,
              assignedEventId: matchingOp.assignedEventId,
            };
          }
          return prev;
        });
      })();
    });
    return unsub;
  }, [localUser?.id, localUser?.email]);

  useEffect(() => {
    if (!supabase || !session?.user?.id) {
      setDbRole(null);
      setDbEventId(null);
      return;
    }

    let isMounted = true;
    const userId = session.user.id;

    async function resolveUserRole() {
      try {
        const client = requireSupabase();
        const { data: membership } = await client
          .from('memberships')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();

        if (isMounted && membership) {
          if (membership.role === 'superadmin') setDbRole('Superadmin');
          else if (membership.role === 'organizer') setDbRole('Organizer');
          return;
        }

        const { data: volunteer } = await client
          .from('event_volunteers')
          .select('event_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (isMounted && volunteer) {
          setDbRole('Volunteer');
          setDbEventId(volunteer.event_id as string);
          return;
        }

        if (isMounted && !membership && !volunteer) {
          // Supabase Auth user has no active membership or volunteer role assignment: evict session
          setDbRole(null);
          setDbEventId(null);
          void signOut();
        }
      } catch {
        // Fallback to metadata / localUser if fetch fails
      }
    }

    void resolveUserRole();
    return () => {
      isMounted = false;
    };
  }, [session?.user?.id]);

  const signInWithEmail = async (email: string, password: string) => {
    try {
      const client = requireSupabase();
      const { error } = await client.auth.signInWithPassword({
        email,
        password,
      });
      return { error };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Failed to sign in') };
    }
  };

  const signInLocally = (u: LocalUser, rememberMe = true) => {
    if (rememberMe) {
      const userWithExpiry: LocalUser = {
        ...u,
        expiresAt: Date.now() + THIRTY_DAYS_MS,
      };
      setLocalUser(userWithExpiry);
      void setPreference('auth.local_user', JSON.stringify(userWithExpiry)).catch(() => {});
      void setPreference('auth.remember_me', 'true').catch(() => {});
      void setPreference('auth.remembered_email', u.email).catch(() => {});
    } else {
      setLocalUser(u);
      void setPreference('auth.local_user', '').catch(() => {});
      void setPreference('auth.remember_me', 'false').catch(() => {});
      void setPreference('auth.remembered_email', '').catch(() => {});
    }
  };

  const signOut = async () => {
    setLocalUser(null);
    setDbRole(null);
    setDbEventId(null);
    void setPreference('auth.local_user', '').catch(() => {});
    try {
      if (supabase) {
        const client = requireSupabase();
        const { error } = await client.auth.signOut();
        return { error };
      }
      return { error: null };
    } catch (err) {
      return { error: err instanceof Error ? err : new Error('Failed to sign out') };
    }
  };

  const isAuthenticated = Boolean(session || localUser);

  const computedRole: OperatorRole | null = isAuthenticated
    ? (localUser?.role ??
       dbRole ??
       (session?.user?.user_metadata?.role as OperatorRole) ??
       'Volunteer')
    : null;

  const computedEventId: string | null =
    localUser?.assignedEventId ??
    dbEventId ??
    (session?.user?.user_metadata?.assigned_event_id as string) ??
    null;

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        localUser,
        role: computedRole,
        assignedEventId: computedEventId,
        loading,
        isConfigured: isSupabaseConfigured,
        signInWithEmail,
        signInLocally,
        signOut,
      }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

