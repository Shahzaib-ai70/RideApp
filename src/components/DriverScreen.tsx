import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
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
import AccountPanel from './AccountPanel';
import DriverVerification from './DriverVerification';
import type { DriverApplicationStatus, DriverApplicationSummary } from './DriverVerification';
import { useAuth } from '../lib/AuthContext';
import { apiRequest } from '../lib/api';
import type { MapPoint } from './ride-map.types';
import { useInAppNotice } from './InAppNoticeProvider';

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

export default function DriverScreen() {
  const { configured, loading: authLoading, session } = useAuth();
  const { notify, confirm } = useInAppNotice();
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
  const [lastPoint, setLastPoint] = useState<MapPoint | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const mounted = useRef(true);
  const applicationLoadVersion = useRef(0);
  const showMessage = useCallback((title: string, message: string) => {
    notify({ title, message });
  }, [notify]);

  const refreshApplication = useCallback(async () => {
    const loadVersion = ++applicationLoadVersion.current;
    if (!session) {
      setApplication(null);
      setApplicationLoading(false);
      return;
    }

    setApplicationError('');
    try {
      const { application: result } = await apiRequest<{ application: unknown }>('/driver/application');
      if (result !== null && !isDriverApplication(result)) {
        throw new Error('The server returned an invalid driver application.');
      }
      if (applicationLoadVersion.current !== loadVersion) return;
      setApplication(result as DriverApplicationSummary | null);
      if (result && isDriverApplication(result) && result.status === 'approved'
        && VEHICLES.includes(result.vehicle_type as Vehicle)) {
        setVehicle(result.vehicle_type as Vehicle);
      }
    } catch (loadError: unknown) {
      if (applicationLoadVersion.current !== loadVersion) return;
      setApplicationError(`Could not load driver verification. ${
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
    if (!isOnline || !session) return undefined;
    let active = true;
    const fetchRequests = async () => {
      try {
        const data = await apiRequest<unknown>('/driver/requests');
        if (!active) return;
        if (!Array.isArray(data) || !data.every(isNearbyRequest)) {
          setRequestError('The server returned an invalid nearby request list.');
          return;
        }
        setRequests(data);
        setRequestError('');
      } catch (error: unknown) {
        if (active) setRequestError(error instanceof Error ? error.message : 'Could not load nearby requests.');
      }
    };

    void fetchRequests();
    const timer = setInterval(() => void fetchRequests(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [isOnline, session]);

  useEffect(() => {
    if (!session) return undefined;
    let active = true;
    void apiRequest<{ ride: unknown }>('/driver/active-ride')
      .then(({ ride }) => {
        if (!active) return;
        if (ride) {
          if (!isNearbyRequest(ride)) {
            setRequestError('The server returned an invalid active ride.');
            return;
          }
          setActiveRide(ride);
        } else {
          setActiveRide(null);
        }
      })
      .catch((error: unknown) => {
        if (active) setRequestError(error instanceof Error ? error.message : 'Could not load your active ride.');
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
    await apiRequest('/driver/presence', {
      method: 'POST',
      body: JSON.stringify({
        display_name: displayName.trim(),
        vehicle: nextVehicle,
        is_online: online,
        latitude: point.latitude,
        longitude: point.longitude,
      }),
    });
  };

  const toggleOnline = async () => {
    if (!session) return;
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
    const confirmed = await confirm({
      title: 'Accept ride request?',
      message: `${request.pickup_address} → ${request.destination_address}\nOffer: PKR ${request.offered_fare}`,
      cancelLabel: 'Not now',
      confirmLabel: 'Accept',
    });
    if (!confirmed) return;

    setBusy(true);
    try {
      await apiRequest('/driver/accept', {
        method: 'POST',
        body: JSON.stringify({ request_id: request.request_id }),
      });
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
    if (!activeRide) return;
    setBusy(true);
    try {
      await apiRequest('/driver/complete', {
        method: 'POST',
        body: JSON.stringify({ request_id: activeRide.request_id }),
      });
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
          Driver accounts, live availability, nearby requests, and ride acceptance connect through Sawaari’s VPS service.
        </Text>
        <View style={styles.notice}>
          <Ionicons name="cloud-offline-outline" size={20} color={COLORS.orange} />
          <Text style={styles.noticeText}>
            VPS backend is not responding. Check that the Sawaari API and database are running on the server.
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

  if (applicationError) {
    return (
      <ScrollView contentContainerStyle={styles.screen}>
        <Text style={styles.eyebrow}>DRIVER MODE</Text>
        <Text style={styles.title}>Driver verification setup</Text>
        <Text style={styles.error}>{applicationError}</Text>
        <Pressable onPress={() => void refreshApplication()} style={styles.acceptButton}>
          <Text style={styles.acceptText}>Try again</Text>
        </Pressable>
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
  loader: { flex: 1 },
  error: { padding: 11, borderRadius: 11, color: COLORS.red, backgroundColor: '#FBE9E8', fontSize: 11, lineHeight: 16 },
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
