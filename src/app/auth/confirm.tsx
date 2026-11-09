import { useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { apiRequest } from '../../lib/api';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

const GREEN = '#0E4E3D';
const INK = '#172621';
const MUTED = '#75817B';
const LINE = '#E8EBE4';
const WHITE = '#FFFFFF';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Confirm your account | Sawaari',
    'Confirm your Sawaari account email address.',
    '/auth/confirm',
    true,
  );
}

export default function ConfirmAccountRoute() {
  const params = useLocalSearchParams<{
    token?: string | string[];
  }>();
  const router = useRouter();
  const token = Array.isArray(params.token) ? params.token[0] : params.token;
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState('');

  const confirmAccount = async () => {
    if (!token) {
      setError('This confirmation link is incomplete or invalid. Request a new confirmation email and try again.');
      return;
    }

    setBusy(true);
    setError('');
    try {
      await apiRequest('/auth/confirm', {
        method: 'POST',
        auth: false,
        body: JSON.stringify({ token }),
      });
      setConfirmed(true);
    } catch (confirmError: unknown) {
      setError(confirmError instanceof Error
        ? confirmError.message
        : 'Could not confirm this account. Request a new confirmation email and try again.');
    } finally {
      setBusy(false);
    }
  };

  const hasConfirmationToken = Boolean(token);

  return (
    <View style={styles.screen}>
      <View style={styles.card}>
        <View style={styles.mark}>
          <Text style={styles.markText}>S</Text>
        </View>
        <Text style={styles.title}>
          {confirmed ? 'Account confirmed' : 'Confirm your Sawaari account'}
        </Text>
        <Text style={styles.copy}>
          {confirmed
            ? 'Your email is verified. You can now sign in and use Sawaari.'
            : 'Your email link is ready. Press the button below to verify your email and finish creating your account.'}
        </Text>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {confirmed ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => router.replace('/')}
            style={styles.button}
          >
            <Text style={styles.buttonText}>Go to Sawaari</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            disabled={busy || !hasConfirmationToken}
            onPress={() => void confirmAccount()}
            style={[styles.button, (busy || !hasConfirmationToken) && styles.buttonDisabled]}
          >
            {busy
              ? <ActivityIndicator color={GREEN} />
              : <Text style={styles.buttonText}>Confirm account</Text>}
          </Pressable>
        )}
        {!confirmed && !hasConfirmationToken ? (
          <Text style={styles.hint}>
            No valid confirmation token was found. Return to Sawaari and request a new email.
          </Text>
        ) : null}
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
    backgroundColor: '#F6F8F3',
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
    backgroundColor: '#C8F169',
  },
  markText: { color: GREEN, fontSize: 26, fontWeight: '900' },
  title: { color: INK, fontSize: 21, fontWeight: '800', textAlign: 'center' },
  copy: { color: MUTED, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  error: { width: '100%', color: '#C34242', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  hint: { color: MUTED, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  button: {
    width: '100%',
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: '#C8F169',
  },
  buttonDisabled: { opacity: 0.55 },
  buttonText: { color: GREEN, fontSize: 14, fontWeight: '800' },
});
