import { createContext, use, useCallback, useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import { api, demoMode, registerAccessTokenProvider } from '../lib/api';
import { supabase } from '../lib/supabase';
import type { Viewer } from '../lib/types';

interface SignUpInput {
  email: string;
  password: string;
  displayName: string;
  intent: 'buyer' | 'seller' | 'supplier';
}

interface AuthContextValue {
  authUser: SupabaseUser | null;
  viewer: Viewer | null;
  loading: boolean;
  configured: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (input: SignUpInput) => Promise<{ confirmationRequired: boolean }>;
  signOut: () => Promise<void>;
  refreshViewer: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const demoUser = {
  id: 'demo-user',
  email: 'demo@buysell.ng',
  user_metadata: { display_name: 'Ada Nwosu' },
} as unknown as SupabaseUser;

export function AuthProvider({ children }: PropsWithChildren) {
  const [authUser, setAuthUser] = useState<SupabaseUser | null>(demoMode ? demoUser : null);
  const [viewer, setViewer] = useState<Viewer | null>(demoMode ? {
    id: 'demo-user', email: 'demo@buysell.ng', displayName: 'Ada Nwosu', platformRoles: ['BUYER'], storeMemberships: [],
  } : null);
  const [loading, setLoading] = useState(!demoMode);

  const refreshViewer = useCallback(async () => {
    if (!authUser && !demoMode) {
      setViewer(null);
      return;
    }
    try {
      setViewer(await api.get<Viewer>('/auth/me'));
    } catch {
      setViewer(null);
    }
  }, [authUser]);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    registerAccessTokenProvider(async () => {
      const { data } = await supabase.auth.getSession();
      return data.session?.access_token ?? null;
    });

    let active = true;
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setAuthUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setAuthUser(session?.user ?? null);
      if (!session) setViewer(null);
    });

    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!loading && authUser) void refreshViewer();
  }, [authUser, loading, refreshViewer]);

  const signIn = useCallback(async (email: string, password: string) => {
    if (demoMode) {
      setAuthUser({ ...demoUser, email } as SupabaseUser);
      return;
    }
    if (!supabase) throw new Error('Authentication is not configured. Add the Supabase URL and publishable key.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async ({ email, password, displayName, intent }: SignUpInput) => {
    if (demoMode) {
      setAuthUser({ ...demoUser, email } as SupabaseUser);
      return { confirmationRequired: false };
    }
    if (!supabase) throw new Error('Authentication is not configured. Add the Supabase URL and publishable key.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
        // These fields are profile hints only. The backend never authorizes from user metadata.
        data: { display_name: displayName, account_intent: intent },
      },
    });
    if (error) throw error;
    return { confirmationRequired: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    if (demoMode) {
      setAuthUser(null);
      setViewer(null);
      return;
    }
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    authUser,
    viewer,
    loading,
    configured: Boolean(supabase) || demoMode,
    signIn,
    signUp,
    signOut,
    refreshViewer,
  }), [authUser, viewer, loading, signIn, signUp, signOut, refreshViewer]);

  return <AuthContext value={value}>{children}</AuthContext>;
}

export function useAuth() {
  const context = use(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
