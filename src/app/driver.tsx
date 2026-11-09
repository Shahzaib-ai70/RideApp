import DriverScreen from '../components/DriverScreen';
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
  return <DriverScreen />;
}
