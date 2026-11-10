import { StyleSheet, View } from 'react-native';
import DriverScreen from '../components/DriverScreen';
import DriverBottomNavigation from '../components/DriverBottomNavigation';
import { pageMetadata } from '../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Driver account | Sawaari',
    'Apply to drive, complete verification, and manage Sawaari driver rides.',
    '/driver',
    true,
  );
}

export default function DriverRoute() {
  return (
    <View style={styles.screen}>
      <View style={styles.content}>
        <DriverScreen />
      </View>
      <DriverBottomNavigation />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flex: 1, minHeight: 0 },
});
