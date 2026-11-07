import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AccountPanel from './AccountPanel';
import AdminDashboard from './AdminDashboard';
import DriverReviewConsole from './DriverReviewConsole';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/withTimeout';

const COLORS = {
  ink: '#172621',
  muted: '#75817B',
  green: '#0E4E3D',
  lime: '#C8F169',
  paper: '#F6F7F1',
  line: '#E8EBE4',
  white: '#FFFFFF',
  red: '#C34242',
};

export default function AdminScreen() {
  const { configured, loading: authLoading, session } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [error, setError] = useState('');
  const checkVersion = useRef(0);

  const checkAccess = useCallback(async () => {
    const version = ++checkVersion.current;
    if (!session || !supabase) {
      setIsAdmin(false);
      setError('');
      setCheckingAccess(false);
      return;
    }

    setCheckingAccess(true);
    setError('');
    try {
      const { data, error: permissionError } = await withTimeout(
        supabase.rpc('is_driver_reviewer'),
        10000,
        'Admin access check timed out. Check your connection and try again.',
      );
      if (permissionError) throw permissionError;
      if (typeof data !== 'boolean') {
        throw new Error('Supabase returned an invalid admin permission response.');
      }
      if (checkVersion.current !== version) return;
      setIsAdmin(data);
    } catch (accessError: unknown) {
      if (checkVersion.current !== version) return;
      setError(accessError instanceof Error
        ? accessError.message
        : 'Could not verify access to the admin panel.');
      setIsAdmin(false);
    } finally {
      if (checkVersion.current === version) setCheckingAccess(false);
    }
  }, [session]);

  useEffect(() => {
    void Promise.resolve().then(() => checkAccess());
    return () => {
      checkVersion.current += 1;
    };
  }, [checkAccess]);

  if (!configured) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Header />
        <Notice
          title="Admin service is not configured"
          message="Connect the app to Supabase before opening the admin panel."
        />
      </ScrollView>
    );
  }

  if (authLoading || checkingAccess) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator size="large" color={COLORS.green} />
        <Text style={styles.loadingText}>Checking admin access…</Text>
      </View>
    );
  }

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Header />
        <Text style={styles.subtitle}>
          Sign in with the account authorized to manage Sawaari. Public accounts cannot access admin data.
        </Text>
        <AccountPanel />
      </ScrollView>
    );
  }

  if (!isAdmin) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Header />
        <Notice
          title="Admin access is not enabled for this account"
          message="Sign in with the account added to the Supabase driver_reviewers allowlist. Creating an ordinary rider or driver account does not grant admin access."
          error={error}
          onRetry={error ? () => void checkAccess() : undefined}
        />
        <AccountPanel />
      </ScrollView>
    );
  }

  if (showReviews) {
    return <DriverReviewConsole onClose={() => setShowReviews(false)} />;
  }

  return (
    <AdminDashboard
      onClose={() => router.replace('/')}
      onOpenReviews={() => setShowReviews(true)}
    />
  );
}

function Header() {
  return (
    <View style={styles.heading}>
      <View style={styles.iconBox}>
        <Ionicons name="shield-checkmark-outline" size={20} color={COLORS.green} />
      </View>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>SAWAARI OPERATIONS</Text>
        <Text style={styles.title}>Admin panel</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        onPress={() => router.replace('/')}
        style={styles.closeButton}
      >
        <Text style={styles.closeText}>Back to app</Text>
      </Pressable>
    </View>
  );
}

function Notice({
  title,
  message,
  error,
  onRetry,
}: {
  title: string;
  message: string;
  error?: string;
  onRetry?: () => void;
}) {
  return (
    <View style={styles.notice}>
      <Text style={styles.noticeTitle}>{title}</Text>
      <Text style={styles.subtitle}>{message}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {onRetry ? (
        <Pressable accessibilityRole="button" onPress={onRetry} style={styles.retryButton}>
          <Text style={styles.retryText}>Check access again</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flexGrow: 1, padding: 20, paddingTop: 28, paddingBottom: 36, gap: 16, backgroundColor: COLORS.paper },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E7F3E2' },
  headingCopy: { flex: 1 },
  eyebrow: { color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.3 },
  title: { marginTop: 4, color: COLORS.ink, fontSize: 22, fontWeight: '800' },
  closeButton: { paddingHorizontal: 10, paddingVertical: 9, borderRadius: 9, backgroundColor: COLORS.white },
  closeText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  subtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  notice: { padding: 16, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white, gap: 10 },
  noticeTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  error: { padding: 10, borderRadius: 9, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 11, lineHeight: 16 },
  retryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: COLORS.lime },
  retryText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  loadingScreen: { flex: 1, minHeight: 260, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: COLORS.paper },
  loadingText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
});
