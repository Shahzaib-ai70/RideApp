import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text } from './AppText';
import { adminApi } from '../lib/adminApi';
import { withTimeout } from '../lib/withTimeout';
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
  orange: '#E79A54',
};

type Summary = {
  pendingApplications: number;
  totalUsers: number;
  approvedDrivers: number;
  onlineDrivers: number;
  searchingRides: number;
  activeRides: number;
  completedToday: number;
  openReports: number;
};

type LiveDriver = {
  driver_id: string;
  driver_name: string;
  driver_email: string;
  vehicle: string;
  last_seen_at: string;
};

type AdminRide = {
  request_id: string;
  status: 'searching' | 'accepted' | 'completed' | 'cancelled';
  rider_id: string;
  rider_name: string;
  rider_email: string;
  driver_id: string | null;
  driver_name: string;
  driver_email: string;
  pickup_address: string;
  destination_address: string;
  pickup_latitude: number;
  pickup_longitude: number;
  destination_latitude: number;
  destination_longitude: number;
  vehicle: string;
  offered_fare: number;
  driver_offer_fare: number | null;
  driver_offer_status: 'pending' | 'rejected' | 'accepted' | null;
  cash_collected: boolean;
  created_at: string;
  updated_at: string;
  driver_latitude: number | null;
  driver_longitude: number | null;
  driver_location_at: string | null;
  driver_location_is_live: boolean;
};

const EMPTY_SUMMARY: Summary = {
  pendingApplications: 0,
  totalUsers: 0,
  approvedDrivers: 0,
  onlineDrivers: 0,
  searchingRides: 0,
  activeRides: 0,
  completedToday: 0,
  openReports: 0,
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
    && typeof value.driver_email === 'string'
    && typeof value.vehicle === 'string'
    && typeof value.last_seen_at === 'string'
    && Number.isFinite(Date.parse(value.last_seen_at));
}

function isAdminRide(value: unknown): value is AdminRide {
  return isRecord(value)
    && typeof value.request_id === 'string'
    && ['searching', 'accepted', 'completed', 'cancelled'].includes(String(value.status))
    && typeof value.rider_id === 'string'
    && typeof value.rider_name === 'string'
    && typeof value.rider_email === 'string'
    && (typeof value.driver_id === 'string' || value.driver_id === null)
    && typeof value.driver_name === 'string'
    && typeof value.driver_email === 'string'
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
    && (typeof value.driver_offer_fare === 'number' || value.driver_offer_fare === null)
    && (value.driver_offer_status === 'pending'
      || value.driver_offer_status === 'rejected'
      || value.driver_offer_status === 'accepted'
      || value.driver_offer_status === null)
    && typeof value.cash_collected === 'boolean'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && (typeof value.driver_latitude === 'number' || value.driver_latitude === null)
    && (typeof value.driver_longitude === 'number' || value.driver_longitude === null)
    && (typeof value.driver_location_at === 'string' || value.driver_location_at === null)
    && typeof value.driver_location_is_live === 'boolean';
}

function isLiveRide(value: unknown): value is AdminRide {
  return isAdminRide(value) && (value.status === 'searching' || value.status === 'accepted');
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function rideLocation(ride: AdminRide): MapPoint | null {
  if (ride.driver_latitude === null || ride.driver_longitude === null) return null;
  return { latitude: ride.driver_latitude, longitude: ride.driver_longitude };
}

export default function AdminDashboard({
  onClose,
  onOpenReviews,
  onOpenReports,
  onOpenUsers,
}: {
  onClose: () => void;
  onOpenReviews: () => void;
  onOpenReports: () => void;
  onOpenUsers: (search?: string) => void;
}) {
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [drivers, setDrivers] = useState<LiveDriver[]>([]);
  const [rides, setRides] = useState<AdminRide[]>([]);
  const [mapRideId, setMapRideId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState('');
  const [apiConnected, setApiConnected] = useState(false);
  const active = useRef(true);
  const refreshVersion = useRef(0);

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    setRefreshing(true);
    try {
      const data = await withTimeout(
        adminApi<unknown>('/api/admin/dashboard'),
        10000,
        'Dashboard refresh timed out. Check your connection and try again.',
      );
      if (!isRecord(data)
        || !isRecord(data.summary)
        || !Array.isArray(data.drivers)
        || !Array.isArray(data.rides)) {
        throw new Error('The server returned invalid admin dashboard data.');
      }
      const row = data.summary;
      const counts = [
        row.pending_applications,
        row.total_users,
        row.approved_drivers,
        row.online_drivers,
        row.searching_rides,
        row.active_rides,
        row.completed_today,
        row.open_reports,
      ].map(parseCount);
      if (counts.some((count) => count === null)) {
        throw new Error('The server returned invalid admin dashboard counts.');
      }
      if (!data.drivers.every(isLiveDriver)) {
        throw new Error('The server returned an invalid online driver list.');
      }
      if (!data.rides.every(isLiveRide)) {
        throw new Error('The server returned an invalid active ride list.');
      }
      if (!active.current || refreshVersion.current !== version) return;

      setSummary({
        pendingApplications: counts[0] ?? 0,
        totalUsers: counts[1] ?? 0,
        approvedDrivers: counts[2] ?? 0,
        onlineDrivers: counts[3] ?? 0,
        searchingRides: counts[4] ?? 0,
        activeRides: counts[5] ?? 0,
        completedToday: counts[6] ?? 0,
        openReports: counts[7] ?? 0,
      });
      setDrivers(data.drivers);
      setRides(data.rides);
      setLastUpdated(new Date().toISOString());
      setApiConnected(true);
      setError('');
    } catch (loadError: unknown) {
      if (!active.current || refreshVersion.current !== version) return;
      setApiConnected(false);
      setError(loadError instanceof Error
        ? loadError.message
        : 'Could not load live admin dashboard data.');
    } finally {
      if (active.current && refreshVersion.current === version) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    active.current = true;
    void Promise.resolve().then(() => {
      if (active.current) void refresh();
    });
    const fallbackTimer = setInterval(() => {
      if (active.current) void refresh();
    }, 10000);

    return () => {
      active.current = false;
      refreshVersion.current += 1;
      clearInterval(fallbackTimer);
    };
  }, [refresh]);

  const metrics: { label: string; value: number; icon: keyof typeof Ionicons.glyphMap; accent?: boolean }[] = [
    { label: 'Waiting for review', value: summary.pendingApplications, icon: 'document-text-outline', accent: true },
    { label: 'Registered users', value: summary.totalUsers, icon: 'people-outline' },
    { label: 'Approved drivers', value: summary.approvedDrivers, icon: 'shield-checkmark-outline' },
    { label: 'Drivers online', value: summary.onlineDrivers, icon: 'radio-outline' },
    { label: 'Searching rides', value: summary.searchingRides, icon: 'search-outline' },
    { label: 'Rides in progress', value: summary.activeRides, icon: 'car-outline' },
    { label: 'Completed today', value: summary.completedToday, icon: 'checkmark-done-outline' },
  ];

  const renderRideCard = (ride: AdminRide) => {
    const driverPoint = rideLocation(ride);
    const showMap = mapRideId === ride.request_id;
    const isActive = ride.status === 'accepted';
    const statusLabel = ride.status === 'accepted'
      ? 'In progress'
      : ride.status === 'searching'
        ? 'Finding a driver'
        : ride.status === 'completed'
          ? 'Completed'
          : 'Cancelled';

    return (
      <View key={ride.request_id} style={styles.rideCard}>
        <View style={styles.rideTopRow}>
          <View style={[
            styles.rideStatus,
            isActive
              ? styles.rideStatusActive
              : ride.status === 'searching'
                ? styles.rideStatusSearching
                : styles.rideStatusHistory,
          ]}>
            <View style={[
              styles.rideStatusDot,
              isActive
                ? styles.rideDotActive
                : ride.status === 'searching'
                  ? styles.rideDotSearching
                  : styles.rideDotHistory,
            ]} />
            <Text style={styles.rideStatusText}>{statusLabel}</Text>
          </View>
          <Text style={styles.fare}>PKR {ride.offered_fare.toLocaleString()}</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ride history for rider ${ride.rider_name || ride.rider_email}`}
          onPress={() => onOpenUsers(ride.rider_email)}
          style={styles.detailBlock}
        >
          <Text style={styles.detailTitle}>Rider</Text>
          <Text style={styles.detailText}>{ride.rider_name || 'Rider'} · {ride.rider_email}</Text>
          <Text selectable style={styles.idText}>ID {ride.rider_id}</Text>
          <Text style={styles.accountHistoryLink}>View rider history ›</Text>
        </Pressable>
        <View style={styles.detailBlock}>
          <Text style={styles.detailTitle}>Driver</Text>
          <Text style={styles.detailText}>
            {ride.driver_id ? `${ride.driver_name || 'Driver'} · ${ride.driver_email}` : 'No driver assigned'}
          </Text>
          {ride.driver_id ? <Text selectable style={styles.idText}>ID {ride.driver_id}</Text> : null}
          {ride.driver_id ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ride history for driver ${ride.driver_name || ride.driver_email}`}
              onPress={() => onOpenUsers(ride.driver_email)}
            >
              <Text style={styles.accountHistoryLink}>View driver history ›</Text>
            </Pressable>
          ) : null}
        </View>
        <View style={styles.routeLine}>
          <View style={styles.routeDots}>
            <View style={styles.routeStart} />
            <View style={styles.routeDash} />
            <View style={styles.routeEnd} />
          </View>
          <View style={styles.routeCopy}>
            <Text style={styles.routeText}>Pickup · {ride.pickup_address}</Text>
            <Text style={styles.routeText}>Destination · {ride.destination_address}</Text>
          </View>
        </View>
        <Text style={styles.detailText}>
          {ride.vehicle} · {ride.cash_collected ? 'Cash recorded as collected' : 'Cash not confirmed'}
        </Text>
        <Text style={styles.detailText}>
          Requested {formatDateTime(ride.created_at)} · Updated {formatDateTime(ride.updated_at)}
        </Text>
        {ride.driver_offer_status ? (
          <Text style={styles.detailText}>
            Driver counter-offer · {ride.driver_offer_status}
            {ride.driver_offer_fare !== null ? ` · PKR ${ride.driver_offer_fare.toLocaleString()}` : ''}
          </Text>
        ) : null}
        <View style={styles.locationPanel}>
          <View style={styles.locationHeading}>
            <Ionicons
              name={ride.driver_location_is_live ? 'navigate-circle' : 'location-outline'}
              size={17}
              color={ride.driver_location_is_live ? COLORS.green : COLORS.muted}
            />
            <Text style={styles.detailTitle}>
              {ride.driver_location_is_live ? 'LIVE DRIVER LOCATION' : 'LAST RECORDED DRIVER LOCATION'}
            </Text>
          </View>
          {driverPoint ? (
            <>
              <Text style={styles.detailText}>
                {driverPoint.latitude.toFixed(6)}, {driverPoint.longitude.toFixed(6)}
              </Text>
              <Text style={styles.timeText}>
                {ride.driver_location_at
                  ? `${ride.driver_location_is_live ? 'Updated' : 'Last reported'} ${formatDateTime(ride.driver_location_at)}`
                  : 'Location time unavailable'}
              </Text>
              <Pressable
                accessibilityRole="button"
                onPress={() => setMapRideId(showMap ? null : ride.request_id)}
                style={styles.mapToggle}
              >
                <Ionicons name={showMap ? 'close-outline' : 'map-outline'} size={15} color={COLORS.green} />
                <Text style={styles.mapToggleText}>{showMap ? 'Hide map' : 'View ride map'}</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.timeText}>
              {ride.status === 'searching'
                ? 'A driver has not been assigned, so there is no driver location yet.'
                : 'No driver coordinates were recorded for this ride.'}
            </Text>
          )}
        </View>
        {showMap && driverPoint ? (
          <View style={styles.mapFrame}>
            <RideMap
              region={{
                latitude: (driverPoint.latitude + ride.pickup_latitude) / 2,
                longitude: (driverPoint.longitude + ride.pickup_longitude) / 2,
                latitudeDelta: Math.max(0.02, Math.abs(driverPoint.latitude - ride.pickup_latitude) * 2),
                longitudeDelta: Math.max(0.02, Math.abs(driverPoint.longitude - ride.pickup_longitude) * 2),
              }}
              pickup={{ latitude: ride.pickup_latitude, longitude: ride.pickup_longitude }}
              destination={{ latitude: ride.destination_latitude, longitude: ride.destination_longitude }}
              acceptedDriverLocation={driverPoint}
              acceptedDriverVehicle={ride.vehicle}
              acceptedDriverTitle={ride.driver_name || 'Driver'}
              acceptedDriverDescription={ride.driver_location_is_live
                ? 'Live location'
                : 'Last recorded location'}
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
              <Ionicons name="shield-checkmark" size={20} color={COLORS.lime} />
            </View>
            <View>
              <Text style={styles.brandName}>SAWAARI</Text>
              <Text style={styles.brandCaption}>OPERATIONS CENTER</Text>
            </View>
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} style={styles.closeButton}>
            <Ionicons name="arrow-back-outline" size={15} color={COLORS.green} />
            <Text style={styles.closeText}>Back to app</Text>
          </Pressable>
        </View>

        <View style={styles.hero}>
          <View style={styles.heroTop}>
            <View style={styles.heroLabel}>
              <Ionicons name="pulse-outline" size={14} color={COLORS.lime} />
              <Text style={styles.heroLabelText}>OPERATIONS OVERVIEW</Text>
            </View>
            <View style={styles.livePill}>
              <View style={[styles.liveDot, apiConnected ? styles.liveDotOn : styles.liveDotOff]} />
              <Text style={styles.liveText}>{apiConnected ? 'CONNECTED' : 'SYNCING'}</Text>
            </View>
          </View>
          <Text style={styles.title}>Your city, in motion.</Text>
          <Text style={styles.heroCopy}>
            Monitor rides, drivers and applications from one place.
          </Text>
          <View style={styles.heroFooter}>
            <Ionicons name="time-outline" size={14} color="#B5C9BE" />
            <Text style={styles.updatedText}>
              {lastUpdated ? `Last updated ${formatTime(lastUpdated)}` : 'Waiting for first update'}
            </Text>
            <Text style={styles.heroHint}>Pull down to refresh</Text>
          </View>
        </View>

        <Pressable accessibilityRole="button" onPress={onOpenReviews} style={styles.reviewButton}>
          <View style={styles.reviewIcon}>
            <Ionicons name="document-text-outline" size={20} color={COLORS.green} />
          </View>
          <View style={styles.reviewCopy}>
            <Text style={styles.reviewButtonText}>Driver application review</Text>
            <Text style={styles.reviewSubtitle}>Check documents and manage approvals</Text>
          </View>
          <View style={styles.reviewCount}>
            <Text style={styles.reviewCountText}>{loading ? '—' : summary.pendingApplications}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.green} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onOpenReports} style={styles.reportButton}>
          <View style={styles.reportIcon}>
            <Ionicons name="alert-circle-outline" size={20} color={COLORS.red} />
          </View>
          <View style={styles.reviewCopy}>
            <Text style={styles.reviewButtonText}>Rider safety reports</Text>
            <Text style={styles.reviewSubtitle}>Review reports and take account action</Text>
          </View>
          <View style={styles.reviewCount}>
            <Text style={styles.reportCountText}>{loading ? '—' : summary.openReports}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.green} />
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => onOpenUsers()} style={styles.usersButton}>
          <View style={styles.usersIcon}>
            <Ionicons name="people-outline" size={20} color={COLORS.green} />
          </View>
          <View style={styles.reviewCopy}>
            <Text style={styles.reviewButtonText}>All registered users</Text>
            <Text style={styles.reviewSubtitle}>View rider accounts and driver application status</Text>
          </View>
          <View style={styles.reviewCount}>
            <Text style={styles.reviewCountText}>{loading ? '—' : summary.totalUsers}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.green} />
        </Pressable>

        {error ? (
          <View style={styles.errorCard}>
            <View style={styles.errorIcon}><Ionicons name="warning-outline" size={18} color={COLORS.red} /></View>
            <View style={styles.errorCopy}>
              <Text style={styles.errorTitle}>Dashboard could not refresh</Text>
              <Text style={styles.errorText}>{error}</Text>
            </View>
            <Pressable accessibilityRole="button" onPress={() => void refresh()} style={styles.retryButton}>
              <Text style={styles.retryText}>Retry</Text>
            </Pressable>
          </View>
        ) : null}

        <View style={styles.sectionHeading}>
          <View>
            <Text style={styles.sectionTitle}>Today at a glance</Text>
            <Text style={styles.sectionSubtitle}>A live snapshot of Sawaari operations</Text>
          </View>
          {loading ? <ActivityIndicator size="small" color={COLORS.green} /> : null}
        </View>
        <View style={styles.metricsGrid}>
          {metrics.map((metric) => (
            <View key={metric.label} style={[styles.metricCard, metric.accent && styles.metricCardAccent]}>
              <View style={[styles.metricIcon, metric.accent && styles.metricIconAccent]}>
                <Ionicons name={metric.icon} size={18} color={metric.accent ? COLORS.green : COLORS.muted} />
              </View>
              <Text style={styles.metricValue}>{loading ? '—' : metric.value}</Text>
              <Text style={styles.metricLabel}>{metric.label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIcon}><Ionicons name="radio-outline" size={16} color={COLORS.green} /></View>
            <Text style={styles.sectionTitle}>Drivers online</Text>
          </View>
          <View style={styles.sectionCountPill}><Text style={styles.sectionCount}>{drivers.length} active</Text></View>
        </View>
        <View style={styles.listGroup}>
          {drivers.length === 0 && !loading ? (
            <View style={styles.emptyCard}>
              <Ionicons name="car-outline" size={22} color={COLORS.muted} />
              <Text style={styles.emptyText}>No approved drivers are online right now.</Text>
            </View>
          ) : null}
          {drivers.map((driver) => (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`View ride history for driver ${driver.driver_name}`}
              key={driver.driver_id}
              onPress={() => onOpenUsers(driver.driver_email)}
              style={styles.listCard}
            >
              <View style={styles.avatar}>
                <Ionicons name="person-outline" size={17} color={COLORS.green} />
              </View>
              <View style={styles.listCopy}>
                <Text style={styles.listTitle}>{driver.driver_name || 'Sawaari driver'}</Text>
                <Text style={styles.listDetail}>{driver.vehicle} · Updated {formatTime(driver.last_seen_at)}</Text>
              </View>
              <View style={styles.onlineBadge}><View style={styles.onlineDot} /><Text style={styles.onlineText}>ONLINE</Text></View>
            </Pressable>
          ))}
        </View>

        <View style={styles.sectionHeading}>
          <View style={styles.sectionTitleRow}>
            <View style={styles.sectionIcon}><Ionicons name="navigate-outline" size={16} color={COLORS.green} /></View>
            <Text style={styles.sectionTitle}>Live rides & driver locations</Text>
          </View>
          <View style={styles.sectionCountPill}><Text style={styles.sectionCount}>{rides.length} active</Text></View>
        </View>
        <View style={styles.listGroup}>
          {rides.length === 0 && !loading ? (
            <View style={styles.emptyCard}>
              <Ionicons name="map-outline" size={22} color={COLORS.muted} />
              <Text style={styles.emptyText}>No searching or in-progress rides at the moment.</Text>
            </View>
          ) : null}
          {rides.map(renderRideCard)}
        </View>

        <View style={styles.disclaimerCard}>
          <Ionicons name="lock-closed-outline" size={15} color={COLORS.muted} />
          <Text style={styles.disclaimer}>
            Restricted admin view. Live coordinates are shown only while fresh; completed rides retain the last location reported during that ride. Location is not an emergency-response system.
          </Text>
        </View>
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
  closeButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  closeText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  hero: { padding: 22, borderRadius: 20, backgroundColor: COLORS.green, gap: 10, overflow: 'hidden' },
  heroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  heroLabel: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  heroLabelText: { color: '#D5E6DA', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20, backgroundColor: '#FFFFFF1A' },
  liveDot: { width: 7, height: 7, borderRadius: 4 },
  liveDotOn: { backgroundColor: COLORS.lime },
  liveDotOff: { backgroundColor: COLORS.orange },
  liveText: { color: COLORS.white, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  title: { marginTop: 3, color: COLORS.white, fontSize: 30, lineHeight: 37, fontWeight: '900' },
  heroCopy: { color: '#D5E6DA', fontSize: 12, lineHeight: 18 },
  heroFooter: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 5 },
  updatedText: { color: '#D5E6DA', fontSize: 9 },
  heroHint: { marginLeft: 'auto', color: '#B5C9BE', fontSize: 9 },
  reviewButton: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderWidth: 1, borderColor: '#DDE8D6', borderRadius: 15, backgroundColor: '#F0F6E9' },
  reportButton: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderWidth: 1, borderColor: '#F0D8D6', borderRadius: 15, backgroundColor: '#FFF8F7' },
  usersButton: { minHeight: 72, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderWidth: 1, borderColor: COLORS.line, borderRadius: 15, backgroundColor: COLORS.white },
  reviewIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: COLORS.lime },
  usersIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E8F0E4' },
  reportIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#FBE9E8' },
  reviewCopy: { flex: 1, gap: 4 },
  reviewButtonText: { color: COLORS.green, fontSize: 13, fontWeight: '900' },
  reviewSubtitle: { color: COLORS.muted, fontSize: 10 },
  reviewCount: { minWidth: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.white },
  reviewCountText: { color: COLORS.green, fontSize: 14, fontWeight: '900' },
  reportCountText: { color: COLORS.red, fontSize: 14, fontWeight: '900' },
  errorCard: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 13, backgroundColor: '#FBE9E8' },
  errorIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: COLORS.white },
  errorCopy: { flex: 1, gap: 3 },
  errorTitle: { color: COLORS.red, fontSize: 11, fontWeight: '900' },
  errorText: { color: COLORS.red, fontSize: 10, lineHeight: 15 },
  retryButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: COLORS.white },
  retryText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  sectionHeading: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 3 },
  sectionTitle: { color: COLORS.ink, fontSize: 15, fontWeight: '900' },
  sectionSubtitle: { marginTop: 4, color: COLORS.muted, fontSize: 10 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  sectionIcon: { width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: '#E8F0E4' },
  sectionCountPill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E9EEE6' },
  sectionCount: { color: COLORS.green, fontSize: 9, fontWeight: '800' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metricCard: { width: '31%', minWidth: 145, flexGrow: 1, minHeight: 132, justifyContent: 'space-between', padding: 14, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  metricCardAccent: { backgroundColor: '#F0F6E9', borderColor: '#DDE8D6' },
  metricIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#F1F3EE' },
  metricIconAccent: { backgroundColor: COLORS.lime },
  metricLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  metricValue: { marginTop: 8, color: COLORS.ink, fontSize: 27, fontWeight: '900' },
  listGroup: { gap: 8 },
  emptyCard: { minHeight: 76, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  emptyText: { flex: 1, color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  listCard: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  avatar: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#E8F0E4' },
  listCopy: { flex: 1, gap: 5 },
  listTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '900' },
  listDetail: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  onlineBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E8F4EA' },
  onlineDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2D9B63' },
  onlineText: { color: COLORS.green, fontSize: 8, fontWeight: '900' },
  rideCard: { padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 10 },
  rideTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  rideStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 20 },
  rideStatusActive: { backgroundColor: '#E8F4EA' },
  rideStatusSearching: { backgroundColor: '#FFF2E5' },
  rideStatusHistory: { backgroundColor: '#E9EEF2' },
  rideStatusDot: { width: 6, height: 6, borderRadius: 3 },
  rideDotActive: { backgroundColor: '#2D9B63' },
  rideDotSearching: { backgroundColor: COLORS.orange },
  rideDotHistory: { backgroundColor: COLORS.muted },
  rideStatusText: { color: COLORS.ink, fontSize: 9, fontWeight: '800' },
  fare: { color: COLORS.green, fontSize: 12, fontWeight: '900' },
  routeLine: { flexDirection: 'row', alignItems: 'stretch', gap: 10, paddingVertical: 2 },
  routeDots: { width: 10, alignItems: 'center', paddingVertical: 3 },
  routeStart: { width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: COLORS.green },
  routeDash: { width: 1, flex: 1, minHeight: 8, backgroundColor: '#B8C7B7' },
  routeEnd: { width: 7, height: 7, backgroundColor: COLORS.green },
  routeCopy: { flex: 1, justifyContent: 'space-between', gap: 8 },
  routeText: { color: COLORS.ink, fontSize: 10, lineHeight: 15 },
  detailBlock: { gap: 3, padding: 10, borderRadius: 10, backgroundColor: '#F6F8F7' },
  detailTitle: { color: COLORS.ink, fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  detailText: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  accountHistoryLink: { color: COLORS.green, fontSize: 9, fontWeight: '900' },
  idText: { color: COLORS.muted, fontSize: 8, lineHeight: 12 },
  locationPanel: { gap: 5, padding: 10, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, backgroundColor: '#F8FBFA' },
  locationHeading: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  mapToggle: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, paddingVertical: 7, borderRadius: 9, backgroundColor: COLORS.lime },
  mapToggleText: { color: COLORS.green, fontSize: 9, fontWeight: '900' },
  mapFrame: { height: 240, overflow: 'hidden', borderRadius: 12, borderWidth: 1, borderColor: COLORS.line },
  timeText: { color: COLORS.muted, fontSize: 9 },
  disclaimerCard: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, padding: 12, borderRadius: 12, backgroundColor: '#ECEFE9' },
  disclaimer: { flex: 1, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
});
