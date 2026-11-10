import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import type { LocationGeocodedAddress } from 'expo-location';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Pressable,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
} from 'react-native';
import { Text, TextInput } from './AppText';
import RideMap from './RideMap';
import type { MapPoint, NearbyMapDriver } from './ride-map.types';
import { loadGoogleMaps } from './google-maps';
import { useInAppNotice } from './InAppNoticeProvider';
import AccountPanel from './AccountPanel';
import { useAuth } from '../lib/AuthContext';
import { apiRequest } from '../lib/api';
import VehicleArt from './VehicleArt';

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
type NearbyDriver = NearbyMapDriver & {
  driver_id: string;
  driver_name: string;
  vehicle: Vehicle;
  distance_m: number;
  updated_at: string;
};
type RideServerStatus = {
  status: string;
  rider_report_status?: 'open' | 'reviewing' | 'resolved' | 'dismissed' | null;
  agreed_fare: number | null;
  driver_name: string;
  driver_vehicle: string;
  driver_vehicle_make?: string;
  driver_vehicle_model?: string;
  driver_vehicle_year?: number | null;
  driver_vehicle_color?: string;
  driver_vehicle_registration_number?: string;
  driver_photo_url?: string | null;
  driver_rating?: number | null;
  driver_rating_count?: number;
  driver_completed_rides?: number;
  rider_rating?: number | null;
  driver_location_updated_at: string | null;
  driver_location: Coordinate | null;
  driver_offer_status: 'pending' | 'rejected' | 'accepted' | null;
  offer_driver_name: string;
  offer_driver_vehicle: string;
  driver_offer_fare: number | null;
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
const VEHICLES: { name: Vehicle; detail: string }[] = [
  { name: 'Bike', detail: '1 seat' },
  { name: 'Rickshaw', detail: '3 seats' },
  { name: 'Car', detail: '4 seats' },
  { name: 'Premium', detail: 'Comfort' },
];
const FARE_RATES: Record<Vehicle, { base: number; perKm: number }> = {
  Bike: { base: 50, perKm: 30 },
  Rickshaw: { base: 80, perKm: 45 },
  Car: { base: 120, perKm: 55 },
  Premium: { base: 200, perKm: 80 },
};
const COLORS = {
  ink: '#12273A',
  muted: '#63798A',
  green: '#0B786F',
  lime: '#D9F5EA',
  paper: '#F1F6F5',
  line: '#DCE8E5',
  white: '#FFFFFF',
  orange: '#E79A54',
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
  const { notify, confirm } = useInAppNotice();
  const { configured, session } = useAuth();
  const { width } = useWindowDimensions();
  const wideLayout = Platform.OS === 'web' && width >= 980;
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [pickup, setPickup] = useState<Coordinate | null>(null);
  const [destination, setDestination] = useState<Coordinate | null>(null);
  const [pickupAddress, setPickupAddress] = useState('');
  const [destinationAddress, setDestinationAddress] = useState('');
  const [searchField, setSearchField] = useState<RouteField | null>(null);
  const [mapPickField, setMapPickField] = useState<RouteField | null>(null);
  const [mapPickAddress, setMapPickAddress] = useState('');
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
  const [activeRideId, setActiveRideId] = useState<string | null>(null);
  const [updatingRideOffer, setUpdatingRideOffer] = useState(false);
  const [respondingToOffer, setRespondingToOffer] = useState(false);
  const [submittingRating, setSubmittingRating] = useState<string | null>(null);
  const [reportingRideId, setReportingRideId] = useState<string | null>(null);
  const [reportCategory, setReportCategory] = useState<'safety' | 'behavior' | 'vehicle' | 'fare' | 'other'>('safety');
  const [reportDetails, setReportDetails] = useState('');
  const [submittingReport, setSubmittingReport] = useState<string | null>(null);
  const [reportError, setReportError] = useState('');
  const [locationGranted, setLocationGranted] = useState(false);
  const [loadingLocation, setLoadingLocation] = useState(false);
  const [locationPromptVisible, setLocationPromptVisible] = useState(false);
  const [locationCanAskAgain, setLocationCanAskAgain] = useState(true);
  const [loadingRides, setLoadingRides] = useState(true);
  const [storageError, setStorageError] = useState('');
  const [addressError, setAddressError] = useState('');
  const [routeDistanceKm, setRouteDistanceKm] = useState<number | null>(null);
  const [routeError, setRouteError] = useState('');
  const [nearbyDrivers, setNearbyDrivers] = useState<Record<string, NearbyDriver[]>>({});
  const [rideStatuses, setRideStatuses] = useState<Record<string, RideServerStatus>>({});
  const [tripMapRegions, setTripMapRegions] = useState<Record<string, MapViewport>>({});
  const [matchingError, setMatchingError] = useState('');
  const showMessage = useCallback((title: string, message: string) => {
    notify({ title, message });
  }, [notify]);
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
    if ((screen !== 'Ride' && screen !== 'Trips') || !configured || !session) return undefined;
    let active = true;
    const refreshMatches = async () => {
      const cloudRides = rides.filter((ride) => ride.cloud
        && (screen === 'Trips' || activeRideId === null || ride.id === activeRideId));
      if (cloudRides.length === 0) return;
      const driverResults: Record<string, NearbyDriver[]> = {};
      const statusResults: Record<string, RideServerStatus> = {};
      const errors: string[] = [];

      await Promise.all(cloudRides.map(async (ride) => {
        try {
          const result = await apiRequest<{
            drivers: unknown[];
            status: unknown;
          }>(`/rides/${encodeURIComponent(ride.id)}/matches`);
          if (Array.isArray(result.drivers)) {
            driverResults[ride.id] = result.drivers.filter((candidate: unknown): candidate is NearbyDriver => {
              if (typeof candidate !== 'object' || candidate === null) return false;
              const driver = candidate as Record<string, unknown>;
              return typeof driver.driver_id === 'string'
                && typeof driver.driver_name === 'string'
                && VEHICLES.some((item) => item === driver.vehicle)
                && typeof driver.latitude === 'number'
                && Number.isFinite(driver.latitude)
                && typeof driver.longitude === 'number'
                && Number.isFinite(driver.longitude)
                && typeof driver.distance_m === 'number'
                && Number.isFinite(driver.distance_m)
                && typeof driver.updated_at === 'string';
            });
          }
          if (typeof result.status === 'object' && result.status !== null) {
            const status = result.status as Record<string, unknown>;
            if (typeof status.status === 'string'
              && typeof status.driver_name === 'string'
              && typeof status.driver_vehicle === 'string'
              && typeof status.offer_driver_name === 'string'
              && typeof status.offer_driver_vehicle === 'string') {
              const locationCandidate = {
                latitude: status.driver_latitude,
                longitude: status.driver_longitude,
              };
              const location = isCoordinate(locationCandidate) ? locationCandidate : null;
              const offerStatus = status.driver_offer_status === 'pending'
                || status.driver_offer_status === 'rejected'
                || status.driver_offer_status === 'accepted'
                ? status.driver_offer_status
                : null;
              statusResults[ride.id] = {
                status: status.status,
                rider_report_status: status.rider_report_status === 'open'
                  || status.rider_report_status === 'reviewing'
                  || status.rider_report_status === 'resolved'
                  || status.rider_report_status === 'dismissed'
                  ? status.rider_report_status
                  : null,
                agreed_fare: typeof status.agreed_fare === 'number' && Number.isFinite(status.agreed_fare)
                  ? status.agreed_fare
                  : null,
                driver_name: status.driver_name,
                driver_vehicle: status.driver_vehicle,
                driver_vehicle_make: typeof status.driver_vehicle_make === 'string'
                  ? status.driver_vehicle_make
                  : '',
                driver_vehicle_model: typeof status.driver_vehicle_model === 'string'
                  ? status.driver_vehicle_model
                  : '',
                driver_vehicle_year: typeof status.driver_vehicle_year === 'number'
                  ? status.driver_vehicle_year
                  : null,
                driver_vehicle_color: typeof status.driver_vehicle_color === 'string'
                  ? status.driver_vehicle_color
                  : '',
                driver_vehicle_registration_number:
                  typeof status.driver_vehicle_registration_number === 'string'
                    ? status.driver_vehicle_registration_number
                    : '',
                driver_photo_url: typeof status.driver_photo_url === 'string'
                  ? status.driver_photo_url
                  : null,
                driver_rating: typeof status.driver_rating === 'number'
                  ? status.driver_rating
                  : null,
                driver_rating_count: typeof status.driver_rating_count === 'number'
                  ? status.driver_rating_count
                  : 0,
                driver_completed_rides: typeof status.driver_completed_rides === 'number'
                  ? status.driver_completed_rides
                  : 0,
                rider_rating: typeof status.rider_rating === 'number'
                  ? status.rider_rating
                  : null,
                driver_location_updated_at: typeof status.driver_location_updated_at === 'string'
                  ? status.driver_location_updated_at
                  : null,
                driver_location: location,
                driver_offer_status: offerStatus,
                offer_driver_name: status.offer_driver_name,
                offer_driver_vehicle: status.offer_driver_vehicle,
                driver_offer_fare: typeof status.driver_offer_fare === 'number'
                  && Number.isFinite(status.driver_offer_fare)
                  ? status.driver_offer_fare
                  : null,
              };
            }
          }
        } catch (error: unknown) {
          errors.push(error instanceof Error ? error.message : 'Could not refresh ride status.');
        }
      }));

      if (!active) return;
      setNearbyDrivers(driverResults);
      setRideStatuses(statusResults);
      setMatchingError(errors[0] ?? '');
      if (screen === 'Ride' && activeRideId === null) {
        const resumableRide = rides.find((ride) => ride.cloud
          && ['searching', 'accepted'].includes(statusResults[ride.id]?.status ?? ''));
        if (resumableRide) {
          setActiveRideId(resumableRide.id);
          setOffer(String(resumableRide.offer));
          setRegion({
            latitude: (resumableRide.pickup.latitude + resumableRide.destination.latitude) / 2,
            longitude: (resumableRide.pickup.longitude + resumableRide.destination.longitude) / 2,
            latitudeDelta: Math.max(
              0.02,
              Math.abs(resumableRide.pickup.latitude - resumableRide.destination.latitude) * 1.8,
            ),
            longitudeDelta: Math.max(
              0.02,
              Math.abs(resumableRide.pickup.longitude - resumableRide.destination.longitude) * 1.8,
            ),
          });
        }
      }
    };

    void refreshMatches();
    const timer = setInterval(() => void refreshMatches(), 10000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [activeRideId, configured, rides, screen, session]);

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

  const updateSuggestedFare = useCallback((
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
  }, [customOffer]);

  const focusMap = useCallback((point: Coordinate) => {
    const nextRegion = { ...point, latitudeDelta: 0.025, longitudeDelta: 0.025 };
    setRegion(nextRegion);
  }, []);

  const lookupAddress = useCallback(async (field: RouteField, point: Coordinate) => {
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
  }, []);

  const locateCurrentPosition = useCallback(async (requestPermission = true) => {
    setLoadingLocation(true);
    try {
      const permission = requestPermission
        ? await Location.requestForegroundPermissionsAsync()
        : await Location.getForegroundPermissionsAsync();
      setLocationCanAskAgain(permission.canAskAgain);
      if (!permission.granted) {
        setLocationGranted(false);
        setLocationPromptVisible(true);
        if (requestPermission) {
          showMessage(
            'Location permission needed',
            'Allow location access in your browser or device settings to use your current position as pickup, or search for a pickup address.',
          );
        }
        return;
      }

      setLocationGranted(true);
      setLocationPromptVisible(false);
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
    } catch (error: unknown) {
      showMessage(
        'Could not get your location',
        error instanceof Error
          ? `${error.message} Check that location services are enabled, or search for a pickup address.`
          : 'Check that location services are enabled, or search for a pickup address.',
      );
    } finally {
      setLoadingLocation(false);
    }
  }, [destination, focusMap, lookupAddress, showMessage, updateSuggestedFare, vehicle]);

  useEffect(() => {
    if (screen !== 'Ride') return undefined;
    let active = true;
    void Location.getForegroundPermissionsAsync()
      .then(async (permission) => {
        if (!active) return;
        setLocationCanAskAgain(permission.canAskAgain);
        if (permission.granted) {
          await locateCurrentPosition(false);
        } else {
          setLocationPromptVisible(true);
        }
      })
      .catch(() => {
        if (active) setLocationPromptVisible(true);
      });
    return () => {
      active = false;
    };
  }, [screen, locateCurrentPosition]);

  const beginPlaceSearch = (field: RouteField) => {
    Keyboard.dismiss();
    setMapPickField(null);
    setSearchField(field);
    setSearchQuery(field === 'pickup' ? pickupAddress : destinationAddress);
    setSearchResults([]);
    setSearchingPlaces(false);
    setSearchError('');
    placeSearchSession.current = null;
  };

  const beginMapPick = () => {
    if (!searchField) return;
    Keyboard.dismiss();
    setMapPickField(searchField);
    setMapPickAddress(searchQuery.trim());
    setSearchField(null);
    setSearchQuery('');
    setSearchResults([]);
    setSearchingPlaces(false);
    setSearchError('');
  };

  const confirmMapPick = () => {
    if (!mapPickField) return;
    const field = mapPickField;
    const point = { latitude: region.latitude, longitude: region.longitude };
    const address = mapPickAddress.trim();
    const nextPickup = field === 'pickup' ? point : pickup;
    const nextDestination = field === 'destination' ? point : destination;

    if (field === 'pickup') {
      setPickup(point);
      setPickupAddress(address || 'Finding address...');
    } else {
      setDestination(point);
      setDestinationAddress(address || 'Finding address...');
    }

    setRouteDistanceKm(null);
    setRouteError('');
    setAddressError('');
    updateSuggestedFare(nextPickup, nextDestination, vehicle);
    setMapPickField(null);
    setMapPickAddress('');
    if (!address) void lookupAddress(field, point);
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
          if (!session) {
            showMessage(
              'Sign in to find drivers',
              'Open Profile and create or sign in to your account before sending this request to nearby drivers.',
            );
            router.navigate('/profile');
            return;
          }
          const result = await apiRequest<{ request_id: string }>('/rides', {
            method: 'POST',
            body: JSON.stringify({
              pickup_address: ride.pickupAddress,
              destination_address: ride.destinationAddress,
              pickup_latitude: ride.pickup.latitude,
              pickup_longitude: ride.pickup.longitude,
              destination_latitude: ride.destination.latitude,
              destination_longitude: ride.destination.longitude,
              vehicle: ride.vehicle,
              offered_fare: ride.offer,
            }),
          });
          if (typeof result.request_id !== 'string') {
            throw new Error('The server did not confirm the ride request.');
          }
          savedRide = { ...ride, id: result.request_id, cloud: true };
        }
        const nextRides = [savedRide, ...rides];
        setRides(nextRides);
        setActiveRideId(savedRide.id);
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
          if (!savedRide.cloud) {
            showMessage(
              'Draft not saved permanently',
              'Your draft is visible on this device for this session, but local storage could not save it.',
            );
          }
          return;
        }
        if (!savedRide.cloud) {
          showMessage(
            'Local draft saved',
            'This request is saved on this device only. Sign in to send a request to nearby drivers.',
          );
        }
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Please try again.';
        setStorageError(detail);
        showMessage('Could not send your request', detail);
      }
    };
    const confirmed = await confirm({
      title: 'Review your ride request',
      message: `${vehicle} · PKR ${parsedOffer}\n\nPickup: ${ride.pickupAddress}\n\nDestination: ${ride.destinationAddress}`,
      cancelLabel: 'Change details',
      confirmLabel: configured ? 'Send ride request' : 'Save local draft',
    });
    if (confirmed) await saveRequest();
  };

  const updateRideOffer = async (ride: Ride) => {
    const updatedOffer = Number(offer.replace(/,/g, ''));
    if (!Number.isInteger(updatedOffer) || updatedOffer < 1 || updatedOffer > 1000000) {
      showMessage('Enter a valid fare', 'Offer an amount between PKR 1 and PKR 1,000,000.');
      return;
    }
    if (!ride.cloud) {
      setRides((current) => current.map((item) => item.id === ride.id
        ? { ...item, offer: updatedOffer }
        : item));
      const nextRides = rides.map((item) => item.id === ride.id
        ? { ...item, offer: updatedOffer }
        : item);
      try {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(nextRides));
        setStorageError('');
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Device storage is unavailable.';
        setStorageError(`Your fare was updated for this session, but could not be saved on this device: ${detail}`);
      }
      return;
    }

    setUpdatingRideOffer(true);
    setMatchingError('');
    try {
      await apiRequest(`/rides/${encodeURIComponent(ride.id)}/offer`, {
        method: 'POST',
        body: JSON.stringify({ offered_fare: updatedOffer }),
      });
      setRides((current) => current.map((item) => item.id === ride.id
        ? { ...item, offer: updatedOffer }
        : item));
      try {
        await AsyncStorage.setItem(
          STORAGE_KEY,
          JSON.stringify(rides.map((item) => item.id === ride.id
            ? { ...item, offer: updatedOffer }
            : item)),
        );
        setStorageError('');
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Device storage is unavailable.';
        setStorageError(`Your fare was updated with nearby drivers, but could not be saved on this device: ${detail}`);
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      setMatchingError(detail);
      showMessage('Could not update fare', detail);
    } finally {
      setUpdatingRideOffer(false);
    }
  };

  const respondToDriverOffer = async (ride: Ride, action: 'accept' | 'reject') => {
    const offeredFare = rideStatuses[ride.id]?.driver_offer_fare;
    if (typeof offeredFare !== 'number' || !Number.isFinite(offeredFare)) {
      showMessage('Offer is unavailable', 'Wait for the latest driver fare to load, then try again.');
      return;
    }
    setRespondingToOffer(true);
    setMatchingError('');
    try {
      const result = await apiRequest<{ offered_fare: number }>(
        `/rides/${encodeURIComponent(ride.id)}/driver-offer/respond`,
        {
          method: 'POST',
          body: JSON.stringify({ action, offered_fare: offeredFare }),
        },
      );
      setRideStatuses((current) => {
        const status = current[ride.id];
        if (!status) return current;
        if (action === 'accept') {
          return {
            ...current,
            [ride.id]: {
              ...status,
              status: 'accepted',
              agreed_fare: result.offered_fare,
              driver_name: status.offer_driver_name,
              driver_vehicle: status.offer_driver_vehicle,
              driver_offer_status: 'accepted',
            },
          };
        }
        return {
          ...current,
          [ride.id]: { ...status, driver_offer_status: 'rejected' },
        };
      });
      if (action === 'accept') {
        showMessage('Fare accepted', 'Your driver is confirmed. Their live location will appear on the map.');
      } else {
        showMessage('Offer declined', 'Your ride is still searching. A driver can send another fare offer.');
      }
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      setMatchingError(detail);
      showMessage('Could not respond to fare offer', detail);
    } finally {
      setRespondingToOffer(false);
    }
  };

  const rateDriver = async (rideId: string, rating: number) => {
    setSubmittingRating(rideId);
    setMatchingError('');
    try {
      const result = await apiRequest<{ rating: number; rating_count: number }>(
        `/rides/${encodeURIComponent(rideId)}/rating`,
        { method: 'POST', body: JSON.stringify({ rating }) },
      );
      setRideStatuses((current) => {
        const status = current[rideId];
        if (!status) return current;
        return {
          ...current,
          [rideId]: {
            ...status,
            rider_rating: rating,
            driver_rating: result.rating,
            driver_rating_count: result.rating_count,
          },
        };
      });
      showMessage('Rating submitted', 'Thank you for rating your driver.');
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : 'Please try again.';
      setMatchingError(detail);
      showMessage('Could not submit rating', detail);
    } finally {
      setSubmittingRating(null);
    }
  };

  const submitRideReport = async (rideId: string) => {
    if (reportDetails.trim().length < 10) {
      setReportError('Please describe what happened in at least 10 characters.');
      return;
    }
    setSubmittingReport(rideId);
    setReportError('');
    try {
      await apiRequest<{ success: boolean; status: 'open' }>(
        `/rides/${encodeURIComponent(rideId)}/report`,
        {
          method: 'POST',
          body: JSON.stringify({ category: reportCategory, details: reportDetails.trim() }),
        },
      );
      setRideStatuses((current) => ({
        ...current,
        [rideId]: { ...current[rideId], rider_report_status: 'open' },
      }));
      setReportingRideId(null);
      setReportDetails('');
      showMessage('Report sent for review', 'Our support team will review your report.');
    } catch (error: unknown) {
      setReportError(error instanceof Error ? error.message : 'Could not submit your report. Please try again.');
    } finally {
      setSubmittingReport(null);
    }
  };

  const renderRideReport = (rideId: string) => {
    const reportStatus = rideStatuses[rideId]?.rider_report_status;
    if (reportStatus) {
      return (
        <View style={styles.reportSubmitted}>
          <Ionicons name="shield-checkmark-outline" size={16} color={COLORS.green} />
          <Text style={styles.reportSubmittedText}>
            Report submitted · {reportStatus === 'open' || reportStatus === 'reviewing'
              ? 'Under review'
              : reportStatus === 'resolved' ? 'Reviewed' : 'Closed'}
          </Text>
        </View>
      );
    }
    return (
      <View style={styles.rideReport}>
        {reportingRideId !== rideId ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              setReportingRideId(rideId);
              setReportError('');
            }}
            style={styles.reportOpenButton}
          >
            <Ionicons name="flag-outline" size={15} color={COLORS.red} />
            <Text style={styles.reportOpenText}>Report a problem with this ride</Text>
          </Pressable>
        ) : (
          <View style={styles.reportForm}>
            <View style={styles.reportFormTitleRow}>
              <Text style={styles.rateDriverPrompt}>Report this driver or ride</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close report form"
                disabled={submittingReport === rideId}
                onPress={() => {
                  setReportingRideId(null);
                  setReportError('');
                }}
              >
                <Ionicons name="close-circle-outline" size={20} color={COLORS.muted} />
              </Pressable>
            </View>
            <View style={styles.reportCategoryList}>
              {([
                ['safety', 'Safety'],
                ['behavior', 'Behavior'],
                ['vehicle', 'Vehicle'],
                ['fare', 'Fare'],
                ['other', 'Other'],
              ] as const).map(([category, label]) => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ selected: reportCategory === category }}
                  key={category}
                  onPress={() => setReportCategory(category)}
                  style={[styles.reportCategory, reportCategory === category && styles.reportCategorySelected]}
                >
                  <Text style={[
                    styles.reportCategoryText,
                    reportCategory === category && styles.reportCategoryTextSelected,
                  ]}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <TextInput
              accessibilityLabel="Describe the ride problem"
              editable={submittingReport !== rideId}
              multiline
              onChangeText={setReportDetails}
              placeholder="Tell us what happened. Reports are reviewed by Sawaari operations."
              style={styles.reportDetailsInput}
              textAlignVertical="top"
              value={reportDetails}
              maxLength={1500}
            />
            {reportError ? <Text style={styles.reportError}>{reportError}</Text> : null}
            <Pressable
              accessibilityRole="button"
              disabled={submittingReport === rideId}
              onPress={() => void submitRideReport(rideId)}
              style={[styles.reportSubmitButton, submittingReport === rideId && styles.reportButtonDisabled]}
            >
              {submittingReport === rideId
                ? <ActivityIndicator size="small" color={COLORS.white} />
                : <Ionicons name="send-outline" size={15} color={COLORS.white} />}
              <Text style={styles.reportSubmitText}>
                {submittingReport === rideId ? 'Sending report…' : 'Submit report'}
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    );
  };

  const cancelRide = (ride: Ride) => {
    const cancel = async () => {
      if (!ride.cloud) {
        setActiveRideId(null);
        showMessage('Local draft closed', 'You can edit your locations and fare to plan another ride.');
        return;
      }
      try {
        await apiRequest(`/rides/${encodeURIComponent(ride.id)}/cancel`, { method: 'POST' });
      } catch (error: unknown) {
        const detail = error instanceof Error ? error.message : 'Please try again.';
        setMatchingError(detail);
        showMessage('Could not cancel request', detail);
        return;
      }
      setRideStatuses((current) => ({
        ...current,
        [ride.id]: {
          status: 'cancelled',
          driver_name: '',
          driver_vehicle: '',
          agreed_fare: null,
          driver_location_updated_at: null,
          driver_location: null,
          driver_offer_status: null,
          offer_driver_name: '',
          offer_driver_vehicle: '',
          driver_offer_fare: null,
        },
      }));
      setNearbyDrivers((current) => ({ ...current, [ride.id]: [] }));
      if (activeRideId === ride.id) setActiveRideId(null);
    };

    void confirm({
      title: 'Cancel ride request?',
      message: 'Nearby drivers will no longer see this request.',
      cancelLabel: 'Keep request',
      confirmLabel: 'Cancel request',
      destructive: true,
    }).then((confirmed) => {
      if (confirmed) void cancel();
    });
  };

  const activeRide = rides.find((ride) => ride.id === activeRideId) ?? null;
  const activeRideStatus = activeRide ? rideStatuses[activeRide.id]?.status ?? 'searching' : '';
  const showActiveRide = Boolean(activeRide
    && !['completed', 'cancelled'].includes(activeRideStatus));

  const renderMap = () => (
    <View style={[styles.mapFrame, wideLayout && styles.mapFrameWide]}>
      <RideMap
        region={region}
        pickup={activeRide && showActiveRide ? activeRide.pickup : pickup}
        destination={activeRide && showActiveRide ? activeRide.destination : destination}
        nearbyDrivers={activeRide && showActiveRide && activeRideStatus !== 'accepted'
          ? nearbyDrivers[activeRide.id] ?? []
          : []}
        acceptedDriverLocation={activeRide && showActiveRide && activeRideStatus === 'accepted'
          ? rideStatuses[activeRide.id]?.driver_location
          : null}
        acceptedDriverVehicle={activeRide && showActiveRide
          ? rideStatuses[activeRide.id]?.driver_vehicle
          : null}
        locationGranted={locationGranted}
        onRegionChange={setRegion}
        onRouteDistanceChange={(distanceKm, error) => {
          setRouteDistanceKm(distanceKm);
          setRouteError(error ?? '');
          if (customOffer) return;
          setOffer(distanceKm === null ? '' : String(estimateFare(distanceKm, vehicle)));
        }}
      />
      {mapPickField ? (
        <>
          <View pointerEvents="none" style={styles.mapPinMarker}>
            <Ionicons name="location" size={38} color={COLORS.green} />
            <View style={styles.mapPinDot} />
          </View>
          <View style={styles.mapPickCard}>
            <Text style={styles.mapPickTitle}>
              Pin exact {mapPickField === 'pickup' ? 'pickup' : 'destination'}
            </Text>
            <Text style={styles.mapPickHint}>Move the map until the pin is over the exact entrance.</Text>
            <TextInput
              accessibilityLabel="Optional street address or house number"
              autoCapitalize="words"
              autoCorrect={false}
              value={mapPickAddress}
              onChangeText={setMapPickAddress}
              placeholder="House number, street, or landmark (optional)"
              placeholderTextColor="#8996A1"
              returnKeyType="done"
              style={styles.mapPickInput}
            />
            <View style={styles.mapPickActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  Keyboard.dismiss();
                  setMapPickField(null);
                  setMapPickAddress('');
                }}
                style={styles.mapPickCancel}
              >
                <Text style={styles.mapPickCancelText}>Cancel</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Set ${mapPickField} at map pin`}
                onPress={confirmMapPick}
                style={styles.mapPickConfirm}
              >
                <Ionicons name="checkmark" size={17} color={COLORS.white} />
                <Text style={styles.mapPickConfirmText}>Use this pin</Text>
              </Pressable>
            </View>
          </View>
        </>
      ) : null}
      {locationPromptVisible && !mapPickField ? (
        <View style={styles.locationPrompt}>
          <View style={styles.locationPromptCopy}>
            <Text style={styles.locationPromptTitle}>Use your current location?</Text>
            <Text style={styles.locationPromptText}>
              {locationCanAskAgain
                ? 'Allow location to set your pickup on the map.'
                : 'Allow location for this site in your browser or device settings, then try again.'}
            </Text>
          </View>
          <Pressable
            accessibilityRole="button"
            disabled={loadingLocation || !locationCanAskAgain}
            onPress={() => void locateCurrentPosition()}
            style={styles.locationPromptButton}
          >
            {loadingLocation ? (
              <ActivityIndicator size="small" color={COLORS.white} />
            ) : (
              <Text style={styles.locationPromptButtonText}>Enable</Text>
            )}
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Dismiss location prompt"
            onPress={() => setLocationPromptVisible(false)}
            style={styles.locationPromptClose}
          >
            <Ionicons name="close" size={17} color={COLORS.muted} />
          </Pressable>
        </View>
      ) : null}
      <View style={styles.mapLabel}>
        <Ionicons name="map" size={14} color={COLORS.green} />
        <Text style={styles.mapLabelText}>SAWAARI · LIVE MAP</Text>
      </View>
      {!mapPickField ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Use my current location"
          style={styles.myLocationButton}
          onPress={() => void locateCurrentPosition()}
          disabled={loadingLocation}
        >
          {loadingLocation ? (
            <ActivityIndicator size="small" color={COLORS.green} />
          ) : (
            <Ionicons name="navigate" size={19} color={COLORS.green} />
          )}
        </Pressable>
      ) : null}
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
            placeholderTextColor="#8996A1"
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
        <Pressable
          accessibilityRole="button"
          onPress={beginMapPick}
          style={styles.searchMapPickButton}
        >
          <Ionicons name="locate-outline" size={17} color={COLORS.green} />
          <Text style={styles.searchMapPickText}>Can’t find the exact address? Pick it on the map</Text>
        </Pressable>
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

  const renderActiveRidePanel = (ride: Ride) => {
    const status = rideStatuses[ride.id]?.status ?? 'searching';
    const drivers = nearbyDrivers[ride.id] ?? [];
    const accepted = status === 'accepted';
    const cloudRide = ride.cloud === true;
    const agreedFare = rideStatuses[ride.id]?.agreed_fare ?? ride.offer;

    return (
      <ScrollView
        style={[styles.bookingScroll, wideLayout && styles.bookingScrollWide]}
        contentContainerStyle={styles.trackingContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.trackingHeading}>
          <View style={styles.trackingHeadingIcon}>
            <Ionicons
              name={accepted ? 'checkmark-circle' : 'radio-outline'}
              size={22}
              color={COLORS.green}
            />
          </View>
          <View style={styles.trackingHeadingCopy}>
            <Text style={styles.sheetTitle}>
              {accepted ? 'Driver accepted' : cloudRide ? 'Finding nearby drivers' : 'Ride draft'}
            </Text>
            <Text style={styles.sheetSubtitle}>
              {!cloudRide
                ? 'This request is saved on this device only.'
                : accepted
                ? 'Your assigned driver is shown on the map.'
                : `${drivers.length} nearby ${drivers.length === 1 ? 'driver' : 'drivers'} · refreshes every 10 seconds`}
            </Text>
          </View>
        </View>

        <View style={styles.trackingRouteCard}>
          <View style={styles.trackingRoutePoint}>
            <View style={styles.routeCircleSmall} />
            <View style={styles.trackingRouteCopy}>
              <Text style={styles.trackingRouteCaption}>PICKUP</Text>
              <Text numberOfLines={2} style={styles.trackingRouteAddress}>
                {addressOrCoordinates(ride.pickupAddress, ride.pickup)}
              </Text>
            </View>
          </View>
          <View style={styles.trackingRouteDivider} />
          <View style={styles.trackingRoutePoint}>
            <View style={styles.routeSquareSmall} />
            <View style={styles.trackingRouteCopy}>
              <Text style={styles.trackingRouteCaption}>DESTINATION</Text>
              <Text numberOfLines={2} style={styles.trackingRouteAddress}>
                {addressOrCoordinates(ride.destinationAddress, ride.destination)}
              </Text>
            </View>
          </View>
        </View>

        <View style={styles.trackingFareCard}>
          <View style={styles.trackingFareHeading}>
            <View>
              <Text style={styles.trackingRouteCaption}>{accepted ? 'AGREED FARE' : 'YOUR MANUAL OFFER'}</Text>
              <Text style={styles.trackingFareAmount}>
                PKR {(accepted ? agreedFare : ride.offer).toLocaleString()}
              </Text>
            </View>
            <View style={styles.trackingVehicle}>
              <VehicleArt vehicle={ride.vehicle} size={38} />
              <Text style={styles.trackingVehicleName}>{ride.vehicle}</Text>
            </View>
          </View>
          {!accepted ? (
            <>
              <View style={styles.trackingOfferRow}>
                <Text style={styles.trackingOfferLabel}>Change your offer</Text>
                <View style={styles.trackingOfferInputWrap}>
                  <Text style={styles.currencyMark}>Rs</Text>
                  <TextInput
                    accessibilityLabel="Update your manual fare offer in Pakistani rupees"
                    style={styles.trackingOfferInput}
                    keyboardType="number-pad"
                    value={offer}
                    onChangeText={(text) => setOffer(text.replace(/[^\d]/g, ''))}
                    placeholder="Enter fare"
                    placeholderTextColor="#95A2AD"
                    maxLength={7}
                    returnKeyType="done"
                  />
                </View>
              </View>
              <Pressable
                accessibilityRole="button"
                disabled={updatingRideOffer}
                onPress={() => void updateRideOffer(ride)}
                style={({ pressed }) => [
                  styles.updateOfferButton,
                  (pressed || updatingRideOffer) && styles.requestButtonPressed,
                ]}
              >
                {updatingRideOffer ? (
                  <ActivityIndicator size="small" color={COLORS.green} />
                ) : (
                  <Text style={styles.updateOfferText}>Update manual offer</Text>
                )}
              </Pressable>
            </>
          ) : null}
        </View>

        {accepted ? (
          <View style={styles.acceptedDriverCard}>
            <View style={styles.acceptedDriverHeader}>
              {rideStatuses[ride.id]?.driver_photo_url ? (
                <Image
                  accessibilityLabel={`${rideStatuses[ride.id]?.driver_name || 'Driver'} profile photo`}
                  source={{ uri: rideStatuses[ride.id]?.driver_photo_url ?? undefined }}
                  style={styles.acceptedDriverPhoto}
                />
              ) : (
                <View style={[styles.acceptedDriverPhoto, styles.acceptedDriverPhotoFallback]}>
                  <Ionicons name="person" size={25} color={COLORS.green} />
                </View>
              )}
              <View style={styles.acceptedDriverIdentity}>
                <View style={styles.acceptedDriverNameRow}>
                  <Text numberOfLines={1} style={styles.acceptedDriverName}>
                    {rideStatuses[ride.id]?.driver_name || 'Your driver'}
                  </Text>
                  <View style={styles.driverVerifiedBadge}>
                    <Ionicons name="checkmark-circle" size={13} color={COLORS.green} />
                    <Text style={styles.driverVerifiedText}>APPROVED</Text>
                  </View>
                </View>
                <View style={styles.driverRatingRow}>
                  <Ionicons
                    name={typeof rideStatuses[ride.id]?.driver_rating === 'number'
                      ? 'star'
                      : 'sparkles'}
                    size={14}
                    color={COLORS.orange}
                  />
                  <Text style={styles.driverRatingText}>
                    {typeof rideStatuses[ride.id]?.driver_rating === 'number'
                      && (rideStatuses[ride.id]?.driver_rating_count ?? 0) > 0
                      ? `${rideStatuses[ride.id]?.driver_rating?.toFixed(1)} · ${rideStatuses[ride.id]?.driver_rating_count} rider ratings`
                      : 'New driver · no ratings yet'}
                  </Text>
                </View>
                <Text style={styles.driverRidesText}>
                  {rideStatuses[ride.id]?.driver_completed_rides ?? 0} completed Sawaari rides
                </Text>
              </View>
            </View>
            <View style={styles.driverVehicleDetails}>
              <View style={styles.driverVehicleTitleRow}>
                <Ionicons name="car-sport-outline" size={17} color={COLORS.green} />
                <Text style={styles.driverVehicleTitle}>
                  {[
                    rideStatuses[ride.id]?.driver_vehicle_year,
                    rideStatuses[ride.id]?.driver_vehicle_make,
                    rideStatuses[ride.id]?.driver_vehicle_model,
                  ].filter(Boolean).join(' ') || rideStatuses[ride.id]?.driver_vehicle || ride.vehicle}
                </Text>
              </View>
              <View style={styles.driverVehicleMeta}>
                <Text style={styles.driverVehicleColor}>
                  {rideStatuses[ride.id]?.driver_vehicle_color || 'Color not provided'}
                </Text>
                <View style={styles.driverPlate}>
                  <Text style={styles.driverPlateText}>
                    {rideStatuses[ride.id]?.driver_vehicle_registration_number || 'Plate not provided'}
                  </Text>
                </View>
              </View>
            </View>
            <View style={styles.driverMatchFooter}>
              <Ionicons name="checkmark-circle" size={16} color={COLORS.green} />
              <Text style={styles.driverMatchText}>
                {rideStatuses[ride.id]?.driver_location
                  ? 'Driver accepted · live location on map'
                  : 'Driver accepted · waiting for live location'}
              </Text>
            </View>
          </View>
        ) : !cloudRide ? (
          <Text style={styles.noDrivers}>
            Sign in to send this request to real nearby drivers.
          </Text>
        ) : drivers.length > 0 ? (
          <View style={styles.trackingDrivers}>
            <Text style={styles.trackingRouteCaption}>AVAILABLE NEARBY</Text>
            {drivers.slice(0, 4).map((driver) => (
              <View key={driver.driver_id} style={styles.nearbyDriver}>
                <View style={styles.nearbyAvatar}>
                  <Ionicons
                    name={driver.vehicle === 'Bike' ? 'bicycle' : 'car-sport'}
                    size={15}
                    color={COLORS.green}
                  />
                </View>
                <Text numberOfLines={1} style={styles.nearbyDriverName}>
                  {driver.driver_name || 'Sawaari driver'} · {driver.vehicle}
                </Text>
                <Text style={styles.nearbyDistance}>
                  {(driver.distance_m / 1000).toFixed(1)} km
                </Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.noDrivers}>
            No approved online drivers matching {ride.vehicle} were found within 10 km yet. Your request is still searching; a driver using the same account as you will not see your request.
          </Text>
        )}

        {matchingError ? <Text style={styles.errorBanner}>{matchingError}</Text> : null}
        {!accepted ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => cancelRide(ride)}
            style={styles.cancelRideButton}
          >
            <Text style={styles.cancelRideText}>Cancel ride request</Text>
          </Pressable>
        ) : null}
      </ScrollView>
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
        {showActiveRide && activeRide ? renderActiveRidePanel(activeRide) : (
        <ScrollView
          style={[styles.bookingScroll, wideLayout && styles.bookingScrollWide]}
          contentContainerStyle={styles.bookingContent}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.sheetHeading}>
            <View>
              <Text style={styles.sheetEyebrow}>YOUR CITY, IN MOTION</Text>
              <Text style={styles.sheetTitle}>Plan your journey</Text>
              <Text style={styles.sheetSubtitle}>A better ride starts with the right route.</Text>
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
            <Text style={styles.sectionTitle}>Choose your vehicle</Text>
            <Text style={styles.sectionHint}>4 ride styles</Text>
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
                  <VehicleArt vehicle={item.name} selected={selected} size={42} />
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
              <Text style={styles.sectionTitle}>Set your fare</Text>
              <Text style={styles.offerHint}>You decide what feels fair</Text>
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
                placeholderTextColor="#95A2AD"
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
            <Text style={styles.requestButtonText}>Find my ride</Text>
            <Ionicons name="arrow-forward" size={19} color={COLORS.white} />
          </Pressable>
        </ScrollView>
        )}
      </View>
      {activeRide
        && activeRideStatus === 'searching'
        && rideStatuses[activeRide.id]?.driver_offer_status === 'pending'
        && typeof rideStatuses[activeRide.id]?.driver_offer_fare === 'number' ? (
        <View pointerEvents="box-none" style={styles.driverOfferPopupLayer}>
          <View style={styles.driverOfferPopupScrim} />
          <View accessibilityLiveRegion="polite" style={styles.driverOfferPopup}>
            <View style={styles.driverOfferPopupHeader}>
              <View style={styles.driverOfferPopupIcon}>
                <Ionicons
                  name={rideStatuses[activeRide.id]?.offer_driver_vehicle === 'Bike' ? 'bicycle' : 'car-sport'}
                  size={20}
                  color={COLORS.ink}
                />
              </View>
              <View style={styles.driverOfferPopupCopy}>
                <Text style={styles.driverOfferPopupEyebrow}>FARE OFFER RECEIVED</Text>
                <Text numberOfLines={1} style={styles.driverOfferPopupName}>
                  {rideStatuses[activeRide.id]?.offer_driver_name || 'Nearby driver'}
                </Text>
                <Text style={styles.driverOfferPopupVehicle}>
                  {rideStatuses[activeRide.id]?.offer_driver_vehicle || activeRide.vehicle} · Verified Sawaari driver
                </Text>
              </View>
              <View style={styles.newOfferBadge}>
                <View style={styles.newOfferDot} />
                <Text style={styles.newOfferText}>NEW</Text>
              </View>
            </View>
            <View style={styles.driverOfferFarePanel}>
              <View>
                <Text style={styles.driverOfferFareLabel}>PROPOSED FARE</Text>
                <Text style={styles.driverOfferPopupFare}>
                  PKR {rideStatuses[activeRide.id].driver_offer_fare?.toLocaleString()}
                </Text>
              </View>
              <View style={styles.cashOnlyBadge}>
                <Ionicons name="cash-outline" size={14} color={COLORS.green} />
                <Text style={styles.cashOnlyText}>CASH</Text>
              </View>
            </View>
            <View style={styles.driverOfferRoute}>
              <View style={styles.driverOfferRouteRail}>
                <View style={styles.routeCircleSmall} />
                <View style={styles.tripConnector} />
                <View style={styles.routeSquareSmall} />
              </View>
              <View style={styles.driverOfferRouteCopy}>
                <View>
                  <Text style={styles.driverOfferRouteLabel}>PICKUP</Text>
                  <Text numberOfLines={1} style={styles.driverOfferRouteValue}>
                    {addressOrCoordinates(activeRide.pickupAddress, activeRide.pickup)}
                  </Text>
                </View>
                <View style={styles.driverOfferRouteDivider} />
                <View>
                  <Text style={styles.driverOfferRouteLabel}>DESTINATION</Text>
                  <Text numberOfLines={1} style={styles.driverOfferRouteValue}>
                    {addressOrCoordinates(activeRide.destinationAddress, activeRide.destination)}
                  </Text>
                </View>
              </View>
            </View>
            <Text style={styles.driverOfferPopupHint}>
              Accept to confirm this driver at the proposed fare, or decline to continue searching.
            </Text>
            <View style={styles.driverOfferPopupActions}>
              <Pressable
                accessibilityRole="button"
                disabled={respondingToOffer}
                onPress={() => void respondToDriverOffer(activeRide, 'reject')}
                style={({ pressed }) => [
                  styles.rejectDriverOfferButton,
                  (pressed || respondingToOffer) && styles.requestButtonPressed,
                ]}
              >
                <Ionicons name="close-circle-outline" size={17} color={COLORS.red} />
                <Text style={styles.rejectDriverOfferText}>Decline</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={respondingToOffer}
                onPress={() => void respondToDriverOffer(activeRide, 'accept')}
                style={({ pressed }) => [
                  styles.acceptDriverOfferButton,
                  (pressed || respondingToOffer) && styles.requestButtonPressed,
                ]}
              >
                {respondingToOffer
                  ? <ActivityIndicator size="small" color={COLORS.white} />
                  : (
                    <>
                      <Ionicons name="checkmark-circle-outline" size={17} color={COLORS.white} />
                      <Text style={styles.acceptDriverOfferText}>Accept fare</Text>
                    </>
                  )}
              </Pressable>
            </View>
          </View>
        </View>
      ) : null}
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
            <VehicleArt vehicle="Car" size={42} />
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
                : 'These are local drafts. Sign in to send a request to nearby drivers.'}
            </Text>
          </View>
          {rides.map((ride) => (
            <View key={ride.id} style={styles.tripCard}>
              <View style={styles.tripCardHeader}>
                <View style={styles.tripVehicle}>
                  <VehicleArt vehicle={ride.vehicle} size={30} />
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
              {ride.cloud && !['completed', 'cancelled'].includes(rideStatuses[ride.id]?.status ?? '') ? (
                <View style={styles.tripMapFrame}>
                  <RideMap
                    region={tripMapRegions[ride.id] ?? {
                      latitude: (ride.pickup.latitude + ride.destination.latitude) / 2,
                      longitude: (ride.pickup.longitude + ride.destination.longitude) / 2,
                      latitudeDelta: Math.max(
                        0.02,
                        Math.abs(ride.pickup.latitude - ride.destination.latitude) * 1.8,
                      ),
                      longitudeDelta: Math.max(
                        0.02,
                        Math.abs(ride.pickup.longitude - ride.destination.longitude) * 1.8,
                      ),
                    }}
                    pickup={ride.pickup}
                    destination={ride.destination}
                    nearbyDrivers={rideStatuses[ride.id]?.status === 'accepted'
                      ? []
                      : nearbyDrivers[ride.id] ?? []}
                    acceptedDriverLocation={rideStatuses[ride.id]?.driver_location}
                    acceptedDriverVehicle={rideStatuses[ride.id]?.driver_vehicle}
                    locationGranted={false}
                    onRegionChange={(nextRegion) => {
                      setTripMapRegions((current) => ({ ...current, [ride.id]: nextRegion }));
                    }}
                  />
                </View>
              ) : null}
              {ride.cloud && rideStatuses[ride.id]?.status === 'accepted' ? (
                <View>
                  <View style={styles.tripAcceptedDriver}>
                    {rideStatuses[ride.id].driver_photo_url ? (
                      <Image
                        accessibilityLabel={`${rideStatuses[ride.id].driver_name || 'Driver'} profile photo`}
                        source={{ uri: rideStatuses[ride.id].driver_photo_url ?? undefined }}
                        style={styles.tripDriverPhoto}
                      />
                    ) : (
                      <View style={[styles.tripDriverPhoto, styles.acceptedDriverPhotoFallback]}>
                        <Ionicons name="person" size={19} color={COLORS.green} />
                      </View>
                    )}
                    <View style={styles.tripDriverCopy}>
                      <Text style={styles.acceptedDriverName}>
                        {rideStatuses[ride.id].driver_name || 'Your driver'}
                      </Text>
                      <Text style={styles.driverRidesText}>
                        {[
                          rideStatuses[ride.id].driver_vehicle_year,
                          rideStatuses[ride.id].driver_vehicle_make,
                          rideStatuses[ride.id].driver_vehicle_model,
                        ].filter(Boolean).join(' ') || rideStatuses[ride.id].driver_vehicle}
                        {rideStatuses[ride.id].driver_vehicle_color
                          ? ` · ${rideStatuses[ride.id].driver_vehicle_color}`
                          : ''}
                      </Text>
                      <View style={styles.tripDriverMeta}>
                        <Ionicons name="star" size={13} color={COLORS.orange} />
                        <Text style={styles.driverRatingText}>
                          {rideStatuses[ride.id].driver_rating_count
                            ? `${rideStatuses[ride.id].driver_rating?.toFixed(1)} (${rideStatuses[ride.id].driver_rating_count})`
                            : 'New driver · no ratings'}
                        </Text>
                        <Text style={styles.tripDriverPlate}>
                          {rideStatuses[ride.id].driver_vehicle_registration_number || 'Plate not provided'}
                        </Text>
                      </View>
                    </View>
                  </View>
                  <View style={styles.matchNotice}>
                    <Ionicons name="checkmark-circle" size={18} color={COLORS.green} />
                    <Text style={styles.matchText}>
                      Accepted by {rideStatuses[ride.id].driver_name || 'a nearby driver'}
                      {rideStatuses[ride.id].driver_vehicle
                        ? ` · ${rideStatuses[ride.id].driver_vehicle}`
                        : ''}
                    </Text>
                  </View>
                  <Text style={styles.liveLocationNote}>
                    {rideStatuses[ride.id].driver_location
                      ? 'Live driver location · updates while the driver app is open and location is enabled.'
                      : 'Waiting for a fresh driver location. Updates require the driver app to stay open with location enabled.'}
                  </Text>
                  {renderRideReport(ride.id)}
                </View>
              ) : ride.cloud && rideStatuses[ride.id]?.status === 'completed' ? (
                <View style={styles.completedRideCard}>
                  <Text style={styles.matchText}>This ride has been marked complete.</Text>
                  {rideStatuses[ride.id]?.rider_rating ? (
                    <View style={styles.ratingThanksRow}>
                      <Ionicons name="star" size={15} color={COLORS.orange} />
                      <Text style={styles.driverRatingText}>
                        You rated this driver {rideStatuses[ride.id]?.rider_rating}/5
                      </Text>
                    </View>
                  ) : (
                    <>
                      <Text style={styles.rateDriverPrompt}>How was your driver?</Text>
                      <View style={styles.rateDriverStars}>
                        {[1, 2, 3, 4, 5].map((rating) => (
                          <Pressable
                            key={rating}
                            accessibilityRole="button"
                            accessibilityLabel={`Rate driver ${rating} out of 5 stars`}
                            disabled={submittingRating === ride.id}
                            onPress={() => void rateDriver(ride.id, rating)}
                            style={styles.rateDriverStarButton}
                          >
                            {submittingRating === ride.id ? (
                              <ActivityIndicator size="small" color={COLORS.orange} />
                            ) : (
                              <Ionicons name="star" size={26} color={COLORS.orange} />
                            )}
                          </Pressable>
                        ))}
                      </View>
                    </>
                  )}
                  {renderRideReport(ride.id)}
                </View>
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
      <View style={styles.profilePageHeading}>
        <Text style={styles.profilePageEyebrow}>YOUR SAWAARI</Text>
        <Text style={styles.secondaryTitle}>Profile & preferences</Text>
        <Text style={styles.secondarySubtitle}>Everything for your next journey, in one place.</Text>
      </View>
      <View style={styles.profileHero}>
        <View style={styles.profileHeroGlow} />
        <View style={styles.profileAvatar}>
          <Ionicons name="person" size={25} color={COLORS.green} />
        </View>
        <View style={styles.profileCopy}>
          <Text style={styles.profileEyebrow}>SAWAARI ACCOUNT</Text>
          <Text style={styles.profileName}>
            {session?.user.email ? 'Your travel profile' : 'Your journey, your account'}
          </Text>
          <Text style={styles.profileSubtext}>
            {session?.user.email ?? 'One account for rides and driver mode.'}
          </Text>
        </View>
        <Ionicons name="sparkles" size={19} color="#B5F1DF" />
      </View>
      <AccountPanel />
      <View style={styles.profileMenu}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Language settings, English"
          onPress={() => showMessage(
            'Language',
            'English is currently available. Urdu language support is not ready yet.',
          )}
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
        >
          <View style={styles.menuIcon}>
            <Ionicons name="language-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Language</Text>
            <Text style={styles.menuSubtitle}>English</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>
        <View style={styles.menuDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open safety centre"
          onPress={() => showMessage(
            'Safety centre',
            'Driver applications are reviewed before approval. Sawaari does not yet provide SOS, live trip tracking, or emergency-response support. If you are in immediate danger, contact local emergency services.',
          )}
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
        >
          <View style={styles.menuIcon}>
            <Ionicons name="shield-checkmark-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Safety centre</Text>
            <Text style={styles.menuSubtitle}>Driver review and safety information</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>
        <View style={styles.menuDivider} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open help and support"
          onPress={() => showMessage(
            'Help & support',
            'Sawaari support chat and a support phone line are not connected yet. For sign-in issues, use the same confirmed email account registered with Sawaari.',
          )}
          style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]}
        >
          <View style={styles.menuIcon}>
            <Ionicons name="help-buoy-outline" size={19} color={COLORS.green} />
          </View>
          <View style={styles.menuCopy}>
            <Text style={styles.menuTitle}>Help & support</Text>
            <Text style={styles.menuSubtitle}>View available support information</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={COLORS.muted} />
        </Pressable>
      </View>
      <View style={styles.profileFootnote}>
        <Ionicons name="information-circle-outline" size={18} color={COLORS.orange} />
        <Text style={styles.profileFootnoteText}>
          Driver applications are reviewed. Emergency support and online payments are not available yet.
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
  safeArea: { flex: 1, backgroundColor: '#11283A' },
  app: { flex: 1, backgroundColor: COLORS.paper },
  rideScreen: { flex: 1, minHeight: 0, position: 'relative' },
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
    height: 72,
    paddingHorizontal: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#11283A',
  },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  cityBadge: {
    height: 35,
    paddingHorizontal: 11,
    borderRadius: 13,
    backgroundColor: '#1C394A',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  cityBadgeText: { color: '#B5F1DF', fontSize: 9, fontWeight: '800', letterSpacing: 0.8 },
  brandLockup: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  brandMark: {
    width: 41,
    height: 41,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#B5F1DF',
    transform: [{ rotate: '-8deg' }],
  },
  brandName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.9, color: COLORS.white },
  brandTagline: { marginTop: 1, fontSize: 8, fontWeight: '700', letterSpacing: 1.4, color: '#A8C1C8' },
  avatarButton: {
    width: 39,
    height: 39,
    borderRadius: 20,
    backgroundColor: '#1C394A',
    borderWidth: 1,
    borderColor: '#355162',
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
    backgroundColor: '#DCE9E5',
    borderWidth: 3,
    borderColor: '#11283A',
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
    shadowColor: '#07151E',
    shadowOpacity: 0.12,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 2 },
  },
  mapLabelText: { fontSize: 9, fontWeight: '800', letterSpacing: 0.8, color: COLORS.ink },
  locationPrompt: {
    position: 'absolute',
    top: 60,
    left: 12,
    right: 12,
    zIndex: 4,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 11,
    borderRadius: 16,
    backgroundColor: COLORS.white,
    elevation: 4,
    shadowColor: '#07151E',
    shadowOpacity: 0.14,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  locationPromptCopy: { flex: 1 },
  locationPromptTitle: { color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  locationPromptText: { marginTop: 3, color: COLORS.muted, fontSize: 9, lineHeight: 13 },
  locationPromptButton: {
    minHeight: 34,
    paddingHorizontal: 12,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.green,
  },
  locationPromptButtonText: { color: COLORS.white, fontSize: 10, fontWeight: '800' },
  locationPromptClose: {
    width: 28,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPinMarker: {
    position: 'absolute',
    zIndex: 2,
    top: '50%',
    left: '50%',
    width: 42,
    height: 48,
    alignItems: 'center',
    justifyContent: 'flex-start',
    marginLeft: -21,
    marginTop: -42,
  },
  mapPinDot: {
    position: 'absolute',
    bottom: 2,
    width: 7,
    height: 7,
    borderRadius: 4,
    borderWidth: 2,
    borderColor: COLORS.white,
    backgroundColor: COLORS.orange,
  },
  mapPickCard: {
    position: 'absolute',
    zIndex: 3,
    left: 12,
    right: 12,
    bottom: 12,
    padding: 13,
    borderRadius: 17,
    backgroundColor: COLORS.white,
    elevation: 5,
    shadowColor: '#07151E',
    shadowOpacity: 0.16,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  mapPickTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  mapPickHint: { marginTop: 3, color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  mapPickInput: {
    minHeight: 42,
    marginTop: 9,
    paddingHorizontal: 11,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 11,
    color: COLORS.ink,
    fontSize: 12,
  },
  mapPickActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 9,
  },
  mapPickCancel: {
    minHeight: 38,
    paddingHorizontal: 13,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mapPickCancelText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  mapPickConfirm: {
    minHeight: 38,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingHorizontal: 13,
    borderRadius: 11,
    backgroundColor: COLORS.green,
  },
  mapPickConfirmText: { color: COLORS.white, fontSize: 11, fontWeight: '800' },
  myLocationButton: {
    position: 'absolute',
    bottom: 14,
    right: 13,
    width: 42,
    height: 42,
    borderRadius: 14,
    backgroundColor: '#183448',
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
    backgroundColor: COLORS.paper,
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
    backgroundColor: COLORS.white,
  },
  searchTitle: { color: COLORS.ink, fontSize: 17, fontWeight: '800' },
  searchSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 11 },
  searchInputWrap: {
    minHeight: 54,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.white,
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
  searchScopeButtonSelected: { backgroundColor: '#0B786F' },
  searchScopeText: { color: COLORS.muted, fontSize: 11, fontWeight: '700' },
  searchScopeTextSelected: { color: COLORS.white },
  searchMapPickButton: {
    minHeight: 42,
    marginTop: 7,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: COLORS.line,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.white,
  },
  searchMapPickText: { flex: 1, color: COLORS.green, fontSize: 11, fontWeight: '700' },
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
    backgroundColor: '#DDF3EC',
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
    maxHeight: '68%',
    marginHorizontal: 12,
    marginBottom: 10,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#FBFDFC',
    elevation: 9,
    shadowColor: '#10293A',
    shadowOpacity: 0.15,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
  },
  bookingSheetWide: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: 410,
    width: 410,
    maxHeight: '100%',
    marginHorizontal: 0,
    borderRadius: 27,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 20,
  },
  bookingScroll: { flexGrow: 0, flexShrink: 1 },
  bookingScrollWide: { flex: 1, flexGrow: 1, minHeight: 0 },
  bookingContent: { paddingBottom: 10 },
  trackingContent: { gap: 12, paddingBottom: 8 },
  trackingHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackingHeadingIcon: {
    width: 42,
    height: 42,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E2F5EF',
  },
  trackingHeadingCopy: { flex: 1 },
  trackingRouteCard: {
    paddingHorizontal: 13,
    paddingVertical: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  trackingRoutePoint: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  trackingRouteCopy: { flex: 1 },
  trackingRouteCaption: { color: COLORS.muted, fontSize: 8, fontWeight: '800', letterSpacing: 1 },
  trackingRouteAddress: { marginTop: 3, color: COLORS.ink, fontSize: 11, fontWeight: '700' },
  trackingRouteDivider: {
    height: 1,
    marginVertical: 9,
    marginLeft: 19,
    backgroundColor: COLORS.line,
  },
  trackingFareCard: {
    padding: 13,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
    gap: 10,
  },
  trackingFareHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  trackingFareAmount: { marginTop: 3, color: COLORS.ink, fontSize: 20, fontWeight: '800' },
  trackingVehicle: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  trackingVehicleName: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  trackingOfferRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  trackingOfferLabel: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  trackingOfferInputWrap: {
    width: 145,
    height: 40,
    paddingHorizontal: 9,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: COLORS.line,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  trackingOfferInput: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    color: COLORS.ink,
    textAlign: 'right',
    fontSize: 13,
    fontWeight: '800',
  },
  updateOfferButton: {
    minHeight: 39,
    borderRadius: 11,
    backgroundColor: COLORS.lime,
    alignItems: 'center',
    justifyContent: 'center',
  },
  updateOfferText: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  trackingDrivers: { gap: 9, padding: 12, borderRadius: 14, backgroundColor: '#F4F7FA' },
  sheetHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 15,
  },
  sheetEyebrow: { marginBottom: 7, color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 },
  sheetTitle: { color: COLORS.ink, fontSize: 25, fontWeight: '800', letterSpacing: -0.9 },
  sheetSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 12, fontWeight: '500' },
  cashBadge: {
    borderWidth: 1,
    borderColor: COLORS.line,
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
    borderRadius: 19,
    borderWidth: 1,
    borderColor: COLORS.line,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  routeRail: { width: 22, alignItems: 'center', paddingTop: 18, paddingBottom: 16 },
  routeCircle: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: '#0B786F',
  },
  routeConnector: { width: 1, flex: 1, minHeight: 16, borderStyle: 'dashed', borderWidth: 0.7, borderColor: '#A8B6C2' },
  routeSquare: { width: 8, height: 8, borderRadius: 3, backgroundColor: COLORS.orange },
  routeFields: { flex: 1 },
  routeField: {
    flex: 1,
    minHeight: 43,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderRadius: 13,
  },
  routeFieldCopy: { flex: 1, paddingRight: 8 },
  routeCaption: { fontSize: 8, fontWeight: '800', letterSpacing: 1.2, color: COLORS.green },
  routeValue: { marginTop: 4, fontSize: 12, fontWeight: '600', color: COLORS.ink },
  routePlaceholder: { fontWeight: '500', color: '#8996A1' },
  routeDivider: { height: 1, marginLeft: 9, backgroundColor: '#E9EFED' },
  sectionHeader: { marginTop: 18, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { color: COLORS.ink, fontSize: 13, fontWeight: '800' },
  sectionHint: { color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  vehicleList: { gap: 9, paddingRight: 8 },
  vehicleCard: {
    width: 82,
    height: 83,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 19,
    borderWidth: 1,
    borderColor: '#E6EFEC',
    backgroundColor: COLORS.white,
    elevation: 3,
    shadowColor: '#1B3A4B',
    shadowOpacity: 0.08,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },
  vehicleCardSelected: { borderWidth: 1.5, borderColor: COLORS.green, backgroundColor: '#E7F7F1' },
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
    borderColor: COLORS.line,
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
    backgroundColor: '#EAF7F3',
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
    backgroundColor: '#0B786F',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
  },
  requestButtonPressed: { opacity: 0.82, transform: [{ scale: 0.99 }] },
  requestButtonText: { color: COLORS.white, fontSize: 14, fontWeight: '800', letterSpacing: 0.2 },
  secondaryScreen: { flex: 1, paddingHorizontal: 20, paddingTop: 19, backgroundColor: COLORS.paper },
  secondaryHeader: { marginBottom: 20 },
  profilePageHeading: { marginBottom: 17 },
  profilePageEyebrow: { marginBottom: 7, color: COLORS.green, fontSize: 9, fontWeight: '800', letterSpacing: 1.5 },
  secondaryTitle: { color: COLORS.ink, fontSize: 26, fontWeight: '800', letterSpacing: -0.8 },
  secondarySubtitle: { marginTop: 4, color: COLORS.muted, fontSize: 12 },
  emptyState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 35, paddingBottom: 65 },
  emptyIcon: { width: 68, height: 68, borderRadius: 23, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF1F7' },
  emptyTitle: { marginTop: 17, color: COLORS.ink, fontSize: 18, fontWeight: '800' },
  emptyCopy: { marginTop: 7, color: COLORS.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 },
  secondaryButton: { marginTop: 19, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 13, backgroundColor: COLORS.lime, flexDirection: 'row', alignItems: 'center', gap: 8 },
  secondaryButtonText: { color: COLORS.green, fontSize: 12, fontWeight: '800' },
  loadingIndicator: { marginTop: 36 },
  tripList: { gap: 11, paddingBottom: 22 },
  localNotice: { padding: 12, borderRadius: 12, backgroundColor: '#EAF1F7', flexDirection: 'row', alignItems: 'center', gap: 8 },
  localNoticeText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '600' },
  tripCard: { padding: 15, borderRadius: 19, borderWidth: 1, borderColor: '#E6EFEC', backgroundColor: COLORS.white, elevation: 3, shadowColor: '#173A4B', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  tripCardHeader: { flexDirection: 'row', alignItems: 'center' },
  tripVehicle: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E2F5EF' },
  tripSummary: { flex: 1, marginLeft: 10 },
  tripVehicleName: { color: COLORS.ink, fontSize: 12, fontWeight: '800' },
  tripTime: { marginTop: 3, color: COLORS.muted, fontSize: 9 },
  draftBadge: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 10, backgroundColor: '#FFF2E5' },
  draftText: { color: '#A96021', fontSize: 8, fontWeight: '800', letterSpacing: 0.7 },
  liveBadge: { backgroundColor: '#EAF1F7' },
  liveBadgeText: { color: COLORS.green },
  tripRoute: { marginTop: 13, flexDirection: 'row' },
  tripMapFrame: {
    height: 190,
    marginTop: 13,
    overflow: 'hidden',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: '#DCE9E5',
  },
  tripDots: { width: 18, alignItems: 'center', paddingTop: 3, paddingBottom: 4 },
  routeCircleSmall: { width: 8, height: 8, borderRadius: 5, borderWidth: 2, borderColor: COLORS.green },
  tripConnector: { width: 1, flex: 1, minHeight: 20, marginVertical: 3, borderWidth: 0.7, borderStyle: 'dashed', borderColor: '#A8B6C2' },
  routeSquareSmall: { width: 7, height: 7, borderRadius: 2, backgroundColor: COLORS.orange },
  tripAddresses: { flex: 1, marginLeft: 7 },
  tripAddress: { minHeight: 23, color: COLORS.ink, fontSize: 10, fontWeight: '600' },
  tripAddressDivider: { height: 1, marginBottom: 8, backgroundColor: COLORS.line },
  matchNotice: {
    marginTop: 12,
    padding: 11,
    borderRadius: 11,
    backgroundColor: '#EAF1F7',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  acceptedDriverCard: {
    marginTop: 12,
    padding: 13,
    gap: 11,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: COLORS.line,
    backgroundColor: COLORS.white,
  },
  acceptedDriverHeader: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  acceptedDriverPhoto: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#E8F4EE' },
  acceptedDriverPhotoFallback: { alignItems: 'center', justifyContent: 'center' },
  acceptedDriverIdentity: { flex: 1, minWidth: 0, gap: 3 },
  acceptedDriverNameRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  acceptedDriverName: { flexShrink: 1, color: COLORS.ink, fontSize: 14, fontWeight: '900' },
  driverVerifiedBadge: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  driverVerifiedText: { color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.4 },
  driverRatingRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  driverRatingText: { color: COLORS.ink, fontSize: 10, fontWeight: '700' },
  driverRidesText: { color: COLORS.muted, fontSize: 9, fontWeight: '600' },
  driverVehicleDetails: { padding: 10, borderRadius: 11, backgroundColor: '#F4F7FA', gap: 7 },
  driverVehicleTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  driverVehicleTitle: { flex: 1, color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  driverVehicleMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  driverVehicleColor: { color: COLORS.muted, fontSize: 10, fontWeight: '700' },
  driverPlate: { paddingHorizontal: 8, paddingVertical: 4, borderWidth: 1, borderColor: '#BAC8CE', borderRadius: 5, backgroundColor: COLORS.white },
  driverPlateText: { color: COLORS.ink, fontSize: 10, fontWeight: '900', letterSpacing: 0.6 },
  driverMatchFooter: { flexDirection: 'row', alignItems: 'center', gap: 6, padding: 9, borderRadius: 9, backgroundColor: '#EAF1F7' },
  driverMatchText: { flex: 1, color: COLORS.green, fontSize: 10, fontWeight: '700' },
  tripAcceptedDriver: { marginTop: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 12, borderWidth: 1, borderColor: COLORS.line, backgroundColor: COLORS.white },
  tripDriverPhoto: { width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F4EE' },
  tripDriverCopy: { flex: 1, minWidth: 0, gap: 3 },
  tripDriverMeta: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  tripDriverPlate: { marginLeft: 'auto', paddingHorizontal: 5, paddingVertical: 2, borderWidth: 1, borderColor: '#BAC8CE', borderRadius: 4, color: COLORS.ink, fontSize: 8, fontWeight: '900' },
  completedRideCard: { marginTop: 8, padding: 11, borderRadius: 11, backgroundColor: '#F4F7FA', gap: 8 },
  rateDriverPrompt: { color: COLORS.ink, fontSize: 11, fontWeight: '800' },
  rateDriverStars: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  rateDriverStarButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  ratingThanksRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rideReport: { marginTop: 6 },
  reportOpenButton: { alignSelf: 'flex-start', minHeight: 36, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 10, borderRadius: 9, backgroundColor: '#FBE9E8' },
  reportOpenText: { color: COLORS.red, fontSize: 10, fontWeight: '800' },
  reportForm: { gap: 9, padding: 11, borderWidth: 1, borderColor: '#E8C7C4', borderRadius: 11, backgroundColor: '#FFF9F8' },
  reportFormTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  reportCategoryList: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  reportCategory: { minHeight: 32, justifyContent: 'center', paddingHorizontal: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 18, backgroundColor: COLORS.white },
  reportCategorySelected: { borderColor: COLORS.red, backgroundColor: '#FBE9E8' },
  reportCategoryText: { color: COLORS.muted, fontSize: 9, fontWeight: '700' },
  reportCategoryTextSelected: { color: COLORS.red, fontWeight: '900' },
  reportDetailsInput: { minHeight: 92, padding: 10, borderWidth: 1, borderColor: COLORS.line, borderRadius: 9, backgroundColor: COLORS.white, color: COLORS.ink, fontSize: 11, lineHeight: 16 },
  reportError: { color: COLORS.red, fontSize: 10 },
  reportSubmitButton: { alignSelf: 'flex-start', minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, borderRadius: 9, backgroundColor: COLORS.red },
  reportSubmitText: { color: COLORS.white, fontSize: 10, fontWeight: '900' },
  reportButtonDisabled: { opacity: 0.6 },
  reportSubmitted: { flexDirection: 'row', alignItems: 'center', gap: 7, padding: 9, borderRadius: 9, backgroundColor: '#E8F4EA' },
  reportSubmittedText: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  driverOfferPopupLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20,
    elevation: 10,
    alignItems: 'center',
    paddingHorizontal: 12,
  },
  driverOfferPopupScrim: {
    position: 'absolute',
    top: 72,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(17, 40, 58, 0.18)',
  },
  driverOfferPopup: {
    width: '100%',
    maxWidth: 520,
    marginTop: 82,
    padding: 15,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#D5E4E0',
    backgroundColor: COLORS.white,
    gap: 12,
    shadowColor: '#10283A',
    shadowOpacity: 0.24,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  driverOfferPopupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 11,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.line,
  },
  driverOfferPopupIcon: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.lime },
  driverOfferPopupCopy: { flex: 1, minWidth: 0 },
  driverOfferPopupEyebrow: { color: COLORS.green, fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  driverOfferPopupName: { marginTop: 3, color: COLORS.ink, fontSize: 14, fontWeight: '900' },
  driverOfferPopupVehicle: { marginTop: 2, color: COLORS.muted, fontSize: 10, fontWeight: '600' },
  newOfferBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 8, paddingVertical: 6, borderRadius: 20, backgroundColor: '#E8F4EE' },
  newOfferDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: COLORS.green },
  newOfferText: { color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.5 },
  driverOfferFarePanel: {
    minHeight: 67,
    paddingHorizontal: 13,
    paddingVertical: 10,
    borderRadius: 13,
    backgroundColor: '#F4F8F6',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  driverOfferFareLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 1 },
  driverOfferPopupFare: { marginTop: 2, color: COLORS.green, fontSize: 23, fontWeight: '900', letterSpacing: -0.5 },
  cashOnlyBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 7, borderRadius: 9, backgroundColor: COLORS.lime },
  cashOnlyText: { color: COLORS.green, fontSize: 8, fontWeight: '900', letterSpacing: 0.6 },
  driverOfferRoute: { flexDirection: 'row', gap: 10, paddingHorizontal: 3 },
  driverOfferRouteRail: { width: 10, alignItems: 'center', paddingTop: 3, paddingBottom: 4 },
  driverOfferRouteCopy: { flex: 1, gap: 8 },
  driverOfferRouteLabel: { color: COLORS.muted, fontSize: 8, fontWeight: '900', letterSpacing: 0.8 },
  driverOfferRouteValue: { marginTop: 2, color: COLORS.ink, fontSize: 10, fontWeight: '700' },
  driverOfferRouteDivider: { height: 1, backgroundColor: COLORS.line },
  driverOfferPopupHint: { color: COLORS.muted, fontSize: 10, lineHeight: 15 },
  driverOfferPopupActions: { flexDirection: 'row', gap: 10, paddingTop: 2 },
  rejectDriverOfferButton: { flex: 1, minHeight: 46, borderRadius: 12, borderWidth: 1, borderColor: '#F0D8D6', backgroundColor: '#FFF8F7', flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center' },
  rejectDriverOfferText: { color: COLORS.red, fontSize: 11, fontWeight: '900' },
  acceptDriverOfferButton: { flex: 1.3, minHeight: 46, borderRadius: 12, backgroundColor: COLORS.green, flexDirection: 'row', gap: 6, alignItems: 'center', justifyContent: 'center', elevation: 2 },
  acceptDriverOfferText: { color: COLORS.white, fontSize: 11, fontWeight: '900' },
  matchText: { flex: 1, color: COLORS.green, fontSize: 11, fontWeight: '700' },
  liveLocationNote: { marginTop: 6, color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  nearbyDrivers: { marginTop: 12, padding: 11, borderRadius: 11, backgroundColor: '#F4F7FA', gap: 8 },
  nearbyHeading: { color: COLORS.green, fontSize: 11, fontWeight: '800' },
  nearbyDriver: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  nearbyAvatar: { width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EAF1F7' },
  nearbyDriverName: { flex: 1, color: COLORS.ink, fontSize: 10, fontWeight: '700' },
  nearbyDistance: { color: COLORS.green, fontSize: 10, fontWeight: '800' },
  nearbyHint: { color: COLORS.muted, fontSize: 9, lineHeight: 14 },
  cancelRideButton: { alignSelf: 'flex-start', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 9, backgroundColor: '#FBE9E8' },
  cancelRideText: { color: COLORS.red, fontSize: 10, fontWeight: '700' },
  noDrivers: { marginTop: 11, padding: 10, borderRadius: 10, color: COLORS.muted, backgroundColor: '#F4F7FA', fontSize: 10, lineHeight: 15 },
  errorBanner: { padding: 11, borderRadius: 11, backgroundColor: '#FBE9E8', color: COLORS.red, fontSize: 11 },
  addressNotice: { marginTop: 6, color: '#A96021', fontSize: 9, lineHeight: 13 },
  profileHero: { position: 'relative', overflow: 'hidden', padding: 18, borderRadius: 23, backgroundColor: '#11283A', flexDirection: 'row', alignItems: 'center', elevation: 7, shadowColor: '#11283A', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  profileHeroGlow: { position: 'absolute', top: -38, right: 24, width: 128, height: 128, borderRadius: 64, backgroundColor: '#1C4E55', opacity: 0.75 },
  profileAvatar: { width: 54, height: 54, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#B5F1DF', borderWidth: 3, borderColor: '#FFFFFF' },
  profileCopy: { flex: 1, marginLeft: 12 },
  profileEyebrow: { marginBottom: 4, color: '#B5F1DF', fontSize: 8, fontWeight: '800', letterSpacing: 1.3 },
  profileName: { color: COLORS.white, fontSize: 13, fontWeight: '800' },
  profileSubtext: { marginTop: 4, color: '#C4D5DA', fontSize: 10, lineHeight: 15 },
  profileMenu: { marginTop: 14, gap: 8 },
  menuItem: { minHeight: 66, paddingHorizontal: 12, borderRadius: 17, borderWidth: 1, borderColor: '#E7EFED', backgroundColor: COLORS.white, flexDirection: 'row', alignItems: 'center', elevation: 2, shadowColor: '#173A4B', shadowOpacity: 0.05, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } },
  menuItemPressed: { opacity: 0.72 },
  menuIcon: { width: 39, height: 39, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E2F5EF' },
  menuCopy: { flex: 1, marginLeft: 10 },
  menuTitle: { color: COLORS.ink, fontSize: 12, fontWeight: '700' },
  menuSubtitle: { marginTop: 3, color: COLORS.muted, fontSize: 9 },
  menuDivider: { height: 0 },
  profileFootnote: { marginTop: 13, padding: 13, borderRadius: 16, backgroundColor: '#FFF3E7', flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  profileFootnoteText: { flex: 1, color: '#775333', fontSize: 10, lineHeight: 15 },
});
