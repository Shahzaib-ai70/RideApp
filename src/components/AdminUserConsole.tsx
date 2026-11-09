import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { adminApi } from '../lib/adminApi';

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

const PAGE_SIZE = 50;

type UserRecord = {
  user_id: string;
  email: string;
  display_name: string;
  email_verified_at: string | null;
  created_at: string;
  driver_status: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isUserRecord(value: unknown): value is UserRecord {
  return isRecord(value)
    && typeof value.user_id === 'string'
    && typeof value.email === 'string'
    && typeof value.display_name === 'string'
    && (value.email_verified_at === null || typeof value.email_verified_at === 'string')
    && typeof value.created_at === 'string'
    && (value.driver_status === null || typeof value.driver_status === 'string');
}

function driverLabel(status: string | null) {
  if (!status) return 'Rider account';
  if (status === 'pending') return 'Driver application pending';
  if (status === 'approved') return 'Approved driver';
  if (status === 'needs_changes') return 'Driver changes requested';
  if (status === 'rejected') return 'Driver application rejected';
  return 'Driver application';
}

export default function AdminUserConsole({ onClose }: { onClose: () => void }) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const params = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (search) params.set('search', search);
      const result = await adminApi<unknown>(`/api/admin/users?${params.toString()}`);
      const resultTotal = isRecord(result) ? result.total : null;
      if (!isRecord(result)
        || !Array.isArray(result.users)
        || !result.users.every(isUserRecord)
        || typeof resultTotal !== 'number'
        || !Number.isSafeInteger(resultTotal)
        || resultTotal < 0) {
        throw new Error('The server returned an invalid user list.');
      }
      setUsers(result.users);
      setTotal(resultTotal);
    } catch (loadError: unknown) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load registered users.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [offset, search]);

  useEffect(() => {
    void Promise.resolve().then(() => refresh());
  }, [refresh]);

  const applySearch = () => {
    setOffset(0);
    setSearch(searchInput.trim());
  };

  const firstUser = total === 0 ? 0 : offset + 1;
  const lastUser = Math.min(offset + users.length, total);

  return (
    <ScrollView
      contentContainerStyle={styles.screen}
      refreshControl={
        <RefreshControl
          refreshing={refreshing && !loading}
          onRefresh={() => void refresh()}
          tintColor={COLORS.green}
        />
      }
    >
      <View style={styles.content}>
        <View style={styles.topBar}>
          <View style={styles.brand}>
            <View style={styles.brandMark}>
              <Ionicons name="shield-checkmark" size={19} color={COLORS.lime} />
            </View>
            <View>
              <Text style={styles.brandName}>SAWAARI</Text>
              <Text style={styles.brandCaption}>OPERATIONS CENTER</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.backButton}>
            <Ionicons name="arrow-back-outline" size={15} color={COLORS.green} />
            <Text style={styles.backText}>Dashboard</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroLabel}>
            <Ionicons name="people-outline" size={15} color={COLORS.lime} />
            <Text style={styles.heroLabelText}>ACCOUNT DIRECTORY</Text>
          </View>
          <Text style={styles.title}>Registered users</Text>
          <Text style={styles.subtitle}>
            All rider accounts are listed here. Driver application status appears separately for users who submit documents.
          </Text>
          <Text style={styles.total}>{loading ? 'Loading accounts…' : `${total} registered account${total === 1 ? '' : 's'}`}</Text>
        </View>

        <View style={styles.searchRow}>
          <View style={styles.searchInputWrap}>
            <Ionicons name="search-outline" size={17} color={COLORS.muted} />
            <TextInput
              accessibilityLabel="Search users by name or email"
              autoCapitalize="none"
              autoCorrect={false}
              onChangeText={setSearchInput}
              onSubmitEditing={applySearch}
              placeholder="Search name or email"
              returnKeyType="search"
              style={styles.searchInput}
              value={searchInput}
            />
          </View>
          <Pressable accessibilityRole="button" onPress={applySearch} style={styles.searchButton}>
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.errorCard}>
            <Ionicons name="warning-outline" size={17} color={COLORS.red} />
            <Text style={styles.errorText}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={() => void refresh()}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        {loading ? (
          <View style={styles.emptyCard}>
            <ActivityIndicator color={COLORS.green} />
            <Text style={styles.emptyText}>Loading registered accounts…</Text>
          </View>
        ) : null}
        {!loading && users.length === 0 && !error ? (
          <View style={styles.emptyCard}>
            <Ionicons name="person-outline" size={21} color={COLORS.muted} />
            <Text style={styles.emptyText}>{search ? 'No accounts match your search.' : 'No accounts have registered yet.'}</Text>
          </View>
        ) : null}

        <View style={styles.userList}>
          {users.map((user) => (
            <View key={user.user_id} style={styles.userCard}>
              <View style={styles.avatar}>
                <Ionicons name="person-outline" size={18} color={COLORS.green} />
              </View>
              <View style={styles.userCopy}>
                <Text style={styles.userName}>{user.display_name || 'Sawaari user'}</Text>
                <Text selectable style={styles.email}>{user.email}</Text>
                <Text style={styles.meta}>
                  Joined {new Date(user.created_at).toLocaleDateString()}
                  {' · '}
                  {user.email_verified_at ? 'Email verified' : 'Email not verified'}
                </Text>
              </View>
              <View style={[styles.statusBadge, user.driver_status && styles.driverBadge]}>
                <Text style={[styles.statusText, user.driver_status && styles.driverStatusText]}>
                  {driverLabel(user.driver_status)}
                </Text>
              </View>
            </View>
          ))}
        </View>

        {!loading && total > PAGE_SIZE ? (
          <View style={styles.pagination}>
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0}
              onPress={() => setOffset((current) => Math.max(0, current - PAGE_SIZE))}
              style={[styles.pageButton, offset === 0 && styles.disabledButton]}
            >
              <Ionicons name="chevron-back" size={15} color={COLORS.green} />
              <Text style={styles.pageButtonText}>Previous</Text>
            </Pressable>
            <Text style={styles.pageText}>{firstUser}–{lastUser} of {total}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={offset + PAGE_SIZE >= total}
              onPress={() => setOffset((current) => current + PAGE_SIZE)}
              style={[styles.pageButton, offset + PAGE_SIZE >= total && styles.disabledButton]}
            >
              <Text style={styles.pageButtonText}>Next</Text>
              <Ionicons name="chevron-forward" size={15} color={COLORS.green} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 42, backgroundColor: COLORS.paper, flexGrow: 1 },
  content: { width: '100%', maxWidth: 1120, alignSelf: 'center', gap: 18 },
  topBar: { minHeight: 56, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: COLORS.green },
  brandName: { color: COLORS.ink, fontSize: 14, fontWeight: '900', letterSpacing: 1.5 },
  brandCaption: { marginTop: 3, color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1.2 },
  backButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  backText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  hero: { padding: 22, borderRadius: 20, backgroundColor: COLORS.green, gap: 9 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroLabelText: { color: '#D5E6DA', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: COLORS.white, fontSize: 27, fontWeight: '900' },
  subtitle: { color: '#D5E6DA', fontSize: 11, lineHeight: 17 },
  total: { color: COLORS.lime, fontSize: 11, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  searchInputWrap: { minHeight: 46, flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: COLORS.white },
  searchInput: { minWidth: 0, flex: 1, paddingVertical: 8, color: COLORS.ink, fontSize: 12 },
  searchButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 16, borderRadius: 11, backgroundColor: COLORS.lime },
  searchButtonText: { color: COLORS.green, fontSize: 11, fontWeight: '900' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 9, padding: 12, borderRadius: 12, backgroundColor: '#FBE9E8' },
  errorText: { flex: 1, color: COLORS.red, fontSize: 10 },
  retryText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  emptyCard: { minHeight: 74, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, padding: 15, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white },
  emptyText: { color: COLORS.muted, fontSize: 11 },
  userList: { gap: 8 },
  userCard: { minHeight: 82, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E8F0E4' },
  userCopy: { minWidth: 0, flex: 1, gap: 4 },
  userName: { color: COLORS.ink, fontSize: 12, fontWeight: '900' },
  email: { color: COLORS.green, fontSize: 10 },
  meta: { color: COLORS.muted, fontSize: 9 },
  statusBadge: { maxWidth: 180, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F3EE' },
  statusText: { color: COLORS.muted, fontSize: 8, fontWeight: '800', textAlign: 'center' },
  driverBadge: { backgroundColor: '#E8F4EA' },
  driverStatusText: { color: COLORS.green },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  pageButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, backgroundColor: COLORS.white },
  pageButtonText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  pageText: { color: COLORS.muted, fontSize: 10 },
});
