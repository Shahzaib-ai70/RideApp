import { useEffect, useState } from 'react';
import type { ComponentType } from 'react';
import type { RideMapProps } from './ride-map.types';

type BrowserRideMap = ComponentType<RideMapProps>;

export default function RideMap(props: RideMapProps) {
  const [BrowserMap, setBrowserMap] = useState<BrowserRideMap | null>(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    let active = true;

    import('./RideMapLeaflet.web')
      .then(({ default: LoadedMap }) => {
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
        background: '#e4ecdf',
        color: '#172621',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 14,
        textAlign: 'center',
      }}
    >
      {loadError ? `The map could not load: ${loadError}` : 'Loading map...'}
    </div>
  );
}
