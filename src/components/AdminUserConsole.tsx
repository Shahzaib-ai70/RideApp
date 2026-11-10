import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './AppText';
import { adminApi } from '../lib/adminApi';
import RideMap from './RideMap';
import type { MapPoint } from './ride-map.types';

const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  lime: '#D9F5EA',
  paper: '#F1F6F5',
  line: '#DCE8E5',
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
  current_restriction_until: string | null;
  current_restriction_reason: string | null;
};

type UserRideHistory = {
  request_id: string;
  status: 'searching' | 'accepted' | 'completed' | 'cancelled';
  user_role: 'rider' | 'driver';
  other_party_name: string;
  other_party_email: string;
  pickup_address: string;
  destination_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  vehicle: string;
  offered_fare: number;
  cash_collected: boolean;
  created_at: string;
  updated_at: string;
  driver_latitude: number | null;
  driver_longitude: number | null;
  driver_location_at: string | null;
  driver_location_is_live: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isRideHistory(value: unknown): value is UserRideHistory {
  return isRecord(value)
    && typeof value.request_id === 'string'
    && ['searching', 'accepted', 'completed', 'cancelled'].includes(String(value.status))
    && (value.user_role === 'rider' || value.user_role === 'driver')
    && typeof value.other_party_name === 'string'
    && typeof value.other_party_email === 'string'
    && typeof value.pickup_address === 'string'
    && typeof value.destination_address === 'string'
    && typeof value.pickup_latitude === 'number'
    && Number.isFinite(value.pickup_latitude)
    && typeof value.pickup_longitude === 'number'
    && Number.isFinite(value.pickup_longitude)
    && typeof value.destination_latitude === 'number'
    && Number.isFinite(value.destination_latitude)
    && typeof value.destination_longitude === 'number'
    && Number.isFinite(value.destination_longitude)
    && typeof value.vehicle === 'string'
    && typeof value.offered_fare === 'number'
    && Number.isFinite(value.offered_fare)
    && typeof value.cash_collected === 'boolean'
    && typeof value.created_at === 'string'
    && Number.isFinite(Date.parse(value.created_at))
    && typeof value.updated_at === 'string'
    && Number.isFinite(Date.parse(value.updated_at))
    && (typeof value.driver_latitude === 'number' || value.driver_latitude === null)
    && (typeof value.driver_longitude === 'number' || value.driver_longitude === null)
    && (typeof value.driver_location_at === 'string' || value.driver_location_at === null)
    && typeof value.driver_location_is_live === 'boolean';
}

function parseRideHistoryResponse(value: unknown) {
  if (!isRecord(value)
    || !Array.isArray(value.rides)
    || typeof value.total !== 'number'
    || !Number.isSafeInteger(value.total)
    || value.total < 0) {
    throw new Error('The server returned invalid ride history.');
  }
  const rides = value.rides.filter(isRideHistory);
  if (rides.length !== value.rides.length) {
    throw new Error('The server returned invalid ride history.');
  }
  return { rides, total: value.total };
}

function isUserRecord(value: unknown): value is UserRecord {
  return isRecord(value)
    && typeof value.user_id === 'string'
    && typeof value.email === 'string'
    && typeof value.display_name === 'string'
    && (value.email_verified_at === null || typeof value.email_verified_at === 'string')
    && typeof value.created_at === 'string'
    && (value.driver_status === null || typeof value.driver_status === 'string')
    && (value.current_restriction_until === null
      || (typeof value.current_restriction_until === 'string'
        && Number.isFinite(Date.parse(value.current_restriction_until))))
    && (value.current_restriction_reason === null
      || typeof value.current_restriction_reason === 'string');
}

function driverLabel(status: string | null) {
  if (!status) return 'Rider account';
  if (status === 'pending') return 'Driver application pending';
  if (status === 'approved') return 'Approved driver';
  if (status === 'needs_changes') return 'Driver changes requested';
  if (status === 'rejected') return 'Driver application rejected';
  return 'Driver application';
}

export default function AdminUserConsole({
  onClose,
  initialSearch = '',
}: {
  onClose: () => void;
  initialSearch?: string;
}) {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [searchInput, setSearchInput] = useState(initialSearch);
  const [search, setSearch] = useState(initialSearch);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [historyUserId, setHistoryUserId] = useState<string | null>(null);
  const [history, setHistory] = useState<UserRideHistory[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [mapRideId, setMapRideId] = useState<string | null>(null);
  const historyRequestVersion = useRef(0);
  const [profileUser, setProfileUser] = useState<UserRecord | null>(null);
  const [restrictionDuration, setRestrictionDuration] = useState('24');
  const [restrictionReason, setRestrictionReason] = useState('');
  const [restrictionBusy, setRestrictionBusy] = useState(false);
  const [restrictionError, setRestrictionError] = useState('');

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
    setHistoryUserId(null);
    setHistory([]);
    setMapRideId(null);
  };

  const loadUserHistory = async (user: UserRecord) => {
    const requestVersion = ++historyRequestVersion.current;
    setHistoryUserId(user.user_id);
    setHistory([]);
    setHistoryTotal(0);
    setHistoryError('');
    setMapRideId(null);
    setHistoryLoading(true);
    setHistoryLoadingMore(false);
    try {
      const result = parseRideHistoryResponse(await adminApi<unknown>(
        `/api/admin/users/${encodeURIComponent(user.user_id)}/history?limit=${PAGE_SIZE}&offset=0`,
      ));
      if (historyRequestVersion.current !== requestVersion) return;
      setHistory(result.rides);
      setHistoryTotal(result.total);
    } catch (loadError: unknown) {
      if (historyRequestVersion.current === requestVersion) {
        setHistoryError(loadError instanceof Error ? loadError.message : 'Could not load this user’s ride history.');
      }
    } finally {
      if (historyRequestVersion.current === requestVersion) setHistoryLoading(false);
    }
  };

  const openProfile = (user: UserRecord) => {
    setProfileUser(user);
    setRestrictionDuration('24');
    setRestrictionReason(user.current_restriction_reason ?? '');
    setRestrictionError('');
    void loadUserHistory(user);
  };

  const closeProfile = () => {
    historyRequestVersion.current += 1;
    setProfileUser(null);
    setHistoryUserId(null);
    setHistory([]);
    setHistoryError('');
    setMapRideId(null);
    setRestrictionError('');
  };

  const applyRestriction = async (permanent: boolean) => {
    if (!profileUser) return;
    const durationHours = Number(restrictionDuration);
    const reason = restrictionReason.trim();
    if (reason.length < 5 || reason.length > 500) {
      setRestrictionError('Enter a short reason between 5 and 500 characters.');
      return;
    }
    if (!permanent && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720)) {
      setRestrictionError('Enter a restriction from 1 to 720 hours.');
      return;
    }
    setRestrictionBusy(true);
    setRestrictionError('');
    try {
      const result = await adminApi<{
        success: boolean;
        restricted_until: string | null;
      }>(`/api/admin/users/${encodeURIComponent(profileUser.user_id)}/restriction`, {
        method: 'POST',
        body: JSON.stringify({
          permanent,
          ...(permanent ? {} : { duration_hours: durationHours }),
          reason,
        }),
      });
      if (!result.success
        || (result.restricted_until !== null && !Number.isFinite(Date.parse(result.restricted_until)))) {
        throw new Error('The server did not confirm the account restriction.');
      }
      const updatedUser = {
        ...profileUser,
        current_restriction_until: result.restricted_until,
        current_restriction_reason: reason,
      };
      setProfileUser(updatedUser);
      setUsers((current) => current.map((user) => (
        user.user_id === updatedUser.user_id ? updatedUser : user
      )));
      setRestrictionError('');
    } catch (error: unknown) {
      setRestrictionError(error instanceof Error ? error.message : 'Could not restrict this account.');
    } finally {
      setRestrictionBusy(false);
    }
  };

  const liftRestriction = async () => {
    if (!profileUser) return;
    setRestrictionBusy(true);
    setRestrictionError('');
    try {
      const result = await adminApi<{ success: boolean }>(
        `/api/admin/users/${encodeURIComponent(profileUser.user_id)}/restriction`,
        { method: 'DELETE' },
      );
      if (!result.success) throw new Error('The server did not confirm the restriction was lifted.');
      const updatedUser = {
        ...profileUser,
        current_restriction_until: null,
        current_restriction_reason: null,
      };
      setProfileUser(updatedUser);
      setUsers((current) => current.map((user) => (
        user.user_id === updatedUser.user_id ? updatedUser : user
      )));
      setRestrictionReason('');
    } catch (error: unknown) {
      setRestrictionError(error instanceof Error ? error.message : 'Could not lift this restriction.');
    } finally {
      setRestrictionBusy(false);
    }
  };

  const loadMoreHistory = async () => {
    if (!historyUserId || historyLoadingMore || history.length >= historyTotal) return;
    const requestedUserId = historyUserId;
    const requestVersion = historyRequestVersion.current;
    setHistoryLoadingMore(true);
    setHistoryError('');
    try {
      const result = parseRideHistoryResponse(await adminApi<unknown>(
        `/api/admin/users/${encodeURIComponent(requestedUserId)}/history?limit=${PAGE_SIZE}&offset=${history.length}`,
      ));
      if (historyRequestVersion.current !== requestVersion) return;
      setHistory((current) => [...current, ...result.rides]);
      setHistoryTotal(result.total);
    } catch (loadError: unknown) {
      if (historyRequestVersion.current === requestVersion) {
        setHistoryError(loadError instanceof Error ? loadError.message : 'Could not load more ride history.');
      }
    } finally {
      if (historyRequestVersion.current === requestVersion) setHistoryLoadingMore(false);
    }
  };

  const firstUser = total === 0 ? 0 : offset + 1;
  const lastUser = Math.min(offset + users.length, total);
  const historyLocation = (ride: UserRideHistory): MapPoint | null => (
    ride.driver_latitude === null || ride.driver_longitude === null
      ? null
      : { latitude: ride.driver_latitude, longitude: ride.driver_longitude }
  );

  const renderHistoryRide = (ride: UserRideHistory) => {
    const location = historyLocation(ride);
    const showMap = mapRideId === ride.request_id;
    const statusLabel = ride.status === 'accepted'
      ? 'In progress'
      : ride.status === 'searching'
        ? 'Finding a driver'
        : ride.status === 'completed'
          ? 'Completed'
          : 'Cancelled';
    return (
      <View key={ride.request_id} style={styles.historyRide}>
        <View style={styles.historyRideTop}>
          <View style={[styles.historyStatus, ride.status === 'completed' && styles.historyStatusComplete]}>
            <View style={[styles.historyDot, ride.status === 'completed' && styles.historyDotComplete]} />
            <Text style={styles.historyStatusText}>{statusLabel}</Text>
          </View>
          <Text style={styles.historyFare}>PKR {ride.offered_fare.toLocaleString()}</Text>
        </View>
        <Text style={styles.historyOtherParty}>
          {ride.user_role === 'rider' ? 'Driver' : 'Rider'} · {ride.other_party_name}
          {ride.other_party_email ? ` · ${ride.other_party_email}` : ''}
        </Text>
        <View style={styles.historyRoute}>
          <Text style={styles.historyRouteText}>Pickup · {ride.pickup_address}</Text>
          <Text style={styles.historyRouteText}>Destination · {ride.destination_address}</Text>
        </View>
        <Text style={styles.historyMeta}>
          {ride.user_role === 'rider' ? 'Rider trip' : 'Driver trip'} · {ride.vehicle}
          {' · '}{ride.cash_collected ? 'Cash recorded as collected' : 'Cash not confirmed'}
        </Text>
        <Text style={styles.historyMeta}>
          {new Date(ride.created_at).toLocaleString()} · Updated {new Date(ride.updated_at).toLocaleString()}
        </Text>
        <View style={styles.historyLocation}>
          <Text style={styles.historyLocationTitle}>
            {ride.driver_location_is_live ? 'LIVE DRIVER LOCATION' : 'LAST RECORDED DRIVER LOCATION'}
          </Text>
          {location ? (
            <>
              <Text style={styles.historyMeta}>
                {location.latitude.toFixed(6)}, {location.longitude.toFixed(6)}
              </Text>
              <Text style={styles.historyMeta}>
                {ride.driver_location_at
                  ? `Reported ${new Date(ride.driver_location_at).toLocaleString()}`
                  : 'Location time unavailable'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMapRideId(showMap ? null : ride.request_id)}
                style={styles.mapButton}
              >
                <Ionicons name={showMap ? 'close-outline' : 'map-outline'} size={14} color={COLORS.green} />
                <Text style={styles.mapButtonText}>{showMap ? 'Hide map' : 'View ride map'}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.historyMeta}>No driver location was recorded for this ride.</Text>
          )}
        </View>
        {showMap && location ? (
          <View style={styles.mapFrame}>
            <RideMap
              region={{
                latitude: (location.latitude + ride.pickup_latitude) / 2,
                longitude: (location.longitude + ride.pickup_longitude) / 2,
                latitudeDelta: Math.max(0.02, Math.abs(location.latitude - ride.pickup_latitude) * 2),
                longitudeDelta: Math.max(0.02, Math.abs(location.longitude - ride.pickup_longitude) * 2),
              }}
              pickup={{ latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }}
              destination={{ latitude: ride.destination_latitude, longitude: ride.destination_longitude }}
              acceptedDriverLocation={location}
              acceptedDriverVehicle={ride.vehicle}
              acceptedDriverTitle={ride.user_role === 'driver' ? 'You' : ride.other_party_name}
              acceptedDriverDescription={ride.driver_location_is_live ? 'Live location' : 'Last recorded location'}
              followAcceptedDriver={ride.driver_location_is_live}
              locationGranted={false}
              onRegionChange={() => undefined}
            />
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <>
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
            Find a rider or driver, then open that account’s ride history when you need it.
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
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open profile and ride history for ${user.display_name || user.email}`}
              key={user.user_id}
              onPress={() => openProfile(user)}
              style={styles.userCard}
            >
              <View style={styles.userCardTop}>
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
                <View style={[
                  styles.statusBadge,
                  user.current_restriction_reason
                    ? styles.restrictedBadge
                    : user.driver_status && styles.driverBadge,
                ]}>
                  <Text style={[
                    styles.statusText,
                    user.current_restriction_reason
                      ? styles.restrictedStatusText
                      : user.driver_status && styles.driverStatusText,
                  ]}>
                    {user.current_restriction_reason ? 'Restricted' : driverLabel(user.driver_status)}
                  </Text>
                </View>
              </View>
              <View style={styles.historyToggle}>
                <Ionicons name="time-outline" size={15} color={COLORS.green} />
                <Text style={styles.historyToggleText}>Open profile, ride history & safety controls</Text>
                <Ionicons name="chevron-forward" size={15} color={COLORS.green} />
              </View>
            </Pressable>
          ))}
        </View>

        {!loading && total > PAGE_SIZE ? (
          <View style={styles.pagination}>
            <Pressable
              accessibilityRole="button"
              disabled={offset === 0}
              onPress={() => {
                closeProfile();
                setOffset((current) => Math.max(0, current - PAGE_SIZE));
              }}
              style={[styles.pageButton, offset === 0 && styles.disabledButton]}
            >
              <Ionicons name="chevron-back" size={15} color={COLORS.green} />
              <Text style={styles.pageButtonText}>Previous</Text>
            </Pressable>
            <Text style={styles.pageText}>{firstUser}–{lastUser} of {total}</Text>
            <Pressable
              accessibilityRole="button"
              disabled={offset + PAGE_SIZE >= total}
              onPress={() => {
                closeProfile();
                setOffset((current) => current + PAGE_SIZE);
              }}
              style={[styles.pageButton, offset + PAGE_SIZE >= total && styles.disabledButton]}
            >
              <Text style={styles.pageButtonText}>Next</Text>
              <Ionicons name="chevron-forward" size={15} color={COLORS.green} />
            </Pressable>
          </View>
        ) : null}
      </View>
    </ScrollView>
    <Modal
      animationType="fade"
      onRequestClose={() => {
        if (!restrictionBusy) closeProfile();
      }}
      transparent
      visible={Boolean(profileUser)}
    >
      <View style={styles.modalBackdrop}>
        <View style={styles.profileModal}>
          <View style={styles.modalHeader}>
            <View style={styles.modalHeadingCopy}>
              <Text style={styles.modalTitle}>{profileUser?.display_name || 'User profile'}</Text>
              <Text selectable style={styles.email}>{profileUser?.email}</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              disabled={restrictionBusy}
              accessibilityLabel="Close user profile"
              onPress={closeProfile}
              style={[styles.modalClose, restrictionBusy && styles.historyDisabledButton]}
            >
              <Ionicons name="close" size={20} color={COLORS.ink} />
            </Pressable>
          </View>
          {profileUser ? (
            <ScrollView contentContainerStyle={styles.modalScrollContent}>
              <View style={styles.profileSummary}>
                <Text style={styles.profileSummaryText}>
                  {driverLabel(profileUser.driver_status)} · Joined {new Date(profileUser.created_at).toLocaleDateString()}
                  {' · '}{profileUser.email_verified_at ? 'Email verified' : 'Email not verified'}
                </Text>
              </View>
              <View style={styles.restrictionPanel}>
                <View style={styles.historyHeading}>
                  <Text style={styles.historyTitle}>Account access restriction</Text>
                  {profileUser.current_restriction_reason ? (
                    <View style={styles.restrictedBadge}>
                      <Text style={styles.restrictedStatusText}>ACTIVE</Text>
                    </View>
                  ) : null}
                </View>
                {profileUser.current_restriction_reason ? (
                  <>
                    <Text style={styles.restrictionReason}>
                      {profileUser.current_restriction_reason}
                    </Text>
                    <Text style={styles.historyMeta}>
                      {profileUser.current_restriction_until
                        ? `Ends ${new Date(profileUser.current_restriction_until).toLocaleString()}`
                        : 'Permanent restriction'}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      disabled={restrictionBusy}
                      onPress={() => void liftRestriction()}
                      style={[styles.liftRestrictionButton, restrictionBusy && styles.historyDisabledButton]}
                    >
                      {restrictionBusy
                        ? <ActivityIndicator size="small" color={COLORS.green} />
                        : <Ionicons name="lock-open-outline" size={15} color={COLORS.green} />}
                      <Text style={styles.liftRestrictionText}>Lift restriction</Text>
                    </Pressable>
                  </>
                ) : (
                  <Text style={styles.historyMeta}>
                    Restriction prevents new ride bookings and driving. Sign-in and history remain available.
                  </Text>
                )}
                <Text style={styles.restrictionLabel}>Reason for restriction</Text>
                <TextInput
                  accessibilityLabel="Reason for account restriction"
                  editable={!restrictionBusy}
                  maxLength={500}
                  onChangeText={setRestrictionReason}
                  placeholder="Briefly explain the report or safety concern"
                  style={styles.restrictionInput}
                  value={restrictionReason}
                />
                <View style={styles.restrictionDurationRow}>
                  <View style={styles.restrictionDurationCopy}>
                    <Text style={styles.restrictionLabel}>Duration in hours (1–720)</Text>
                    <TextInput
                      accessibilityLabel="Restriction duration in hours"
                      editable={!restrictionBusy}
                      keyboardType="number-pad"
                      maxLength={3}
                      onChangeText={setRestrictionDuration}
                      style={styles.durationInput}
                      value={restrictionDuration}
                    />
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={restrictionBusy}
                    onPress={() => void applyRestriction(false)}
                    style={[styles.restrictButton, restrictionBusy && styles.historyDisabledButton]}
                  >
                    {restrictionBusy
                      ? <ActivityIndicator size="small" color={COLORS.white} />
                      : <Ionicons name="time-outline" size={15} color={COLORS.white} />}
                    <Text style={styles.restrictButtonText}>Restrict temporarily</Text>
                  </Pressable>
                </View>
                <Pressable
                  accessibilityRole="button"
                  disabled={restrictionBusy}
                  onPress={() => void applyRestriction(true)}
                  style={[styles.blockButton, restrictionBusy && styles.historyDisabledButton]}
                >
                  <Ionicons name="ban-outline" size={15} color={COLORS.white} />
                  <Text style={styles.restrictButtonText}>Block account permanently</Text>
                </Pressable>
                {restrictionError ? <Text style={styles.errorText}>{restrictionError}</Text> : null}
              </View>
              <View style={styles.historyPanel}>
                <View style={styles.historyHeading}>
                  <Text style={styles.historyTitle}>Ride history</Text>
                  {!historyLoading
                    ? <Text style={styles.historyCount}>{historyTotal} rides</Text>
                    : null}
                </View>
                {historyLoading ? (
                  <View style={styles.historyMessage}>
                    <ActivityIndicator color={COLORS.green} />
                    <Text style={styles.emptyText}>Loading ride history…</Text>
                  </View>
                ) : null}
                {historyError ? (
                  <View style={styles.historyError}>
                    <Ionicons name="warning-outline" size={16} color={COLORS.red} />
                    <Text style={styles.errorText}>{historyError}</Text>
                    <Pressable onPress={() => void loadUserHistory(profileUser)}>
                      <Text style={styles.retryText}>Retry</Text>
                    </Pressable>
                  </View>
                ) : null}
                {!historyLoading && !historyError && history.length === 0 ? (
                  <View style={styles.historyMessage}>
                    <Ionicons name="time-outline" size={19} color={COLORS.muted} />
                    <Text style={styles.emptyText}>No rides found for this account.</Text>
                  </View>
                ) : null}
                {history.map(renderHistoryRide)}
                {history.length < historyTotal ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={historyLoadingMore}
                    onPress={() => void loadMoreHistory()}
                    style={[styles.loadMoreButton, historyLoadingMore && styles.historyDisabledButton]}
                  >
                    {historyLoadingMore
                      ? <ActivityIndicator size="small" color={COLORS.green} />
                      : <Ionicons name="add-circle-outline" size={16} color={COLORS.green} />}
                    <Text style={styles.loadMoreText}>
                      {historyLoadingMore ? 'Loading more…' : `Load more (${history.length} of ${historyTotal})`}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
            </ScrollView>
          ) : null}
        </View>
      </View>
    </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  modalBackdrop: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 14, backgroundColor: 'rgba(10, 28, 35, 0.62)' },
  profileModal: { width: '100%', maxWidth: 720, maxHeight: '92%', overflow: 'hidden', borderRadius: 18, backgroundColor: COLORS.paper },
  modalHeader: { minHeight: 68, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 17, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: COLORS.line, backgroundColor: COLORS.white },
  modalHeadingCopy: { minWidth: 0, flex: 1, gap: 4 },
  modalTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '900' },
  modalClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#EFF4F2' },
  modalScrollContent: { gap: 12, padding: 15 },
  profileSummary: { padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: COLORS.white },
  profileSummaryText: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  restrictionPanel: { gap: 10, padding: 13, borderWidth: 1, borderColor: COLORS.line, borderRadius: 13, backgroundColor: COLORS.white },
  restrictedBadge: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: '#FBE9E8' },
  restrictedStatusText: { color: COLORS.red, fontSize: 8, fontWeight: '900' },
  restrictionReason: { color: COLORS.ink, fontSize: 11, lineHeight: 16 },
  restrictionLabel: { color: COLORS.ink, fontSize: 10, fontWeight: '800' },
  restrictionInput: { minHeight: 42, paddingHorizontal: 10, paddingVertical: 8, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, color: COLORS.ink, fontSize: 11 },
  restrictionDurationRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 10 },
  restrictionDurationCopy: { width: 112, gap: 6 },
  durationInput: { minHeight: 40, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, color: COLORS.ink, fontSize: 12 },
  restrictButton: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: COLORS.green },
  restrictButtonText: { color: COLORS.white, fontSize: 10, fontWeight: '900', textAlign: 'center' },
  blockButton: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: COLORS.red },
  liftRestrictionButton: { minHeight: 38, alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#EFF7F3' },
  liftRestrictionText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
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
  userCard: { gap: 10, padding: 12, borderWidth: 1, borderColor: COLORS.line, borderRadius: 14, backgroundColor: COLORS.white },
  userCardTop: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11 },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E8F0E4' },
  userCopy: { minWidth: 0, flex: 1, gap: 4 },
  userName: { color: COLORS.ink, fontSize: 12, fontWeight: '900' },
  email: { color: COLORS.green, fontSize: 10 },
  meta: { color: COLORS.muted, fontSize: 9 },
  statusBadge: { maxWidth: 180, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 20, backgroundColor: '#F1F3EE' },
  statusText: { color: COLORS.muted, fontSize: 8, fontWeight: '800', textAlign: 'center' },
  driverBadge: { backgroundColor: '#E8F4EA' },
  driverStatusText: { color: COLORS.green },
  historyToggle: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#EFF7F3' },
  historyToggleText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '900' },
  historyPanel: { gap: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: COLORS.line },
  historyHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyTitle: { flex: 1, color: COLORS.ink, fontSize: 12, fontWeight: '900' },
  historyCount: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  historyMessage: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, padding: 12, borderRadius: 10, backgroundColor: '#F6F8F7' },
  historyError: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: 10, backgroundColor: '#FBE9E8' },
  historyRide: { gap: 9, padding: 11, borderWidth: 1, borderColor: COLORS.line, borderRadius: 11, backgroundColor: '#FBFDFC' },
  historyRideTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  historyStatus: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 20, backgroundColor: '#E9EEF2' },
  historyStatusComplete: { backgroundColor: '#E8F4EA' },
  historyDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.muted },
  historyDotComplete: { backgroundColor: '#2D9B63' },
  historyStatusText: { color: COLORS.ink, fontSize: 9, fontWeight: '800' },
  historyFare: { color: COLORS.green, fontSize: 11, fontWeight: '900' },
  historyOtherParty: { color: COLORS.ink, fontSize: 10, fontWeight: '700' },
  historyRoute: { gap: 5, padding: 9, borderRadius: 9, backgroundColor: '#F1F5F3' },
  historyRouteText: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
  historyMeta: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  historyLocation: { gap: 5, padding: 9, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, backgroundColor: '#F8FBFA' },
  historyLocationTitle: { color: COLORS.ink, fontSize: 9, fontWeight: '900', letterSpacing: 0.4 },
  mapButton: { alignSelf: 'flex-start', minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, borderRadius: 8, backgroundColor: COLORS.lime },
  mapButtonText: { color: COLORS.green, fontSize: 9, fontWeight: '900' },
  mapFrame: { height: 220, overflow: 'hidden', borderRadius: 10, borderWidth: 1, borderColor: COLORS.line },
  loadMoreButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, padding: 9, borderRadius: 9, backgroundColor: '#EFF7F3' },
  loadMoreText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  historyDisabledButton: { opacity: 0.55 },
  pagination: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, paddingVertical: 4 },
  pageButton: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 10, backgroundColor: COLORS.white },
  pageButtonText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  disabledButton: { opacity: 0.45 },
  pageText: { color: COLORS.muted, fontSize: 10 },
});
