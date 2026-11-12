import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { RideMapProps } from './ride-map.types';

type BrowserRideMap = ComponentType<RideMapProps>;

const mapServiceHosts = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY
  ? ['https://maps.googleapis.com', 'https://maps.gstatic.com']
  : [
    'https://tile.openstreetmap.org',
    'https://photon.komoot.io',
    'https://router.project-osrm.org',
  ];

if (typeof document !== 'undefined') {
  const connectedHosts = new Set(
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="preconnect"]'))
      .map((link) => link.href),
  );
  mapServiceHosts.forEach((host) => {
    if (connectedHosts.has(host)) return;
    const link = document.createElement('link');
    link.rel = 'preconnect';
    link.href = host;
    link.crossOrigin = 'anonymous';
    document.head.appendChild(link);
  });
}

const browserMapPromise = typeof window === 'undefined'
  ? null
  : import('./RideMapLeaflet.web').then(({ default: LoadedMap }) => LoadedMap);

export default function RideMap(props: RideMapProps) {
  const [BrowserMap, setBrowserMap] = useState<BrowserRideMap | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;

    (browserMapPromise ?? import('./RideMapLeaflet.web').then(({ default: LoadedMap }) => LoadedMap))
      .then((LoadedMap) => {
        if (active) setBrowserMap(() => LoadedMap);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(error instanceof Error ? error.message : 'The map failed to load.');
      });

    return () => {
      active = false;
    };
  }, []);

  if (BrowserMap) return <BrowserMap {...props} />;

  return (
    <div
      role={loadError ? 'alert' : 'status'}
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        width: '100%',
        height: '100%',
        minHeight: 220,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: '#dce9e5',
        color: '#12273a',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        textAlign: 'center',
      }}
    >
      {loadError ? `The map could not load: ${loadError}` : 'Loading map...'}
    </div>
  );
}

void browserMapPromise?.catch(() => undefined);
