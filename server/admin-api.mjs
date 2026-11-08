import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.ADMIN_API_PORT ?? 3210);
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const MAX_BODY_BYTES = 16 * 1024;
const attempts = new Map();

const config = {
  username: process.env.ADMIN_USERNAME ?? '',
  passwordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  sessionSecret: process.env.ADMIN_SESSION_SECRET ?? '',
  supabaseUrl: (process.env.SUPABASE_URL ?? '').replace(/\/+$/, ''),
  serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
  origin: process.env.ADMIN_ORIGIN ?? 'https://sawaari.online',
};

if (!config.username || !config.passwordHash || !config.sessionSecret
  || !config.supabaseUrl || !config.serviceRoleKey) {
  throw new Error('Admin API configuration is incomplete. Set the required VPS environment variables.');
}
if (config.sessionSecret.length < 32) {
  throw new Error('ADMIN_SESSION_SECRET must contain at least 32 characters.');
}

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    ...headers,
  });
  response.end(JSON.stringify(value));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_BODY_BYTES) {
      throw Object.assign(new Error('Request body is too large.'), { status: 413 });
    }
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw Object.assign(new Error('Invalid JSON request body.'), { status: 400 });
  }
}

function sign(value) {
  return createHmac('sha256', config.sessionSecret).update(value).digest('base64url');
}

function makeSessionToken() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    nonce: randomBytes(16).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

function hasSession(request) {
  const cookies = request.headers.cookie ?? '';
  const match = cookies.match(/(?:^|;\s*)sawaari_admin=([^;]+)/);
  if (!match) return false;
  const [payload, signature, extra] = match[1].split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(sign(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

function cookie(token, maxAge) {
  return `sawaari_admin=${token}; HttpOnly; Secure; SameSite=Strict; Path=/api/admin; Max-Age=${maxAge}`;
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  if (origin === config.origin) return true;
  return process.env.NODE_ENV !== 'production'
    && (origin === 'http://localhost:8081' || origin === 'http://127.0.0.1:8081');
}

async function verifyPassword(password) {
  if (password.length > 1024) return false;
  const [algorithm, salt, digest, extra] = config.passwordHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !digest || extra) return false;
  const expected = Buffer.from(digest, 'base64url');
  if (expected.length !== 64) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), 64);
  return timingSafeEqual(expected, actual);
}

function rateLimit(request) {
  const now = Date.now();
  const ip = request.socket.remoteAddress ?? 'unknown';
  const state = attempts.get(ip) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (state.resetAt <= now) {
    state.count = 0;
    state.resetAt = now + 15 * 60 * 1000;
  }
  state.count += 1;
  attempts.set(ip, state);
  if (attempts.size > 10000) {
    for (const [key, value] of attempts) {
      if (value.resetAt <= now) attempts.delete(key);
    }
  }
  return state.count <= 10;
}

async function supabaseRequest(path, body) {
  const response = await fetch(`${config.supabaseUrl}${path}`, {
    method: 'POST',
    headers: {
      apikey: config.serviceRoleKey,
      Authorization: `Bearer ${config.serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data.message === 'string'
      ? data.message
      : 'The database request failed.';
    throw Object.assign(new Error(message), { status: response.status >= 500 ? 502 : 400 });
  }
  return data;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (!url.pathname.startsWith('/api/admin/')) {
      sendJson(response, 404, { error: 'Not found.' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/session') {
      sendJson(response, 200, { authenticated: hasSession(request) });
      return;
    }

    if (request.method === 'POST' && !originAllowed(request)) {
      sendJson(response, 403, { error: 'Request origin is not allowed.' });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/login') {
      if (!rateLimit(request)) {
        sendJson(response, 429, { error: 'Too many sign-in attempts. Try again in 15 minutes.' });
        return;
      }
      const body = await readJson(request);
      const username = typeof body.username === 'string' ? body.username.trim() : '';
      const password = typeof body.password === 'string' ? body.password : '';
      const usernameMatches = Buffer.from(username.toLowerCase())
        .equals(Buffer.from(config.username.toLowerCase()));
      const passwordMatches = await verifyPassword(password);
      if (!usernameMatches || !passwordMatches) {
        sendJson(response, 401, { error: 'Invalid admin username or password.' });
        return;
      }
      sendJson(response, 200, { authenticated: true }, {
        'Set-Cookie': cookie(makeSessionToken(), SESSION_TTL_SECONDS),
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/logout') {
      sendJson(response, 200, { authenticated: false }, { 'Set-Cookie': cookie('', 0) });
      return;
    }

    if (!hasSession(request)) {
      sendJson(response, 401, { error: 'Admin sign-in is required.' });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/dashboard') {
      sendJson(response, 200, await supabaseRequest('/rest/v1/rpc/get_admin_dashboard_data', {}));
      return;
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/review-queue') {
      sendJson(response, 200, await supabaseRequest('/rest/v1/rpc/get_driver_review_queue', {}));
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/review') {
      const body = await readJson(request);
      if (!isUuid(body.applicationId)
        || !['approved', 'needs_changes', 'rejected'].includes(body.decision)
        || typeof body.note !== 'string'
        || body.note.length > 1000
        || (body.decision !== 'approved' && body.note.trim().length < 5)) {
        sendJson(response, 400, { error: 'Invalid review decision or feedback.' });
        return;
      }
      await supabaseRequest('/rest/v1/rpc/review_driver_application_for_vps', {
        p_application_id: body.applicationId,
        p_decision: body.decision,
        p_review_note: body.note,
      });
      sendJson(response, 200, { success: true });
      return;
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/document-url') {
      const body = await readJson(request);
      if (typeof body.path !== 'string' || body.path.length > 512
        || body.path.startsWith('/') || body.path.split('/').some((part) => !part || part === '.' || part === '..')) {
        sendJson(response, 400, { error: 'Invalid document path.' });
        return;
      }
      const objectPath = body.path.split('/').map(encodeURIComponent).join('/');
      const responseFromStorage = await fetch(
        `${config.supabaseUrl}/storage/v1/object/sign/sawaari-driver-documents/${objectPath}`,
        {
          method: 'POST',
          headers: {
            apikey: config.serviceRoleKey,
            Authorization: `Bearer ${config.serviceRoleKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ expiresIn: 120 }),
          signal: AbortSignal.timeout(15000),
        },
      );
      const data = await responseFromStorage.json().catch(() => null);
      if (!responseFromStorage.ok || typeof data?.signedURL !== 'string') {
        throw Object.assign(new Error('Could not create a private document link.'), { status: 502 });
      }
      sendJson(response, 200, {
        url: data.signedURL.startsWith('http')
          ? data.signedURL
          : `${config.supabaseUrl}${data.signedURL.startsWith('/storage/v1') ? '' : '/storage/v1'}${data.signedURL}`,
      });
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) console.error('Admin API request failed:', error);
    sendJson(response, status, {
      error: status >= 500 ? 'Admin service encountered an error.' : error.message,
    });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sawaari admin API listening on 127.0.0.1:${PORT}`);
});
