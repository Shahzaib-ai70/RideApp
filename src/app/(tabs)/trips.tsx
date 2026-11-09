import SawaariApp from '../../components/SawaariApp';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata('Your trips | Sawaari', 'View your Sawaari trip activity.', '/trips', true);
}

export default function TripsRoute() {
  return <SawaariApp screen="Trips" />;
}
