import { createServer } from 'node:http';
import { searchTomTomLocations } from './tomtom-search.mjs';

const PORT = Number(process.env.MAP_SEARCH_DEV_PORT ?? 3211);
const MAX_BODY_BYTES = 16 * 1024;
const allowedOrigin = /^https?:\/\/(localhost|127\.0\.0\.1):\d+$/;

function sendJson(response, status, value, origin = '') {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...(origin && allowedOrigin.test(origin) ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      Vary: 'Origin',
    } : {}),
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Search request is too large.'), { status: 413 });
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Search request is invalid.'), { status: 400 });
  }
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin ?? '';
  if (request.method === 'OPTIONS') {
    sendJson(response, 204, {}, origin);
    return;
  }

  const url = new URL(request.url ?? '/', `http://localhost:${PORT}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { status: 'ok' });
    return;
  }
  if (request.method !== 'POST' || url.pathname !== '/api/maps/location-search') {
    sendJson(response, 404, { error: 'Not found.' }, origin);
    return;
  }
  if (origin && !allowedOrigin.test(origin)) {
    sendJson(response, 403, { error: 'Origin not allowed.' });
    return;
  }

  try {
    const body = await readJson(request);
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (query.length < 3 || query.length > 200
      || !['Pakistan', 'Worldwide'].includes(body.scope)
      || (body.proximity !== null && body.proximity !== undefined
        && (typeof body.proximity.latitude !== 'number'
          || typeof body.proximity.longitude !== 'number'))) {
      throw Object.assign(new Error('Enter a search of 3 to 200 characters.'), { status: 400 });
    }
    const suggestions = await searchTomTomLocations({
      query,
      proximity: body.proximity,
      scope: body.scope,
      apiKey: process.env.TOMTOM_API_KEY_SERVER,
    });
    sendJson(response, 200, { suggestions }, origin);
  } catch (error) {
    sendJson(response, Number.isInteger(error?.status) ? error.status : 502, {
      error: error instanceof Error ? error.message : 'Location search failed.',
    }, origin);
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Local map search proxy listening on http://127.0.0.1:${PORT}`);
});

server.on('error', (error) => {
  console.error('Local map search proxy failed:', error);
  process.exitCode = 1;
});
