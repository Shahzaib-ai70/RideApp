import { useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import type { Metadata } from 'expo-router/server';
import { Link, useLocalSearchParams } from 'expo-router';
import { Pressable, Text, TextInput } from '../components/AppText';
import { apiRequest } from '../lib/api';
import { pageMetadata } from '../lib/seo';

const GREEN = '#0B786F';
const INK = '#12273A';
const MUTED = '#63798A';
const LINE = '#DCE8E5';
const WHITE = '#FFFFFF';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Delete your account | Sawaari',
    'Request deletion of your Sawaari account and associated data.',
    '/delete-account',
    true,
  );
}

export default function DeleteAccountRoute() {
  const params = useLocalSearchParams<{ token?: string | string[] }>();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [requested, setRequested] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const [error, setError] = useState('');

  const requestDeletion = async () => {
    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/delete-request', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ email: email.trim() }),
      });
      setRequested(true);
    } catch (requestError: unknown) {
      setError(requestError instanceof Error ? requestError.message : 'Could not send the deletion request.');
    } finally {
      setBusy(false);
    }
  };

  const confirmDeletion = async () => {
    if (!token) return;
    setBusy(true);
    setError('');
    try {
      const result = await apiRequest<{ deleted: boolean }>('/auth/delete-request/confirm', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ token }),
      });
      setDeleted(result.deleted);
      setConfirmed(true);
    } catch (confirmError: unknown) {
      setError(confirmError instanceof Error ? confirmError.message : 'Could not confirm account deletion.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Text style={styles.markText}>S</Text>
        </View>
        <Text accessibilityRole="header" style={styles.title}>
          {confirmed
            ? 'Request complete'
            : token
              ? 'Confirm account deletion'
              : requested
                ? 'Check your email'
                : 'Request account deletion'}
        </Text>
        <Text style={styles.copy}>
          {confirmed && deleted
            ? 'Your Sawaari account has been deleted. Private driver documents are being removed from secure storage. Some ride records involving other users may remain without your driver account details.'
            : confirmed
              ? 'If a Sawaari account was associated with this email, its deletion has been processed.'
            : token
              ? 'Confirming permanently deletes the Sawaari account associated with this email. This cannot be undone.'
              : requested
                ? 'If this address is associated with a Sawaari account, we sent a confirmation link. Open it to review and confirm deletion.'
                : 'Enter the email address on your Sawaari account. We will email a confirmation link before deleting anything.'}
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {token && !confirmed ? (
          <Pressable
            accessibilityRole="button"
            disabled={busy}
            onPress={() => void confirmDeletion()}
            style={[styles.button, busy && styles.buttonDisabled]}
          >
            {busy ? <ActivityIndicator color={GREEN} /> : <Text style={styles.buttonText}>Permanently delete account</Text>}
          </Pressable>
        ) : null}
        {!token && !requested && !confirmed ? (
          <>
            <TextInput
              accessibilityLabel="Email address on your Sawaari account"
              value={email}
              onChangeText={setEmail}
              placeholder="Email address"
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              style={styles.input}
            />
            <Pressable
              accessibilityRole="button"
              disabled={busy || !email.includes('@')}
              onPress={() => void requestDeletion()}
              style={[styles.button, (busy || !email.includes('@')) && styles.buttonDisabled]}
            >
              {busy ? <ActivityIndicator color={GREEN} /> : <Text style={styles.buttonText}>Send confirmation email</Text>}
            </Pressable>
          </>
        ) : null}
        <View style={styles.links}>
          <Link href="/privacy" style={styles.link}>Privacy Policy</Link>
          <Link href="/" style={styles.link}>Return to Sawaari</Link>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    minHeight: '100%',
    justifyContent: 'center',
    padding: 20,
    backgroundColor: '#F1F6F5',
  },
  card: {
    width: '100%',
    maxWidth: 440,
    alignSelf: 'center',
    alignItems: 'center',
    padding: 24,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: WHITE,
    gap: 14,
  },
  mark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    backgroundColor: '#D9F5EA',
  },
  markText: { color: GREEN, fontSize: 26, fontWeight: '900' },
  title: { color: INK, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  copy: { color: MUTED, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  error: { width: '100%', color: '#C34242', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  input: {
    width: '100%',
    minHeight: 46,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: LINE,
    borderRadius: 11,
    color: INK,
    backgroundColor: WHITE,
  },
  button: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#D9F5EA',
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: GREEN, fontSize: 14, fontWeight: '800' },
  links: { flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  link: { color: GREEN, fontSize: 13, fontWeight: '700' },
});
