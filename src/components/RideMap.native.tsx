import {
  Camera,
  GeoJSONSource,
  Layer,
  Map as MapLibreMap,
  UserLocation,
  ViewAnnotation,
} from '@maplibre/maplibre-react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { CameraRef, ViewStateChangeEvent } from '@maplibre/maplibre-react-native';
import type { MapPoint, RideMapProps } from './ride-map.types';

const GREEN = '#0B786F';
const WHITE = '#FFFFFF';
const ORANGE = '#E79A54';
const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

type MapRegion = MapPoint & { latitudeDelta: number; longitudeDelta: number };

function zoomForRegion(region: MapRegion) {
  const longitudeZoom = Math.log2(360 / Math.max(region.longitudeDelta, 0.00001));
  const latitudeZoom = Math.log2(170 / Math.max(region.latitudeDelta, 0.00001));
  return Math.max(2, Math.min(20, Math.min(longitudeZoom, latitudeZoom)));
}

function regionForViewState(view: ViewStateChangeEvent): MapRegion {
  const [west, south, east, north] = view.bounds;
  return {
    latitude: view.center[1],
    longitude: view.center[0],
    latitudeDelta: Math.max(0.001, Math.abs(north - south)),
    longitudeDelta: Math.max(0.001, Math.abs(east - west)),
  };
}

function sameRegion(left: MapRegion, right: MapRegion) {
  return Math.abs(left.latitude - right.latitude) < 0.00001
    && Math.abs(left.longitude - right.longitude) < 0.00001
    && Math.abs(left.latitudeDelta - right.latitudeDelta) < 0.00001
    && Math.abs(left.longitudeDelta - right.longitudeDelta) < 0.00001;
}

function toLngLat(point: MapPoint): [number, number] {
  return [point.longitude, point.latitude];
}

export default function RideMap({
  region,
  pickup,
  destination,
  nearbyDrivers = [],
  acceptedDriverLocation,
  acceptedDriverVehicle,
  acceptedDriverTitle = 'Your driver',
  acceptedDriverDescription = 'Live driver location',
  followAcceptedDriver = true,
  locationGranted,
  onRegionChange,
  onMapPress,
  onMarkerDragEnd,
  routeOptions = [],
  selectedRouteIndex = 0,
  onSelectRoute,
  previewPoint,
  previewPointKind = 'pickup',
}: RideMapProps) {
  const camera = useRef<CameraRef>(null);
  const lastRegion = useRef<MapRegion>(region);
  const routeData = useMemo<GeoJSON.FeatureCollection<
    GeoJSON.LineString,
    { routeIndex: number; selected: boolean }
  >>(
    () => ({
      type: 'FeatureCollection',
      features: routeOptions.flatMap((route, index) => route.path.length < 2 ? [] : [{
        type: 'Feature' as const,
        properties: { routeIndex: index, selected: index === selectedRouteIndex },
        geometry: {
          type: 'LineString' as const,
          coordinates: route.path.map((point) => [point.longitude, point.latitude] as [number, number]),
        },
      }]),
    }),
    [routeOptions, selectedRouteIndex],
  );

  const { latitude, latitudeDelta, longitude, longitudeDelta } = region;
  useEffect(() => {
    const nextRegion = { latitude, latitudeDelta, longitude, longitudeDelta };
    if (sameRegion(lastRegion.current, nextRegion)) return;
    lastRegion.current = nextRegion;
    camera.current?.flyTo({
      center: toLngLat(nextRegion),
      zoom: zoomForRegion(nextRegion),
      duration: 500,
    });
  }, [latitude, latitudeDelta, longitude, longitudeDelta]);

  const acceptedLatitude = acceptedDriverLocation?.latitude;
  const acceptedLongitude = acceptedDriverLocation?.longitude;
  useEffect(() => {
    if (acceptedLatitude === undefined || acceptedLongitude === undefined || !followAcceptedDriver) return;
    const nextRegion = {
      latitude: acceptedLatitude,
      longitude: acceptedLongitude,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    };
    lastRegion.current = nextRegion;
    camera.current?.easeTo({
      center: toLngLat(nextRegion),
      zoom: zoomForRegion(nextRegion),
      duration: 500,
    });
  }, [
    acceptedLatitude,
    acceptedLongitude,
    followAcceptedDriver,
  ]);

  return (
    <MapLibreMap
      style={StyleSheet.absoluteFill}
      mapStyle={MAP_STYLE}
      attribution
      compass
      scaleBar={false}
      onRegionDidChange={(event) => {
        const nextRegion = regionForViewState(event.nativeEvent);
        lastRegion.current = nextRegion;
        onRegionChange(nextRegion);
      }}
      onPress={onMapPress ? (event) => {
        const [longitude, latitude] = event.nativeEvent.lngLat;
        onMapPress({ latitude, longitude });
      } : undefined}
      accessibilityLabel="Map showing the selected pickup and destination."
    >
      <Camera
        ref={camera}
        initialViewState={{
          center: toLngLat(region),
          zoom: zoomForRegion(region),
        }}
      />
      {locationGranted ? <UserLocation animated minDisplacement={5} /> : null}
      <GeoJSONSource
        id="ride-routes"
        data={routeData}
        onPress={(event) => {
          event.stopPropagation();
          const route = event.nativeEvent.features.find((feature) => (
            typeof feature.properties?.routeIndex === 'number'
          ));
          const index = route?.properties?.routeIndex;
          if (typeof index === 'number') onSelectRoute?.(index);
        }}
      >
        <Layer
          id="alternate-routes"
          type="line"
          filter={['==', ['get', 'selected'], false]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': '#64828B', 'line-width': 4, 'line-opacity': 0.8 }}
        />
        <Layer
          id="selected-route"
          type="line"
          filter={['==', ['get', 'selected'], true]}
          layout={{ 'line-cap': 'round', 'line-join': 'round' }}
          paint={{ 'line-color': GREEN, 'line-width': 6, 'line-opacity': 0.95 }}
        />
      </GeoJSONSource>
      {pickup ? (
        <ViewAnnotation
          id="pickup-marker"
          lngLat={toLngLat(pickup)}
          anchor="bottom"
          draggable={Boolean(onMarkerDragEnd)}
          onDragEnd={onMarkerDragEnd ? (event) => {
            const [longitude, latitude] = event.nativeEvent.lngLat;
            onMarkerDragEnd('pickup', { latitude, longitude });
          } : undefined}
        >
          <View style={styles.pickupMarker}>
            <View style={styles.pickupMarkerDot} />
          </View>
        </ViewAnnotation>
      ) : null}
      {destination ? (
        <ViewAnnotation
          id="destination-marker"
          lngLat={toLngLat(destination)}
          anchor="bottom"
          draggable={Boolean(onMarkerDragEnd)}
          onDragEnd={onMarkerDragEnd ? (event) => {
            const [longitude, latitude] = event.nativeEvent.lngLat;
            onMarkerDragEnd('destination', { latitude, longitude });
          } : undefined}
        >
          <View style={styles.destinationMarker}>
            <Ionicons name="location" size={18} color={WHITE} />
          </View>
        </ViewAnnotation>
      ) : null}
      {previewPoint ? (
        <ViewAnnotation
          id="preview-marker"
          lngLat={toLngLat(previewPoint)}
          anchor="bottom"
        >
          <View style={[
            styles.destinationMarker,
            previewPointKind === 'pickup' && styles.previewPickupMarker,
          ]}>
            <Ionicons name="location" size={18} color={WHITE} />
          </View>
        </ViewAnnotation>
      ) : null}
      {nearbyDrivers.map((driver) => (
        <ViewAnnotation
          key={driver.driver_id}
          id={`nearby-${driver.driver_id}`}
          lngLat={toLngLat(driver)}
          anchor="center"
        >
          <View style={styles.nearbyMarker}>
            <Ionicons name={vehicleIcon(driver.vehicle)} size={15} color={WHITE} />
          </View>
        </ViewAnnotation>
      ))}
      {acceptedDriverLocation ? (
        <ViewAnnotation
          id="accepted-driver-marker"
          lngLat={toLngLat(acceptedDriverLocation)}
          anchor="center"
          title={acceptedDriverTitle}
          snippet={acceptedDriverDescription}
        >
          <View style={styles.liveDriverMarker}>
            <Ionicons name={vehicleIcon(acceptedDriverVehicle ?? '')} size={19} color={WHITE} />
          </View>
        </ViewAnnotation>
      ) : null}
    </MapLibreMap>
  );
}

function vehicleIcon(vehicle: string): keyof typeof Ionicons.glyphMap {
  if (vehicle === 'Bike') return 'bicycle';
  if (vehicle === 'Rickshaw') return 'car-outline';
  return 'car-sport';
}

const styles = StyleSheet.create({
  pickupMarker: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 5,
    borderColor: WHITE,
    backgroundColor: GREEN,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  pickupMarkerDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: WHITE },
  destinationMarker: {
    width: 32,
    height: 32,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: ORANGE,
    elevation: 4,
  },
  previewPickupMarker: { backgroundColor: GREEN },
  nearbyMarker: {
    width: 25,
    height: 25,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#537A8A',
    elevation: 3,
  },
  liveDriverMarker: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    borderColor: WHITE,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GREEN,
    elevation: 6,
  },
});
