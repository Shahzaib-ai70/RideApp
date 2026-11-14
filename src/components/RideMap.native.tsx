import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import type { MapPoint, RideMapProps } from './ride-map.types';

const GREEN = '#0B786F';
const WHITE = '#FFFFFF';
const ORANGE = '#E79A54';

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
  mapType = 'standard',
  previewPoint,
  previewPointKind = 'pickup',
}: RideMapProps) {
  const map = useRef<MapView>(null);

  useEffect(() => {
    if (!acceptedDriverLocation || !followAcceptedDriver) return;
    map.current?.animateToRegion({
      ...acceptedDriverLocation,
      latitudeDelta: 0.02,
      longitudeDelta: 0.02,
    }, 500);
  }, [acceptedDriverLocation, followAcceptedDriver]);

  return (
    <MapView
      ref={map}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_GOOGLE}
      mapType={mapType}
      region={region}
      onRegionChangeComplete={onRegionChange}
      onPress={onMapPress ? (event: { nativeEvent: { coordinate: MapPoint } }) => {
        onMapPress(event.nativeEvent.coordinate);
      } : undefined}
      showsUserLocation={locationGranted}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      accessibilityLabel="Map showing the selected pickup and destination."
    >
      {routeOptions.map((route, index) => (
        <Polyline
          key={`route-${index}`}
          coordinates={route.path}
          strokeColor={index === selectedRouteIndex ? GREEN : '#64828B'}
          strokeWidth={index === selectedRouteIndex ? 6 : 4}
          zIndex={index === selectedRouteIndex ? 2 : 1}
          tappable={Boolean(onSelectRoute)}
          onPress={() => onSelectRoute?.(index)}
        />
      ))}
      {pickup && (
        <Marker
          coordinate={pickup}
          title="Pickup"
          draggable={Boolean(onMarkerDragEnd)}
          onDragEnd={onMarkerDragEnd ? (event) => {
            onMarkerDragEnd('pickup', event.nativeEvent.coordinate);
          } : undefined}
        >
          <View style={styles.pickupMarker}>
            <View style={styles.pickupMarkerDot} />
          </View>
        </Marker>
      )}
      {destination && (
        <Marker
          coordinate={destination}
          title="Destination"
          draggable={Boolean(onMarkerDragEnd)}
          onDragEnd={onMarkerDragEnd ? (event) => {
            onMarkerDragEnd('destination', event.nativeEvent.coordinate);
          } : undefined}
        >
          <View style={styles.destinationMarker}>
            <Ionicons name="location" size={18} color={WHITE} />
          </View>
        </Marker>
      )}
      {previewPoint && (
        <Marker
          coordinate={previewPoint}
          title={`Selected ${previewPointKind}`}
          pinColor={previewPointKind === 'destination' ? ORANGE : GREEN}
        />
      )}
      {nearbyDrivers.map((driver) => (
        <Marker
          key={driver.driver_id}
          coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
          title={`Nearby ${driver.vehicle}`}
        >
          <View style={styles.nearbyMarker}>
            <Ionicons name={vehicleIcon(driver.vehicle)} size={15} color={WHITE} />
          </View>
        </Marker>
      ))}
      {acceptedDriverLocation ? (
        <Marker
          coordinate={acceptedDriverLocation}
          title={acceptedDriverTitle}
          description={acceptedDriverDescription}
        >
          <View style={styles.liveDriverMarker}>
            <Ionicons name={vehicleIcon(acceptedDriverVehicle ?? '')} size={19} color={WHITE} />
          </View>
        </Marker>
      ) : null}
    </MapView>
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
    backgroundColor: '#0B786F',
    elevation: 6,
  },
});
