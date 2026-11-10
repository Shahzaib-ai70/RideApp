import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import type { RideMapProps } from './ride-map.types';
import VehicleSilhouette from './VehicleSilhouette';
import type { VehicleType } from './VehicleSilhouette';

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
      region={region}
      onRegionChangeComplete={onRegionChange}
      showsUserLocation={locationGranted}
      showsMyLocationButton={false}
      toolbarEnabled={false}
      accessibilityLabel="Map showing the selected pickup and destination."
    >
      {pickup && (
        <Marker coordinate={pickup} title="Pickup">
          <View style={styles.pickupMarker}>
            <View style={styles.pickupMarkerDot} />
          </View>
        </Marker>
      )}
      {destination && (
        <Marker coordinate={destination} title="Destination">
          <View style={styles.destinationMarker}>
            <Ionicons name="location" size={18} color={WHITE} />
          </View>
        </Marker>
      )}
      {nearbyDrivers.map((driver) => (
        <Marker
          key={driver.driver_id}
          coordinate={{ latitude: driver.latitude, longitude: driver.longitude }}
          title={`Nearby ${driver.vehicle}`}
        >
          <View style={styles.nearbyMarker}>
            <VehicleSilhouette vehicle={vehicleType(driver.vehicle)} width={20} height={30} />
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
            <VehicleSilhouette
              vehicle={vehicleType(acceptedDriverVehicle ?? '')}
              width={25}
              height={36}
            />
          </View>
        </Marker>
      ) : null}
    </MapView>
  );
}

function vehicleType(vehicle: string): VehicleType {
  if (vehicle === 'Bike' || vehicle === 'Rickshaw' || vehicle === 'Premium') return vehicle;
  return 'Car';
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
