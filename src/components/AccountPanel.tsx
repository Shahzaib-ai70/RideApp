import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';

const GREEN = '#0E4E3D';
const INK = '#172621';
const MUTED = '#75817B';
const LINE = '#E8EBE4';
const WHITE = '#FFFFFF';

export default function AccountPanel() {
  const { configured, session, authError } = useAuth();
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const submit = async () => {
    if (!supabase) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const result = creating
        ? await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
            ...(Platform.OS === 'web' ? { emailRedirectTo: window.location.origin } : {}),
          },
        })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (result.error) throw result.error;
      if (result.data.session) {
        setNotice(creating ? 'Account created and signed in.' : 'You are signed in.');
      } else {
        setNotice(
          creating
            ? 'Check your email, click the confirmation link, then return to Sawaari and sign in. If the link cannot open localhost, return to this app.'
            : 'Check your email to confirm the new account, then sign in.',
        );
      }
    } catch (submitError: unknown) {
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setBusy(true);
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) throw signOutError;
      setNotice('You are signed out.');
    } catch (signOutError: unknown) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Connect your Supabase project</Text>
        <Text style={styles.copy}>
          Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY to your local .env, then restart Expo. Setup instructions are in the README.
        </Text>
      </View>
    );
  }

  if (session) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>Signed in</Text>
        <Text style={styles.copy}>{session.user.email}</Text>
        {authError ? <Text style={styles.error}>{authError}</Text> : null}
        <Pressable disabled={busy} onPress={() => void signOut()} style={styles.button}>
          {busy ? <ActivityIndicator color={GREEN} /> : <Text style={styles.buttonText}>Sign out</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{creating ? 'Create your account' : 'Sign in to Sawaari'}</Text>
      <Text style={styles.copy}>Use one account to request rides or drive. Email confirmation may be required.</Text>
      {creating ? (
        <TextInput
          accessibilityLabel="Your name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Your name"
          autoCapitalize="words"
          style={styles.input}
        />
      ) : null}
      <TextInput
        accessibilityLabel="Email address"
        value={email}
        onChangeText={setEmail}
        placeholder="Email address"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        style={styles.input}
      />
      <TextInput
        accessibilityLabel="Password"
        value={password}
        onChangeText={setPassword}
        placeholder="Password (at least 8 characters)"
        secureTextEntry
        autoCapitalize="none"
        style={styles.input}
      />
      {error || authError ? <Text style={styles.error}>{error || authError}</Text> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      <Pressable
        disabled={busy || (creating && displayName.trim().length < 2)
          || !email.includes('@') || password.length < 8}
        onPress={() => void submit()}
        style={styles.button}
      >
        {busy ? <ActivityIndicator color={GREEN} /> : (
          <Text style={styles.buttonText}>{creating ? 'Create account' : 'Sign in'}</Text>
        )}
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={busy}
        onPress={() => {
          setCreating(!creating);
          setError('');
          setNotice('');
        }}
        style={styles.linkButton}
      >
        <Text style={styles.linkText}>
          {creating ? 'Already have an account? Sign in' : 'New to Sawaari? Create an account'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 16, borderRadius: 16, borderWidth: 1, borderColor: LINE, backgroundColor: WHITE, gap: 10 },
  title: { color: INK, fontSize: 17, fontWeight: '800' },
  copy: { color: MUTED, fontSize: 12, lineHeight: 18 },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 11,
    color: INK,
    backgroundColor: WHITE,
  },
  error: { color: '#C34242', fontSize: 12, lineHeight: 18 },
  notice: { color: GREEN, fontSize: 12, lineHeight: 18 },
  button: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 11,
    backgroundColor: '#C8F169',
  },
  buttonText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  linkButton: { alignSelf: 'center', padding: 6 },
  linkText: { color: GREEN, fontWeight: '700', fontSize: 12 },
});
