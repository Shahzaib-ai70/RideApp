import DriverModeScreen from '../../components/DriverModeScreen';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Driver mode | Sawaari',
    'Choose driver mode and continue to Sawaari driver onboarding.',
    '/drive',
    true,
  );
}

export default function DriverModeRoute() {
  return <DriverModeScreen />;
}
