import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim() ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? '';

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

const authStorage = {
  getItem: (key: string) => (
    typeof window === 'undefined' ? Promise.resolve(null) : AsyncStorage.getItem(key)
  ),
  setItem: (key: string, value: string) => (
    typeof window === 'undefined' ? Promise.resolve() : AsyncStorage.setItem(key, value)
  ),
  removeItem: (key: string) => (
    typeof window === 'undefined' ? Promise.resolve() : AsyncStorage.removeItem(key)
  ),
};

export const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      storage: Platform.OS === 'web' ? authStorage : AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: Platform.OS === 'web',
    },
  })
  : null;
