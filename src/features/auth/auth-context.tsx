import { AuthApiError, type Session, type User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Alert, AppState, type AppStateStatus, Platform } from 'react-native';

import type { OperatorRole } from '@/features/operators/operator-types';
import { isSupabaseConfigured, requireSupabase, supabase } from '@/lib/supabase';

import { listEvents } from '@/features/events/event-repository';
import { getOperatorAccessStatus, isIcpepAccount } from '@/features/operators/operator-helpers';
import {
  getOperators,
  loadStoredOperators,
  subscribeOperators,
  syncOperatorsFromSupabase,
} from '@/features/operators/operator-store';
import { getPreference, setPreference } from '@/lib/preferences';
import { checkIsOnline, useNetworkStatus } from '@/lib/use-network-status';

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
  isValidating: boolean;
  isConfigured: boolean;
  signInWithEmail: (email: string, password: string) => Promise<{ error: Error | null }>;
  signInLocally: (user: LocalUser, rememberMe?: boolean) => void;
  signOut: () => Promise<{ error: Error | null }>;
  validateSession: () => Promise<{ isValid: boolean; error?: string }>;
}

const AuthContext = createContext<AuthContextType>({
  session: null,
  user: null,
  localUser: null,
  role: null,
  assignedEventId: null,
  loading: true,
  isValidating: false,
  isConfigured: false,
  signInWithEmail: async () => ({ error: new Error('Supabase is not configured') }),
  signInLocally: () => { },
  signOut: async () => ({ error: new Error('Supabase is not configured') }),
  validateSession: async () => ({ isValid: false }),
});

function notifySessionExpired(message: string) {
  if (Platform.OS === 'web') {
    if (typeof window !== 'undefined' && window.alert) {
      window.alert(message);
    }
  } else {
    Alert.alert('Session Expired', message, [{ text: 'OK' }]);
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [localUser, setLocalUser] = useState<LocalUser | null>(null);
  const [dbRole, setDbRole] = useState<OperatorRole | null>(null);
  const [dbEventId, setDbEventId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isValidating, setIsValidating] = useState(false);

  const isValidatingRef = useRef(false);
  const networkStatus = useNetworkStatus();
  const prevConnectedRef = useRef(networkStatus.isConnected);

  const signOut = useCallback(async () => {
    setLocalUser(null);
    setDbRole(null);
    setDbEventId(null);
    void setPreference('auth.local_user', '').catch(() => { });
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
  }, []);

  const resolveUserRole = useCallback(
    async (userId: string): Promise<boolean> => {
      if (!supabase || !userId) {
        setDbRole(null);
        setDbEventId(null);
        return false;
      }

      try {
        const client = requireSupabase();
        const { data: membership, error: memErr } = await client
          .from('memberships')
          .select('role')
          .eq('user_id', userId)
          .maybeSingle();

        if (membership) {
          if (membership.role === 'superadmin') setDbRole('Superadmin');
          else if (membership.role === 'organizer') setDbRole('Organizer');
          return true;
        }

        const { data: volunteer, error: volErr } = await client
          .from('event_volunteers')
          .select('event_id')
          .eq('user_id', userId)
          .maybeSingle();

        if (volunteer) {
          setDbRole('Volunteer');
          setDbEventId(volunteer.event_id as string);
          return true;
        }

        // Only evict if both queries executed without network errors and returned no assignment
        if (!memErr && !volErr && !membership && !volunteer) {
          console.warn('[Auth] User has no active membership or volunteer role. Evicting session.');
          setDbRole(null);
          setDbEventId(null);
          await signOut();
          return false;
        }

        return true;
      } catch (err) {
        console.warn('[Auth] Role resolution notice:', err);
        return true;
      }
    },
    [signOut],
  );

  const validateSession = useCallback(async (): Promise<{ isValid: boolean; error?: string }> => {
    if (isValidatingRef.current) {
      return { isValid: true };
    }

    // 1. Offline check: Keep local session active to preserve offline attendance scanning
    const isOnline = await checkIsOnline();
    if (!isOnline) {
      return { isValid: true };
    }

    isValidatingRef.current = true;
    setIsValidating(true);

    try {
      // 2. Supabase Auth Session Validation
      if (supabase) {
        const { data: sessionData } = await supabase.auth.getSession();
        const currentSession = sessionData?.session;

        if (currentSession) {
          const expiresAt = currentSession.expires_at ? currentSession.expires_at * 1000 : 0;
          const now = Date.now();

          // If token has expired or will expire in less than 60s, refresh proactively
          if (expiresAt && expiresAt - now < 60 * 1000) {
            const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
            if (refreshErr) {
              const isAuthFail =
                refreshErr instanceof AuthApiError ||
                refreshErr.status === 400 ||
                refreshErr.status === 401 ||
                refreshErr.status === 403 ||
                refreshErr.message.toLowerCase().includes('refresh_token') ||
                refreshErr.message.toLowerCase().includes('invalid');

              if (isAuthFail) {
                console.warn('[Auth] Refresh token rejected by server:', refreshErr.message);
                await signOut();
                notifySessionExpired('Your session has expired. Please sign in again.');
                return { isValid: false, error: refreshErr.message };
              }
            } else if (refreshData.session) {
              setSession(refreshData.session);
            }
          }

          // Actively validate the token with Supabase Auth server
          const { data: userData, error: userErr } = await supabase.auth.getUser();

          if (userErr) {
            const isAuthFail =
              userErr instanceof AuthApiError ||
              userErr.status === 400 ||
              userErr.status === 401 ||
              userErr.status === 403 ||
              userErr.message.toLowerCase().includes('jwt') ||
              userErr.message.toLowerCase().includes('session');

            if (isAuthFail) {
              console.warn('[Auth] JWT verification failed on server:', userErr.message);
              await signOut();
              notifySessionExpired('Your session is no longer valid. Please sign in again.');
              return { isValid: false, error: userErr.message };
            }
            // Network/timeout error: do NOT evict session
          } else if (userData.user) {
            setSession((prev) => (prev ? { ...prev, user: userData.user } : prev));
            const roleValid = await resolveUserRole(userData.user.id);
            if (!roleValid) {
              notifySessionExpired('Your operator access has been revoked.');
              return { isValid: false, error: 'Access revoked' };
            }
          }
        }
      }

      // 3. Local Operator Account Validation
      if (localUser?.id || localUser?.email) {
        try {
          await syncOperatorsFromSupabase();
          const allOps = getOperators();
          const matchingOp = allOps.find(
            (op) =>
              (localUser.id && op.id === localUser.id) ||
              (localUser.email && op.email.toLowerCase() === localUser.email.toLowerCase()),
          );

          if (!matchingOp) {
            console.warn('[Auth] Local operator account was deleted remotely. Evicting session.');
            await signOut();
            notifySessionExpired('Your operator account has been removed.');
            return { isValid: false, error: 'Account removed' };
          }

          const realEvents = await listEvents().catch(() => []);
          const accessStatus = getOperatorAccessStatus(matchingOp, realEvents);
          if (accessStatus.isRevoked) {
            console.warn(`[Auth] Local operator access is revoked (${accessStatus.label}). Evicting session.`);
            await signOut();
            notifySessionExpired(`Access revoked: Operator account is ${accessStatus.label.toLowerCase()}.`);
            return { isValid: false, error: accessStatus.label };
          }
        } catch (opErr) {
          console.warn('[Auth] Local operator revalidation notice:', opErr);
        }
      }

      return { isValid: true };
    } finally {
      isValidatingRef.current = false;
      setIsValidating(false);
    }
  }, [localUser, signOut, resolveUserRole]);

  // Initial authentication mount
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
              void setPreference('auth.local_user', '').catch(() => { });
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
                  void setPreference('auth.local_user', '').catch(() => { });
                } else if (isMounted) {
                  setLocalUser(parsed);
                }
              }
            }
          } catch { }
        }
      } catch { }

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
        // If device is already online at launch, validate session immediately
        void checkIsOnline().then((online) => {
          if (online && isMounted) {
            void validateSession();
          }
        });
        void import('@/lib/sync-worker').then(({ processSyncQueue }) => processSyncQueue().catch(() => { }));
      }
    }

    void initAuth();

    if (supabase) {
      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((event, currentSession) => {
        if (isMounted) {
          setSession(currentSession);
          setLoading(false);
        }
        if (event === 'SIGNED_OUT') {
          setDbRole(null);
          setDbEventId(null);
        } else if (event === 'TOKEN_REFRESHED' || event === 'SIGNED_IN') {
          if (currentSession?.user?.id) {
            void resolveUserRole(currentSession.user.id);
          }
        }
      });

      return () => {
        isMounted = false;
        subscription.unsubscribe();
      };
    }
  }, [resolveUserRole, validateSession]);

  // Network connection restoration listener: validates session every time device comes online
  useEffect(() => {
    if (networkStatus.isConnected && !prevConnectedRef.current) {
      console.log('[Auth] Network connection established. Validating session & JWT...');
      void validateSession();
      // Auto-replay sync queue upon reconnecting
      void import('@/lib/sync-worker').then(({ processSyncQueue }) => processSyncQueue().catch(() => { }));
      // Refresh local operators list if logged out so offline logins remain updated
      if (!session && !localUser) {
        void syncOperatorsFromSupabase().catch(() => { });
      }
    }
    prevConnectedRef.current = networkStatus.isConnected;
  }, [networkStatus.isConnected, validateSession, session, localUser]);

  // AppState change listener: resumes auto-refresh on foreground and triggers validation if online
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (nextAppState === 'active') {
        if (supabase) {
          supabase.auth.startAutoRefresh();
        }
        if (networkStatus.isConnected) {
          void validateSession();
        }
      } else if (nextAppState === 'background' || nextAppState === 'inactive') {
        if (supabase) {
          supabase.auth.stopAutoRefresh();
        }
      }
    };

    const subscription = AppState.addEventListener('change', handleAppStateChange);
    return () => {
      subscription.remove();
    };
  }, [networkStatus.isConnected, validateSession]);

  // Local operator revocation / deletion subscription
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
        } catch { }

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
  }, [localUser?.id, localUser?.email, signOut]);

  // Role resolution for active Supabase Auth user
  useEffect(() => {
    if (!session?.user?.id) {
      setDbRole(null);
      setDbEventId(null);
      return;
    }
    void resolveUserRole(session.user.id);
  }, [session?.user?.id, resolveUserRole]);

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
      void setPreference('auth.local_user', JSON.stringify(userWithExpiry)).catch(() => { });
      void setPreference('auth.remember_me', 'true').catch(() => { });
      void setPreference('auth.remembered_email', u.email).catch(() => { });
    } else {
      setLocalUser(u);
      void setPreference('auth.local_user', '').catch(() => { });
      void setPreference('auth.remember_me', 'false').catch(() => { });
      void setPreference('auth.remembered_email', '').catch(() => { });
    }
  };

  const isAuthenticated = Boolean(session || localUser);

  const isIcpepUser = Boolean(
    (localUser?.email && isIcpepAccount(localUser.email)) ||
    (session?.user?.email && isIcpepAccount(session.user.email)),
  );

  const computedRole: OperatorRole | null = isAuthenticated
    ? (isIcpepUser
        ? 'Superadmin'
        : (localUser?.role ??
          dbRole ??
          (session?.user?.user_metadata?.role as OperatorRole) ??
          'Volunteer'))
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
        isValidating,
        isConfigured: isSupabaseConfigured,
        signInWithEmail,
        signInLocally,
        signOut,
        validateSession,
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
