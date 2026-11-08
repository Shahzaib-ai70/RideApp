import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TOKEN_KEY = 'sawaari_access_token';
const configuredApiUrl = process.env.EXPO_PUBLIC_API_URL?.trim().replace(/\/+$/, '');
const API_BASE = Platform.OS === 'web' ? '/api' : configuredApiUrl || 'https://sawaari.online/api';

export type ApiUser = {
  id: string;
  email: string;
  display_name: string;
};

type ApiOptions = RequestInit & { auth?: boolean };

export async function saveAccessToken(token: string | null) {
  if (Platform.OS === 'web') return;
  if (token) await SecureStore.setItemAsync(TOKEN_KEY, token);
  else await SecureStore.deleteItemAsync(TOKEN_KEY);
}

export async function apiRequest<T>(path: string, init: ApiOptions = {}): Promise<T> {
  const { auth = true, ...requestInit } = init;
  const token = auth && Platform.OS !== 'web'
    ? await SecureStore.getItemAsync(TOKEN_KEY)
    : null;
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestInit,
    credentials: 'same-origin',
    headers: {
      ...(requestInit.body && !(requestInit.body instanceof FormData)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...requestInit.headers,
    },
  });
  const result: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = typeof result === 'object'
      && result !== null
      && 'error' in result
      && typeof result.error === 'string'
      ? result.error
      : `Sawaari request failed (${response.status}).`;
    throw new Error(message);
  }
  return result as T;
}

export async function getCurrentUser() {
  const result = await apiRequest<{ user: ApiUser | null }>('/auth/session');
  return result.user;
}
