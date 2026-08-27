import type { Session, User } from '@supabase/supabase-js';
import React, { createContext, useContext, useEffect, useState } from 'react';

import type { OperatorRole } from '@/features/operators/operator-types';
import { isSupabaseConfigured, requireSupabase, supabase } from '@/lib/supabase';

import { getOperators, subscribeOperators } from '@/features/operators/operator-store';

export interface LocalUser {
  id: string;
  email: string;
  name?: string;
  role?: OperatorRole;
  assignedEventId?: string | null;
}

interface AuthContextType {
  session: Session | null;
  user: User | null;
  localUser: LocalUser | null;
  role: OperatorRole;
  assignedEventId: string | null;
  loading: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInLocally: (user: LocalUser) => void;
  signOut: () => Promise<{ error: Error | null }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  localUser: null,
  role: 'Superadmin',
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
    if (!supabase) {
      setLoading(false);
      return;
    }

    let isMounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session: initialSession } }) => {
        if (isMounted) {
          setSession(initialSession);
          setLoading(false);
        }
      })
      .catch((error: unknown) => {
        console.warn('Failed to retrieve initial session:', error);
        if (isMounted) {
          setLoading(false);
        }
      });

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
      if (matchingOp) {
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
      }
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

  const signInLocally = (u: LocalUser) => {
    setLocalUser(u);
  };

  const signOut = async () => {
    setLocalUser(null);
    setDbRole(null);
    setDbEventId(null);
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

  const computedRole: OperatorRole =
    localUser?.role ??
    dbRole ??
    (session?.user?.user_metadata?.role as OperatorRole) ??
    'Superadmin';

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
