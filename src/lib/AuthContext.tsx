import { createContext, useContext, useEffect, useState } from 'react';
import type { PropsWithChildren } from 'react';
import { apiRequest } from './api';
import type { ApiUser } from './api';

export type AppSession = {
  user: ApiUser & { user_metadata: { display_name: string } };
};

type AuthContextValue = {
  configured: boolean;
  loading: boolean;
  session: AppSession | null;
  authError: string;
  refreshSession: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue>({
  configured: true,
  loading: false,
  session: null,
  authError: '',
  refreshSession: async () => {},
});

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<AppSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');

  const refreshSession = async () => {
    try {
      const { user } = await apiRequest<{ user: ApiUser | null }>('/auth/session');
      setSession(user ? { user: { ...user, user_metadata: { display_name: user.display_name } } } : null);
      setAuthError('');
    } catch (error: unknown) {
      setAuthError(error instanceof Error ? error.message : 'Could not connect to Sawaari.');
      throw error;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    void apiRequest<{ user: ApiUser | null }>('/auth/session')
      .then(({ user }) => {
        if (!active) return;
        setSession(user ? { user: { ...user, user_metadata: { display_name: user.display_name } } } : null);
        setAuthError('');
      })
      .catch((error: unknown) => {
        if (active) {
          setAuthError(error instanceof Error ? error.message : 'Could not connect to Sawaari.');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <AuthContext.Provider value={{ configured: true, loading, session, authError, refreshSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
