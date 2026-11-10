import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { Text, TextInput } from './AppText';
import AccountPanel from './AccountPanel';
import DriverVerification from './DriverVerification';
import VehicleArt from './VehicleArt';
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
  my_offer_status: 'pending' | 'rejected' | null;
  my_offer_fare: number | null;
};
type DriverRideHistory = {
  request_id: string;
  pickup_address: string;
  destination_address: string;
  vehicle: Vehicle;
  offered_fare: number;
  cash_collected: boolean;
  completed_at: string;
};
type DriverDashboard = {
  profile: { display_name: string; email: string };
  application: {
    full_name: string;
    vehicle_type: Vehicle;
    vehicle_make: string;
    vehicle_model: string;
    vehicle_year: number;
    status: DriverApplicationStatus;
    review_note: string;
  } | null;
  summary: {
    completed_rides: number;
    cash_collected: number;
    cash_not_confirmed: number;
  };
  recent_rides: DriverRideHistory[];
  payment_method: 'cash';
};

const VEHICLES: Vehicle[] = ['Bike', 'Rickshaw', 'Car', 'Premium'];
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
    && typeof request.created_at === 'string'
    && (request.my_offer_status === null
      || request.my_offer_status === 'pending'
      || request.my_offer_status === 'rejected')
    && (request.my_offer_fare === null
      || (typeof request.my_offer_fare === 'number' && Number.isFinite(request.my_offer_fare)));
}

function finiteNumber(value: unknown): value is number | string {
  return (typeof value === 'number' || typeof value === 'string')
    && Number.isFinite(Number(value));
}

function formatPkr(amount: number) {
  return `PKR ${Math.round(amount).toLocaleString()}`;
}

function dashboardNumber(value: number | string | undefined) {
  return Number(value ?? 0);
}

function isDriverDashboard(value: unknown): value is DriverDashboard {
  if (typeof value !== 'object' || value === null) return false;
  const dashboard = value as Record<string, unknown>;
  if (typeof dashboard.profile !== 'object' || dashboard.profile === null
    || typeof dashboard.summary !== 'object' || dashboard.summary === null
    || !Array.isArray(dashboard.recent_rides) || dashboard.payment_method !== 'cash') return false;

  const profile = dashboard.profile as Record<string, unknown>;
  const summary = dashboard.summary as Record<string, unknown>;
  const application = dashboard.application;
  const validApplication = application === null
    || (typeof application === 'object'
      && typeof (application as Record<string, unknown>).full_name === 'string'
      && VEHICLES.includes((application as Record<string, unknown>).vehicle_type as Vehicle)
      && typeof (application as Record<string, unknown>).vehicle_make === 'string'
      && typeof (application as Record<string, unknown>).vehicle_model === 'string'
      && typeof (application as Record<string, unknown>).vehicle_year === 'number'
      && APPLICATION_STATUSES.includes(
        (application as Record<string, unknown>).status as DriverApplicationStatus,
      )
      && typeof (application as Record<string, unknown>).review_note === 'string');

  return typeof profile.display_name === 'string'
    && typeof profile.email === 'string'
    && validApplication
    && finiteNumber(summary.completed_rides)
    && finiteNumber(summary.cash_collected)
    && finiteNumber(summary.cash_not_confirmed)
    && dashboard.recent_rides.every((ride: unknown) => {
      if (typeof ride !== 'object' || ride === null) return false;
      const item = ride as Record<string, unknown>;
      return typeof item.request_id === 'string'
        && typeof item.pickup_address === 'string'
        && typeof item.destination_address === 'string'
        && VEHICLES.includes(item.vehicle as Vehicle)
        && typeof item.offered_fare === 'number'
        && Number.isFinite(item.offered_fare)
        && typeof item.cash_collected === 'boolean'
        && typeof item.completed_at === 'string';
    });
}

export default function DriverScreen() {
  const { configured, loading: authLoading, session } = useAuth();
  const { notify, confirm } = useInAppNotice();
  const [displayName, setDisplayName] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('Car');
  const [isOnline, setIsOnline] = useState(false);
  const [availabilityLoading, setAvailabilityLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [requests, setRequests] = useState<NearbyRequest[]>([]);
  const [offerAmounts, setOfferAmounts] = useState<Record<string, string>>({});
  const [sendingOfferId, setSendingOfferId] = useState<string | null>(null);
  const [activeRide, setActiveRide] = useState<NearbyRequest | null>(null);
  const [activeRideLoaded, setActiveRideLoaded] = useState(false);
  const [requestError, setRequestError] = useState('');
  const [application, setApplication] = useState<DriverApplicationSummary | null>(null);
  const [applicationLoading, setApplicationLoading] = useState(true);
  const [applicationError, setApplicationError] = useState('');
  const [dashboard, setDashboard] = useState<DriverDashboard | null>(null);
  const [dashboardError, setDashboardError] = useState('');
  const [dashboardLoading, setDashboardLoading] = useState(true);
  const [lastPoint, setLastPoint] = useState<MapPoint | null>(null);
  const watch = useRef<Location.LocationSubscription | null>(null);
  const activeRideWatch = useRef<Location.LocationSubscription | null>(null);
  const mounted = useRef(true);
  const applicationLoadVersion = useRef(0);
  const availabilityRestoreUser = useRef<string | null>(null);
  const showMessage = useCallback((title: string, message: string) => {
    notify({ title, message });
  }, [notify]);

  const refreshDashboard = useCallback(async () => {
    if (!session) {
      setDashboard(null);
      setDashboardLoading(false);
      return;
    }

    setDashboardError('');
    try {
      const result: unknown = await apiRequest('/driver/dashboard');
      if (!isDriverDashboard(result)) {
        throw new Error('The server returned invalid driver dashboard data.');
      }
      setDashboard(result);
      setDisplayName(result.profile.display_name);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Could not load driver account details.';
      setDashboardError(message === 'Not found.'
        ? 'The API serving this site is missing the driver dashboard route. Update the VPS API from the latest GitHub main branch and restart sawaari-api.'
        : message);
    } finally {
      setDashboardLoading(false);
    }
  }, [session]);

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
      activeRideWatch.current?.remove();
      activeRideWatch.current = null;
    };
  }, []);

  useEffect(() => {
    void Promise.resolve().then(refreshApplication);
    return () => {
      applicationLoadVersion.current += 1;
    };
  }, [refreshApplication]);

  useEffect(() => {
    void Promise.resolve().then(refreshDashboard);
  }, [refreshDashboard]);

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
    const fetchActiveRide = () => apiRequest<{ ride: unknown }>('/driver/active-ride')
      .then(({ ride }) => {
        if (!active) return;
        if (ride) {
          if (!isNearbyRequest(ride)) {
            setRequestError('The server returned an invalid active ride.');
            return;
          }
          setActiveRide((current) => current?.request_id === ride.request_id ? current : ride);
          setIsOnline(false);
          watch.current?.remove();
          watch.current = null;
        } else {
          setActiveRide(null);
        }
      })
      .catch((error: unknown) => {
        if (active) setRequestError(error instanceof Error ? error.message : 'Could not load your active ride.');
      })
      .finally(() => {
        if (active) setActiveRideLoaded(true);
      });
    void fetchActiveRide();
    const timer = setInterval(() => void fetchActiveRide(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [session]);

  useEffect(() => {
    if (!session || !activeRide) return undefined;
    let active = true;
    let subscription: Location.LocationSubscription | null = null;

    const sendLocation = async (point: MapPoint) => {
      await apiRequest('/driver/location', {
        method: 'POST',
        body: JSON.stringify({
          request_id: activeRide.request_id,
          latitude: point.latitude,
          longitude: point.longitude,
        }),
      });
    };

    const startTracking = async () => {
      try {
        let permission = await Location.getForegroundPermissionsAsync();
        if (!permission.granted) {
          permission = await Location.requestForegroundPermissionsAsync();
        }
        if (!permission.granted) {
          throw new Error('Allow location access to share your live position with the rider.');
        }

        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        const point = {
          latitude: current.coords.latitude,
          longitude: current.coords.longitude,
        };
        if (!active) return;
        await sendLocation(point);
        if (!active) return;
        setLastPoint(point);

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            timeInterval: 10000,
            distanceInterval: 20,
          },
          (position) => {
            const nextPoint = {
              latitude: position.coords.latitude,
              longitude: position.coords.longitude,
            };
            setLastPoint(nextPoint);
            void sendLocation(nextPoint).catch((error: unknown) => {
              if (active) {
                setRequestError(error instanceof Error
                  ? `Live location update failed: ${error.message}`
                  : 'Live location update failed.');
              }
            });
          },
        );
        if (active) activeRideWatch.current = subscription;
        else subscription.remove();
      } catch (error: unknown) {
        if (active) {
          setRequestError(error instanceof Error
            ? `Live location is unavailable: ${error.message}`
            : 'Live location is unavailable.');
        }
      }
    };

    void startTracking();
    return () => {
      active = false;
      subscription?.remove();
      if (activeRideWatch.current === subscription) activeRideWatch.current = null;
    };
  }, [activeRide, session]);

  useEffect(() => {
    if (!session || application?.status !== 'pending') return undefined;
    const timer = setInterval(() => void refreshApplication(), 10000);
    return () => clearInterval(timer);
  }, [application?.status, refreshApplication, session]);

  const setPresence = useCallback(async (
    online: boolean,
    point: MapPoint,
    nextVehicle = vehicle,
  ) => {
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
  }, [displayName, vehicle]);

  const startOnline = useCallback(async (nextVehicle = vehicle) => {
    if (displayName.trim().length < 2) {
      throw new Error('Enter your name before going online.');
    }
    let permission = await Location.getForegroundPermissionsAsync();
    if (!permission.granted) permission = await Location.requestForegroundPermissionsAsync();
    if (!permission.granted) {
      throw new Error('Allow location access to receive nearby ride requests.');
    }
    const current = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const point = { latitude: current.coords.latitude, longitude: current.coords.longitude };
    const subscription = await Location.watchPositionAsync(
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
        void setPresence(true, nextPoint, nextVehicle).catch((error: unknown) => {
          if (mounted.current) {
            setRequestError(error instanceof Error
              ? `Could not refresh your driver location: ${error.message}`
              : 'Could not refresh your driver location.');
          }
        });
      },
    );
    try {
      await setPresence(true, point, nextVehicle);
    } catch (error: unknown) {
      subscription.remove();
      throw error;
    }
    watch.current?.remove();
    watch.current = subscription;
    setLastPoint(point);
    setIsOnline(true);
    setAvailabilityLoading(false);
  }, [displayName, setPresence, vehicle]);

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

      await startOnline();
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

  useEffect(() => {
    if (!session || application?.status !== 'approved' || !activeRideLoaded || dashboardLoading) return;
    const userId = session.user.id;
    if (availabilityRestoreUser.current === userId) return;
    availabilityRestoreUser.current = userId;
    let active = true;

    const restoreAvailability = async () => {
      try {
        const presence = await apiRequest<unknown>('/driver/presence');
        if (typeof presence !== 'object' || presence === null) {
          throw new Error('The server returned invalid driver availability.');
        }
        const value = presence as Record<string, unknown>;
        if (typeof value.is_online !== 'boolean'
          || typeof value.vehicle !== 'string'
          || (value.latitude !== null && typeof value.latitude !== 'number')
          || (value.longitude !== null && typeof value.longitude !== 'number')) {
          throw new Error('The server returned invalid driver availability.');
        }
        if (!active) return;
        if (typeof value.latitude === 'number' && Number.isFinite(value.latitude)
          && typeof value.longitude === 'number' && Number.isFinite(value.longitude)) {
          setLastPoint({ latitude: value.latitude, longitude: value.longitude });
        }
        if (!value.is_online || activeRide) {
          setIsOnline(false);
          return;
        }
        setIsOnline(true);
        if (VEHICLES.includes(value.vehicle as Vehicle)) setVehicle(value.vehicle as Vehicle);
        await startOnline(value.vehicle as Vehicle);
      } catch (error: unknown) {
        if (active) {
          setRequestError(error instanceof Error
            ? `Could not restore online availability: ${error.message}`
            : 'Could not restore online availability.');
        }
      } finally {
        if (active) setAvailabilityLoading(false);
      }
    };

    void restoreAvailability();
    return () => {
      active = false;
    };
  }, [activeRide, activeRideLoaded, application?.status, dashboardLoading, session, startOnline]);

  const sendFareOffer = async (request: NearbyRequest) => {
    const amount = Number(offerAmounts[request.request_id]
      ?? request.my_offer_fare
      ?? request.offered_fare);
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000000) {
      showMessage('Invalid fare offer', 'Enter a whole amount between PKR 1 and PKR 1,000,000.');
      return;
    }

    setSendingOfferId(request.request_id);
    try {
      await apiRequest('/driver/offer', {
        method: 'POST',
        body: JSON.stringify({ request_id: request.request_id, offered_fare: amount }),
      });
      setOfferAmounts((current) => ({ ...current, [request.request_id]: String(amount) }));
      setRequests((current) => current.map((item) => item.request_id === request.request_id
        ? { ...item, my_offer_status: 'pending', my_offer_fare: amount }
        : item));
      showMessage('Fare offer sent', 'The rider can now accept or reject your fare in the app.');
    } catch (error: unknown) {
      showMessage('Could not send fare offer', error instanceof Error ? error.message : 'Please try again.');
    } finally {
      setSendingOfferId(null);
    }
  };

  const respondToRideRequest = async (request: NearbyRequest, action: 'accept' | 'reject') => {
    setSendingOfferId(request.request_id);
    try {
      await apiRequest('/driver/request-response', {
        method: 'POST',
        body: JSON.stringify({ request_id: request.request_id, action }),
      });
      if (action === 'accept') {
        watch.current?.remove();
        watch.current = null;
        setIsOnline(false);
        setActiveRide(request);
        setRequests([]);
        showMessage('Ride accepted', `You accepted the rider's fare of ${formatPkr(request.offered_fare)}.`);
        return;
      }

      setRequests((current) => current.filter((item) => item.request_id !== request.request_id));
      setOfferAmounts((current) => {
        const next = { ...current };
        delete next[request.request_id];
        return next;
      });
      showMessage('Ride request rejected', 'This request was removed from your list. The rider can still match with other drivers.');
    } catch (error: unknown) {
      showMessage(
        action === 'accept' ? 'Could not accept this fare' : 'Could not reject this request',
        error instanceof Error ? error.message : 'Please try again.',
      );
    } finally {
      setSendingOfferId(null);
    }
  };

  const completeRide = async () => {
    if (!activeRide) return;
    const cashReceived = await confirm({
      title: 'Confirm cash payment',
      message: `Mark this ride complete and record ${formatPkr(activeRide.offered_fare)} as cash received from the rider?`,
      cancelLabel: 'Not yet',
      confirmLabel: 'Cash received',
    });
    if (!cashReceived) return;
    setBusy(true);
    try {
      await apiRequest('/driver/complete', {
        method: 'POST',
        body: JSON.stringify({ request_id: activeRide.request_id, cash_collected: true }),
      });
      setActiveRide(null);
      await refreshDashboard();
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

  const topRequest = requests[0] ?? null;

  return (
    <View style={styles.screenRoot}>
    <ScrollView contentContainerStyle={styles.screen}>
      <View style={styles.driverIntro}>
        <View style={styles.driverIntroTop}>
          <View style={styles.driverIntroCopy}>
            <Text style={styles.driverIntroEyebrow}>SAWAARI · DRIVER STUDIO</Text>
            <Text style={styles.driverIntroTitle}>Your road, your rhythm.</Text>
          </View>
          <VehicleArt
            vehicle={VEHICLES.find((item) => item === application.vehicle_type) ?? 'Car'}
            selected
            size={56}
          />
        </View>
        <Text style={styles.driverIntroSubtitle}>
          Go online when you’re ready. Nearby ride offers appear here.
        </Text>
        <View style={styles.driverLiveState}>
          <View style={[styles.driverLiveDot, isOnline && styles.driverLiveDotOn]} />
          <Text style={styles.driverLiveText}>{isOnline ? 'You’re visible to nearby riders' : 'You’re currently offline'}</Text>
        </View>
      </View>
      <View style={styles.notice}>
        <Ionicons name="warning-outline" size={18} color={COLORS.orange} />
        <Text style={styles.noticeText}>
          Safety features are not operational yet: in-app emergency/SOS, calls, and trip sharing are unavailable.
          Do not use Sawaari for real passenger trips until these protections are added.
        </Text>
      </View>
      {dashboardLoading ? <ActivityIndicator color={COLORS.green} /> : null}
      {dashboardError ? (
        <View style={styles.error}>
          <Text style={styles.errorText}>{dashboardError}</Text>
          <Pressable onPress={() => void refreshDashboard()}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : null}
      {dashboard ? (
        <>
          <View style={styles.card}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIcon}>
                <Ionicons name="person-outline" size={18} color={COLORS.green} />
              </View>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.cardTitle}>Driver account</Text>
                <Text style={styles.cardSubtitle}>{dashboard.profile.email}</Text>
              </View>
              <View style={styles.verifiedBadge}>
                <Ionicons name="checkmark-circle" size={14} color={COLORS.green} />
                <Text style={styles.verifiedText}>Approved</Text>
              </View>
            </View>
            <View style={styles.infoDivider} />
            <Text style={styles.accountName}>
              {dashboard.application?.full_name || dashboard.profile.display_name || 'Driver'}
            </Text>
            {dashboard.application ? (
              <Text style={styles.vehicleInfo}>
                {dashboard.application.vehicle_year} {dashboard.application.vehicle_make}{' '}
                {dashboard.application.vehicle_model} · {dashboard.application.vehicle_type}
              </Text>
            ) : null}
            <Text style={styles.smallNote}>Identity and vehicle documents are verified by Sawaari admin.</Text>
          </View>

          <View style={styles.earningsCard}>
            <View style={styles.sectionHeading}>
              <View style={styles.sectionIconLight}>
                <Ionicons name="wallet-outline" size={18} color={COLORS.white} />
              </View>
              <View style={styles.sectionHeadingCopy}>
                <Text style={styles.earningsLabel}>CASH COLLECTED</Text>
                <Text style={styles.earningsAmount}>
                  {formatPkr(dashboardNumber(dashboard.summary.cash_collected))}
                </Text>
              </View>
            </View>
            <View style={styles.earningsStats}>
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatValue}>
                  {dashboardNumber(dashboard.summary.completed_rides).toLocaleString()}
                </Text>
                <Text style={styles.earningsStatLabel}>completed rides</Text>
              </View>
              <View style={styles.earningsStatDivider} />
              <View style={styles.earningsStat}>
                <Text style={styles.earningsStatValue}>
                  {formatPkr(dashboardNumber(dashboard.summary.cash_not_confirmed))}
                </Text>
                <Text style={styles.earningsStatLabel}>cash not confirmed</Text>
              </View>
            </View>
          </View>

          <View style={styles.paymentCard}>
            <View style={styles.sectionIcon}>
              <Ionicons name="cash-outline" size={18} color={COLORS.green} />
            </View>
            <View style={styles.sectionHeadingCopy}>
              <Text style={styles.cardTitle}>Payment method</Text>
              <Text style={styles.cardSubtitle}>Cash only · collect the fare directly from the rider.</Text>
              <Text style={styles.smallNote}>
                Bank, JazzCash, Easypaisa, card payments, and electronic payouts are not connected.
              </Text>
            </View>
          </View>
        </>
      ) : null}
      {activeRide ? (
        <View style={styles.requestCard}>
          <Text style={styles.activeLabel}>ACTIVE RIDE</Text>
          <Text style={styles.requestFare}>PKR {activeRide.offered_fare}</Text>
          <Text style={styles.riderName}>Rider · {activeRide.rider_name || 'Sawaari rider'}</Text>
          <Text style={styles.routeText}>Pickup: {activeRide.pickup_address}</Text>
          <Text style={styles.routeText}>Drop-off: {activeRide.destination_address}</Text>
          <Text style={styles.routeText}>{activeRide.vehicle}</Text>
          <Text style={styles.paymentHint}>
            Payment: cash · Confirm only after the rider has paid the agreed fare.
          </Text>
          <Text style={styles.locationSharingNote}>
            Live location is shared with this rider while the app is open and location is enabled.
          </Text>
          <Pressable disabled={busy} onPress={() => void completeRide()} style={styles.acceptButton}>
            {busy ? <ActivityIndicator color={COLORS.green} /> : (
              <Text style={styles.acceptText}>Confirm cash received & complete ride</Text>
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
              <VehicleArt vehicle={item} selected={vehicle === item} size={36} />
              <Text style={[styles.vehicleText, vehicle === item && styles.vehicleTextSelected]}>
                {item}
              </Text>
            </Pressable>
          ))}
        </View>
        <Pressable
          accessibilityRole="switch"
          accessibilityState={{ checked: isOnline, disabled: busy || availabilityLoading }}
          disabled={busy || availabilityLoading || Boolean(activeRide)}
          onPress={() => void toggleOnline()}
          style={[styles.onlineButton, isOnline && styles.offlineButton]}
        >
          {busy || availabilityLoading ? <ActivityIndicator color={COLORS.white} /> : (
            <>
              <Ionicons name={isOnline ? 'pause-circle-outline' : 'radio-outline'} size={19} color={COLORS.white} />
              <Text style={styles.onlineButtonText}>{isOnline ? 'Go offline' : 'Go online'}</Text>
            </>
          )}
        </Pressable>
        <Text style={styles.statusText}>
          {activeRide
            ? 'Offline during active ride'
            : availabilityLoading
              ? 'Restoring saved availability…'
            : isOnline
              ? 'Online · stays online after refresh; keep this screen open to share current location'
              : 'Offline · no ride requests will be sent'}
        </Text>
      </View>

      {requestError ? <Text style={styles.error}>{requestError}</Text> : null}
      {isOnline && !activeRide && requests.length === 0 && !requestError ? (
        <View style={styles.empty}>
          <Ionicons name="search-outline" size={26} color={COLORS.green} />
          <Text style={styles.emptyTitle}>Looking for nearby requests</Text>
          <Text style={styles.emptyCopy}>
            Requests appear when the vehicle matches and pickup is within 10 km. Keep this screen open so your location can refresh.
          </Text>
        </View>
      ) : null}
      {dashboard?.recent_rides.length ? (
        <View style={styles.historySection}>
          <Text style={styles.cardTitle}>Completed rides</Text>
          <Text style={styles.cardSubtitle}>Your latest completed trips and recorded cash fares.</Text>
          {dashboard.recent_rides.map((ride) => (
            <View key={ride.request_id} style={styles.historyRide}>
              <View style={styles.historyRideCopy}>
                <Text numberOfLines={1} style={styles.historyRoute}>
                  {ride.pickup_address} → {ride.destination_address}
                </Text>
                <Text style={styles.historyMeta}>
                  {ride.vehicle} · {new Date(ride.completed_at).toLocaleDateString()}
                </Text>
                <Text style={styles.historyPayment}>
                  {ride.cash_collected ? 'Cash received' : 'Cash not confirmed'}
                </Text>
              </View>
              <Text style={styles.historyFare}>{formatPkr(ride.offered_fare)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      <Text style={styles.disclaimer}>
        Cash tracking is an in-app record, not a money transfer. Electronic payments, payouts, navigation, live trip tracking, and safety support are not connected. Do not use this MVP for real passenger trips.
      </Text>
    </ScrollView>
    {isOnline && !activeRide && topRequest ? (
      <View pointerEvents="box-none" style={styles.requestPopupLayer}>
        <View style={styles.requestPopupScrim} />
        <View accessibilityLiveRegion="polite" style={styles.requestPopup}>
          <View style={styles.requestPopupHeading}>
            <View style={styles.requestPopupIcon}>
              <Ionicons
                name={topRequest.vehicle === 'Bike' ? 'bicycle' : 'car-sport'}
                size={20}
                color={COLORS.ink}
              />
            </View>
            <View style={styles.requestPopupTitleCopy}>
              <Text style={styles.requestPopupEyebrow}>RIDE REQUEST</Text>
              <Text numberOfLines={1} style={styles.requestPopupRider}>
                {topRequest.rider_name || 'Sawaari rider'}
              </Text>
              <Text style={styles.requestPopupVehicle}>{topRequest.vehicle} · Pickup {topRequest.distance_m < 1000
                ? `${Math.round(topRequest.distance_m)} m away`
                : `${(topRequest.distance_m / 1000).toFixed(1)} km away`}</Text>
            </View>
            <View style={styles.newRequestBadge}>
              <View style={styles.newRequestDot} />
              <Text style={styles.newRequestText}>NEW</Text>
            </View>
          </View>
          <View style={styles.requestPopupFareRow}>
            <View>
              <Text style={styles.requestMetaLabel}>RIDER&apos;S FARE</Text>
              <Text style={styles.requestPopupFare}>{formatPkr(topRequest.offered_fare)}</Text>
            </View>
            <View style={styles.requestPopupTimeBadge}>
              <Ionicons name="time-outline" size={13} color={COLORS.muted} />
              <Text style={styles.requestPopupTime}>
                {new Date(topRequest.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
              </Text>
            </View>
          </View>
          <View style={styles.requestPopupRouteBlock}>
            <View style={styles.requestPopupRouteRail}>
              <View style={styles.requestPopupRouteStart} />
              <View style={styles.requestPopupRouteDash} />
              <View style={styles.requestPopupRouteEnd} />
            </View>
            <View style={styles.requestPopupRouteCopy}>
              <View>
                <Text style={styles.requestPopupRouteLabel}>PICKUP</Text>
                <Text numberOfLines={1} style={styles.requestPopupRoute}>{topRequest.pickup_address}</Text>
              </View>
              <View style={styles.requestPopupRouteDivider} />
              <View>
                <Text style={styles.requestPopupRouteLabel}>DESTINATION</Text>
                <Text numberOfLines={1} style={styles.requestPopupRoute}>{topRequest.destination_address}</Text>
              </View>
            </View>
          </View>
          {topRequest.my_offer_status === 'pending' ? (
            <Text style={styles.offerStatus}>Your counter-offer is waiting for the rider. You can change it below.</Text>
          ) : topRequest.my_offer_status === 'rejected' ? (
            <Text style={styles.offerRejected}>Rider declined your last offer. Change the price and resend it.</Text>
          ) : null}
          <Text style={styles.requestPopupCounterLabel}>YOUR COUNTER-OFFER <Text style={styles.optionalLabel}>· OPTIONAL</Text></Text>
          <View style={styles.driverOfferInputWrap}>
            <Text style={styles.driverOfferCurrency}>PKR</Text>
            <TextInput
              accessibilityLabel={`Your fare offer for ${topRequest.rider_name || 'ride request'}`}
              value={offerAmounts[topRequest.request_id]
                ?? String(topRequest.my_offer_fare ?? topRequest.offered_fare)}
              onChangeText={(text) => setOfferAmounts((current) => ({
                ...current,
                [topRequest.request_id]: text.replace(/[^\d]/g, ''),
              }))}
              keyboardType="number-pad"
              maxLength={7}
              placeholder="Enter your fare"
              style={styles.driverOfferInput}
            />
            <Pressable
              accessibilityRole="button"
              disabled={sendingOfferId === topRequest.request_id}
              onPress={() => void sendFareOffer(topRequest)}
              style={styles.counterOfferButton}
            >
              {sendingOfferId === topRequest.request_id
                ? <ActivityIndicator size="small" color={COLORS.green} />
                : <Text style={styles.counterOfferText}>
                  {topRequest.my_offer_status === 'pending' ? 'Update' : 'Send offer'}
                </Text>}
            </Pressable>
          </View>
          <View style={styles.requestPopupActions}>
            <Pressable
              accessibilityRole="button"
              disabled={sendingOfferId === topRequest.request_id}
              onPress={() => void respondToRideRequest(topRequest, 'reject')}
              style={({ pressed }) => [
                styles.rejectRequestButton,
                (pressed || sendingOfferId === topRequest.request_id) && styles.disabledRequestAction,
              ]}
            >
              <Ionicons name="close-circle-outline" size={17} color={COLORS.red} />
              <Text style={styles.rejectRequestText}>Reject</Text>
            </Pressable>
            {topRequest.my_offer_status === 'pending' ? (
              <View style={[styles.acceptRequestButton, styles.waitingRequestButton]}>
                <Text style={styles.waitingRequestText}>Waiting for rider</Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                disabled={sendingOfferId === topRequest.request_id}
                onPress={() => void respondToRideRequest(topRequest, 'accept')}
                style={({ pressed }) => [
                  styles.acceptRequestButton,
                  (pressed || sendingOfferId === topRequest.request_id) && styles.disabledRequestAction,
                ]}
              >
                {sendingOfferId === topRequest.request_id
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.white} />
                      <Text style={styles.acceptRequestText}>Accept fare</Text>
                    </>
                  )}
              </Pressable>
            )}
          </View>
          {requests.length > 1 ? (
            <Text style={styles.requestQueueNote}>
              +{requests.length - 1} more nearby {requests.length === 2 ? 'request' : 'requests'} after this one
            </Text>
          ) : null}
        </View>
      </View>
    ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: { flex: 1, position: 'relative', backgroundColor: COLORS.paper },
  screen: { padding: 18, paddingBottom: 36, gap: 14, backgroundColor: COLORS.paper, flexGrow: 1 },
  requestPopupLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 30,
    elevation: 18,
    alignItems: 'center',
    paddingHorizontal: 10,
  },
  requestPopupScrim: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(17, 40, 58, 0.18)',
  },
  requestPopup: {
    width: '100%',
    maxWidth: 520,
    marginTop: 10,
    padding: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D5E4E0',
    backgroundColor: COLORS.white,
    gap: 11,
    shadowColor: '#10283A',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  requestPopupHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: COLORS.line },
  requestPopupIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.lime },
  requestPopupTitleCopy: { flex: 1, minWidth: 0 },
  requestPopupEyebrow: { color: COLORS.green, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  requestPopupRider: { marginTop: 3, color: COLORS.ink, fontSize: 14, fontWeight: '900' },
  requestPopupVehicle: { marginTop: 2, color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  newRequestBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E8F4EE' },
  newRequestDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  newRequestText: { color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  requestPopupFareRow: {
    minHeight: 67,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: '#F4F8F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  requestPopupFare: { marginTop: 2, color: COLORS.green, fontSize: 23, fontWeight: '900', letterSpacing: -0.5 },
  requestPopupTimeBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 8, backgroundColor: COLORS.white },
  requestPopupTime: { color: COLORS.muted, fontSize: 9, fontWeight: '700' },
  requestPopupRouteBlock: { flexDirection: 'row', gap: 10, paddingHorizontal: 3 },
  requestPopupRouteRail: { width: 10, alignItems: 'center', paddingVertical: 4 },
  requestPopupRouteStart: { width: 7, height: 7, borderRadius: 4, borderWidth: 2, borderColor: COLORS.green },
  requestPopupRouteDash: { width: 1, flex: 1, minHeight: 8, backgroundColor: '#B8C7B7' },
  requestPopupRouteEnd: { width: 7, height: 7, backgroundColor: COLORS.orange },
  requestPopupRouteCopy: { flex: 1, gap: 8 },
  requestPopupRoute: { marginTop: 2, color: COLORS.ink, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  requestPopupRouteLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  requestPopupRouteDivider: { height: 1, backgroundColor: COLORS.line },
  requestPopupCounterLabel: { color: COLORS.ink, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  optionalLabel: { color: COLORS.muted, fontWeight: '600' },
  requestPopupActions: { flexDirection: 'row', gap: 10, paddingTop: 1 },
  acceptRequestButton: { flex: 1.3, minHeight: 46, borderRadius: 12, backgroundColor: COLORS.green, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  acceptRequestText: { color: COLORS.white, fontSize: 11, fontWeight: '900' },
  rejectRequestButton: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#F0D8D6', backgroundColor: '#FFF8F7', flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  rejectRequestText: { color: COLORS.red, fontSize: 11, fontWeight: '900' },
  waitingRequestButton: { backgroundColor: '#E8EFED' },
  waitingRequestText: { color: COLORS.muted, fontSize: 10, fontWeight: '800' },
  disabledRequestAction: { opacity: 0.65 },
  requestQueueNote: { color: COLORS.muted, fontSize: 9, textAlign: 'center' },
  counterOfferButton: { minWidth: 78, minHeight: 38, paddingHorizontal: 10, borderRadius: 9, backgroundColor: COLORS.lime, alignItems: 'center', justifyContent: 'center' },
  counterOfferText: { color: COLORS.green, fontSize: 10, fontWeight: '900' },
  eyebrow: { marginTop: 6, color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.4 },
  title: { color: COLORS.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  subtitle: { color: COLORS.muted, fontSize: 13, lineHeight: 19 },
  driverIntro: { padding: 17, borderRadius: 23, gap: 11, backgroundColor: '#11283A', elevation: 7, shadowColor: '#11283A', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  driverIntroTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  driverIntroCopy: { flex: 1 },
  driverIntroEyebrow: { color: '#A8D9CC', fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  driverIntroTitle: { marginTop: 5, color: COLORS.white, fontSize: 23, fontWeight: '800', letterSpacing: -0.6 },
  driverIntroSubtitle: { color: '#D0DFE2', fontSize: 11, lineHeight: 17 },
  driverLiveState: { flexDirection: 'row', alignItems: 'center', gap: 7, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.16)' },
  driverLiveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#E79A54' },
  driverLiveDotOn: { backgroundColor: '#52D5A9' },
  driverLiveText: { color: '#D5E6E3', fontSize: 10, fontWeight: '600' },
  card: { padding: 16, borderRadius: 20, borderWidth: 1, borderColor: '#E6EFEC', backgroundColor: COLORS.white, elevation: 3, shadowColor: '#173A4B', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sectionHeadingCopy: { flex: 1 },
  sectionIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2F5EF',
  },
  sectionIconLight: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  cardTitle: { color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  cardSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 10,
    backgroundColor: '#E2F5EF',
  },
  verifiedText: { color: COLORS.green, fontSize: 9, fontWeight: '800' },
  infoDivider: { height: 1, marginVertical: 13, backgroundColor: COLORS.line },
  accountName: { color: COLORS.ink, fontSize: 16, fontWeight: '800' },
  vehicleInfo: { marginTop: 4, color: COLORS.green, fontSize: 12, fontWeight: '700' },
  smallNote: { marginTop: 7, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  earningsCard: { padding: 18, borderRadius: 22, backgroundColor: '#0B786F', elevation: 6, shadowColor: '#0B786F', shadowOpacity: 0.2, shadowRadius: 11, shadowOffset: { width: 0, height: 5 } },
  earningsLabel: { color: '#D8E5EF', fontSize: 9, fontWeight: '800', letterSpacing: 1 },
  earningsAmount: { marginTop: 3, color: COLORS.white, fontSize: 25, fontWeight: '900' },
  earningsStats: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.2)',
  },
  earningsStat: { flex: 1 },
  earningsStatValue: { color: COLORS.white, fontSize: 14, fontWeight: '800' },
  earningsStatLabel: { marginTop: 3, color: '#D8E5EF', fontSize: 9 },
  earningsStatDivider: { width: 1, height: 30, marginHorizontal: 14, backgroundColor: 'rgba(255,255,255,0.2)' },
  paymentCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
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
  vehicleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 },
  vehicleButton: { minWidth: 74, alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 9, borderRadius: 13, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  vehicleSelected: { borderColor: COLORS.green, backgroundColor: '#E2F5EF' },
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
  errorText: { color: COLORS.red, fontSize: 11, lineHeight: 16 },
  retryText: { marginTop: 7, color: COLORS.green, fontSize: 11, fontWeight: '800' },
  empty: { alignItems: 'center', padding: 22, borderRadius: 16, backgroundColor: COLORS.white },
  emptyTitle: { marginTop: 9, color: COLORS.ink, fontSize: 14, fontWeight: '800' },
  emptyCopy: { marginTop: 4, color: COLORS.muted, fontSize: 11, textAlign: 'center' },
  requestCard: { padding: 17, borderRadius: 21, borderWidth: 1, borderColor: '#E6EFEC', backgroundColor: COLORS.white, gap: 9, elevation: 4, shadowColor: '#173A4B', shadowOpacity: 0.07, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  paymentHint: { color: COLORS.orange, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  locationSharingNote: { color: COLORS.green, fontSize: 10, lineHeight: 15, fontWeight: '600' },
  requestTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  requestMetaLabel: { color: COLORS.muted, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  requestFare: { color: COLORS.green, fontSize: 18, fontWeight: '800' },
  activeLabel: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 1.1 },
  distance: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  riderName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  routeText: { color: COLORS.muted, fontSize: 11, lineHeight: 16 },
  historySection: {
    padding: 15,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  historyRide: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: COLORS.line,
  },
  historyRideCopy: { flex: 1 },
  historyRoute: { color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  historyMeta: { marginTop: 4, color: COLORS.muted, fontSize: 9 },
  historyPayment: { marginTop: 4, color: COLORS.green, fontSize: 9, fontWeight: '700' },
  historyFare: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  offerStatus: { color: COLORS.green, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  offerRejected: { color: COLORS.orange, fontSize: 10, lineHeight: 15, fontWeight: '700' },
  driverOfferInputWrap: { minHeight: 44, paddingHorizontal: 11, borderRadius: 11, borderWidth: 1, borderColor: COLORS.line, flexDirection: 'row', alignItems: 'center', gap: 8 },
  driverOfferCurrency: { color: COLORS.muted, fontSize: 11, fontWeight: '800' },
  driverOfferInput: { flex: 1, minWidth: 0, paddingVertical: 8, color: COLORS.ink, fontSize: 14, fontWeight: '800', textAlign: 'right' },
  acceptButton: { minHeight: 42, marginTop: 4, borderRadius: 11, backgroundColor: COLORS.lime, alignItems: 'center', justifyContent: 'center' },
  acceptText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  disclaimer: { marginTop: 10, color: COLORS.muted, fontSize: 10, lineHeight: 16 },
});
