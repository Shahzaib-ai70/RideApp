const PHOTON_SEARCH_ENDPOINT = 'https://photon.komoot.io/api/';
const PAKISTAN_SEARCH_BOUNDS = '60.87,23.69,77.84,37.10';

export async function searchPhotonLocations({ query, scope, proximity }) {
  const url = new URL(PHOTON_SEARCH_ENDPOINT);
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '10');
  url.searchParams.set('lang', 'en');
  if (scope === 'Pakistan') url.searchParams.set('bbox', PAKISTAN_SEARCH_BOUNDS);
  if (proximity) {
    url.searchParams.set('lat', String(proximity.latitude));
    url.searchParams.set('lon', String(proximity.longitude));
  }

  let response;
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/geo+json, application/json',
        'User-Agent': 'Sawaari/1.0 (+https://sawaari.online)',
      },
      signal: AbortSignal.timeout(10000),
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new Error('OpenStreetMap search timed out. Try again.');
    }
    throw new Error('OpenStreetMap search is temporarily unreachable. Try again.');
  }

  if (!response.ok) throw new Error(`OpenStreetMap search failed (${response.status}).`);
  const payload = await response.json().catch(() => null);
  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.features)) {
    throw new Error('OpenStreetMap returned an invalid search response.');
  }
  return payload;
}
