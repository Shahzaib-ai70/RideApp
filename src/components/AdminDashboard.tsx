import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';

const COLORS = {
  ink: '#172621',
  muted: '#75817B',
  green: '#0E4E3D',
  lime: '#C8F169',
  paper: '#F6F7F1',
  line: '#E8EBE4',
  white: '#FFFFFF',
  red: '#C34242',
  orange: '#EF9B54',
};

type Summary = {
  pendingApplications: number;
  approvedDrivers: number;
  onlineDrivers: number;
  searchingRides: number;
  activeRides: number;
  completedToday: number;
};

type LiveDriver = {
  driver_id: string;
  driver_name: string;
  vehicle: string;
  last_seen_at: string;
};

type LiveRide = {
  request_id: string;
  status: 'searching' | 'accepted';
  rider_name: string;
  driver_name: string;
  pickup_address: string;
  destination_address: string;
  vehicle: string;
  offered_fare: number;
  created_at: string;
  updated_at: string;
};

const EMPTY_SUMMARY: Summary = {
  pendingApplications: 0,
  approvedDrivers: 0,
  onlineDrivers: 0,
  searchingRides: 0,
  activeRides: 0,
  completedToday: 0,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function parseCount(value: unknown) {
  const count = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function isLiveDriver(value: unknown): value is LiveDriver {
  return isRecord(value)
    && typeof value.driver_id === 'string'
    && typeof value.driver_name === 'string'
    && typeof value.vehicle === 'string'
    && typeof value.last_seen_at === 'string'
    && Number.isFinite(Date.parse(value.last_seen_at));
}

function isLiveRide(value: unknown): value is LiveRide {
  return isRecord(value)
    && typeof value.request_id === 'string'
    && (value.status === 'searching' || value.status === 'accepted')
    && typeof value.rider_name === 'string'
    && typeof value.driver_name === 'string'
    && typeof value.pickup_address === 'string'
    && typeof value.destination_address === 'string'
    && typeof value.vehicle === 'string'
    && typeof value.offered_fare === 'number'
    && Number.isFinite(value.offered_fare)
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export default function AdminDashboard({
  onClose,
  onOpenReviews,
}: {
  onClose: () => void;
  onOpenReviews: () => void;
}) {
  const { session } = useAuth();
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [rides, setRides] = useState<LiveRide[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [realtimeConnected, setRealtimeConnected] = useState(false);
  const active = useRef(true);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    if (!supabase || !session) {
      setError('Sign in with an authorized admin account to open this dashboard.');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      const [summaryResult, driversResult, ridesResult] = await Promise.all([
        supabase.rpc('get_admin_dashboard_summary'),
        supabase.rpc('get_admin_live_drivers'),
        supabase.rpc('get_admin_live_rides'),
      ]);
      if (summaryResult.error) throw summaryResult.error;
      if (driversResult.error) throw driversResult.error;
      if (ridesResult.error) throw ridesResult.error;

      const row = Array.isArray(summaryResult.data) && summaryResult.data.length === 1
        ? summaryResult.data[0]
        : null;
      if (!isRecord(row)) throw new Error('The server returned an invalid admin summary.');
      const counts = [
        row.pending_applications,
        row.approved_drivers,
        row.online_drivers,
        row.searching_rides,
        row.active_rides,
        row.completed_today,
      ].map(parseCount);
      if (counts.some((count) => count === null)) {
        throw new Error('The server returned invalid admin dashboard counts.');
      }
      if (!Array.isArray(driversResult.data) || !driversResult.data.every(isLiveDriver)) {
        throw new Error('The server returned an invalid online driver list.');
      }
      if (!Array.isArray(ridesResult.data) || !ridesResult.data.every(isLiveRide)) {
        throw new Error('The server returned an invalid active ride list.');
      }
      if (!active.current || refreshVersion.current !== version) return;

      setSummary({
        pendingApplications: counts[0] ?? 0,
        approvedDrivers: counts[1] ?? 0,
        onlineDrivers: counts[2] ?? 0,
        searchingRides: counts[3] ?? 0,
        activeRides: counts[4] ?? 0,
        completedToday: counts[5] ?? 0,
      });
      setDrivers(driversResult.data);
      setRides(ridesResult.data);
      setLastUpdated(new Date().toISOString());
      setError('');
    } catch (loadError: unknown) {
      if (!active.current || refreshVersion.current !== version) return;
      setError(loadError instanceof Error
        ? loadError.message
        : 'Could not load live admin dashboard data.');
    } finally {
      if (active.current && refreshVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [session]);

  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void refresh();
    });
    const client = supabase;
    if (!client || !session) {
      return () => {
        active.current = false;
        refreshVersion.current += 1;
      };
    }

    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        if (active.current) void refresh();
      }, 350);
    };
    const channel = client.channel(`sawaari-admin-${session.user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'admin_dashboard_events',
      }, scheduleRefresh)
      .subscribe((status) => {
        if (active.current) setRealtimeConnected(status === 'SUBSCRIBED');
      });
    const fallbackTimer = setInterval(() => {
      if (active.current) void refresh();
    }, 30000);

    return () => {
      active.current = false;
      refreshVersion.current += 1;
      if (refreshTimer) clearTimeout(refreshTimer);
      clearInterval(fallbackTimer);
      void client.removeChannel(channel);
    };
  }, [refresh, session]);

  const metrics: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; accent?: boolean }[] = [
    { label: 'Waiting for review', value: summary.pendingApplications, icon: 'document-text-outline', accent: true },
    { label: 'Approved drivers', value: summary.approvedDrivers, icon: 'shield-checkmark-outline' },
    { label: 'Drivers online', value: summary.onlineDrivers, icon: 'radio-outline' },
    { label: 'Searching rides', value: summary.searchingRides, icon: 'search-outline' },
    { label: 'Rides in progress', value: summary.activeRides, icon: 'car-outline' },
    { label: 'Completed today', value: summary.completedToday, icon: 'checkmark-done-outline' },
  ];

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
      <View style={styles.headingRow}>
        <View style={styles.headingCopy}>
          <Text style={styles.eyebrow}>SAWAARI OPERATIONS</Text>
          <Text style={styles.title}>Admin dashboard</Text>
        </View>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeText}>Close</Text>
        </Pressable>
      </View>
      <View style={styles.liveRow}>
        <View style={[styles.liveDot, realtimeConnected ? styles.liveDotOn : styles.liveDotOff]} />
        <Text style={styles.liveText}>
          {realtimeConnected ? 'Live updates connected' : 'Reconnecting · checking every 30 seconds'}
        </Text>
        {lastUpdated ? <Text style={styles.updatedText}>Updated {formatTime(lastUpdated)}</Text> : null}
      </View>

      <Pressable accessibilityRole="button" onPress={onOpenReviews} style={styles.reviewButton}>
        <Ionicons name="shield-checkmark-outline" size={18} color={COLORS.green} />
        <Text style={styles.reviewButtonText}>Review driver applications</Text>
        <Ionicons name="chevron-forward" size={17} color={COLORS.green} />
      </Pressable>

      {error ? (
        <View style={styles.errorCard}>
          <Text style={styles.errorTitle}>Dashboard could not refresh</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retryButton}>
            <Text style={styles.retryText}>Try again</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Today at a glance</Text>
        {loading ? <ActivityIndicator size="small" color={COLORS.green} /> : null}
      </View>
      <View style={styles.metricsGrid}>
        {metrics.map((metric) => (
          <View key={metric.label} style={[styles.metricCard, metric.accent && styles.metricCardAccent]}>
            <View style={styles.metricTop}>
              <Ionicons name={metric.icon} size={17} color={metric.accent ? COLORS.green : COLORS.muted} />
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
            <Text style={styles.metricValue}>{loading ? '—' : metric.value}</Text>
          </View>
        ))}
      </View>

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Online drivers</Text>
        <Text style={styles.sectionCount}>{drivers.length} active</Text>
      </View>
      {drivers.length === 0 && !loading ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No approved drivers are currently online.</Text>
        </View>
      ) : null}
      {drivers.map((driver) => (
        <View key={driver.driver_id} style={styles.listCard}>
          <View style={styles.avatar}>
            <Ionicons name="person-outline" size={17} color={COLORS.green} />
          </View>
          <View style={styles.listCopy}>
            <Text style={styles.listTitle}>{driver.driver_name || 'Sawaari driver'}</Text>
            <Text style={styles.listDetail}>{driver.vehicle} · location updated {formatTime(driver.last_seen_at)}</Text>
          </View>
          <View style={styles.onlineBadge}><Text style={styles.onlineText}>ONLINE</Text></View>
        </View>
      ))}

      <View style={styles.sectionHeading}>
        <Text style={styles.sectionTitle}>Live rides</Text>
        <Text style={styles.sectionCount}>{rides.length} active</Text>
      </View>
      {rides.length === 0 && !loading ? (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No searching or in-progress rides right now.</Text>
        </View>
      ) : null}
      {rides.map((ride) => (
        <View key={ride.request_id} style={styles.rideCard}>
          <View style={styles.rideTopRow}>
            <Text style={styles.listTitle}>{ride.status === 'searching' ? 'Finding a driver' : 'Ride in progress'}</Text>
            <Text style={styles.fare}>PKR {ride.offered_fare}</Text>
          </View>
          <Text style={styles.listDetail}>
            {ride.rider_name || 'Rider'} · {ride.vehicle} · {ride.status === 'accepted'
              ? `Driver: ${ride.driver_name || 'Assigned'}`
              : 'No driver assigned'}
          </Text>
          <Text style={styles.routeText} numberOfLines={2}>
            {ride.pickup_address} → {ride.destination_address}
          </Text>
          <Text style={styles.timeText}>Requested {formatTime(ride.created_at)}</Text>
        </View>
      ))}

      <Text style={styles.disclaimer}>
        Admin access is limited to authorized reviewer accounts. Driver documents are kept in the separate review queue and are not shown on this dashboard. Live online state expires if a driver stops sending location updates.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 18, paddingBottom: 36, gap: 12, backgroundColor: COLORS.paper, flexGrow: 1 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  headingCopy: { flex: 1 },
  eyebrow: { marginTop: 6, color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { marginTop: 4, color: COLORS.ink, fontSize: 24, fontWeight: '800' },
  closeButton: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, backgroundColor: '#E7F3E2' },
  closeText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  liveRow: { minHeight: 34, flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  liveDotOn: { backgroundColor: '#2D9B63' },
  liveDotOff: { backgroundColor: COLORS.orange },
  liveText: { flex: 1, color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  updatedText: { color: COLORS.muted, fontSize: 9 },
  reviewButton: { minHeight: 46, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 13, borderRadius: 11, backgroundColor: COLORS.lime },
  reviewButtonText: { flex: 1, color: COLORS.green, fontSize: 12, fontWeight: '800' },
  errorCard: { padding: 12, borderRadius: 11, backgroundColor: '#FBE9E8', gap: 5 },
  errorTitle: { color: COLORS.red, fontSize: 11, fontWeight: '800' },
  errorText: { color: COLORS.red, fontSize: 10, lineHeight: 15 },
  retryButton: { alignSelf: 'flex-start', marginTop: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: COLORS.white },
  retryText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  sectionHeading: { minHeight: 30, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '800' },
  sectionCount: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  metricCard: { width: '48%', flexGrow: 1, minHeight: 91, padding: 12, borderRadius: 13, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 11 },
  metricCardAccent: { backgroundColor: '#EFF5E7', borderColor: '#D5E4C8' },
  metricTop: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metricLabel: { flex: 1, color: COLORS.muted, fontSize: 9, fontWeight: '700' },
  metricValue: { color: COLORS.ink, fontSize: 23, fontWeight: '800' },
  emptyCard: { padding: 15, borderRadius: 12, backgroundColor: COLORS.white },
  emptyText: { color: COLORS.muted, fontSize: 11 },
  listCard: { minHeight: 61, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 11, borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  avatar: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E7F3E2' },
  listCopy: { flex: 1, gap: 4 },
  listTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  listDetail: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  onlineBadge: { paddingHorizontal: 7, paddingVertical: 5, borderRadius: 7, backgroundColor: '#E7F3E2' },
  onlineText: { color: COLORS.green, fontSize: 8, fontWeight: '800' },
  rideCard: { padding: 12, borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 7 },
  rideTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  fare: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  routeText: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
  timeText: { color: COLORS.muted, fontSize: 9 },
  disclaimer: { marginTop: 4, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
});
