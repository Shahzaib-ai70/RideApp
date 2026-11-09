import type { Metadata } from 'expo-router/server';

const SITE_URL = 'https://sawaari.online';

export function pageMetadata(
  title: string,
  description: string,
  path: string,
  noIndex = false,
): Metadata {
  const url = new URL(path, SITE_URL).toString();

  return {
    title,
    description,
    applicationName: 'Sawaari',
    robots: noIndex ? { index: false, follow: false } : { index: true, follow: true },
    alternates: { canonical: url },
    openGraph: {
      type: 'website',
      siteName: 'Sawaari',
      title,
      description,
      url,
    },
    twitter: {
      card: 'summary',
      title,
      description,
    },
  };
}
