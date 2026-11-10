import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './AppText';
import { useAuth } from '../lib/AuthContext';
import { apiRequest, saveAccessToken } from '../lib/api';

const GREEN = '#0B786F';
const INK = '#12273A';
const MUTED = '#63798A';
const LINE = '#DCE8E5';
const WHITE = '#FFFFFF';

export default function AccountPanel() {
  const { session, authError, refreshSession } = useAuth();
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');

  const submit = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (creating) {
        await apiRequest('/auth/signup', {
          method: 'POST',
          auth: false,
          body: JSON.stringify({
            email: email.trim(),
            password,
            display_name: displayName.trim(),
          }),
        });
        setPendingConfirmationEmail(email.trim());
        setNotice('We sent a confirmation email. Open its link, then press Confirm account on the Sawaari page.');
      } else {
        const result = await apiRequest<{ token: string }>('/auth/login', {
          method: 'POST',
          auth: false,
          body: JSON.stringify({ email: email.trim(), password }),
        });
        await saveAccessToken(result.token);
        await refreshSession();
        setPendingConfirmationEmail('');
        setNotice('You are signed in.');
      }
    } catch (submitError: unknown) {
      if (creating || (submitError instanceof Error
        && submitError.message.toLowerCase().includes('confirm your email'))) {
        setPendingConfirmationEmail(email.trim());
      }
      setError(submitError instanceof Error ? submitError.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  const resendConfirmation = async () => {
    if (!pendingConfirmationEmail) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/auth/resend-confirmation', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: pendingConfirmationEmail }),
      });
      setNotice('A new confirmation email was requested. Check your inbox and spam folder.');
    } catch (resendError: unknown) {
      setError(resendError instanceof Error ? resendError.message : 'Could not resend the confirmation email.');
    } finally {
      setBusy(false);
    }
  };

  const signOut = async () => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
      await saveAccessToken(null);
      await refreshSession();
      setNotice('You are signed out.');
    } catch (signOutError: unknown) {
      setError(signOutError instanceof Error ? signOutError.message : 'Could not sign out.');
    } finally {
      setBusy(false);
    }
  };

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
          setPendingConfirmationEmail('');
        }}
        style={styles.linkButton}
      >
        <Text style={styles.linkText}>
          {creating ? 'Already have an account? Sign in' : 'New to Sawaari? Create an account'}
        </Text>
      </Pressable>
      {pendingConfirmationEmail ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => void resendConfirmation()}
          style={styles.linkButton}
        >
          <Text style={styles.linkText}>Resend confirmation email</Text>
        </Pressable>
      ) : null}
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
    backgroundColor: '#D9F5EA',
  },
  buttonText: { color: GREEN, fontWeight: '800', fontSize: 13 },
  linkButton: { alignSelf: 'center', padding: 6 },
  linkText: { color: GREEN, fontWeight: '700', fontSize: 12 },
});
