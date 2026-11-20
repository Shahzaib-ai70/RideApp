import type { Metadata } from 'expo-router/server';
import LegalDocument from '../components/LegalDocument';
import { pageMetadata } from '../lib/seo';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Privacy Policy | Sawaari',
    'How Sawaari Pakistan handles account, ride, location, and driver application information.',
    '/privacy',
  );
}

export default function PrivacyRoute() {
  return <LegalDocument kind="privacy" />;
}
