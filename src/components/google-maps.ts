let googleMapsPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps() {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Maps can only be loaded in a browser.'));
  }
  if (window.google?.maps) return Promise.resolve(window.google);

  const apiKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY;
  if (!apiKey) {
    return Promise.reject(new Error(
      'Google Maps needs a restricted web API key. Add EXPO_PUBLIC_GOOGLE_MAPS_WEB_API_KEY to .env and restart Expo.',
    ));
  }

  if (!googleMapsPromise) {
    googleMapsPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const url = new URL('https://maps.googleapis.com/maps/api/js');
      url.searchParams.set('key', apiKey);
      url.searchParams.set('v', 'weekly');
      url.searchParams.set('loading', 'async');
      script.src = url.toString();
      script.async = true;
      script.onload = () => {
        if (window.google?.maps) {
          resolve(window.google);
        } else {
          googleMapsPromise = null;
          reject(new Error('Google Maps loaded without its JavaScript libraries.'));
        }
      };
      script.onerror = () => {
        googleMapsPromise = null;
        reject(new Error('Google Maps could not load. Check the web API key and network connection.'));
      };
      document.head.appendChild(script);
    });
  }

  return googleMapsPromise;
}
