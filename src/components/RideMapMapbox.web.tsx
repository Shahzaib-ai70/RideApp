import { useEffect, useRef, useState } from 'react';
import mapboxgl from 'mapbox-gl';
import type { RideMapProps } from './ride-map.types';
import 'mapbox-gl/dist/mapbox-gl.css';
import './ride-map.web.css';

const ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN ?? '';
const ROUTE_SOURCE_ID = 'sawaari-route-source';
const ALTERNATE_ROUTE_LAYER_ID = 'sawaari-alternate-routes';
const SELECTED_ROUTE_LAYER_ID = 'sawaari-selected-route';

function mapStyle(type: RideMapProps['mapType']) {
  switch (type) {
    case 'satellite':
    case 'hybrid':
      return 'mapbox://styles/mapbox/satellite-streets-v12';
    case 'terrain':
      return 'mapbox://styles/mapbox/outdoors-v12';
    default:
      return 'mapbox://styles/mapbox/streets-v12';
  }
}

function makePin(kind: 'pickup' | 'destination' | 'preview', previewKind: 'pickup' | 'destination' = 'pickup') {
  const element = document.createElement('div');
  element.className = `sawaari-mapbox-pin sawaari-mapbox-pin-${kind}${
    kind === 'preview' ? ` sawaari-mapbox-pin-preview-${previewKind}` : ''
  }`;
  element.setAttribute('aria-label', kind === 'pickup'
    ? 'Pickup location'
    : kind === 'destination' ? 'Destination location' : 'Selected map point');
  if (kind === 'pickup') {
    element.innerHTML = '<span></span>';
  } else {
    element.textContent = '';
  }
  return element;
}

function vehicleGlyph(vehicle: string) {
  if (vehicle === 'Bike') return '🏍️';
  if (vehicle === 'Rickshaw') return '🛺';
  if (vehicle === 'Premium') return '🚙';
  return '🚗';
}

function makeDriverMarker(accepted: boolean, vehicle: string) {
  const element = document.createElement('div');
  element.className = `sawaari-mapbox-driver${accepted ? ' sawaari-mapbox-driver-accepted' : ''}`;
  element.textContent = vehicleGlyph(vehicle);
  return element;
}

function ensureRouteLayers(map: mapboxgl.Map) {
  if (!map.getSource(ROUTE_SOURCE_ID)) {
    map.addSource(ROUTE_SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }
  if (!map.getLayer(ALTERNATE_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: ALTERNATE_ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['!=', ['get', 'selected'], true],
      paint: {
        'line-color': '#64828B',
        'line-width': 4,
        'line-opacity': 0.6,
      },
    });
  }
  if (!map.getLayer(SELECTED_ROUTE_LAYER_ID)) {
    map.addLayer({
      id: SELECTED_ROUTE_LAYER_ID,
      type: 'line',
      source: ROUTE_SOURCE_ID,
      filter: ['==', ['get', 'selected'], true],
      paint: {
        'line-color': '#0B786F',
        'line-width': 6,
        'line-opacity': 0.95,
      },
    });
  }
}

function routeFeatureCollection(
  routeOptions: NonNullable<RideMapProps['routeOptions']>,
  selectedRouteIndex: number,
): GeoJSON.FeatureCollection<GeoJSON.LineString> {
  return {
    type: 'FeatureCollection',
    features: routeOptions.flatMap((route, index) => {
      if (route.path.length < 2) return [];
      return [{
        type: 'Feature' as const,
        properties: { selected: index === selectedRouteIndex },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.path.map((point) => [point.longitude, point.latitude]),
        },
      }];
    }),
  };
}

function SetupMessage() {
  return (
    <div className="sawaari-map-setup" role="status">
      <strong>Mapbox map token required</strong>
      <span>
        Add your URL-restricted public token as
        {' '}<code>EXPO_PUBLIC_MAPBOX_ACCESS_TOKEN</code> in
        {' '}<code>.env</code>, then restart the web app.
      </span>
      <a href="https://account.mapbox.com/access-tokens/" target="_blank" rel="noreferrer">
        Get a Mapbox access token
      </a>
    </div>
  );
}

export default function RideMapMapbox(props: RideMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const pickupMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const destinationMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const previewMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const nearbyMarkersRef = useRef(new Map<string, mapboxgl.Marker>());
  const acceptedMarkerRef = useRef<mapboxgl.Marker | null>(null);
  const driverAnimationRef = useRef<number | null>(null);
  const propsRef = useRef(props);
  const currentMapTypeRef = useRef(props.mapType);
  const styleLoadedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [mapWarning, setMapWarning] = useState('');
  const pickupKey = props.pickup
    ? `${props.pickup.latitude},${props.pickup.longitude}` : '';
  const destinationKey = props.destination
    ? `${props.destination.latitude},${props.destination.longitude}` : '';
  const previewKey = props.previewPoint
    ? `${props.previewPoint.latitude},${props.previewPoint.longitude}:${props.previewPointKind}` : '';
  const acceptedDriverKey = props.acceptedDriverLocation
    ? `${props.acceptedDriverLocation.latitude},${props.acceptedDriverLocation.longitude}` : '';
  const canDragMarkers = Boolean(props.onMarkerDragEnd);
  const hasPickup = Boolean(props.pickup);
  const hasDestination = Boolean(props.destination);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);

  useEffect(() => {
    if (!ACCESS_TOKEN || !containerRef.current) return undefined;
    const initialProps = propsRef.current;
    mapboxgl.accessToken = ACCESS_TOKEN;
    const map = new mapboxgl.Map({
      accessToken: ACCESS_TOKEN,
      container: containerRef.current,
      style: mapStyle(initialProps.mapType),
      center: [initialProps.region.longitude, initialProps.region.latitude],
      zoom: 13,
      attributionControl: true,
      cooperativeGestures: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new mapboxgl.FullscreenControl(), 'top-left');

    let resizeFrame: number | null = null;
    const resizeMap = () => {
      resizeFrame = null;
      const container = containerRef.current;
      if (container?.clientWidth && container.clientHeight) map.resize();
    };
    const scheduleResize = () => {
      if (resizeFrame === null) resizeFrame = window.requestAnimationFrame(resizeMap);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(scheduleResize);
    if (containerRef.current) resizeObserver?.observe(containerRef.current);
    window.addEventListener('resize', scheduleResize);
    scheduleResize();

    const handleLoad = () => {
      ensureRouteLayers(map);
      styleLoadedRef.current = true;
      setLoadError('');
      setMapWarning('');
      setMapReady(true);
      scheduleResize();
    };
    const handleStyleLoad = () => {
      ensureRouteLayers(map);
      styleLoadedRef.current = true;
      setLoadError('');
      setMapWarning('');
      setMapReady(true);
      scheduleResize();
    };
    const handleMoveEnd = () => {
      const center = map.getCenter();
      const bounds = map.getBounds();
      if (!bounds) return;
      propsRef.current.onRegionChange({
        latitude: center.lat,
        longitude: center.lng,
        latitudeDelta: bounds.getNorth() - bounds.getSouth(),
        longitudeDelta: bounds.getEast() - bounds.getWest(),
      });
    };
    const handleClick = (event: mapboxgl.MapMouseEvent) => {
      propsRef.current.onMapPress?.({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
    };
    const handleError = (event: mapboxgl.ErrorEvent) => {
      const message = event.error.message || 'Mapbox could not load map resources.';
      if (!styleLoadedRef.current) {
        setLoadError(message);
      } else {
        setMapWarning('Some map details could not load. Check your connection, token restrictions, and Mapbox usage limits.');
      }
    };
    map.on('load', handleLoad);
    map.on('style.load', handleStyleLoad);
    map.on('moveend', handleMoveEnd);
    map.on('click', handleClick);
    map.on('error', handleError);

    const nearbyMarkers = nearbyMarkersRef.current;
    return () => {
      map.off('load', handleLoad);
      map.off('style.load', handleStyleLoad);
      map.off('moveend', handleMoveEnd);
      map.off('click', handleClick);
      map.off('error', handleError);
      resizeObserver?.disconnect();
      window.removeEventListener('resize', scheduleResize);
      if (resizeFrame !== null) window.cancelAnimationFrame(resizeFrame);
      if (driverAnimationRef.current !== null) cancelAnimationFrame(driverAnimationRef.current);
      pickupMarkerRef.current?.remove();
      destinationMarkerRef.current?.remove();
      previewMarkerRef.current?.remove();
      nearbyMarkers.forEach((marker) => marker.remove());
      acceptedMarkerRef.current?.remove();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || currentMapTypeRef.current === props.mapType) return;
    currentMapTypeRef.current = props.mapType;
    styleLoadedRef.current = false;
    setMapWarning('');
    map.setStyle(mapStyle(props.mapType));
    map.once('style.load', () => {
      ensureRouteLayers(map);
      const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(routeFeatureCollection(props.routeOptions ?? [], props.selectedRouteIndex ?? 0));
    });
  }, [mapReady, props.mapType, props.routeOptions, props.selectedRouteIndex]);

  useEffect(() => {
    const map = mapRef.current;
    const currentProps = propsRef.current;
    if (!map || !mapReady || !currentProps.pickup || !currentProps.destination) return;
    const bounds = new mapboxgl.LngLatBounds(
      [currentProps.pickup.longitude, currentProps.pickup.latitude],
      [currentProps.destination.longitude, currentProps.destination.latitude],
    );
    map.fitBounds(bounds, { padding: 64, maxZoom: 15, duration: 450 });
  }, [destinationKey, mapReady, pickupKey]);

  useEffect(() => {
    const map = mapRef.current;
    const currentProps = propsRef.current;
    if (!map || !mapReady || (currentProps.pickup && currentProps.destination)) return;
    const center = map.getCenter();
    if (Math.abs(center.lat - currentProps.region.latitude) > 0.00001
      || Math.abs(center.lng - currentProps.region.longitude) > 0.00001) {
      map.easeTo({
        center: [currentProps.region.longitude, currentProps.region.latitude],
        duration: 300,
      });
    }
  }, [
    mapReady,
    hasDestination,
    hasPickup,
    props.region.latitude,
    props.region.longitude,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const currentProps = propsRef.current;
    pickupMarkerRef.current?.remove();
    pickupMarkerRef.current = null;
    if (currentProps.pickup) {
      const marker = new mapboxgl.Marker({
        element: makePin('pickup'),
        anchor: 'center',
        draggable: canDragMarkers,
      }).setLngLat([currentProps.pickup.longitude, currentProps.pickup.latitude]).addTo(map);
      marker.on('dragend', () => {
        const point = marker.getLngLat();
        propsRef.current.onMarkerDragEnd?.('pickup', {
          latitude: point.lat,
          longitude: point.lng,
        });
      });
      pickupMarkerRef.current = marker;
    }

    destinationMarkerRef.current?.remove();
    destinationMarkerRef.current = null;
    if (currentProps.destination) {
      const marker = new mapboxgl.Marker({
        element: makePin('destination'),
        anchor: 'bottom',
        draggable: canDragMarkers,
      }).setLngLat([currentProps.destination.longitude, currentProps.destination.latitude]).addTo(map);
      marker.on('dragend', () => {
        const point = marker.getLngLat();
        propsRef.current.onMarkerDragEnd?.('destination', {
          latitude: point.lat,
          longitude: point.lng,
        });
      });
      destinationMarkerRef.current = marker;
    }
  }, [canDragMarkers, destinationKey, mapReady, pickupKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const currentProps = propsRef.current;
    previewMarkerRef.current?.remove();
    previewMarkerRef.current = null;
    if (currentProps.previewPoint) {
      previewMarkerRef.current = new mapboxgl.Marker({
        element: makePin('preview', currentProps.previewPointKind),
        anchor: 'bottom',
      }).setLngLat([currentProps.previewPoint.longitude, currentProps.previewPoint.latitude]).addTo(map);
    }
  }, [mapReady, previewKey]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const visibleDrivers = new Set(props.nearbyDrivers?.map((driver) => driver.driver_id) ?? []);
    nearbyMarkersRef.current.forEach((marker, id) => {
      if (!visibleDrivers.has(id)) {
        marker.remove();
        nearbyMarkersRef.current.delete(id);
      }
    });
    props.nearbyDrivers?.forEach((driver) => {
      let marker = nearbyMarkersRef.current.get(driver.driver_id);
      if (!marker) {
        marker = new mapboxgl.Marker({
          element: makeDriverMarker(false, driver.vehicle),
          anchor: 'center',
        }).addTo(map);
        nearbyMarkersRef.current.set(driver.driver_id, marker);
      }
      marker.setLngLat([driver.longitude, driver.latitude]);
    });
  }, [mapReady, props.nearbyDrivers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const location = props.acceptedDriverLocation;
    if (!location) {
      acceptedMarkerRef.current?.remove();
      acceptedMarkerRef.current = null;
      if (driverAnimationRef.current !== null) cancelAnimationFrame(driverAnimationRef.current);
      driverAnimationRef.current = null;
      return;
    }
    if (!acceptedMarkerRef.current) {
      acceptedMarkerRef.current = new mapboxgl.Marker({
        element: makeDriverMarker(true, props.acceptedDriverVehicle ?? ''),
        anchor: 'center',
      }).setLngLat([location.longitude, location.latitude]).addTo(map);
      return;
    }
    if (driverAnimationRef.current !== null) cancelAnimationFrame(driverAnimationRef.current);
    const marker = acceptedMarkerRef.current;
    const start = marker.getLngLat();
    const startTime = performance.now();
    const duration = 550;
    const targetLongitude = location.longitude;
    const targetLatitude = location.latitude;
    const animate = (now: number) => {
      const progress = Math.min(1, (now - startTime) / duration);
      const eased = 1 - (1 - progress) ** 3;
      marker.setLngLat([
        start.lng + (targetLongitude - start.lng) * eased,
        start.lat + (targetLatitude - start.lat) * eased,
      ]);
      if (progress < 1) driverAnimationRef.current = requestAnimationFrame(animate);
      else driverAnimationRef.current = null;
    };
    driverAnimationRef.current = requestAnimationFrame(animate);
    if (props.followAcceptedDriver
      && !map.getBounds()?.contains([targetLongitude, targetLatitude])) {
      map.easeTo({ center: [targetLongitude, targetLatitude], duration: 450 });
    }
  }, [
    acceptedDriverKey,
    mapReady,
    props.acceptedDriverLocation,
    props.acceptedDriverVehicle,
    props.followAcceptedDriver,
  ]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const updateRoutes = () => {
      if (!map.getSource(ROUTE_SOURCE_ID)) ensureRouteLayers(map);
      const source = map.getSource(ROUTE_SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
      source?.setData(routeFeatureCollection(props.routeOptions ?? [], props.selectedRouteIndex ?? 0));
    };
    if (map.isStyleLoaded()) updateRoutes();
    else map.once('style.load', updateRoutes);
    return () => {
      map.off('style.load', updateRoutes);
    };
  }, [mapReady, props.routeOptions, props.selectedRouteIndex]);

  if (!ACCESS_TOKEN) return <SetupMessage />;
  return (
    <div className="sawaari-mapbox-frame">
      <div
        ref={containerRef}
        className="sawaari-mapbox-canvas"
        role="region"
        aria-label="Interactive Mapbox street map showing pickup, destination, and driver locations"
      />
      {mapWarning ? (
        <div className="sawaari-mapbox-warning" role="status">{mapWarning}</div>
      ) : null}
      {loadError ? (
        <div className="sawaari-mapbox-error" role="alert">
          <strong>Mapbox could not load</strong>
          <span>{loadError}</span>
          <span>Check token URL restrictions and your Mapbox account usage limits.</span>
        </div>
      ) : null}
    </div>
  );
}
