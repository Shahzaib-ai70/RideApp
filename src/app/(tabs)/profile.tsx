import SawaariApp from '../../components/SawaariApp';
import { pageMetadata } from '../../lib/seo';
import type { Metadata } from 'expo-router/server';

export function generateMetadata(): Metadata {
  return pageMetadata('Your profile | Sawaari', 'Manage your Sawaari account and preferences.', '/profile', true);
}

export default function ProfileRoute() {
  return <SawaariApp screen="Profile" />;
}
