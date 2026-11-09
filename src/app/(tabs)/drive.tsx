import DriverScreen from '../../components/DriverScreen';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Drive with Sawaari | Driver applications',
    'Sign in to Sawaari and apply to drive. Driver applications are reviewed before drivers can accept ride requests.',
    '/drive',
    true,
  );
}

export default function DriverRoute() {
  return <DriverScreen />;
}
