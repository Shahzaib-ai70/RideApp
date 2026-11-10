import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, View } from 'react-native';

export type VehicleType = 'Bike' | 'Rickshaw' | 'Car' | 'Premium';

const VEHICLE_ICONS: Record<VehicleType, keyof typeof Ionicons.glyphMap> = {
  Bike: 'bicycle',
  Rickshaw: 'car-outline',
  Car: 'car-sport',
  Premium: 'car-sport',
};

export default function VehicleArt({
  vehicle,
  selected = false,
  size = 42,
}: {
  vehicle: VehicleType;
  selected?: boolean;
  size?: number;
}) {
  const plateColor = selected ? '#245B8F' : '#EDF3F8';
  const iconColor = selected ? '#FFFFFF' : '#355B7B';

  return (
    <View
      accessible={false}
      style={[styles.root, { width: size, height: size }]}
    >
      <View
        style={[
          styles.depth,
          { width: size - 4, height: size - 5 },
          selected && styles.selectedDepth,
        ]}
      />
      <View
        style={[
          styles.plate,
          { width: size - 4, height: size - 5, backgroundColor: plateColor },
          selected && styles.selectedPlate,
        ]}
      >
        <View style={[styles.highlight, selected && styles.selectedHighlight]} />
        <Ionicons name={VEHICLE_ICONS[vehicle]} size={size * 0.53} color={iconColor} />
        {vehicle === 'Premium' ? (
          <View style={styles.premiumBadge}>
            <Ionicons name="sparkles" size={size * 0.18} color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  depth: {
    position: 'absolute',
    top: 4,
    left: 3,
    borderRadius: 13,
    backgroundColor: '#D5E0E9',
  },
  selectedDepth: {
    backgroundColor: '#173F67',
  },
  plate: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    shadowColor: '#173F67',
    shadowOpacity: 0.2,
    shadowRadius: 5,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  selectedPlate: {
    borderColor: '#B9D2E6',
    shadowOpacity: 0.28,
  },
  highlight: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '42%',
    backgroundColor: '#FFFFFF',
    opacity: 0.45,
  },
  selectedHighlight: {
    backgroundColor: '#8AB8DE',
    opacity: 0.5,
  },
  premiumBadge: {
    position: 'absolute',
    top: 2,
    right: 2,
    width: 12,
    height: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 6,
    backgroundColor: '#D98A3C',
  },
});
