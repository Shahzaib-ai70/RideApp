const TOMTOM_SEARCH_ENDPOINT = 'https://api.tomtom.com/search/2/search';

function validPoint(point) {
  return typeof point === 'object'
    && point !== null
    && Number.isFinite(point.latitude)
    && point.latitude >= -90
    && point.latitude <= 90
    && Number.isFinite(point.longitude)
    && point.longitude >= -180
    && point.longitude <= 180;
}

function uniqueParts(parts) {
  return [...new Set(parts.filter((part) => typeof part === 'string' && part.trim())
    .map((part) => part.trim()))];
}

function placeAddress(address) {
  const city = address.municipalitySubdivision || address.municipality;
  return uniqueParts([
    address.streetNumber && address.streetName
      ? `${address.streetNumber} ${address.streetName}`
      : address.streetName,
    city,
    address.countrySubdivisionName || address.countrySubdivision,
    address.country,
  ]).join(', ');
}

export async function searchTomTomLocations({
  query,
  proximity,
  scope,
  apiKey,
  signal,
}) {
  if (!apiKey) throw new Error('TomTom Search is not configured on the API server.');
  const url = new URL(`${TOMTOM_SEARCH_ENDPOINT}/${encodeURIComponent(query)}.json`);
  url.searchParams.set('key', apiKey);
  url.searchParams.set('limit', '8');
  url.searchParams.set('language', 'en-US');
  url.searchParams.set('typeahead', 'true');
  url.searchParams.set('idxSet', 'POI,Addr');
  if (scope === 'Pakistan') url.searchParams.set('countrySet', 'PK');
  if (validPoint(proximity)) {
    url.searchParams.set('lat', String(proximity.latitude));
    url.searchParams.set('lon', String(proximity.longitude));
    url.searchParams.set('radius', '50000');
  }

  let response;
  try {
    response = await fetch(url, { signal: signal ?? AbortSignal.timeout(10000) });
  } catch (error) {
    if (error?.name === 'TimeoutError') throw new Error('TomTom Search timed out. Try again.');
    throw new Error('TomTom Search is temporarily unreachable. Try again.');
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error('TomTom Search rejected its API key. Check the server configuration.');
    }
    if (response.status === 429) throw new Error('TomTom Search is rate-limited. Try again shortly.');
    throw new Error(`TomTom Search could not complete this request (${response.status}).`);
  }
  if (typeof payload !== 'object' || payload === null || !Array.isArray(payload.results)) {
    throw new Error('TomTom Search returned an invalid response.');
  }

  return payload.results.flatMap((result) => {
    if (typeof result !== 'object' || result === null
      || typeof result.id !== 'string'
      || !validPoint({
        latitude: result.position?.lat,
        longitude: result.position?.lon,
      })
      || !['POI', 'Point Address', 'Address Range', 'Street', 'Cross Street'].includes(result.type)
      || (scope === 'Pakistan' && result.address?.countryCode !== 'PK')
      || typeof result.score !== 'number' || result.score < 2) return [];

    const point = {
      latitude: result.position.lat,
      longitude: result.position.lon,
    };
    const label = typeof result.poi?.name === 'string' && result.poi.name.trim()
      ? result.poi.name.trim()
      : placeAddress(result.address ?? {});
    if (!label) return [];
    const detail = placeAddress(result.address ?? {});
    const approximate = ['Address Range', 'Street', 'Cross Street'].includes(result.type);
    return [{
      id: result.id,
      label,
      detail: detail || 'Address details unavailable',
      point,
      resultType: result.type,
      approximate,
      score: result.score,
      source: 'tomtom',
    }];
  });
}
