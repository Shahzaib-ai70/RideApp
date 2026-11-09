import SawaariApp from '../../components/SawaariApp';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Sawaari Pakistan | Book rides and drive on your terms',
    'Book rides in Pakistan, choose your fare, and explore local trips with Sawaari. Drivers can apply to offer rides through one platform.',
    '/',
  );
}

export default function RideRoute() {
  return <SawaariApp screen="Ride" />;
}
