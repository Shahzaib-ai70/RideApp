import { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { divIcon, latLngBounds } from 'leaflet';
import type { LatLngExpression, LatLngTuple } from 'leaflet';
import type { RideMapProps } from './ride-map.types';
import { loadGoogleMaps } from './google-maps';
import 'leaflet/dist/leaflet.css';
import './ride-map.web.css';

const GOOGLE_MAPS_WEB_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY;

function pinIcon(kind: 'pickup' | 'destination') {
  return divIcon({
    className: 'sawaari-marker-shell',
    html: kind === 'pickup'
      ? '<span class="sawaari-marker sawaari-marker-pickup"><i></i></span>'
      : '<span class="sawaari-marker sawaari-marker-destination">●</span>',
    iconSize: kind === 'pickup' ? [25, 25] : [32, 32],
    iconAnchor: kind === 'pickup' ? [12, 12] : [16, 29],
  });
}

function MapRegionEvents({ onRegionChange }: Pick<RideMapProps, 'onRegionChange'>) {
  const map = useMap();
  const onRegionChangeRef = useRef(onRegionChange);

  useEffect(() => {
    onRegionChangeRef.current = onRegionChange;
  }, [onRegionChange]);

  useMapEvents({
    moveend() {
      const center = map.getCenter();
      const bounds = map.getBounds();
      onRegionChangeRef.current({
        latitude: center.lat,
        longitude: center.lng,
        latitudeDelta: bounds.getNorth() - bounds.getSouth(),
        longitudeDelta: bounds.getEast() - bounds.getWest(),
      });
    },
  });
  return null;
}

function RegionSync({
  region,
  pickup,
  destination,
}: Pick<RideMapProps, 'region' | 'pickup' | 'destination'>) {
  const map = useMap();

  useEffect(() => {
    if (pickup && destination) return;
    map.setView([region.latitude, region.longitude], map.getZoom(), { animate: true });
  }, [destination, map, pickup, region.latitude, region.longitude]);

  useEffect(() => {
    if (!pickup || !destination) return;
    map.fitBounds(
      latLngBounds(
        [pickup.latitude, pickup.longitude],
        [destination.latitude, destination.longitude],
      ),
      { padding: [55, 55], maxZoom: 15, animate: true },
    );
  }, [destination, map, pickup]);

  return null;
}

type OsrmRouteResponse = {
  code: string;
  routes?: {
    distance: number;
    geometry: {
      coordinates: [number, number][];
    };
  }[];
};

function isOsrmRouteResponse(value: unknown): value is OsrmRouteResponse {
  if (typeof value !== 'object' || value === null || !('code' in value)) return false;
  const result = value as { code?: unknown; routes?: unknown };
  if (typeof result.code !== 'string') return false;
  if (result.routes === undefined) return true;
  if (!Array.isArray(result.routes)) return false;
  return result.routes.every((route: unknown) => {
    if (typeof route !== 'object' || route === null) return false;
    const candidate = route as { distance?: unknown; geometry?: unknown };
    if (typeof candidate.distance !== 'number' || typeof candidate.geometry !== 'object'
      || candidate.geometry === null || !('coordinates' in candidate.geometry)) return false;
    return Array.isArray(candidate.geometry.coordinates)
      && candidate.geometry.coordinates.every((coordinate: unknown) =>
        Array.isArray(coordinate) && coordinate.length === 2
        && coordinate.every((part: unknown) => typeof part === 'number' && Number.isFinite(part)));
  });
}

function OpenStreetMapRoute({
  pickup,
  destination,
  onRouteDistanceChange,
}: Pick<RideMapProps, 'pickup' | 'destination' | 'onRouteDistanceChange'>) {
  const [route, setRoute] = useState<{ key: string; path: LatLngTuple[] } | null>(null);
  const onRouteDistanceChangeRef = useRef(onRouteDistanceChange);
  const routeKey = pickup && destination
    ? `${pickup.latitude},${pickup.longitude};${destination.latitude},${destination.longitude}`
    : '';

  useEffect(() => {
    onRouteDistanceChangeRef.current = onRouteDistanceChange;
  }, [onRouteDistanceChange]);

  useEffect(() => {
    if (!pickup || !destination) {
      onRouteDistanceChangeRef.current?.(null);
      return undefined;
    }

    const controller = new AbortController();
    onRouteDistanceChangeRef.current?.(null);

    const url = new URL(
      `https://router.project-osrm.org/route/v1/driving/${pickup.longitude},${pickup.latitude};${destination.longitude},${destination.latitude}`,
    );
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('steps', 'false');

    void fetch(url, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Road route service failed (${response.status}).`);
        return await response.json() as unknown;
      })
      .then((data) => {
        if (!isOsrmRouteResponse(data) || data.code !== 'Ok') {
          throw new Error('No drivable road route was found between these places.');
        }
        const route = data.routes?.[0];
        if (!route || route.geometry.coordinates.length < 2 || route.distance <= 0) {
          throw new Error('The road route service returned an invalid route.');
        }
        setRoute({
          key: routeKey,
          path: route.geometry.coordinates.map(([longitude, latitude]) => [latitude, longitude]),
        });
        onRouteDistanceChangeRef.current?.(route.distance / 1000);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const message = error instanceof Error
          ? error.message
          : 'Could not calculate the OpenStreetMap road route.';
        onRouteDistanceChangeRef.current?.(null, message);
      });

    return () => controller.abort();
  }, [pickup, destination, routeKey]);

  return route?.key === routeKey && route.path.length > 0 ? (
    <Polyline
      key={routeKey}
      positions={route.path as LatLngExpression[]}
      pathOptions={{ color: '#0E4E3D', opacity: 0.9, weight: 6 }}
    />
  ) : null;
}

function OpenStreetMapRideMap(props: RideMapProps) {
  const { region, pickup, destination, onRegionChange, onRouteDistanceChange } = props;
  return (
    <MapContainer
      center={[region.latitude, region.longitude]}
      zoom={13}
      scrollWheelZoom
      zoomControl
      attributionControl
      className="sawaari-open-map"
      aria-label="OpenStreetMap showing the selected pickup, destination, and road route."
    >
      <TileLayer
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={19}
      />
      <MapRegionEvents onRegionChange={onRegionChange} />
      <RegionSync region={region} pickup={pickup} destination={destination} />
      {pickup && <Marker position={[pickup.latitude, pickup.longitude]} icon={pinIcon('pickup')} />}
      {destination && (
        <Marker
          position={[destination.latitude, destination.longitude]}
          icon={pinIcon('destination')}
        />
      )}
      <OpenStreetMapRoute
        pickup={pickup}
        destination={destination}
        onRouteDistanceChange={onRouteDistanceChange}
      />
    </MapContainer>
  );
}

function GoogleRideMap({
  region,
  pickup,
  destination,
  onRegionChange,
  onRouteDistanceChange,
}: RideMapProps) {
  const mapElement = useRef<HTMLDivElement>(null);
  const map = useRef<google.maps.Map | null>(null);
  const markers = useRef<google.maps.Marker[]>([]);
  const routeLines = useRef<google.maps.Polyline[]>([]);
  const onRegionChangeRef = useRef(onRegionChange);
  const onRouteDistanceChangeRef = useRef(onRouteDistanceChange);
  const initialRegion = useRef(region);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    onRegionChangeRef.current = onRegionChange;
    onRouteDistanceChangeRef.current = onRouteDistanceChange;
  }, [onRegionChange, onRouteDistanceChange]);

  useEffect(() => {
    let active = true;
    let idleListener: google.maps.MapsEventListener | undefined;

    loadGoogleMaps()
      .then(async (mapsApi) => {
        await mapsApi.maps.importLibrary('maps');
        if (!active || !mapElement.current) return;
        map.current = new mapsApi.maps.Map(mapElement.current, {
          center: {
            lat: initialRegion.current.latitude,
            lng: initialRegion.current.longitude,
          },
          zoom: 13,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: true,
          clickableIcons: false,
          gestureHandling: 'greedy',
        });
        setMapReady(true);
        idleListener = map.current.addListener('idle', () => {
          const currentMap = map.current;
          const center = currentMap?.getCenter();
          const bounds = currentMap?.getBounds();
          if (!center || !bounds) return;
          const northEast = bounds.getNorthEast();
          const southWest = bounds.getSouthWest();
          onRegionChangeRef.current({
            latitude: center.lat(),
            longitude: center.lng(),
            latitudeDelta: northEast.lat() - southWest.lat(),
            longitudeDelta: northEast.lng() - southWest.lng(),
          });
        });
        setLoadError('');
      })
      .catch((error: unknown) => {
        if (!active) return;
        const message = error instanceof Error ? error.message : 'Google Maps could not load.';
        setLoadError(message);
        onRouteDistanceChangeRef.current?.(null, message);
      });

    return () => {
      active = false;
      idleListener?.remove();
      markers.current.forEach((marker) => marker.setMap(null));
      routeLines.current.forEach((line) => line.setMap(null));
      map.current = null;
    };
  }, []);

  useEffect(() => {
    if (!map.current || (pickup && destination)) return;
    map.current.setCenter({ lat: region.latitude, lng: region.longitude });
  }, [region.latitude, region.longitude, pickup, destination]);

  useEffect(() => {
    const currentMap = map.current;
    if (!currentMap || !mapReady) return;
    markers.current.forEach((marker) => marker.setMap(null));
    markers.current = [];
    routeLines.current.forEach((line) => line.setMap(null));
    routeLines.current = [];

    const pickupPosition = pickup ? { lat: pickup.latitude, lng: pickup.longitude } : null;
    const destinationPosition = destination
      ? { lat: destination.latitude, lng: destination.longitude }
      : null;
    if (pickupPosition) {
      markers.current.push(new google.maps.Marker({
        map: currentMap,
        position: pickupPosition,
        title: 'Pickup',
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: '#0E4E3D',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 3,
        },
      }));
    }
    if (destinationPosition) {
      markers.current.push(new google.maps.Marker({
        map: currentMap,
        position: destinationPosition,
        title: 'Destination',
        icon: {
          path: google.maps.SymbolPath.BACKWARD_CLOSED_ARROW,
          rotation: 45,
          scale: 7,
          fillColor: '#EF9B54',
          fillOpacity: 1,
          strokeColor: '#FFFFFF',
          strokeWeight: 2,
        },
      }));
    }

    let active = true;
    onRouteDistanceChangeRef.current?.(null);
    if (pickupPosition && destinationPosition) {
      void loadGoogleMaps()
        .then(async (mapsApi) => {
          const routes = await mapsApi.maps.importLibrary('routes') as google.maps.RoutesLibrary;
          const result = await routes.Route.computeRoutes({
            origin: pickupPosition,
            destination: destinationPosition,
            travelMode: 'DRIVING',
            region: 'pk',
            fields: ['path', 'distanceMeters', 'viewport'],
          });
          if (!active) return;
          const route = result.routes?.[0];
          if (!route || typeof route.distanceMeters !== 'number' || !route.path?.length) {
            throw new Error('Google Maps could not find a road route between these locations.');
          }
          routeLines.current = route.createPolylines({
            polylineOptions: {
              strokeColor: '#0E4E3D',
              strokeOpacity: 0.9,
              strokeWeight: 6,
              zIndex: 2,
            },
          });
          routeLines.current.forEach((line) => line.setMap(currentMap));
          if (route.viewport) currentMap.fitBounds(route.viewport, 56);
          onRouteDistanceChangeRef.current?.(route.distanceMeters / 1000);
        })
        .catch((error: unknown) => {
          if (!active) return;
          const message = error instanceof Error
            ? error.message
            : 'Could not calculate the Google Maps road route.';
          onRouteDistanceChangeRef.current?.(null, message);
        });
    }

    return () => {
      active = false;
    };
  }, [pickup, destination, mapReady]);

  return (
    <div className="sawaari-google-map-frame">
      <div
        ref={mapElement}
        className="sawaari-google-map"
        role="region"
        aria-label="Google road map showing the selected pickup and destination"
      />
      {loadError ? (
        <div className="sawaari-map-setup" role="status">
          <strong>Google Maps could not load</strong>
          <span>{loadError}</span>
          <span>Check your restricted key, enabled APIs, and Google Cloud billing setup.</span>
        </div>
      ) : null}
    </div>
  );
}

export default function RideMapLeaflet(props: RideMapProps) {
  if (GOOGLE_MAPS_WEB_KEY) return <GoogleRideMap {...props} />;
  return <OpenStreetMapRideMap {...props} />;
}
