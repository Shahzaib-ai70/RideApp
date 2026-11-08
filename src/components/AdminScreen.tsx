import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
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

const ADMIN_USERNAME = 'ShahzaibKS';
const ADMIN_ACCOUNT_EMAIL = 'ms0489123@gmail.com';

export default function AdminScreen() {
  const { configured, loading: authLoading, session } = useAuth();
  const [checkingAccess, setCheckingAccess] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [showReviews, setShowReviews] = useState(false);
  const [error, setError] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [signingIn, setSigningIn] = useState(false);
  const [signInError, setSignInError] = useState('');
  const checkVersion = useRef(0);

  const signIn = async () => {
    if (!supabase) return;
    setSigningIn(true);
    setSignInError('');
    try {
      if (username.trim().toLowerCase() !== ADMIN_USERNAME.toLowerCase()) {
        throw new Error('Invalid admin username or password.');
      }
      const { error: signInFailure } = await supabase.auth.signInWithPassword({
        email: ADMIN_ACCOUNT_EMAIL,
        password,
      });
      if (signInFailure) throw signInFailure;
      setPassword('');
    } catch (submitError: unknown) {
      setSignInError(submitError instanceof Error
        ? submitError.message
        : 'Could not sign in to the admin panel.');
    } finally {
      setSigningIn(false);
    }
  };

  const signOut = async () => {
    if (!supabase) return;
    setError('');
    const { error: signOutError } = await supabase.auth.signOut();
    if (signOutError) setError(signOutError.message);
  };

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
        <View style={styles.authContent}>
          <Header />
          <Notice
            title="Admin service is not configured"
            message="Connect the app to Supabase before opening the admin panel."
          />
        </View>
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
        <View style={styles.authContent}>
          <Header />
          <View style={styles.authLayout}>
            <View style={styles.welcomePanel}>
              <View style={styles.welcomeIcon}>
                <Ionicons name="shield-checkmark" size={25} color={COLORS.lime} />
              </View>
              <Text style={styles.welcomeEyebrow}>PRIVATE ADMIN ACCESS</Text>
              <Text style={styles.welcomeTitle}>Welcome back.</Text>
              <Text style={styles.welcomeCopy}>
                Manage driver verification and monitor Sawaari operations from your secure control panel.
              </Text>
              <View style={styles.secureNote}>
                <Ionicons name="lock-closed-outline" size={14} color={COLORS.lime} />
                <Text style={styles.secureNoteText}>Authorized admins only</Text>
              </View>
            </View>
            <View style={styles.loginCard}>
              <View style={styles.formHeading}>
                <Text style={styles.cardTitle}>Admin sign in</Text>
                <Text style={styles.cardCopy}>Enter your admin credentials to continue.</Text>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>USERNAME</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="person-outline" size={17} color={COLORS.muted} />
                  <TextInput
                    accessibilityLabel="Admin username"
                    autoCapitalize="none"
                    autoComplete="username"
                    autoCorrect={false}
                    onChangeText={setUsername}
                    onSubmitEditing={() => void signIn()}
                    placeholder={ADMIN_USERNAME}
                    returnKeyType="next"
                    style={styles.input}
                    textContentType="username"
                    value={username}
                  />
                </View>
              </View>
              <View style={styles.fieldGroup}>
                <Text style={styles.fieldLabel}>PASSWORD</Text>
                <View style={styles.inputWrap}>
                  <Ionicons name="key-outline" size={17} color={COLORS.muted} />
                  <TextInput
                    accessibilityLabel="Admin password"
                    autoCapitalize="none"
                    autoComplete="current-password"
                    onChangeText={setPassword}
                    onSubmitEditing={() => void signIn()}
                    placeholder="Enter your password"
                    returnKeyType="go"
                    secureTextEntry
                    style={styles.input}
                    textContentType="password"
                    value={password}
                  />
                </View>
              </View>
              {signInError ? <Text style={styles.error}>{signInError}</Text> : null}
              <Pressable
                accessibilityRole="button"
                disabled={signingIn || !username.trim() || !password}
                onPress={() => void signIn()}
                style={[styles.signInButton, (signingIn || !username.trim() || !password) && styles.disabledButton]}
              >
                {signingIn
                  ? <ActivityIndicator color={COLORS.white} />
                  : (
                    <>
                      <Text style={styles.signInText}>Sign in to admin</Text>
                      <Ionicons name="arrow-forward" size={17} color={COLORS.white} />
                    </>
                  )}
              </Pressable>
              <View style={styles.formFooter}>
                <Ionicons name="lock-closed-outline" size={13} color={COLORS.muted} />
                <Text style={styles.formFooterText}>Your credentials are verified securely.</Text>
              </View>
            </View>
          </View>
        </View>
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
        <View style={styles.loginCard}>
          <View style={styles.accessDeniedIcon}><Ionicons name="person-circle-outline" size={25} color={COLORS.red} /></View>
          <Text style={styles.cardTitle}>Account not authorized</Text>
          <Text style={styles.cardCopy}>Signed in as {session.user.email}. This account does not have admin permissions.</Text>
          <Pressable accessibilityRole="button" onPress={() => void signOut()} style={styles.signOutButton}>
            <Ionicons name="log-out-outline" size={16} color={COLORS.green} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
        </View>
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
        <Ionicons name="shield-checkmark" size={20} color={COLORS.lime} />
      </View>
      <View style={styles.headingCopy}>
        <Text style={styles.eyebrow}>SAWAARI OPERATIONS</Text>
        <Text style={styles.headerTitle}>Admin panel</Text>
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
  screen: { flexGrow: 1, padding: 18, paddingTop: 22, paddingBottom: 40, backgroundColor: COLORS.paper },
  authContent: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 24 },
  heading: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 11 },
  iconBox: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.green },
  headingCopy: { flex: 1 },
  eyebrow: { color: COLORS.green, fontSize: 9, fontWeight: '900', letterSpacing: 1.3 },
  headerTitle: { marginTop: 4, color: COLORS.ink, fontSize: 21, fontWeight: '900' },
  closeButton: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 11, paddingVertical: 9, borderRadius: 10, backgroundColor: COLORS.white },
  closeText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  subtitle: { color: COLORS.muted, fontSize: 12, lineHeight: 18 },
  authLayout: { flexDirection: 'row', flexWrap: 'wrap', gap: 16, alignItems: 'stretch' },
  welcomePanel: { minHeight: 330, minWidth: 0, flexBasis: 340, flexGrow: 1, flexShrink: 1, justifyContent: 'center', padding: 26, borderRadius: 20, backgroundColor: COLORS.green, gap: 13 },
  welcomeIcon: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 17, backgroundColor: '#FFFFFF1A' },
  welcomeEyebrow: { marginTop: 7, color: COLORS.lime, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  welcomeTitle: { color: COLORS.white, fontSize: 31, fontWeight: '900' },
  welcomeCopy: { maxWidth: 370, color: '#D5E6DA', fontSize: 12, lineHeight: 19 },
  secureNote: { flexDirection: 'row', alignItems: 'center', gap: 7, alignSelf: 'flex-start', marginTop: 12, paddingHorizontal: 11, paddingVertical: 8, borderRadius: 20, backgroundColor: '#FFFFFF1A' },
  secureNoteText: { color: COLORS.white, fontSize: 9, fontWeight: '800' },
  loginCard: { minWidth: 0, flexBasis: 390, flexGrow: 1, flexShrink: 1, justifyContent: 'center', padding: 22, borderWidth: 1, borderColor: COLORS.line, borderRadius: 20, backgroundColor: COLORS.white, gap: 16 },
  formHeading: { gap: 5, marginBottom: 2 },
  cardTitle: { color: COLORS.ink, fontSize: 18, fontWeight: '900' },
  cardCopy: { color: COLORS.muted, fontSize: 11, lineHeight: 17 },
  fieldGroup: { gap: 7 },
  fieldLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  inputWrap: { minHeight: 49, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: '#FAFBF8' },
  input: { minHeight: 46, flex: 1, paddingVertical: 8, color: COLORS.ink, fontSize: 12 },
  signInButton: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 11, backgroundColor: COLORS.green },
  disabledButton: { opacity: 0.6 },
  signInText: { color: COLORS.white, fontSize: 12, fontWeight: '900' },
  formFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  formFooterText: { color: COLORS.muted, fontSize: 9 },
  accessDeniedIcon: { width: 45, height: 45, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#FBE9E8' },
  notice: { width: '100%', maxWidth: 760, alignSelf: 'center', padding: 18, borderWidth: 1, borderColor: COLORS.line, borderRadius: 16, backgroundColor: COLORS.white, gap: 10 },
  noticeTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  error: { padding: 10, borderRadius: 9, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 11, lineHeight: 16 },
  retryButton: { minHeight: 42, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderRadius: 9, backgroundColor: COLORS.lime },
  retryText: { color: COLORS.green, fontSize: 11, fontWeight: '900' },
  signOutButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 10, backgroundColor: COLORS.paper },
  signOutText: { color: COLORS.green, fontSize: 12, fontWeight: '900' },
  loadingScreen: { flex: 1, minHeight: 300, alignItems: 'center', justifyContent: 'center', gap: 12, backgroundColor: COLORS.paper },
  loadingText: { color: COLORS.muted, fontSize: 12, fontWeight: '700' },
});
