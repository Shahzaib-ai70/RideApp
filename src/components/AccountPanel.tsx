import { useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pressable, Text, TextInput } from './AppText';
import { useAuth } from '../lib/AuthContext';
import { apiRequest, saveAccessToken } from '../lib/api';
import { RIDES_STORAGE_KEY } from '../lib/storageKeys';

const GREEN = '#0B786F';
const INK = '#12273A';
const MUTED = '#63798A';
const LINE = '#DCE8E5';
const WHITE = '#FFFFFF';

export default function AccountPanel({ onAccountDeleted }: { onAccountDeleted?: () => void }) {
  const { session, authError, refreshSession } = useAuth();
  const [creating, setCreating] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [pendingConfirmationEmail, setPendingConfirmationEmail] = useState('');
  const [deletePassword, setDeletePassword] = useState('');
  const [confirmingDeletion, setConfirmingDeletion] = useState(false);

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
        setPassword('');
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

  const deleteAccount = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiRequest('/auth/delete-account', {
        method: 'POST',
        body: JSON.stringify({ password: deletePassword }),
      });
      await saveAccessToken(null);
      await refreshSession();
      setConfirmingDeletion(false);
      setDeletePassword('');
      setPassword('');
      setEmail('');
      onAccountDeleted?.();
      try {
        await AsyncStorage.removeItem(RIDES_STORAGE_KEY);
      } catch (storageError: unknown) {
        setError(
          storageError instanceof Error
            ? `Account deleted, but this device's saved trip history could not be cleared: ${storageError.message}`
            : 'Account deleted, but this device’s saved trip history could not be cleared.',
        );
        return;
      }
      setNotice('Your account has been deleted. Private driver documents are being removed from secure storage.');
    } catch (deleteError: unknown) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the account.');
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
        {confirmingDeletion ? (
          <View style={styles.deletePanel}>
            <Text style={styles.deleteTitle}>Permanently delete your account?</Text>
            <Text style={styles.copy}>
              This removes your account and associated data. This action cannot be undone.
              Enter your current password to confirm.
            </Text>
            <TextInput
              accessibilityLabel="Current password to confirm account deletion"
              value={deletePassword}
              onChangeText={setDeletePassword}
              placeholder="Current password"
              secureTextEntry
              autoCapitalize="none"
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || deletePassword.length < 8}
              onPress={() => void deleteAccount()}
              style={styles.deleteButton}
            >
              {busy ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.deleteButtonText}>Delete my account</Text>}
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={() => {
                setConfirmingDeletion(false);
                setDeletePassword('');
              }}
              style={styles.linkButton}
            >
              <Text style={styles.linkText}>Cancel</Text>
            </Pressable>
          </View>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => {
              setConfirmingDeletion(true);
              setError('');
              setNotice('');
            }}
            style={styles.deleteLinkButton}
          >
            <Text style={styles.deleteLinkText}>Delete account</Text>
          </Pressable>
        )}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
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
  deletePanel: { padding: 12, borderWidth: 1, borderColor: '#F1C9C6', borderRadius: 12, backgroundColor: '#FFF8F7', gap: 9 },
  deleteTitle: { color: '#A52B2B', fontSize: 14, fontWeight: '800' },
  deleteButton: { minHeight: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#B42318' },
  deleteButtonText: { color: WHITE, fontWeight: '800', fontSize: 13 },
  deleteLinkButton: { alignSelf: 'center', padding: 6 },
  deleteLinkText: { color: '#A52B2B', fontWeight: '700', fontSize: 12 },
});
