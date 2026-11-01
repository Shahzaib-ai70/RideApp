import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { RideMapProps } from './ride-map.types';

const GREEN = '#0E4E3D';
const WHITE = '#FFFFFF';
const ORANGE = '#EF9B54';

export default function RideMap({
  region,
  pickup,
  destination,
  locationGranted,
  onRegionChange,
}: RideMapProps) {
  return (
    <MapView
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
    </MapView>
  );
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
});
