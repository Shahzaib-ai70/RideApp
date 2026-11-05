import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import * as Linking from 'expo-linking';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AccountPanel from './AccountPanel';
import DriverReviewConsole from './DriverReviewConsole';
import DriverVerification from './DriverVerification';
import type { DriverApplicationStatus, DriverApplicationSummary } from './DriverVerification';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import type { MapPoint } from './ride-map.types';

type Vehicle = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';
type NearbyRequest = {
  request_id: string;
  rider_name: string;
  pickup_address: string;
  destination_address: string;
  vehicle: Vehicle;
  offered_fare: number;
  distance_m: number;
  created_at: string;
};

const VEHICLES: Vehicle[] = ['Bike', 'Rickshaw', 'Car', 'Premium'];
const DRIVER_REVIEW_MIGRATION_URL =
  'https://github.com/Shahzaib-ai70/RideApp/blob/main/supabase/migrations/20261102000000_driver_document_review.sql';
const SUPABASE_SQL_EDITOR_URL =
  'https://supabase.com/dashboard/project/tdmzdootumjimthtpqmk/sql/new';
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
const APPLICATION_STATUSES: DriverApplicationStatus[] = [
  'pending',
  'approved',
  'needs_changes',
  'rejected',
];

function isDriverApplication(value: unknown): value is DriverApplicationSummary {
  if (typeof value !== 'object' || value === null) return false;
  const application = value as Record<string, unknown>;
  return typeof application.application_id === 'string'
    && typeof application.full_name === 'string'
    && typeof application.vehicle_type === 'string'
    && typeof application.vehicle_make === 'string'
    && typeof application.vehicle_model === 'string'
    && typeof application.vehicle_year === 'number'
    && typeof application.review_note === 'string'
    && APPLICATION_STATUSES.includes(application.status as DriverApplicationStatus);
}

function isNearbyRequest(value: unknown): value is NearbyRequest {
  if (typeof value !== 'object' || value === null) return false;
  const request = value as Record<string, unknown>;
  return typeof request.request_id === 'string'
    && typeof request.rider_name === 'string'
    && typeof request.pickup_address === 'string'
    && typeof request.destination_address === 'string'
    && VEHICLES.includes(request.vehicle as Vehicle)
    && typeof request.offered_fare === 'number'
    && Number.isFinite(request.offered_fare)
    && typeof request.distance_m === 'number'
    && Number.isFinite(request.distance_m)
    && typeof request.created_at === 'string';
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') window.alert(`${title}\n\n${message}`);
  else Alert.alert(title, message);
}

export default function DriverScreen() {
  const { configured, loading: authLoading, session } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('Car');
  const [isOnline, setIsOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<NearbyRequest[]>([]);
  const [activeRide, setActiveRide] = useState<NearbyRequest | null>(null);
  const [requestError, setRequestError] = useState('');
  const [application, setApplication] = useState<DriverApplicationSummary | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(true);
  const [applicationError, setApplicationError] = useState('');
  const [applicationSetupRequired, setApplicationSetupRequired] = useState(false);
  const [isReviewer, setIsReviewer] = useState(false);
  const [reviewQueueOpen, setReviewQueueOpen] = useState(false);
  const [lastPoint, setLastPoint] = useState<MapPoint | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const mounted = useRef(true);
  const applicationLoadVersion = useRef(0);

  const refreshApplication = useCallback(async () => {
    const loadVersion = ++applicationLoadVersion.current;
    const client = supabase;
    if (!session || !client) {
      setApplication(null);
      setIsReviewer(false);
      setApplicationSetupRequired(false);
      setApplicationLoading(false);
      return;
    }

    setApplicationError('');
    setApplicationSetupRequired(false);
    try {
      const [applicationResult, reviewerResult] = await Promise.all([
        client.rpc('get_my_driver_application'),
        client.rpc('is_driver_reviewer'),
      ]);
      if (applicationResult.error) throw applicationResult.error;
      if (reviewerResult.error) throw reviewerResult.error;
      const rows = applicationResult.data;
      if (!Array.isArray(rows) || rows.length > 1
        || (rows.length === 1 && !isDriverApplication(rows[0]))) {
        throw new Error('The server returned an invalid driver application.');
      }
      if (typeof reviewerResult.data !== 'boolean') {
        throw new Error('The server returned an invalid reviewer permission.');
      }
      if (applicationLoadVersion.current !== loadVersion) return;
      setApplication(rows.length === 1 ? rows[0] : null);
      setIsReviewer(reviewerResult.data);
      setApplicationSetupRequired(false);
      if (rows.length === 1 && rows[0].status === 'approved'
        && VEHICLES.includes(rows[0].vehicle_type as Vehicle)) {
        setVehicle(rows[0].vehicle_type as Vehicle);
      }
    } catch (loadError: unknown) {
      if (applicationLoadVersion.current !== loadVersion) return;
      const errorCode = typeof loadError === 'object' && loadError !== null && 'code' in loadError
        ? loadError.code
        : null;
      const setupRequired = errorCode === 'PGRST202'
        || errorCode === '42P01'
        || errorCode === '42883';
      setApplicationSetupRequired(setupRequired);
      setApplicationError(setupRequired
        ? 'Driver verification is not set up in Supabase yet. Run the driver document review SQL migration once, then try again.'
        : `Could not load driver verification. ${
          loadError instanceof Error ? loadError.message : 'Please try again.'
        }`);
    } finally {
      if (applicationLoadVersion.current === loadVersion) setApplicationLoading(false);
    }
  }, [session]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      watch.current?.remove();
      watch.current = null;
    };
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshApplication);
    return () => {
      applicationLoadVersion.current += 1;
    };
  }, [refreshApplication]);

  useEffect(() => {
    const client = supabase;
    if (!isOnline || !session || !client) return undefined;
    let active = true;
    const fetchRequests = async () => {
      const { data, error } = await client.rpc('get_nearby_ride_requests', {
        p_radius_m: 10000,
      });
      if (!active) return;
      if (error) {
        setRequestError(error.message);
        return;
      }
      if (!Array.isArray(data) || !data.every(isNearbyRequest)) {
        setRequestError('The server returned an invalid nearby request list.');
        return;
      }
      setRequests(data);
      setRequestError('');
    };

    void fetchRequests();
    const timer = setInterval(() => void fetchRequests(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isOnline, session]);

  useEffect(() => {
    const client = supabase;
    if (!session || !client) return undefined;
    let active = true;
    void client.rpc('get_my_active_driver_ride')
      .then(({ data, error }) => {
        if (!active) return;
        if (error) {
          setRequestError(error.message);
          return;
        }
        if (Array.isArray(data) && data.length > 0) {
          if (!isNearbyRequest(data[0])) {
            setRequestError('The server returned an invalid active ride.');
            return;
          }
          setActiveRide(data[0]);
        } else {
          setActiveRide(null);
        }
      });
    return () => {
      active = false;
    };
  }, [session]);

  useEffect(() => {
    if (!session || application?.status !== 'pending') return undefined;
    const timer = setInterval(() => void refreshApplication(), 10000);
    return () => clearInterval(timer);
  }, [application?.status, refreshApplication, session]);

  const setPresence = async (online: boolean, point: MapPoint, nextVehicle = vehicle) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { error } = await supabase.rpc('set_driver_presence', {
      p_display_name: displayName.trim(),
      p_vehicle: nextVehicle,
      p_is_online: online,
      p_latitude: point.latitude,
      p_longitude: point.longitude,
    });
    if (error) throw error;
  };

  const toggleOnline = async () => {
    if (!supabase || !session) return;
    if (!isOnline && application?.status !== 'approved') {
      showMessage(
        'Driver approval required',
        'Submit your documents and wait for approval before going online.',
      );
      return;
    }
    setBusy(true);
    setRequestError('');
    try {
      if (isOnline) {
        const point = lastPoint;
        if (!point) throw new Error('Your live location is unavailable. Try going offline again.');
        await setPresence(false, point);
        watch.current?.remove();
        watch.current = null;
        setIsOnline(false);
        setRequests([]);
        return;
      }

      if (displayName.trim().length < 2) {
        throw new Error('Enter your name before going online.');
      }
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Allow location access to receive nearby ride requests.');
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = { latitude: current.coords.latitude, longitude: current.coords.longitude };
      watch.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.Balanced,
          timeInterval: 15000,
          distanceInterval: 40,
        },
        (position) => {
          const nextPoint = {
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
          };
          setLastPoint(nextPoint);
          void setPresence(true, nextPoint).catch((error: unknown) => {
            if (mounted.current) {
              setRequestError(error instanceof Error
                ? `Could not refresh your driver location: ${error.message}`
                : 'Could not refresh your driver location.');
            }
          });
        },
      );
      await setPresence(true, point);
      setLastPoint(point);
      setIsOnline(true);
    } catch (error: unknown) {
      watch.current?.remove();
      watch.current = null;
      showMessage(
        'Could not change driver availability',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const acceptRequest = async (request: NearbyRequest) => {
    if (!supabase) return;
    const confirmed = Platform.OS === 'web'
      ? window.confirm(
        `Accept this ride request?\n\n${request.pickup_address} → ${request.destination_address}\nOffer: PKR ${request.offered_fare}`,
      )
      : await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Accept ride request?',
          `${request.pickup_address} → ${request.destination_address}\nOffer: PKR ${request.offered_fare}`,
          [
            { text: 'Not now', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Accept', onPress: () => resolve(true) },
          ],
        );
      });
    if (!confirmed) return;

    setBusy(true);
    try {
      const { error } = await supabase.rpc('accept_ride_request', {
        p_request_id: request.request_id,
      });
      if (error) throw error;
      watch.current?.remove();
      watch.current = null;
      setIsOnline(false);
      setActiveRide(request);
      setRequests((current) => current.filter((item) => item.request_id !== request.request_id));
      showMessage(
        'Ride accepted',
        'The rider has been notified. Contact and trip safety tools still need to be configured before real-world use.',
      );
    } catch (error: unknown) {
      showMessage(
        'Could not accept this ride',
        error instanceof Error ? error.message : 'The request may already have been accepted.',
      );
    } finally {
      setBusy(false);
    }
  };

  const completeRide = async () => {
    if (!supabase || !activeRide) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('complete_ride_request', {
        p_request_id: activeRide.request_id,
      });
      if (error) throw error;
      setActiveRide(null);
      showMessage('Ride completed', 'This ride was marked complete.');
    } catch (error: unknown) {
      showMessage(
        'Could not complete the ride',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  if (!configured) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>DRIVER MODE</Text>
        <Text style={styles.title}>Drive with Sawaari</Text>
        <Text style={styles.subtitle}>
          Driver accounts, live availability, nearby requests, and ride acceptance connect through your Supabase project.
        </Text>
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={20} color={COLORS.orange} />
          <Text style={styles.noticeText}>
            Backend not configured yet. Add the Supabase URL and publishable/anon key to your local .env, then run the SQL migration from the README.
          </Text>
        </View>
        <AccountPanel />
      </ScrollView>
    );
  }

  if (authLoading) {
    return <ActivityIndicator color={COLORS.green} style={styles.loader} />;
  }

  if (!session) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>DRIVER MODE</Text>
        <Text style={styles.title}>Sign in to drive</Text>
        <Text style={styles.subtitle}>One Sawaari account works for both rides and driving.</Text>
        <AccountPanel />
      </ScrollView>
    );
  }

  if (applicationLoading) {
    return <ActivityIndicator color={COLORS.green} style={styles.loader} />;
  }

  if (isReviewer && reviewQueueOpen) {
    return <DriverReviewConsole onClose={() => setReviewQueueOpen(false)} />;
  }

  if (applicationError) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>DRIVER MODE</Text>
        <Text style={styles.title}>Driver verification setup</Text>
        <Text style={styles.error}>{applicationError}</Text>
        {applicationSetupRequired ? (
          <View style={styles.setupCard}>
            <Text style={styles.setupCopy}>
              In Supabase, open the SQL Editor, paste and run the driver review migration, then return here and tap Try again. This is a one-time database setup; deploying the website does not run it.
            </Text>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(SUPABASE_SQL_EDITOR_URL).catch((error: unknown) => {
                  setApplicationError(error instanceof Error
                    ? `Could not open Supabase SQL Editor: ${error.message}`
                    : 'Could not open Supabase SQL Editor.');
                });
              }}
              style={styles.setupLinkButton}
            >
              <Text style={styles.setupLinkText}>Open Supabase SQL Editor</Text>
            </Pressable>
            <Pressable
              accessibilityRole="link"
              onPress={() => {
                void Linking.openURL(DRIVER_REVIEW_MIGRATION_URL).catch((error: unknown) => {
                  setApplicationError(error instanceof Error
                    ? `Could not open the driver migration: ${error.message}`
                    : 'Could not open the driver migration.');
                });
              }}
              style={styles.setupLinkButton}
            >
              <Text style={styles.setupLinkText}>Open driver review SQL</Text>
            </Pressable>
          </View>
        ) : null}
        <Pressable onPress={() => void refreshApplication()} style={styles.acceptButton}>
          <Text style={styles.acceptText}>Try again</Text>
        </Pressable>
        {isReviewer ? (
          <Pressable onPress={() => setReviewQueueOpen(true)} style={styles.vehicleButton}>
            <Text style={styles.vehicleText}>Open review queue</Text>
          </Pressable>
        ) : null}
      </ScrollView>
    );
  }

  if (application?.status !== 'approved') {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>DRIVER MODE</Text>
        <Text style={styles.title}>Driver verification</Text>
        <Text style={styles.subtitle}>
          Submit your vehicle details and documents. You can request rides after a reviewer approves them.
        </Text>
        {isReviewer ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => setReviewQueueOpen(true)}
            style={styles.acceptButton}
          >
            <Text style={styles.acceptText}>Open driver review queue</Text>
          </Pressable>
        ) : null}
        <DriverVerification
          application={application}
          onSubmitted={() => void refreshApplication()}
        />
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.screen}>
      <Text style={styles.eyebrow}>DRIVER MODE</Text>
      <Text style={styles.title}>Nearby requests</Text>
      {isReviewer ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => setReviewQueueOpen(true)}
          style={styles.reviewQueueButton}
        >
          <Ionicons name="shield-checkmark-outline" size={17} color={COLORS.green} />
          <Text style={styles.reviewQueueText}>Review driver applications</Text>
        </Pressable>
      ) : null}
      <Text style={styles.subtitle}>
        Stay online with location enabled to receive matching ride requests within 10 km.
      </Text>
      {activeRide ? (
        <View style={styles.requestCard}>
          <Text style={styles.activeLabel}>ACTIVE RIDE</Text>
          <Text style={styles.requestFare}>PKR {activeRide.offered_fare}</Text>
          <Text style={styles.riderName}>Rider · {activeRide.rider_name || 'Sawaari rider'}</Text>
          <Text style={styles.routeText}>Pickup: {activeRide.pickup_address}</Text>
          <Text style={styles.routeText}>Drop-off: {activeRide.destination_address}</Text>
          <Text style={styles.routeText}>{activeRide.vehicle}</Text>
          <Pressable disabled={busy} onPress={() => void completeRide()} style={styles.acceptButton}>
            {busy ? <ActivityIndicator color={COLORS.green} /> : (
              <Text style={styles.acceptText}>Mark ride complete</Text>
            )}
          </Pressable>
        </View>
      ) : null}
      <View style={styles.card}>
        <Text style={styles.label}>Driver name</Text>
        <TextInput
          accessibilityLabel="Driver name"
          value={displayName}
          onChangeText={setDisplayName}
          placeholder="Enter your name"
          editable={!isOnline}
          style={styles.nameInput}
        />
        <Text style={[styles.label, styles.vehicleLabel]}>Vehicle type</Text>
        <View style={styles.vehicleRow}>
          {VEHICLES.map((item) => (
            <Pressable
              key={item}
              accessibilityRole="radio"
              accessibilityState={{ selected: vehicle === item }}
              disabled={isOnline || application.vehicle_type !== item}
              onPress={() => setVehicle(item)}
              style={[styles.vehicleButton, vehicle === item && styles.vehicleSelected]}
            >
              <Text style={[styles.vehicleText, vehicle === item && styles.vehicleTextSelected]}>
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: isOnline, disabled: busy }}
          disabled={busy || Boolean(activeRide)}
          onPress={() => void toggleOnline()}
          style={[styles.onlineButton, isOnline && styles.offlineButton]}
        >
          {busy ? <ActivityIndicator color={COLORS.white} /> : (
            <>
              <Ionicons name={isOnline ? 'pause-circle-outline' : 'radio-outline'} size={19} color={COLORS.white} />
              <Text style={styles.onlineButtonText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.statusText}>
          {activeRide
            ? 'Offline during active ride'
            : isOnline
              ? 'Online · sharing foreground location for nearby matching'
              : 'Offline · no ride requests will be sent'}
        </Text>
      </View>

      {requestError ? <Text style={styles.error}>{requestError}</Text> : null}
      {isOnline && !activeRide && requests.length === 0 && !requestError ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={26} color={COLORS.green} />
          <Text style={styles.emptyTitle}>Looking for nearby requests</Text>
          <Text style={styles.emptyCopy}>New matching ride requests will appear here.</Text>
        </View>
      ) : null}
      {requests.map((request) => (
        <View key={request.request_id} style={styles.requestCard}>
          <View style={styles.requestTop}>
            <Text style={styles.requestFare}>PKR {request.offered_fare}</Text>
            <Text style={styles.distance}>{(request.distance_m / 1000).toFixed(1)} km away</Text>
          </View>
          <Text style={styles.riderName}>Ride request · {request.rider_name || 'Sawaari rider'}</Text>
          <Text style={styles.routeText}>Pickup: {request.pickup_address}</Text>
          <Text style={styles.routeText}>Drop-off: {request.destination_address}</Text>
          <Text style={styles.routeText}>{request.vehicle} · {new Date(request.created_at).toLocaleTimeString()}</Text>
          <Pressable
            disabled={busy}
            onPress={() => void acceptRequest(request)}
            style={styles.acceptButton}
          >
            <Text style={styles.acceptText}>Accept ride</Text>
          </Pressable>
        </View>
      ))}
      <Text style={styles.disclaimer}>
        Driver onboarding, identity verification, rider contact, navigation, trip tracking, payments, and safety support are not yet production-ready. Do not use this MVP for real passenger trips.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { padding: 20, paddingBottom: 36, gap: 14, backgroundColor: COLORS.paper, flexGrow: 1 },
  eyebrow: { marginTop: 6, color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: COLORS.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  card: { padding: 15, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  label: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  nameInput: {
    height: 45,
    marginTop: 8,
    paddingHorizontal: 11,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.line,
    color: COLORS.ink,
    backgroundColor: COLORS.white,
  },
  vehicleLabel: { marginTop: 14 },
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginTop: 8 },
  vehicleButton: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10, backgroundColor: COLORS.paper },
  vehicleSelected: { backgroundColor: '#E5F0DC', borderWidth: 1, borderColor: COLORS.green },
  vehicleText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  vehicleTextSelected: { color: COLORS.green },
  onlineButton: {
    minHeight: 48,
    marginTop: 16,
    borderRadius: 13,
    backgroundColor: COLORS.green,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  offlineButton: { backgroundColor: COLORS.orange },
  onlineButtonText: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
  statusText: { marginTop: 9, color: COLORS.muted, fontSize: 10, textAlign: 'center' },
  notice: { padding: 13, borderRadius: 13, backgroundColor: '#FFF2E5', flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  noticeText: { flex: 1, color: COLORS.ink, fontSize: 11, lineHeight: 17 },
  reviewQueueButton: { minHeight: 42, paddingHorizontal: 12, borderRadius: 11, backgroundColor: '#E7F3E2', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  reviewQueueText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  loader: { flex: 1 },
  error: { padding: 11, borderRadius: 11, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 11, lineHeight: 16 },
  setupCard: { gap: 8, padding: 14, borderRadius: 14, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  setupCopy: { color: COLORS.ink, fontSize: 12, lineHeight: 18 },
  setupLinkButton: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 10, backgroundColor: '#EFF5E7' },
  setupLinkText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  empty: { alignItems: 'center', padding: 22, borderRadius: 16, backgroundColor: COLORS.white },
  emptyTitle: { marginTop: 9, color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  emptyCopy: { marginTop: 4, color: COLORS.muted, fontSize: 11, textAlign: 'center' },
  requestCard: { padding: 15, borderRadius: 15, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white, gap: 8 },
  requestTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestFare: { color: COLORS.green, fontSize: 18, fontWeight: '800' },
  activeLabel: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  distance: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  riderName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  routeText: { color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  acceptButton: { minHeight: 42, marginTop: 4, borderRadius: 11, backgroundColor: COLORS.lime, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  disclaimer: { marginTop: 10, color: COLORS.muted, fontSize: 10, lineHeight: 16 },
});
