import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  StyleSheet,
  View,
} from 'react-native';
import { Pressable, Text } from './AppText';

const TABS = [
  { label: 'Ride', icon: 'navigate-outline' as const, route: '/(tabs)' as const },
  { label: 'Trips', icon: 'time-outline' as const, route: '/(tabs)/trips' as const },
  { label: 'Driver', icon: 'car-sport-outline' as const, route: null },
  { label: 'Profile', icon: 'person-outline' as const, route: '/(tabs)/profile' as const },
];

export default function DriverBottomNavigation() {
  const router = useRouter();

  return (
    <View accessibilityRole="tablist" style={styles.bar}>
      {TABS.map((tab) => {
        const selected = tab.route === null;
        const color = selected ? '#0B786F' : '#71858D';
        return (
          <Pressable
            key={tab.label}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            onPress={() => {
              if (tab.route) router.replace(tab.route);
            }}
            style={styles.tab}
          >
            <Ionicons name={tab.icon} size={21} color={color} />
            <Text style={[styles.label, selected && styles.selectedLabel]}>{tab.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 66,
    marginHorizontal: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
    borderRadius: 23,
    borderWidth: 1,
    borderColor: '#FFFFFF',
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-around',
    elevation: 12,
    shadowColor: '#10293A',
    shadowOpacity: 0.12,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: -4 },
  },
  tab: {
    flex: 1,
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  label: { color: '#71858D', fontSize: 9, fontWeight: '600' },
  selectedLabel: { color: '#0B786F' },
});
