import type { Session } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { supabase, supabaseConfigured } from './supabase';

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: Session | null;
  authError: string;
};

const AuthContext = createContext<AuthContextValue>({
  configured: false,
  loading: false,
  session: null,
  authError: '',
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [authError, setAuthError] = useState('');

  useEffect(() => {
    if (!supabase) return undefined;
    let active = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) {
        setSession(nextSession);
        setLoading(false);
        setAuthError('');
      }
    });

    void supabase.auth.getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) throw error;
        setSession(data.session);
        setAuthError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        setAuthError(error instanceof Error ? error.message : 'Could not restore your sign-in session.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider value={{ configured: supabaseConfigured, loading, session, authError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
