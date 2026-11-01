import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import RideMap from './RideMap';
import type { MapPoint } from './ride-map.types';
import { loadGoogleMaps } from './google-maps';
import AccountPanel from './AccountPanel';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';

type Coordinate = MapPoint;
type MapViewport = Coordinate & { latitudeDelta: number; longitudeDelta: number };

type Vehicle = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';
type Screen = 'Ride' | 'Trips' | 'Profile';
type RouteField = 'pickup' | 'destination';
type SearchScope = 'Pakistan' | 'Worldwide';
type PlaceSuggestion = {
  id: string;
  label: string;
  detail: string;
  country: string;
  point: Coordinate | null;
  googlePrediction?: google.maps.places.PlacePrediction;
};

type Ride = {
  id: string;
  createdAt: string;
  pickup: Coordinate;
  pickupAddress: string;
  destination: Coordinate;
  destinationAddress: string;
  vehicle: Vehicle;
  offer: number;
  cloud?: boolean;
};
type NearbyDriver = {
  driver_id: string;
  driver_name: string;
  vehicle: Vehicle;
  distance_m: number;
  updated_at: string;
};
type RideServerStatus = {
  status: string;
  driver_name: string;
  driver_vehicle: string;
};

const STORAGE_KEY = '@sawaari/rides';
const GOOGLE_MAPS_WEB_CONFIGURED = Boolean(process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY);
const DEFAULT_REGION: MapViewport = {
  latitude: 24.8607,
  longitude: 67.0011,
  latitudeDelta: 0.045,
  longitudeDelta: 0.045,
};
const PAKISTAN_SEARCH_BOUNDS = '60.87,23.69,77.84,37.10';
const VEHICLES: { name: Vehicle; icon: keyof typeof Ionicons.glyphMap; detail: string }[] = [
  { name: 'Bike', icon: 'bicycle-outline', detail: '1 seat' },
  { name: 'Rickshaw', icon: 'car-outline', detail: '3 seats' },
  { name: 'Car', icon: 'car-sport-outline', detail: '4 seats' },
  { name: 'Premium', icon: 'diamond-outline', detail: 'Comfort' },
];
const FARE_RATES: Record<Vehicle, { base: number; perKm: number }> = {
  Bike: { base: 50, perKm: 30 },
  Rickshaw: { base: 80, perKm: 45 },
  Car: { base: 120, perKm: 55 },
  Premium: { base: 200, perKm: 80 },
};
const COLORS = {
  ink: '#172621',
  muted: '#75817B',
  green: '#0E4E3D',
  lime: '#C8F169',
  paper: '#F6F7F1',
  line: '#E8EBE4',
  white: '#FFFFFF',
  orange: '#EF9B54',
  red: '#C34242',
};

function coordinatesLabel(point: Coordinate | null) {
  if (!point) return '';
  return `${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)}`;
}

function estimateStraightLineDistance(pickup: Coordinate, destination: Coordinate) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(destination.latitude - pickup.latitude);
  const longitudeDelta = radians(destination.longitude - pickup.longitude);
  const latitude1 = radians(pickup.latitude);
  const latitude2 = radians(destination.latitude);
  const rawHaversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitude1) * Math.cos(latitude2) * Math.sin(longitudeDelta / 2) ** 2;
  const haversine = Math.min(1, Math.max(0, rawHaversine));
  return Math.max(0.1, 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)));
}

function estimateFare(distanceKm: number, rideVehicle: Vehicle) {
  const { base, perKm } = FARE_RATES[rideVehicle];
  return Math.ceil((base + distanceKm * perKm) / 10) * 10;
}

function showMessage(title: string, message: string) {
  if (Platform.OS === 'web') {
    window.alert(`${title}\n\n${message}`);
  } else {
    Alert.alert(title, message);
  }
}

function addressOrCoordinates(address: string, point: Coordinate) {
  return address && address !== 'Finding address...' ? address : coordinatesLabel(point);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function photonSuggestions(value: unknown, scope: SearchScope): PlaceSuggestion[] {
  if (!isRecord(value) || !Array.isArray(value.features)) return [];

  return value.features.flatMap((feature, index) => {
    if (!isRecord(feature) || !isRecord(feature.geometry) || !Array.isArray(feature.geometry.coordinates)
      || !isRecord(feature.properties)) return [];
    const [longitude, latitude] = feature.geometry.coordinates;
    if (typeof longitude !== 'number' || !Number.isFinite(longitude)
      || typeof latitude !== 'number' || !Number.isFinite(latitude)) return [];

    const properties = feature.properties;
    const country = typeof properties.country === 'string' ? properties.country : '';
    if (scope === 'Pakistan' && country !== 'Pakistan') return [];
    const labelParts = [
      properties.name,
      properties.housenumber,
      properties.street,
    ].filter((part): part is string => typeof part === 'string' && part.length > 0);
    const uniqueLabelParts = [...new Set(labelParts)];
    if (uniqueLabelParts.length === 0) return [];

    const context = [
      properties.district,
      properties.city,
      properties.state,
      properties.country,
    ].filter((part): part is string => typeof part === 'string'
      && !uniqueLabelParts.some((labelPart) => labelPart.toLowerCase() === part.toLowerCase()));
    const id = typeof properties.osm_id === 'number' || typeof properties.osm_id === 'string'
      ? String(properties.osm_id)
      : String(index);

    return [{
      id: `${properties.osm_type ?? 'place'}-${id}`,
      label: uniqueLabelParts.join(', '),
      detail: [...new Set(context)].join(', ') || 'Place',
      country,
      point: { latitude, longitude },
    }];
  });
}

function isCoordinate(value: unknown): value is Coordinate {
  return isRecord(value)
    && typeof value.latitude === 'number'
    && Number.isFinite(value.latitude)
    && typeof value.longitude === 'number'
    && Number.isFinite(value.longitude);
}

function isRide(value: unknown): value is Ride {
  if (!isRecord(value)) return false;
  return typeof value.id === 'string'
    && typeof value.createdAt === 'string'
    && Number.isFinite(Date.parse(value.createdAt))
    && isCoordinate(value.pickup)
    && typeof value.pickupAddress === 'string'
    && isCoordinate(value.destination)
    && typeof value.destinationAddress === 'string'
    && VEHICLES.some((item) => item.name === value.vehicle)
    && typeof value.offer === 'number'
    && Number.isFinite(value.offer)
    && value.offer > 0
    && (!('cloud' in value) || typeof value.cloud === 'boolean');
}

function formatAddress(address: LocationGeocodedAddress | undefined) {
  const parts = [address?.name, address?.street, address?.district, address?.city, address?.region]
    .filter((part): part is string => Boolean(part));
  return [...new Set(parts)].slice(0, 3).join(', ');
}

function formatTime(dateString: string) {
  return new Date(dateString).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function SawaariApp({ screen }: { screen: Screen }) {
  const router = useRouter();
  const { configured, session } = useAuth();
  const { width } = useWindowDimensions();
  const wideLayout = Platform.OS === 'web' && width >= 980;
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pickup, setPickup] = useState<Coordinate | null>(null);
  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [searchField, setSearchField] = useState<RouteField | null>(null);
  const [searchScope, setSearchScope] = useState<SearchScope>('Pakistan');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PlaceSuggestion[]>([]);
  const placeSearchSession = useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const [searchingPlaces, setSearchingPlaces] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [vehicle, setVehicle] = useState<Vehicle>('Car');
  const [offer, setOffer] = useState('');
  const [customOffer, setCustomOffer] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [locationGranted, setLocationGranted] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [loadingRides, setLoadingRides] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeError, setRouteError] = useState('');
  const [nearbyDrivers, setNearbyDrivers] = useState<Record<string, NearbyDriver[]>>({});
  const [rideStatuses, setRideStatuses] = useState<Record<string, RideServerStatus>>({});
  const [matchingError, setMatchingError] = useState('');
  const directDistanceKm = pickup && destination
    && (Math.abs(pickup.latitude - destination.latitude) >= 0.0001
      || Math.abs(pickup.longitude - destination.longitude) >= 0.0001)
    ? estimateStraightLineDistance(pickup, destination)
    : null;
  const fareDistanceKm = Platform.OS === 'web' ? routeDistanceKm : directDistanceKm;
  const suggestedFare = fareDistanceKm === null ? null : estimateFare(fareDistanceKm, vehicle);

  useEffect(() => {
    let active = true;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((value) => {
        if (!active || !value) return;
        const savedRides: unknown = JSON.parse(value);
        if (!Array.isArray(savedRides) || !savedRides.every(isRide)) {
          throw new Error('Stored ride history is invalid.');
        }
        setRides(savedRides);
      })
      .catch(() => {
        if (active) setStorageError('Trip history could not be loaded from this device.');
      })
      .finally(() => {
        if (active) setLoadingRides(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const client = supabase;
    if (screen !== 'Trips' || !configured || !session || !client) return undefined;
    let active = true;
    const refreshMatches = async () => {
      const cloudRides = rides.filter((ride) => ride.cloud);
      if (cloudRides.length === 0) return;
      const driverResults: Record<string, NearbyDriver[]> = {};
      const statusResults: Record<string, RideServerStatus> = {};
      const errors: string[] = [];

      await Promise.all(cloudRides.map(async (ride) => {
        const [driversResponse, statusResponse] = await Promise.all([
          client.rpc('get_nearby_drivers', {
            p_latitude: ride.pickup.latitude,
            p_longitude: ride.pickup.longitude,
            p_radius_m: 10000,
          }),
          client.rpc('get_my_ride_status', { p_request_id: ride.id }),
        ]);
        if (driversResponse.error) errors.push(driversResponse.error.message);
        else if (Array.isArray(driversResponse.data)) {
          driverResults[ride.id] = driversResponse.data.filter((candidate: unknown): candidate is NearbyDriver => {
            if (typeof candidate !== 'object' || candidate === null) return false;
            const driver = candidate as Record<string, unknown>;
            return typeof driver.driver_id === 'string'
              && typeof driver.driver_name === 'string'
              && VEHICLES.some((item) => item === driver.vehicle)
              && typeof driver.distance_m === 'number'
              && typeof driver.updated_at === 'string';
          });
        }
        if (statusResponse.error) errors.push(statusResponse.error.message);
        else if (Array.isArray(statusResponse.data) && statusResponse.data.length > 0) {
          const current = statusResponse.data[0] as unknown;
          if (typeof current === 'object' && current !== null) {
            const status = current as Record<string, unknown>;
            if (typeof status.status === 'string'
              && typeof status.driver_name === 'string'
              && typeof status.driver_vehicle === 'string') {
              statusResults[ride.id] = {
                status: status.status,
                driver_name: status.driver_name,
                driver_vehicle: status.driver_vehicle,
              };
            }
          }
        }
      }));

      if (!active) return;
      setNearbyDrivers(driverResults);
      setRideStatuses(statusResults);
      setMatchingError(errors[0] ?? '');
    };

    void refreshMatches();
    const timer = setInterval(() => void refreshMatches(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [configured, rides, screen, session]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (!searchField || query.length < 3) return undefined;

    const controller = new AbortController();
    const timeout = setTimeout(() => {
      setSearchingPlaces(true);
      setSearchError('');
      if (Platform.OS === 'web' && GOOGLE_MAPS_WEB_CONFIGURED) {
        void loadGoogleMaps()
          .then(async (mapsApi) => {
            const places = await mapsApi.maps.importLibrary('places') as google.maps.PlacesLibrary;
            if (controller.signal.aborted) return;
            const sessionToken = placeSearchSession.current
              ?? new places.AutocompleteSessionToken();
            placeSearchSession.current = sessionToken;
            const bounds = searchScope === 'Pakistan'
              ? { north: 37.10, south: 23.69, east: 77.84, west: 60.87 }
              : undefined;
            const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({
              input: query,
              language: 'en',
              region: 'pk',
              sessionToken,
              ...(bounds ? { locationRestriction: bounds, includedRegionCodes: ['pk'] } : {}),
            });
            if (controller.signal.aborted) return;
            setSearchResults(suggestions.flatMap((suggestion) => {
              const prediction = suggestion.placePrediction;
              if (!prediction) return [];
              return [{
                id: prediction.placeId,
                label: prediction.mainText?.text ?? prediction.text.text,
                detail: prediction.secondaryText?.text ?? '',
                country: searchScope === 'Pakistan' ? 'Pakistan' : '',
                point: null,
                googlePrediction: prediction,
              }];
            }));
          })
          .catch((error: unknown) => {
            if (controller.signal.aborted) return;
            setSearchError(error instanceof Error
              ? error.message
              : 'Could not search Google Maps places. Check your connection and API settings.');
            setSearchResults([]);
          })
          .finally(() => {
            if (!controller.signal.aborted) setSearchingPlaces(false);
          });
        return;
      }

      const params = new URLSearchParams({
        q: query,
        limit: '10',
        lang: 'en',
      });
      if (searchScope === 'Pakistan') params.set('bbox', PAKISTAN_SEARCH_BOUNDS);
      const searchCenter = searchField === 'destination' ? pickup : destination;
      if (searchCenter) {
        params.set('lat', String(searchCenter.latitude));
        params.set('lon', String(searchCenter.longitude));
      }

      void fetch(`https://photon.komoot.io/api/?${params.toString()}`, { signal: controller.signal })
        .then(async (response) => {
          if (!response.ok) throw new Error(`Place search failed (${response.status}).`);
          return await response.json() as unknown;
        })
        .then((data) => setSearchResults(photonSuggestions(data, searchScope)))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setSearchError(error instanceof Error
            ? error.message
            : 'Could not search places. Check your connection and try again.');
          setSearchResults([]);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearchingPlaces(false);
        });
    }, 450);

    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [destination, pickup, searchField, searchQuery, searchScope]);

  const updateSuggestedFare = (
    nextPickup: Coordinate | null,
    nextDestination: Coordinate | null,
    nextVehicle: Vehicle,
  ) => {
    if (customOffer) return;
    if (!nextPickup || !nextDestination) {
      setOffer('');
      return;
    }
    if (Platform.OS === 'web') {
      setOffer('');
      return;
    }
    const distance = estimateStraightLineDistance(nextPickup, nextDestination);
    setOffer(String(estimateFare(distance, nextVehicle)));
  };

  const focusMap = (point: Coordinate) => {
    const nextRegion = { ...point, latitudeDelta: 0.025, longitudeDelta: 0.025 };
    setRegion(nextRegion);
  };

  const lookupAddress = async (field: RouteField, point: Coordinate) => {
    try {
      const [address] = await Location.reverseGeocodeAsync(point);
      const label = formatAddress(address);
      if (!label) throw new Error('No address was returned for this location.');
      if (field === 'pickup') setPickupAddress(label);
      else setDestinationAddress(label);
      setAddressError('');
    } catch {
      const label = `Address unavailable · ${coordinatesLabel(point)}`;
      if (field === 'pickup') setPickupAddress(label);
      else setDestinationAddress(label);
      setAddressError('Could not look up a street address. The selected map coordinates are still saved.');
    }
  };

  const useMyLocation = async () => {
    setLoadingLocation(true);
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted) {
        setLocationGranted(false);
        showMessage(
          'Location permission needed',
          'Allow location access in your device settings to use your current position as pickup, or search for a pickup address.',
        );
        return;
      }

      setLocationGranted(true);
      const result = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      const point = {
        latitude: result.coords.latitude,
        longitude: result.coords.longitude,
      };
      setPickup(point);
      setRouteDistanceKm(null);
      setRouteError('');
      updateSuggestedFare(point, destination, vehicle);
      setPickupAddress('Finding address...');
      void lookupAddress('pickup', point);
      setSearchField(null);
      focusMap(point);
    } catch {
      showMessage(
        'Could not get your location',
        'Check that location services are enabled, or search for a pickup address.',
      );
    } finally {
      setLoadingLocation(false);
    }
  };

  const beginPlaceSearch = (field: RouteField) => {
    Keyboard.dismiss();
    setSearchField(field);
    setSearchQuery(field === 'pickup' ? pickupAddress : destinationAddress);
    setSearchResults([]);
    setSearchingPlaces(false);
    setSearchError('');
    placeSearchSession.current = null;
  };

  const selectPlace = async (place: PlaceSuggestion) => {
    if (!searchField) return;
    const field = searchField;
    let selectedPoint = place.point;
    let selectedLabel = place.label;

    if (place.googlePrediction) {
      setSearchingPlaces(true);
      try {
        const selectedPlace = place.googlePrediction.toPlace();
        await selectedPlace.fetchFields({
          fields: ['displayName', 'formattedAddress', 'location'],
        });
        const location = selectedPlace.location;
        if (!location) throw new Error('Google Maps did not return coordinates for this place.');
        selectedPoint = { latitude: location.lat(), longitude: location.lng() };
        selectedLabel = selectedPlace.formattedAddress || selectedPlace.displayName || place.label;
      } catch (error: unknown) {
        setSearchError(error instanceof Error
          ? error.message
          : 'Could not load the selected place from Google Maps.');
        setSearchingPlaces(false);
        placeSearchSession.current = null;
        return;
      }
    }

    if (!selectedPoint) {
      setSearchError('This search result did not include a usable location.');
      setSearchingPlaces(false);
      return;
    }
    const nextPickup = field === 'pickup' ? selectedPoint : pickup;
    const nextDestination = field === 'destination' ? selectedPoint : destination;

    if (field === 'pickup') {
      setPickup(selectedPoint);
      setPickupAddress(selectedLabel);
    } else {
      setDestination(selectedPoint);
      setDestinationAddress(selectedLabel);
    }

    setRouteDistanceKm(null);
    setRouteError('');
    updateSuggestedFare(nextPickup, nextDestination, vehicle);
    if (nextPickup && nextDestination) {
      setRegion({
        latitude: (nextPickup.latitude + nextDestination.latitude) / 2,
        longitude: (nextPickup.longitude + nextDestination.longitude) / 2,
        latitudeDelta: Math.max(0.01, Math.abs(nextPickup.latitude - nextDestination.latitude) * 1.8),
        longitudeDelta: Math.max(0.01, Math.abs(nextPickup.longitude - nextDestination.longitude) * 1.8),
      });
    } else {
      focusMap(selectedPoint);
    }
    placeSearchSession.current = null;
    Keyboard.dismiss();
    setSearchField(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchingPlaces(false);
    setSearchError('');
  };

  const createRide = async () => {
    Keyboard.dismiss();
    const parsedOffer = Number(offer.replace(/,/g, ''));
    if (!pickup || !destination) {
      showMessage(
        'Choose both locations',
        'Select pickup and destination, then tap each point on the map.',
      );
      return;
    }
    if (Math.abs(pickup.latitude - destination.latitude) < 0.0001 &&
      Math.abs(pickup.longitude - destination.longitude) < 0.0001) {
      showMessage('Choose a different destination', 'Pickup and destination cannot be the same.');
      return;
    }
    if (!Number.isFinite(parsedOffer) || parsedOffer < 1 || parsedOffer > 1000000) {
      showMessage('Enter a valid fare', 'Offer an amount between PKR 1 and PKR 1,000,000.');
      return;
    }
    if (configured && !session) {
      showMessage(
        'Sign in to find drivers',
        'Open Profile and create or sign in to your account before sending this request to nearby drivers.',
      );
      router.navigate('/profile');
      return;
    }

    const ride: Ride = {
      id: `${Date.now()}`,
      createdAt: new Date().toISOString(),
      pickup,
      pickupAddress: addressOrCoordinates(pickupAddress, pickup),
      destination,
      destinationAddress: addressOrCoordinates(destinationAddress, destination),
      vehicle,
      offer: parsedOffer,
      cloud: false,
    };

    const saveRequest = async () => {
      try {
        let savedRide = ride;
        if (configured) {
          const client = supabase;
          if (!session || !client) {
            showMessage(
              'Sign in to find drivers',
              'Open Profile and create or sign in to your account before sending this request to nearby drivers.',
            );
            router.navigate('/profile');
            return;
          }
          const { data, error } = await client.rpc('create_ride_request', {
            p_pickup_address: ride.pickupAddress,
            p_destination_address: ride.destinationAddress,
            p_pickup_latitude: ride.pickup.latitude,
            p_pickup_longitude: ride.pickup.longitude,
            p_destination_latitude: ride.destination.latitude,
            p_destination_longitude: ride.destination.longitude,
            p_vehicle: ride.vehicle,
            p_offered_fare: ride.offer,
          });
          if (error) throw error;
          if (typeof data !== 'string') {
            throw new Error('The server did not confirm the ride request.');
          }
          savedRide = { ...ride, id: data, cloud: true };
        }
        const nextRides = [savedRide, ...rides];
        setRides(nextRides);
        setOffer('');
        setCustomOffer(false);
        router.navigate('/trips');
        try {
          await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextRides));
          setStorageError('');
        } catch (error: unknown) {
          const detail = error instanceof Error ? error.message : 'Device storage is unavailable.';
          setStorageError(
            savedRide.cloud
              ? `Ride request was sent, but trip history could not be saved on this device: ${detail}`
              : `Draft is available until the app closes, but could not be saved on this device: ${detail}`,
          );
          showMessage(
            savedRide.cloud ? 'Ride sent; history not saved' : 'Draft not saved permanently',
            savedRide.cloud
              ? 'Your request is active and visible in Trips for this session, but local trip history could not be stored.'
              : 'Your draft is visible in Trips for this session, but local storage could not save it.',
          );
          return;
        }
        showMessage(
          savedRide.cloud ? 'Searching nearby drivers' : 'Local draft saved',
          savedRide.cloud
            ? 'Your request was sent to online drivers nearby. Check Trips for available drivers.'
            : 'This request is saved on this device only. To find real nearby drivers, configure the shared Supabase backend and sign in.',
        );
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Please try again.';
        setStorageError(detail);
        showMessage('Could not send your request', detail);
      }
    };
    const reviewMessage =
      `${vehicle} · PKR ${parsedOffer}\n\nPickup: ${ride.pickupAddress}\n\nDestination: ${ride.destinationAddress}`;

    if (Platform.OS === 'web') {
      const action = configured ? 'Send request to nearby drivers' : 'Save this local draft';
      if (window.confirm(`Review your ride request\n\n${reviewMessage}\n\n${action}?`)) {
        await saveRequest();
      }
      return;
    }

    Alert.alert('Review your ride request', reviewMessage, [
      { text: 'Change details', style: 'cancel' },
      {
        text: configured ? 'Send ride request' : 'Save local draft',
        onPress: () => void saveRequest(),
      },
    ]);
  };

  const cancelRide = (ride: Ride) => {
    const client = supabase;
    if (!client) return;
    const cancel = async () => {
      const { error } = await client.rpc('cancel_ride_request', { p_request_id: ride.id });
      if (error) {
        setMatchingError(error.message);
        showMessage('Could not cancel request', error.message);
        return;
      }
      setRideStatuses((current) => ({
        ...current,
        [ride.id]: { status: 'cancelled', driver_name: '', driver_vehicle: '' },
      }));
      setNearbyDrivers((current) => ({ ...current, [ride.id]: [] }));
    };

    if (Platform.OS === 'web') {
      if (window.confirm('Cancel this ride request?')) void cancel();
      return;
    }
    Alert.alert('Cancel ride request?', 'Nearby drivers will no longer see this request.', [
      { text: 'Keep request', style: 'cancel' },
      { text: 'Cancel request', style: 'destructive', onPress: () => void cancel() },
    ]);
  };

  const renderMap = () => (
    <View style={[styles.mapFrame, wideLayout && styles.mapFrameWide]}>
      <RideMap
        region={region}
        pickup={pickup}
        destination={destination}
        locationGranted={locationGranted}
        onRegionChange={setRegion}
        onRouteDistanceChange={(distanceKm, error) => {
          setRouteDistanceKm(distanceKm);
          setRouteError(error ?? '');
          if (customOffer) return;
          setOffer(distanceKm === null ? '' : String(estimateFare(distanceKm, vehicle)));
        }}
      />
      <View style={styles.mapLabel}>
        <Ionicons name="map" size={14} color={COLORS.green} />
        <Text style={styles.mapLabelText}>MAP VIEW</Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Use my current location"
        style={styles.myLocationButton}
        onPress={useMyLocation}
        disabled={loadingLocation}
      >
        {loadingLocation ? (
          <ActivityIndicator size="small" color={COLORS.green} />
        ) : (
          <Ionicons name="navigate" size={19} color={COLORS.green} />
        )}
      </Pressable>
    </View>
  );

  const renderPlaceSearch = () => {
    if (!searchField) return null;
    const fieldTitle = searchField === 'pickup' ? 'Pickup location' : 'Destination';

    return (
      <View style={styles.searchOverlay}>
        <View style={styles.searchHeader}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close place search"
            onPress={() => {
              Keyboard.dismiss();
              setSearchField(null);
              setSearchQuery('');
              setSearchResults([]);
              setSearchingPlaces(false);
              setSearchError('');
              placeSearchSession.current = null;
            }}
            style={styles.searchBackButton}
          >
            <Ionicons name="arrow-back" size={21} color={COLORS.ink} />
          </Pressable>
          <View>
            <Text style={styles.searchTitle}>Search {fieldTitle.toLowerCase()}</Text>
            <Text style={styles.searchSubtitle}>
              {searchScope === 'Pakistan'
                ? 'Search places across Pakistan'
                : 'Search places anywhere in the world'}
            </Text>
          </View>
        </View>
        <View style={styles.searchInputWrap}>
          <Ionicons name="search" size={19} color={COLORS.green} />
          <TextInput
            accessibilityLabel={`Search ${fieldTitle.toLowerCase()} address`}
            autoFocus
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="search"
            value={searchQuery}
            onChangeText={(text) => {
              setSearchQuery(text);
              setSearchResults([]);
              setSearchError('');
              setSearchingPlaces(false);
            }}
            placeholder="Search any city, address, or landmark"
            placeholderTextColor="#89948D"
            style={styles.searchInput}
          />
          {searchQuery.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear place search"
              onPress={() => {
                setSearchQuery('');
                setSearchResults([]);
                setSearchError('');
                setSearchingPlaces(false);
              }}
            >
              <Ionicons name="close-circle" size={19} color={COLORS.muted} />
            </Pressable>
          ) : null}
        </View>
        <View style={styles.searchScopeRow}>
          {(['Pakistan', 'Worldwide'] as const).map((scope) => {
            const selected = searchScope === scope;
            return (
              <Pressable
                key={scope}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  if (scope === searchScope) return;
                  setSearchScope(scope);
                  setSearchResults([]);
                  setSearchingPlaces(false);
                  setSearchError('');
                }}
                style={[styles.searchScopeButton, selected && styles.searchScopeButtonSelected]}
              >
                <Text style={[styles.searchScopeText, selected && styles.searchScopeTextSelected]}>
                  {scope === 'Pakistan' ? 'Pakistan' : 'Worldwide'}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <ScrollView
          style={styles.searchResults}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {searchingPlaces ? (
            <ActivityIndicator color={COLORS.green} style={styles.searchLoading} />
          ) : searchError ? (
            <Text style={styles.searchMessage}>{searchError}</Text>
          ) : searchQuery.trim().length < 3 ? (
            <Text style={styles.searchMessage}>
              Type at least 3 letters to search {searchScope === 'Pakistan' ? 'Pakistan' : 'worldwide'}.
            </Text>
          ) : searchResults.length === 0 ? (
            <Text style={styles.searchMessage}>No places found. Try a nearby area or landmark.</Text>
          ) : (
            searchResults.map((place) => (
              <Pressable
                key={place.id}
                accessibilityRole="button"
                accessibilityLabel={`Select ${place.label}`}
                onPress={() => selectPlace(place)}
                style={styles.searchResult}
              >
                <View style={styles.searchResultIcon}>
                  <Ionicons name="location-outline" size={19} color={COLORS.green} />
                </View>
                <View style={styles.searchResultCopy}>
                  <Text numberOfLines={2} style={styles.searchResultTitle}>{place.label}</Text>
                  <Text numberOfLines={1} style={styles.searchResultDetail}>{place.detail}</Text>
                </View>
                <Ionicons name="chevron-forward" size={17} color={COLORS.muted} />
              </Pressable>
            ))
          )}
          <Text style={styles.searchAttribution}>
            {Platform.OS === 'web' && GOOGLE_MAPS_WEB_CONFIGURED
              ? 'Place search by Google Maps Platform'
              : 'Search by Photon · Data © OpenStreetMap contributors'}
          </Text>
        </ScrollView>
      </View>
    );
  };

  const renderRideScreen = () => (
    <View style={[styles.rideScreen, wideLayout && styles.rideScreenWide]}>
      <View style={[styles.mapColumn, wideLayout && styles.mapColumnWide]}>
        <View style={styles.header}>
          <View style={styles.brandLockup}>
            <View style={styles.brandMark}>
              <Ionicons name="navigate" size={19} color={COLORS.green} />
            </View>
            <View>
              <Text style={styles.brandName}>sawaari</Text>
              <Text style={styles.brandTagline}>YOUR CITY, YOUR WAY</Text>
            </View>
          </View>
          <View style={styles.headerActions}>
            <View style={styles.cityBadge}>
              <Ionicons name="location-outline" size={14} color={COLORS.green} />
              <Text style={styles.cityBadgeText}>PAKISTAN</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Open profile"
              style={styles.avatarButton}
              onPress={() => router.navigate('/profile')}
            >
              <Ionicons name="person-outline" size={19} color={COLORS.green} />
            </Pressable>
          </View>
        </View>
        {renderMap()}
      </View>
      <View style={[styles.bookingSheet, wideLayout && styles.bookingSheetWide]}>
        <View style={styles.sheetHandle} />
        <ScrollView
          style={[styles.bookingScroll, wideLayout && styles.bookingScrollWide]}
          contentContainerStyle={styles.bookingContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheetHeading}>
            <View>
              <Text style={styles.sheetEyebrow}>LET’S GET YOU THERE</Text>
              <Text style={styles.sheetTitle}>Where to?</Text>
              <Text style={styles.sheetSubtitle}>Your ride, your price.</Text>
            </View>
            <View style={styles.cashBadge}>
              <Ionicons name="cash-outline" size={16} color={COLORS.green} />
              <Text style={styles.cashText}>PKR</Text>
            </View>
          </View>

          <View style={styles.routeCard}>
            <View style={styles.routeRail}>
              <View style={styles.routeCircle} />
              <View style={styles.routeConnector} />
              <View style={styles.routeSquare} />
            </View>
            <View style={styles.routeFields}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search pickup address"
                accessibilityHint="Opens place search for the pickup address."
                onPress={() => beginPlaceSearch('pickup')}
                style={styles.routeField}
              >
                <View style={styles.routeFieldCopy}>
                  <Text style={styles.routeCaption}>PICKUP</Text>
                  <Text numberOfLines={1} style={[styles.routeValue, !pickup && styles.routePlaceholder]}>
                    {pickup ? addressOrCoordinates(pickupAddress, pickup) : 'Search for pickup address'}
                  </Text>
                </View>
                {pickup ? (
                  <Ionicons name="checkmark-circle" size={19} color={COLORS.green} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                )}
              </Pressable>
              <View style={styles.routeDivider} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Search destination address"
                accessibilityHint="Opens place search for the destination address."
                onPress={() => beginPlaceSearch('destination')}
                style={styles.routeField}
              >
                <View style={styles.routeFieldCopy}>
                  <Text style={styles.routeCaption}>DESTINATION</Text>
                  <Text
                    numberOfLines={1}
                    style={[styles.routeValue, !destination && styles.routePlaceholder]}
                  >
                    {destination
                      ? addressOrCoordinates(destinationAddress, destination)
                      : 'Search for destination address'}
                  </Text>
                </View>
                {destination ? (
                  <Ionicons name="checkmark-circle" size={19} color={COLORS.green} />
                ) : (
                  <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
                )}
              </Pressable>
            </View>
          </View>
          {storageError ? <Text style={styles.errorBanner}>{storageError}</Text> : null}
          {addressError ? <Text style={styles.addressNotice}>{addressError}</Text> : null}

          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Choose your ride</Text>
            <Text style={styles.sectionHint}>Swipe to explore</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.vehicleList}
          >
            {VEHICLES.map((item) => {
              const selected = vehicle === item.name;
              return (
                <Pressable
                  key={item.name}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => {
                    setVehicle(item.name);
                    if (Platform.OS === 'web' && routeDistanceKm !== null && !customOffer) {
                      setOffer(String(estimateFare(routeDistanceKm, item.name)));
                    } else {
                      updateSuggestedFare(pickup, destination, item.name);
                    }
                  }}
                  style={[styles.vehicleCard, selected && styles.vehicleCardSelected]}
                >
                  <Ionicons
                    name={item.icon}
                    size={25}
                    color={selected ? COLORS.green : COLORS.muted}
                  />
                  <Text style={[styles.vehicleName, selected && styles.vehicleNameSelected]}>
                    {item.name}
                  </Text>
                  <Text style={styles.vehicleDetail}>{item.detail}</Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <View style={styles.offerRow}>
            <View style={styles.offerLabelWrap}>
              <Text style={styles.sectionTitle}>Your offer</Text>
              <Text style={styles.offerHint}>Set the price you’re happy to pay</Text>
            </View>
            <View style={styles.offerInputWrap}>
              <Text style={styles.currencyMark}>Rs</Text>
              <TextInput
                accessibilityLabel="Your fare offer in Pakistani rupees"
                style={styles.offerInput}
                keyboardType="number-pad"
                value={offer}
                onChangeText={(text) => {
                  setOffer(text.replace(/[^\d]/g, ''));
                  setCustomOffer(true);
                }}
                placeholder="Enter fare"
                placeholderTextColor="#A4ADA7"
                maxLength={7}
                returnKeyType="done"
              />
            </View>
          </View>
          {suggestedFare !== null && fareDistanceKm !== null ? (
            <View style={styles.fareEstimate}>
              <View style={styles.fareEstimateCopy}>
                <Text style={styles.fareEstimateTitle}>
                  Suggested fare: PKR {suggestedFare}
                </Text>
                <Text style={styles.fareEstimateNote}>
                  {Platform.OS === 'web'
                    ? GOOGLE_MAPS_WEB_CONFIGURED ? 'Google road route' : 'OpenStreetMap road route'
                    : 'Direct-distance estimate'} · {fareDistanceKm.toFixed(1)} km · fare estimate only.
                </Text>
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Use suggested fare, ${suggestedFare} Pakistani rupees`}
                onPress={() => {
                  setOffer(String(suggestedFare));
                  setCustomOffer(false);
                }}
                style={styles.useSuggestionButton}
              >
                <Text style={styles.useSuggestionText}>Use</Text>
              </Pressable>
            </View>
          ) : pickup && destination && Platform.OS === 'web' ? (
            <Text style={styles.fareEstimateNote}>
              {routeError || 'Calculating Google Maps road route...'}
            </Text>
          ) : (
            <Text style={styles.fareEstimateNote}>
              Choose pickup and destination to see a distance and fare suggestion.
            </Text>
          )}

          <Pressable
            accessibilityRole="button"
            style={({ pressed }) => [styles.requestButton, pressed && styles.requestButtonPressed]}
            onPress={createRide}
          >
            <Text style={styles.requestButtonText}>Review ride request</Text>
            <Ionicons name="arrow-forward" size={19} color={COLORS.green} />
          </Pressable>
        </ScrollView>
      </View>
      {renderPlaceSearch()}
    </View>
  );

  const renderTripsScreen = () => (
    <View style={styles.secondaryScreen}>
      <View style={styles.secondaryHeader}>
        <Text style={styles.secondaryTitle}>Your trips</Text>
        <Text style={styles.secondarySubtitle}>Ride requests and nearby driver matches</Text>
      </View>
      {storageError ? <Text style={styles.errorBanner}>{storageError}</Text> : null}
      {matchingError ? <Text style={styles.errorBanner}>{matchingError}</Text> : null}
      {loadingRides ? (
        <ActivityIndicator color={COLORS.green} style={styles.loadingIndicator} />
      ) : rides.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="car-outline" size={28} color={COLORS.green} />
          </View>
          <Text style={styles.emptyTitle}>No trips yet</Text>
          <Text style={styles.emptyCopy}>Your ride requests will appear here after you create one.</Text>
          <Pressable style={styles.secondaryButton} onPress={() => router.navigate('/')}>
            <Text style={styles.secondaryButtonText}>Plan a ride</Text>
            <Ionicons name="arrow-forward" size={16} color={COLORS.green} />
          </Pressable>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.tripList}>
          <View style={styles.localNotice}>
            <Ionicons name="information-circle-outline" size={17} color={COLORS.green} />
            <Text style={styles.localNoticeText}>
              {rides.some((ride) => ride.cloud)
                ? 'Searching for real online drivers near your pickup. Matches refresh every 10 seconds.'
                : 'These are local drafts. Sign in and configure Supabase to search for real nearby drivers.'}
            </Text>
          </View>
          {rides.map((ride) => (
            <View key={ride.id} style={styles.tripCard}>
              <View style={styles.tripCardHeader}>
                <View style={styles.tripVehicle}>
                  <Ionicons
                    name={VEHICLES.find((item) => item.name === ride.vehicle)?.icon ?? 'car-outline'}
                    size={19}
                    color={COLORS.green}
                  />
                </View>
                <View style={styles.tripSummary}>
                  <Text style={styles.tripVehicleName}>{ride.vehicle} · PKR {ride.offer}</Text>
                  <Text style={styles.tripTime}>{formatTime(ride.createdAt)}</Text>
                </View>
                <View style={[styles.draftBadge, ride.cloud && styles.liveBadge]}>
                  <Text style={[styles.draftText, ride.cloud && styles.liveBadgeText]}>
                    {!ride.cloud
                      ? 'LOCAL'
                      : rideStatuses[ride.id]?.status === 'accepted'
                        ? 'MATCHED'
                        : rideStatuses[ride.id]?.status === 'completed'
                          ? 'COMPLETED'
                          : rideStatuses[ride.id]?.status === 'cancelled'
                            ? 'CANCELLED'
                            : 'SEARCHING'}
                  </Text>
                </View>
              </View>
              <View style={styles.tripRoute}>
                <View style={styles.tripDots}>
                  <View style={styles.routeCircleSmall} />
                  <View style={styles.tripConnector} />
                  <View style={styles.routeSquareSmall} />
                </View>
                <View style={styles.tripAddresses}>
                  <Text numberOfLines={1} style={styles.tripAddress}>
                    {addressOrCoordinates(ride.pickupAddress, ride.pickup)}
                  </Text>
                  <View style={styles.tripAddressDivider} />
                  <Text numberOfLines={1} style={styles.tripAddress}>
                    {addressOrCoordinates(ride.destinationAddress, ride.destination)}
                  </Text>
                </View>
              </View>
              {ride.cloud && rideStatuses[ride.id]?.status === 'accepted' ? (
                <View style={styles.matchNotice}>
                  <Ionicons name="checkmark-circle" size={18} color={COLORS.green} />
                  <Text style={styles.matchText}>
                    Accepted by {rideStatuses[ride.id].driver_name || 'a nearby driver'}
                    {rideStatuses[ride.id].driver_vehicle
                      ? ` · ${rideStatuses[ride.id].driver_vehicle}`
                      : ''}
                  </Text>
                </View>
              ) : ride.cloud && rideStatuses[ride.id]?.status === 'completed' ? (
                <Text style={styles.matchText}>This ride has been marked complete.</Text>
              ) : ride.cloud && rideStatuses[ride.id]?.status === 'cancelled' ? (
                <Text style={styles.noDrivers}>This request was cancelled.</Text>
              ) : ride.cloud ? (
                (nearbyDrivers[ride.id] ?? []).length > 0 ? (
                  <View style={styles.nearbyDrivers}>
                    <Text style={styles.nearbyHeading}>
                      {nearbyDrivers[ride.id].length} online driver
                      {nearbyDrivers[ride.id].length === 1 ? '' : 's'} nearby
                    </Text>
                    {nearbyDrivers[ride.id].slice(0, 3).map((driver) => (
                      <View key={driver.driver_id} style={styles.nearbyDriver}>
                        <View style={styles.nearbyAvatar}>
                          <Ionicons name="person" size={15} color={COLORS.green} />
                        </View>
                        <Text numberOfLines={1} style={styles.nearbyDriverName}>
                          {driver.driver_name || 'Sawaari driver'} · {driver.vehicle}
                        </Text>
                        <Text style={styles.nearbyDistance}>
                          {(driver.distance_m / 1000).toFixed(1)} km
                        </Text>
                      </View>
                    ))}
                    <Text style={styles.nearbyHint}>
                      Driver acceptance is still pending. Matching updates automatically.
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => cancelRide(ride)}
                      style={styles.cancelRideButton}
                    >
                      <Text style={styles.cancelRideText}>Cancel request</Text>
                    </Pressable>
                  </View>
                ) : (
                  <View>
                    <Text style={styles.noDrivers}>No online drivers found nearby yet. We are still searching.</Text>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => cancelRide(ride)}
                      style={styles.cancelRideButton}
                    >
                      <Text style={styles.cancelRideText}>Cancel request</Text>
                    </Pressable>
                  </View>
                )
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );

  const renderProfileScreen = () => (
    <View style={styles.secondaryScreen}>
      <View style={styles.secondaryHeader}>
        <Text style={styles.secondaryTitle}>Your account</Text>
        <Text style={styles.secondarySubtitle}>Sign in to request rides or drive</Text>
      </View>
      {configured ? <AccountPanel /> : (
        <View style={styles.localNotice}>
          <Ionicons name="cloud-offline-outline" size={17} color={COLORS.green} />
          <Text style={styles.localNoticeText}>
            Supabase is not configured. Local ride planning works, but real accounts and driver matching need your Supabase project settings.
          </Text>
        </View>
      )}
      <View style={styles.profileCard}>
        <View style={styles.profileAvatar}>
          <Ionicons name="person" size={25} color={COLORS.green} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileName}>Welcome to Sawaari</Text>
          <Text style={styles.profileSubtext}>
            {session?.user.email ?? 'Create one account for rider and driver mode.'}
          </Text>
        </View>
      </View>
      <View style={styles.profileMenu}>
        <View style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Ionicons name="language-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Language</Text>
            <Text style={styles.menuSubtitle}>English</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </View>
        <View style={styles.menuDivider} />
        <View style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Ionicons name="shield-checkmark-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Safety centre</Text>
            <Text style={styles.menuSubtitle}>Safety features are not configured yet</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </View>
        <View style={styles.menuDivider} />
        <View style={styles.menuItem}>
          <View style={styles.menuIcon}>
            <Ionicons name="help-buoy-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Help & support</Text>
            <Text style={styles.menuSubtitle}>Support service is not connected yet</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </View>
      </View>
      <View style={styles.profileFootnote}>
        <Ionicons name="information-circle-outline" size={18} color={COLORS.orange} />
        <Text style={styles.profileFootnoteText}>
          Live driver search only works after Supabase is configured and an account is signed in. Safety, identity checks and payments are not connected.
        </Text>
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="dark" />
      <View style={styles.app}>
        {screen === 'Ride' && renderRideScreen()}
        {screen === 'Trips' && renderTripsScreen()}
        {screen === 'Profile' && renderProfileScreen()}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: COLORS.paper },
  app: { flex: 1, backgroundColor: COLORS.paper },
  rideScreen: { flex: 1, minHeight: 0 },
  rideScreenWide: {
    width: '100%',
    maxWidth: 1440,
    alignSelf: 'center',
    padding: 22,
    flexDirection: 'row-reverse',
    gap: 22,
  },
  mapColumn: { flex: 1, minHeight: 0 },
  mapColumnWide: { flex: 1, flexBasis: 0, minWidth: 0 },
  header: {
    height: 68,
    paddingHorizontal: 22,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cityBadge: {
    height: 35,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: '#E8EFE4',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cityBadgeText: { color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: {
    width: 41,
    height: 41,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.lime,
    transform: [{ rotate: '-8deg' }],
  },
  brandName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.9, color: COLORS.ink },
  brandTagline: { marginTop: 1, fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: COLORS.muted },
  avatarButton: {
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: COLORS.white,
    borderWidth: 1,
    borderColor: COLORS.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapFrame: {
    flex: 1,
    minHeight: 220,
    marginHorizontal: 12,
    marginBottom: 12,
    overflow: 'hidden',
    borderRadius: 25,
    backgroundColor: '#DEE7DF',
    borderWidth: 1,
    borderColor: '#DFE5DC',
  },
  mapFrameWide: {
    marginHorizontal: 0,
    marginBottom: 0,
    borderRadius: 29,
  },
  mapLabel: {
    position: 'absolute',
    top: 13,
    left: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    elevation: 3,
    shadowColor: '#1C2A21',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  mapLabelText: { fontSize: 9, fontWeight: '800', letterSpacing: 1, color: COLORS.ink },
  myLocationButton: {
    position: 'absolute',
    bottom: 14,
    right: 13,
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: COLORS.white,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 3,
    shadowColor: '#1C2A21',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  searchOverlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 2000,
    elevation: 20,
    paddingHorizontal: 18,
    paddingTop: 10,
    backgroundColor: COLORS.white,
  },
  searchHeader: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
    marginBottom: 15,
  },
  searchBackButton: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.paper,
  },
  searchTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  searchSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 11 },
  searchInputWrap: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#DDE4D9',
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAF6',
  },
  searchInput: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 12,
    color: COLORS.ink,
    fontSize: 14,
  },
  searchScopeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 11,
    marginBottom: 4,
  },
  searchScopeButton: {
    minHeight: 34,
    paddingHorizontal: 13,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.paper,
  },
  searchScopeButtonSelected: { backgroundColor: COLORS.green },
  searchScopeText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  searchScopeTextSelected: { color: COLORS.white },
  searchResults: { flex: 1, marginTop: 8 },
  searchLoading: { marginTop: 28 },
  searchMessage: {
    paddingHorizontal: 6,
    paddingVertical: 20,
    color: COLORS.muted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'center',
  },
  searchResult: {
    minHeight: 70,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  searchResultIcon: {
    width: 38,
    height: 38,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF4EA',
  },
  searchResultCopy: { flex: 1 },
  searchResultTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '700', lineHeight: 17 },
  searchResultDetail: { marginTop: 4, color: COLORS.muted, fontSize: 10 },
  searchAttribution: {
    paddingVertical: 14,
    color: COLORS.muted,
    fontSize: 9,
    textAlign: 'center',
  },
  mapZoomPill: {
    position: 'absolute',
    left: 13,
    bottom: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 13,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: COLORS.white,
  },
  mapZoomText: { color: COLORS.green, fontSize: 10, fontWeight: '700' },
  bookingSheet: {
    flexGrow: 0,
    flexShrink: 1,
    maxHeight: '64%',
    marginHorizontal: 10,
    paddingHorizontal: 20,
    paddingTop: 11,
    paddingBottom: 14,
    borderTopLeftRadius: 25,
    borderTopRightRadius: 25,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
    elevation: 8,
    shadowColor: '#193328',
    shadowOpacity: 0.09,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: -6 },
  },
  bookingSheetWide: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 410,
    width: 410,
    maxHeight: '100%',
    marginHorizontal: 0,
    borderRadius: 25,
    paddingHorizontal: 22,
    paddingTop: 18,
    paddingBottom: 18,
  },
  bookingScroll: { flexGrow: 0, flexShrink: 1 },
  bookingScrollWide: { flex: 1, flexGrow: 1, minHeight: 0 },
  bookingContent: { paddingBottom: 10 },
  sheetHandle: {
    width: 39,
    height: 4,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 15,
    backgroundColor: '#D8DED6',
  },
  sheetHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  sheetEyebrow: { marginBottom: 5, color: '#789080', fontSize: 9, fontWeight: '800', letterSpacing: 1.4 },
  sheetTitle: { color: COLORS.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.9 },
  sheetSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 12, fontWeight: '500' },
  cashBadge: {
    borderWidth: 1,
    borderColor: '#DDE4D9',
    borderRadius: 13,
    backgroundColor: COLORS.white,
    paddingHorizontal: 12,
    paddingVertical: 9,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cashText: { color: COLORS.green, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  routeCard: {
    flexDirection: 'row',
    minHeight: 104,
    backgroundColor: COLORS.white,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 13,
    paddingVertical: 8,
  },
  routeRail: { width: 22, alignItems: 'center', paddingTop: 18, paddingBottom: 16 },
  routeCircle: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.green,
  },
  routeConnector: { width: 1, flex: 1, minHeight: 16, borderStyle: 'dashed', borderWidth: 0.7, borderColor: '#A8B4AA' },
  routeSquare: { width: 8, height: 8, borderRadius: 2, backgroundColor: COLORS.orange },
  routeFields: { flex: 1 },
  routeField: {
    flex: 1,
    minHeight: 43,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 9,
  },
  routeFieldCopy: { flex: 1, paddingRight: 8 },
  routeCaption: { fontSize: 9, fontWeight: '800', letterSpacing: 1.1, color: COLORS.muted },
  routeValue: { marginTop: 4, fontSize: 12, fontWeight: '600', color: COLORS.ink },
  routePlaceholder: { fontWeight: '500', color: '#89948D' },
  routeDivider: { height: 1, marginLeft: 9, backgroundColor: COLORS.line },
  sectionHeader: { marginTop: 17, marginBottom: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  sectionHint: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  vehicleList: { gap: 9, paddingRight: 8 },
  vehicleCard: {
    width: 82,
    height: 83,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  vehicleCardSelected: { borderWidth: 1.5, borderColor: COLORS.green, backgroundColor: '#EDF4E8' },
  vehicleName: { marginTop: 5, color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  vehicleNameSelected: { color: COLORS.green },
  vehicleDetail: { marginTop: 2, color: COLORS.muted, fontSize: 9, fontWeight: '500' },
  offerRow: {
    width: '100%',
    marginTop: 16,
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  offerLabelWrap: { flex: 1, minWidth: 0, paddingRight: 2 },
  offerHint: { marginTop: 4, color: COLORS.muted, fontSize: 10, fontWeight: '500' },
  offerInputWrap: {
    width: 145,
    maxWidth: '52%',
    minWidth: 118,
    flexShrink: 0,
    height: 47,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#DDE4D9',
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    backgroundColor: COLORS.white,
  },
  currencyMark: { flexShrink: 0, color: COLORS.green, fontSize: 12, fontWeight: '800' },
  offerInput: {
    flex: 1,
    minWidth: 0,
    width: 0,
    padding: 0,
    textAlign: 'right',
    color: COLORS.ink,
    fontSize: 15,
    fontWeight: '800',
  },
  fareEstimate: {
    minHeight: 44,
    marginTop: -4,
    marginBottom: 9,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 12,
    backgroundColor: '#F1F6EA',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  fareEstimateCopy: { flex: 1 },
  fareEstimateTitle: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  fareEstimateNote: { marginTop: 3, marginBottom: 8, color: COLORS.muted, fontSize: 9, lineHeight: 13 },
  useSuggestionButton: {
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: 9,
    backgroundColor: COLORS.white,
  },
  useSuggestionText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  requestButton: {
    height: 54,
    borderRadius: 16,
    paddingHorizontal: 18,
    backgroundColor: COLORS.lime,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  requestButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  requestButtonText: { color: COLORS.green, fontSize: 14, fontWeight: '800' },
  secondaryScreen: { flex: 1, paddingHorizontal: 20, paddingTop: 16, backgroundColor: COLORS.paper },
  secondaryHeader: { marginBottom: 20 },
  secondaryTitle: { color: COLORS.ink, fontSize: 27, fontWeight: '800', letterSpacing: -0.8 },
  secondarySubtitle: { marginTop: 4, color: COLORS.muted, fontSize: 12 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 65 },
  emptyIcon: { width: 68, height: 68, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E9F1DF' },
  emptyTitle: { marginTop: 17, color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  emptyCopy: { marginTop: 7, color: COLORS.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  secondaryButton: { marginTop: 19, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 13, backgroundColor: COLORS.lime, flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryButtonText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  loadingIndicator: { marginTop: 36 },
  tripList: { gap: 11, paddingBottom: 22 },
  localNotice: { padding: 12, borderRadius: 12, backgroundColor: '#E9F1DF', flexDirection: 'row', alignItems: 'center', gap: 8 },
  localNoticeText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '600' },
  tripCard: { padding: 14, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  tripCardHeader: { flexDirection: 'row', alignItems: 'center' },
  tripVehicle: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF4EA' },
  tripSummary: { flex: 1, marginLeft: 10 },
  tripVehicleName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  tripTime: { marginTop: 3, color: COLORS.muted, fontSize: 9 },
  draftBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#FFF2E5' },
  draftText: { color: '#A96021', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  liveBadge: { backgroundColor: '#E7F3E2' },
  liveBadgeText: { color: COLORS.green },
  tripRoute: { marginTop: 13, flexDirection: 'row' },
  tripDots: { width: 18, alignItems: 'center', paddingTop: 3, paddingBottom: 4 },
  routeCircleSmall: { width: 8, height: 8, borderRadius: 5, borderWidth: 2, borderColor: COLORS.green },
  tripConnector: { width: 1, flex: 1, minHeight: 20, marginVertical: 3, borderWidth: 0.7, borderStyle: 'dashed', borderColor: '#A8B4AA' },
  routeSquareSmall: { width: 7, height: 7, borderRadius: 2, backgroundColor: COLORS.orange },
  tripAddresses: { flex: 1, marginLeft: 7 },
  tripAddress: { minHeight: 23, color: COLORS.ink, fontSize: 10, fontWeight: '600' },
  tripAddressDivider: { height: 1, marginBottom: 8, backgroundColor: COLORS.line },
  matchNotice: {
    marginTop: 12,
    padding: 11,
    borderRadius: 11,
    backgroundColor: '#E7F3E2',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  matchText: { flex: 1, color: COLORS.green, fontSize: 11, fontWeight: '700' },
  nearbyDrivers: { marginTop: 12, padding: 11, borderRadius: 11, backgroundColor: '#F6F8F2', gap: 8 },
  nearbyHeading: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  nearbyDriver: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  nearbyAvatar: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E7F3E2' },
  nearbyDriverName: { flex: 1, color: COLORS.ink, fontSize: 10, fontWeight: '700' },
  nearbyDistance: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  nearbyHint: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  cancelRideButton: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#FBE9E8' },
  cancelRideText: { color: COLORS.red, fontSize: 10, fontWeight: '700' },
  noDrivers: { marginTop: 11, padding: 10, borderRadius: 10, color: COLORS.muted, backgroundColor: '#F6F8F2', fontSize: 10, lineHeight: 15 },
  errorBanner: { padding: 11, borderRadius: 11, backgroundColor: '#FBE9E8', color: COLORS.red, fontSize: 11 },
  addressNotice: { marginTop: 6, color: '#A96021', fontSize: 9, lineHeight: 13 },
  profileCard: { padding: 15, borderRadius: 17, backgroundColor: COLORS.green, flexDirection: 'row', alignItems: 'center' },
  profileAvatar: { width: 47, height: 47, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.lime },
  profileCopy: { flex: 1, marginLeft: 12 },
  profileName: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
  profileSubtext: { marginTop: 4, color: '#D2E2D9', fontSize: 10, lineHeight: 15 },
  profileMenu: { marginTop: 15, paddingHorizontal: 13, borderRadius: 16, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  menuItem: { minHeight: 62, flexDirection: 'row', alignItems: 'center' },
  menuIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EFF4EA' },
  menuCopy: { flex: 1, marginLeft: 10 },
  menuTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  menuSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 9 },
  menuDivider: { height: 1, marginLeft: 45, backgroundColor: COLORS.line },
  profileFootnote: { marginTop: 15, padding: 13, borderRadius: 13, backgroundColor: '#FFF4E8', flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  profileFootnoteText: { flex: 1, color: '#775333', fontSize: 10, lineHeight: 15 },
});
