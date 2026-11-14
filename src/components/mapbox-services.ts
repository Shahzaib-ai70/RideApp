import type { MapPoint, RideRouteOption, RouteTravelMode } from './ride-map.types';

const MAPBOX_ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
const SEARCH_BOX_ENDPOINT = 'https://api.mapbox.com/search/searchbox/v1';
const GEOCODING_ENDPOINT = 'https://api.mapbox.com/search/geocode/v6';
const DIRECTIONS_ENDPOINT = 'https://api.mapbox.com/directions/v5';

export type MapboxPlaceSuggestion = {
  id: string;
  label: string;
  detail: string;
};

export type MapboxPlaceDetails = {
  label: string;
  point: MapPoint;
};

function requireAccessToken() {
  if (!MAPBOX_ACCESS_TOKEN) {
    throw new Error('Mapbox is not configured. Add EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN and restart the app.');
  }
  return MAPBOX_ACCESS_TOKEN;
}

async function requestJson(url: URL, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { signal });
  let payload: unknown;
  try {
    payload = await response.json() as unknown;
  } catch {
    throw new Error('Mapbox returned an unreadable response.');
  }
  if (!response.ok) {
    const message = typeof payload === 'object' && payload !== null
      && 'message' in payload && typeof payload.message === 'string'
      ? payload.message
      : `Mapbox request failed (${response.status}).`;
    throw new Error(message);
  }
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('Mapbox returned an invalid response.');
  }
  return payload as Record<string, unknown>;
}

export function createMapboxSessionToken() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    return (character === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

export async function suggestMapboxPlaces(
  query: string,
  sessionToken: string,
  scope: 'Pakistan' | 'Worldwide',
  proximity: MapPoint,
  signal: AbortSignal,
): Promise<MapboxPlaceSuggestion[]> {
  const url = new URL(`${SEARCH_BOX_ENDPOINT}/suggest`);
  url.searchParams.set('q', query);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('access_token', requireAccessToken());
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '8');
  url.searchParams.set('types', 'poi,address,street,place,locality,neighborhood,postcode');
  url.searchParams.set('proximity', `${proximity.longitude},${proximity.latitude}`);
  if (scope === 'Pakistan') url.searchParams.set('country', 'PK');

  const payload = await requestJson(url, signal);
  if (!Array.isArray(payload.suggestions)) return [];
  return payload.suggestions.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const suggestion = item as Record<string, unknown>;
    if (typeof suggestion.mapbox_id !== 'string' || typeof suggestion.name !== 'string') return [];
    const detail = typeof suggestion.full_address === 'string'
      ? suggestion.full_address
      : typeof suggestion.place_formatted === 'string'
        ? suggestion.place_formatted
        : typeof suggestion.address === 'string' ? suggestion.address : '';
    return [{ id: suggestion.mapbox_id, label: suggestion.name, detail }];
  });
}

export async function retrieveMapboxPlace(
  mapboxId: string,
  sessionToken: string,
  signal?: AbortSignal,
): Promise<MapboxPlaceDetails> {
  const url = new URL(`${SEARCH_BOX_ENDPOINT}/retrieve/${encodeURIComponent(mapboxId)}`);
  url.searchParams.set('session_token', sessionToken);
  url.searchParams.set('access_token', requireAccessToken());
  url.searchParams.set('language', 'en');
  const payload = await requestJson(url, signal);
  const feature = Array.isArray(payload.features) ? payload.features[0] : null;
  if (typeof feature !== 'object' || feature === null) {
    throw new Error('Mapbox did not return details for this search result.');
  }
  const geometry = (feature as Record<string, unknown>).geometry;
  const properties = (feature as Record<string, unknown>).properties;
  if (typeof geometry !== 'object' || geometry === null
    || !Array.isArray((geometry as Record<string, unknown>).coordinates)
    || typeof properties !== 'object' || properties === null) {
    throw new Error('Mapbox returned incomplete place details.');
  }
  const coordinates = (geometry as { coordinates: unknown[] }).coordinates;
  const [longitude, latitude] = coordinates;
  if (typeof latitude !== 'number' || !Number.isFinite(latitude)
    || typeof longitude !== 'number' || !Number.isFinite(longitude)
    || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
    throw new Error('Mapbox returned invalid place coordinates.');
  }
  const details = properties as Record<string, unknown>;
  const label = typeof details.full_address === 'string'
    ? details.full_address
    : typeof details.place_formatted === 'string'
      ? details.place_formatted
      : typeof details.name === 'string' ? details.name : '';
  return { label, point: { latitude, longitude } };
}

export async function reverseMapboxGeocode(point: MapPoint, signal?: AbortSignal) {
  const url = new URL(`${GEOCODING_ENDPOINT}/reverse`);
  url.searchParams.set('longitude', String(point.longitude));
  url.searchParams.set('latitude', String(point.latitude));
  url.searchParams.set('access_token', requireAccessToken());
  url.searchParams.set('language', 'en');
  url.searchParams.set('limit', '1');
  const payload = await requestJson(url, signal);
  const feature = Array.isArray(payload.features) ? payload.features[0] : null;
  if (typeof feature !== 'object' || feature === null) return '';
  const properties = (feature as Record<string, unknown>).properties;
  if (typeof properties !== 'object' || properties === null) return '';
  const details = properties as Record<string, unknown>;
  if (typeof details.full_address === 'string' && details.full_address) return details.full_address;
  if (typeof details.place_formatted === 'string' && details.place_formatted) return details.place_formatted;
  return typeof details.name === 'string' ? details.name : '';
}

function directionsProfile(mode: RouteTravelMode) {
  switch (mode) {
    case 'WALKING': return 'mapbox/walking';
    case 'BICYCLING': return 'mapbox/cycling';
    default: return 'mapbox/driving';
  }
}

export async function getMapboxDirections(
  origin: MapPoint,
  destination: MapPoint,
  travelMode: RouteTravelMode,
  signal: AbortSignal,
): Promise<RideRouteOption[]> {
  const coordinates = `${origin.longitude},${origin.latitude};${destination.longitude},${destination.latitude}`;
  const url = new URL(`${DIRECTIONS_ENDPOINT}/${directionsProfile(travelMode)}/${coordinates}`);
  url.searchParams.set('access_token', requireAccessToken());
  url.searchParams.set('alternatives', 'true');
  url.searchParams.set('geometries', 'geojson');
  url.searchParams.set('overview', 'full');
  url.searchParams.set('steps', 'false');

  const payload = await requestJson(url, signal);
  if (!Array.isArray(payload.routes)) return [];
  const routes = payload.routes.flatMap((item) => {
    if (typeof item !== 'object' || item === null) return [];
    const route = item as Record<string, unknown>;
    const geometry = route.geometry;
    if (typeof route.distance !== 'number' || !Number.isFinite(route.distance)
      || route.distance <= 0 || typeof route.duration !== 'number'
      || !Number.isFinite(route.duration) || route.duration <= 0
      || typeof geometry !== 'object' || geometry === null
      || !Array.isArray((geometry as Record<string, unknown>).coordinates)) return [];
    const path = (geometry as { coordinates: unknown[] }).coordinates.flatMap((coordinate) => {
      if (!Array.isArray(coordinate) || coordinate.length < 2) return [];
      const [longitude, latitude] = coordinate;
      if (typeof longitude !== 'number' || !Number.isFinite(longitude)
        || typeof latitude !== 'number' || !Number.isFinite(latitude)
        || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return [];
      return [{ latitude, longitude }];
    });
    if (path.length < 2) return [];
    return [{
      distanceMeters: route.distance,
      durationMillis: route.duration * 1000,
      path,
    }];
  });
  if (routes.length === 0) throw new Error('Mapbox could not find a route between these locations.');
  return routes.slice(0, 3);
}
