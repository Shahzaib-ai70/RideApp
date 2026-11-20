import type { Metadata } from 'expo-router/server';
import LegalDocument from '../components/LegalDocument';
import { pageMetadata } from '../lib/seo';

export function generateMetadata(): Metadata {
  return pageMetadata(
    'Terms & Conditions | Sawaari',
    'Terms for using Sawaari Pakistan’s rider and driver services.',
    '/terms',
  );
}

export default function TermsRoute() {
  return <LegalDocument kind="terms" />;
}
