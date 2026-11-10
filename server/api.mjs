import {
  createHmac,
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, open, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { basename, extname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import Busboy from 'busboy';
import nodemailer from 'nodemailer';
import pg from 'pg';

const { Pool } = pg;
const scrypt = promisify(scryptCallback);
const PORT = Number(process.env.API_PORT ?? 3210);
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const ADMIN_TTL_SECONDS = 8 * 60 * 60;
const MAX_JSON_BYTES = 64 * 1024;
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
const VEHICLES = new Set(['Bike', 'Rickshaw', 'Car', 'Premium']);
const DOCUMENT_TYPES = new Set(['cnic', 'driving_license', 'vehicle_registration', 'vehicle_photo']);
const EXTENSIONS_BY_MIME = new Map([
  ['application/pdf', '.pdf'],
  ['image/jpeg', '.jpg'],
  ['image/png', '.png'],
]);

const config = {
  databaseUrl: process.env.DATABASE_URL ?? '',
  publicOrigin: new URL(process.env.PUBLIC_ORIGIN ?? 'https://sawaari.online').origin,
  sessionSecret: process.env.SESSION_SECRET ?? '',
  privateDocumentsDir: resolve(process.env.PRIVATE_DOCUMENTS_DIR ?? '/var/lib/sawaari/private-documents'),
  adminUsername: process.env.ADMIN_USERNAME ?? '',
  adminPasswordHash: process.env.ADMIN_PASSWORD_HASH ?? '',
  smtpHost: process.env.SMTP_HOST ?? '',
  smtpPort: Number(process.env.SMTP_PORT ?? 465),
  smtpSecure: process.env.SMTP_SECURE !== 'false',
  smtpUser: process.env.SMTP_USER ?? '',
  smtpPassword: process.env.SMTP_PASSWORD ?? '',
  smtpFrom: process.env.SMTP_FROM ?? '',
};

if (!config.databaseUrl || !config.sessionSecret || config.sessionSecret.length < 32
  || !config.adminUsername || !config.adminPasswordHash || !config.smtpHost
  || !config.smtpUser || !config.smtpPassword || !config.smtpFrom) {
  throw new Error('VPS API configuration is incomplete. Run server/setup-vps.mjs first.');
}
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) throw new Error('API_PORT is invalid.');

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: 15,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});
const mailer = nodemailer.createTransport({
  host: config.smtpHost,
  port: config.smtpPort,
  secure: config.smtpSecure,
  auth: { user: config.smtpUser, pass: config.smtpPassword },
  connectionTimeout: 10000,
  greetingTimeout: 10000,
  socketTimeout: 20000,
});
const loginAttempts = new Map();

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

function fail(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (Buffer.byteLength(raw) > MAX_JSON_BYTES) throw fail('Request body is too large.', 413);
  }
  let value;
  try {
    value = raw ? JSON.parse(raw) : {};
  } catch {
    throw fail('Invalid JSON request body.');
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw fail('JSON request body must be an object.');
  }
  return value;
}

function hashToken(token) {
  return createHmac('sha256', config.sessionSecret).update(token).digest('hex');
}

function secureCookie(name, value, maxAge, path = '/api') {
  return `${name}=${value}; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=${maxAge}`;
}

function clearCookie(name, path = '/api') {
  return `${name}=; HttpOnly; Secure; SameSite=Strict; Path=${path}; Max-Age=0`;
}

function cookieValue(request, name) {
  const cookies = request.headers.cookie ?? '';
  const match = cookies.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? '';
}

function requestToken(request) {
  const authorization = request.headers.authorization ?? '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  return match?.[1] ?? cookieValue(request, 'sawaari_session');
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  if (origin === config.publicOrigin) return true;
  return process.env.NODE_ENV !== 'production'
    && (origin === 'http://localhost:8081' || origin === 'http://127.0.0.1:8081');
}

function signAdminPayload(payload) {
  return createHmac('sha256', config.sessionSecret).update(payload).digest('base64url');
}

function makeAdminCookie() {
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + ADMIN_TTL_SECONDS,
    nonce: randomBytes(16).toString('base64url'),
  })).toString('base64url');
  return `${payload}.${signAdminPayload(payload)}`;
}

function isAdminSession(request) {
  const [payload, signature, extra] = cookieValue(request, 'sawaari_admin').split('.');
  if (!payload || !signature || extra) return false;
  const expected = Buffer.from(signAdminPayload(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Number.isSafeInteger(data.exp) && data.exp > Math.floor(Date.now() / 1000);
  } catch {
    return false;
  }
}

async function verifyPassword(password, encodedHash) {
  if (typeof password !== 'string' || password.length > 1024) return false;
  const [algorithm, salt, digest, extra] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !digest || extra) return false;
  const expected = Buffer.from(digest, 'base64url');
  if (expected.length !== 64) return false;
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), 64);
  return timingSafeEqual(expected, actual);
}

function loginAllowed(request) {
  const now = Date.now();
  const forwardedFor = request.headers['x-forwarded-for'];
  const key = (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor)?.split(',').at(-1)?.trim()
    || request.socket.remoteAddress
    || 'unknown';
  const state = loginAttempts.get(key) ?? { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (state.resetAt <= now) {
    state.count = 0;
    state.resetAt = now + 15 * 60 * 1000;
  }
  state.count += 1;
  loginAttempts.set(key, state);
  if (loginAttempts.size > 10000) {
    for (const [ip, item] of loginAttempts) {
      if (item.resetAt <= now) loginAttempts.delete(ip);
    }
  }
  return state.count <= 10;
}

async function authenticatedUser(request) {
  const token = requestToken(request);
  if (!token) return null;
  const result = await pool.query(
    `select u.id, u.email, u.display_name
     from user_sessions s
     join app_users u on u.id = s.user_id
     where s.token_hash = $1 and s.expires_at > now() and u.email_verified_at is not null`,
    [hashToken(token)],
  );
  return result.rows[0] ?? null;
}

async function requireUser(request) {
  const user = await authenticatedUser(request);
  if (!user) throw fail('Sign in with a confirmed account to continue.', 401);
  return user;
}

function publicUser(user) {
  return { id: user.id, email: user.email, display_name: user.display_name };
}

async function issueEmailVerification(userId, email) {
  const rateLimit = await pool.query(
    `insert into email_send_limits (email)
     values ($1)
     on conflict (email) do update set
       send_count = case
         when email_send_limits.window_started_at <= now() - interval '1 hour' then 1
         else email_send_limits.send_count + 1
       end,
       window_started_at = case
         when email_send_limits.window_started_at <= now() - interval '1 hour' then now()
         else email_send_limits.window_started_at
       end,
       last_sent_at = now(),
       updated_at = now()
     where email_send_limits.last_sent_at <= now() - interval '60 seconds'
       and (email_send_limits.window_started_at <= now() - interval '1 hour'
         or email_send_limits.send_count < 5)
     returning email`,
    [email],
  );
  if (!rateLimit.rowCount) throw fail('Please wait before requesting another confirmation email.', 429);
  const token = randomBytes(32).toString('base64url');
  await pool.query(
    `insert into email_verification_tokens (token_hash, user_id, expires_at)
     values ($1, $2, now() + interval '24 hours')
     on conflict (token_hash) do nothing`,
    [hashToken(token), userId],
  );
  const url = new URL('/auth/confirm', config.publicOrigin);
  url.searchParams.set('token', token);
  await mailer.sendMail({
    from: config.smtpFrom,
    to: email,
    subject: 'Confirm your Sawaari account',
    text: `Open this link to confirm your Sawaari account, then press Confirm account:\n\n${url.href}\n\nThis link expires in 24 hours.`,
    html: `<h2>Confirm your Sawaari account</h2><p>Open the link below, then press <strong>Confirm account</strong> to verify your email.</p><p><a href="${url.href}">Open Sawaari</a></p><p>This link expires in 24 hours.</p>`,
  });
}

function validEmail(value) {
  return typeof value === 'string'
    && value.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function validCoordinates(latitude, longitude) {
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function distanceMeters(latitude1, longitude1, latitude2, longitude2) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitude2 - latitude1);
  const longitudeDelta = radians(longitude2 - longitude1);
  const rawHaversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitude1)) * Math.cos(radians(latitude2))
      * Math.sin(longitudeDelta / 2) ** 2;
  const haversine = Math.min(1, Math.max(0, rawHaversine));
  return 2 * 6371000 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function distanceSql(latExpression, lonExpression) {
  return `2 * 6371000 * asin(sqrt(least(1, greatest(0,
    power(sin(radians(${latExpression} - $1) / 2), 2)
    + cos(radians($1)) * cos(radians(${latExpression}))
      * power(sin(radians(${lonExpression} - $2) / 2), 2)
  ))))`;
}

function isUuid(value) {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function parseDriverUpload(request, userId) {
  await mkdir(config.privateDocumentsDir, { recursive: true, mode: 0o700 });
  const fields = {};
  const documents = [];
  const createdFiles = [];
  const streamTasks = [];
  let parseError = null;
  const parser = Busboy({
    headers: request.headers,
    limits: { files: 4, fileSize: MAX_DOCUMENT_BYTES, fields: 10, fieldSize: 2048 },
  });

  parser.on('field', (name, value) => {
    fields[name] = value;
  });
  parser.on('filesLimit', () => { parseError = fail('Upload exactly four driver documents.'); });
  parser.on('fieldsLimit', () => { parseError = fail('Too many form fields.'); });
  parser.on('file', (fieldName, stream, info) => {
    const mimeType = info.mimeType.toLowerCase();
    const extension = EXTENSIONS_BY_MIME.get(mimeType);
    if (!DOCUMENT_TYPES.has(fieldName) || !extension) {
      parseError = fail('Choose a PDF, JPG, or PNG for each required document.');
      stream.resume();
      return;
    }
    const storedName = `${userId}-${randomUUID()}${extension}`;
    const fullPath = join(config.privateDocumentsDir, storedName);
    createdFiles.push(fullPath);
    const file = createWriteStream(fullPath, { flags: 'wx', mode: 0o600 });
    let size = 0;
    stream.on('data', (chunk) => { size += chunk.length; });
    stream.on('limit', () => { parseError = fail('Each driver document must be 10 MB or smaller.', 413); });
    const task = new Promise((resolveTask, rejectTask) => {
      file.on('error', rejectTask);
      file.on('finish', async () => {
        if (stream.truncated) {
          parseError = fail('Each driver document must be 10 MB or smaller.', 413);
          rejectTask(parseError);
          return;
        }
        try {
          const handle = await open(fullPath, 'r');
          const header = Buffer.alloc(8);
          let bytesRead;
          try {
            ({ bytesRead } = await handle.read(header, 0, header.length, 0));
          } finally {
            await handle.close();
          }
          const validSignature = mimeType === 'application/pdf'
            ? header.subarray(0, 5).toString('ascii') === '%PDF-'
            : mimeType === 'image/png'
              ? bytesRead >= 8 && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
              : bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
          if (!validSignature) {
            parseError = fail('A selected file does not match its PDF or image type.');
            rejectTask(parseError);
            return;
          }
        } catch (error) {
          rejectTask(error);
          return;
        }
        documents.push({
          doc_type: fieldName,
          path: storedName,
          content_type: mimeType,
          size,
          name: basename(info.filename).slice(0, 180),
        });
        resolveTask();
      });
    });
    stream.pipe(file);
    streamTasks.push(task.catch((error) => {
      parseError ??= error;
    }));
  });

  const parsed = new Promise((resolveParsed, rejectParsed) => {
    parser.on('error', rejectParsed);
    parser.on('finish', resolveParsed);
  });
  request.pipe(parser);
  try {
    await parsed;
    await Promise.all(streamTasks);
    if (parseError) throw parseError;
    if (documents.length !== 4 || new Set(documents.map((item) => item.doc_type)).size !== 4
      || [...DOCUMENT_TYPES].some((type) => !documents.some((item) => item.doc_type === type))) {
      throw fail('Upload all four required driver documents.');
    }
    for (const document of documents) {
      if (document.size < 1 || document.size > MAX_DOCUMENT_BYTES) {
        throw fail('Each driver document must be between 1 byte and 10 MB.');
      }
    }
    return { fields, documents, createdFiles };
  } catch (error) {
    await Promise.all(createdFiles.map((path) => rm(path, { force: true })));
    throw error;
  }
}

async function driverApplication(userId) {
  const result = await pool.query(
    `select id as application_id, full_name, vehicle_type, vehicle_make, vehicle_model,
            vehicle_year, documents, status, review_note, submitted_at
     from driver_applications where user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

async function getNearbyDrivers(userId, rideId) {
  const rideResult = await pool.query(
    'select pickup_latitude, pickup_longitude, vehicle from ride_requests where id = $1 and rider_id = $2',
    [rideId, userId],
  );
  const ride = rideResult.rows[0];
  if (!ride) throw fail('Ride request not found.', 404);
  const sqlDistance = distanceSql('dp.latitude', 'dp.longitude');
  const result = await pool.query(
    `select dp.user_id as driver_id, u.display_name as driver_name, dp.vehicle,
            round(dp.latitude::numeric, 2)::double precision as latitude,
            round(dp.longitude::numeric, 2)::double precision as longitude,
            ${sqlDistance} as distance_m, dp.updated_at
     from driver_presence dp
     join app_users u on u.id = dp.user_id
     join driver_applications da on da.user_id = dp.user_id and da.status = 'approved'
     where dp.is_online and dp.vehicle = $3 and dp.user_id <> $4
       and dp.updated_at > now() - interval '90 seconds'
       and ${sqlDistance} <= 10000
     order by distance_m
     limit 30`,
    [ride.pickup_latitude, ride.pickup_longitude, ride.vehicle, userId],
  );
  return result.rows;
}

async function adminDashboard() {
  const [counts, drivers, rides] = await Promise.all([
    pool.query(
      `select
        (select count(*)::int from app_users) as total_users,
        (select count(*)::int from driver_applications where status = 'pending') as pending_applications,
        (select count(*)::int from driver_applications where status = 'approved') as approved_drivers,
        (select count(*)::int from driver_presence dp join driver_applications da on da.user_id = dp.user_id
          where dp.is_online and dp.updated_at > now() - interval '90 seconds' and da.status = 'approved') as online_drivers,
        (select count(*)::int from ride_requests where status = 'searching') as searching_rides,
        (select count(*)::int from ride_requests where status = 'accepted') as active_rides,
        (select count(*)::int from ride_requests where status = 'completed' and updated_at >= date_trunc('day', now())) as completed_today`,
    ),
    pool.query(
      `select dp.user_id as driver_id, u.display_name as driver_name, dp.vehicle,
              dp.updated_at as last_seen_at
       from driver_presence dp join app_users u on u.id = dp.user_id
       join driver_applications da on da.user_id = dp.user_id and da.status = 'approved'
       where dp.is_online and dp.updated_at > now() - interval '90 seconds'
       order by dp.updated_at desc limit 20`,
    ),
    pool.query(
      `select r.id as request_id, r.status, rider.display_name as rider_name,
              coalesce(driver.display_name, '') as driver_name, r.pickup_address,
              r.destination_address, r.vehicle, r.offered_fare, r.created_at, r.updated_at
       from ride_requests r
       join app_users rider on rider.id = r.rider_id
       left join app_users driver on driver.id = r.driver_id
       where r.status in ('searching', 'accepted')
       order by r.updated_at desc limit 30`,
    ),
  ]);
  return { summary: counts.rows[0], drivers: drivers.rows, rides: rides.rows };
}

async function route(request, response, url) {
  const { pathname } = url;
  const method = request.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    await pool.query('select 1');
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (method !== 'GET' && !originAllowed(request)) throw fail('Request origin is not allowed.', 403);

  if (method === 'POST' && pathname === '/api/auth/signup') {
    if (!loginAllowed(request)) throw fail('Too many signup attempts. Try again in 15 minutes.', 429);
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    if (!validEmail(email) || password.length < 8 || password.length > 1024
      || displayName.length < 2 || displayName.length > 80) {
      throw fail('Enter a valid email, a password of at least 8 characters, and your name.');
    }
    const existing = await pool.query('select id, email_verified_at from app_users where email = $1', [email]);
    if (existing.rowCount) {
      if (existing.rows[0].email_verified_at) {
        throw fail('An account already uses this email. Sign in or request a new confirmation email.', 409);
      }
      if (!existing.rows[0].email_verified_at) {
        try {
          await issueEmailVerification(existing.rows[0].id, email);
        } catch (error) {
          if (Number.isInteger(error?.status) && error.status < 500) throw error;
          console.error('Signup confirmation email failed:', error);
          throw fail('Account exists but confirmation email could not be sent. Check VPS SMTP settings and try again.', 502);
        }
      }
      sendJson(response, 200, { message: 'Confirmation email sent.' });
      return;
    }
    const salt = randomBytes(16);
    const passwordHash = `scrypt$${salt.toString('base64url')}$${(await scrypt(password, salt, 64)).toString('base64url')}`;
    const inserted = await pool.query(
      `insert into app_users (email, password_hash, display_name)
       values ($1, $2, $3) returning id`,
      [email, passwordHash, displayName],
    );
    try {
      await issueEmailVerification(inserted.rows[0].id, email);
    } catch (error) {
      console.error('Signup confirmation email failed:', error);
      throw fail('Account was created but confirmation email could not be sent. Use Resend confirmation email after SMTP is fixed.', 502);
    }
    sendJson(response, 201, { message: 'Confirmation email sent.' });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/resend-confirmation') {
    if (!loginAllowed(request)) throw fail('Too many requests. Try again in 15 minutes.', 429);
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!validEmail(email)) throw fail('Enter a valid email address.');
    const result = await pool.query(
      'select id from app_users where email = $1 and email_verified_at is null',
      [email],
    );
    if (result.rowCount) {
      try {
        await issueEmailVerification(result.rows[0].id, email);
      } catch (error) {
        if (Number.isInteger(error?.status) && error.status < 500) throw error;
        console.error('Confirmation resend failed:', error);
        throw fail('Confirmation email could not be sent. Check VPS SMTP settings and try again.', 502);
      }
    }
    sendJson(response, 200, { message: 'If this account needs confirmation, an email has been sent.' });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/confirm') {
    const body = await readJson(request);
    const token = typeof body.token === 'string' ? body.token : '';
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) throw fail('This confirmation link is invalid or expired.');
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(
        `select user_id from email_verification_tokens
         where token_hash = $1 and expires_at > now() for update`,
        [hashToken(token)],
      );
      if (!result.rowCount) throw fail('This confirmation link is invalid or expired.');
      await client.query(
        'update app_users set email_verified_at = coalesce(email_verified_at, now()) where id = $1',
        [result.rows[0].user_id],
      );
      await client.query('delete from email_verification_tokens where user_id = $1', [result.rows[0].user_id]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    sendJson(response, 200, { confirmed: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/login') {
    if (!loginAllowed(request)) throw fail('Too many sign-in attempts. Try again in 15 minutes.', 429);
    const body = await readJson(request);
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const result = await pool.query(
      'select id, email, display_name, password_hash, email_verified_at from app_users where email = $1',
      [email],
    );
    const user = result.rows[0];
    if (!user || !(await verifyPassword(password, user.password_hash))) {
      throw fail('Email or password is incorrect.', 401);
    }
    if (!user.email_verified_at) throw fail('Confirm your email before signing in. Use Resend confirmation email if needed.', 403);
    const token = randomBytes(32).toString('base64url');
    await pool.query(
      'insert into user_sessions (token_hash, user_id, expires_at) values ($1, $2, now() + interval \'30 days\')',
      [hashToken(token), user.id],
    );
    sendJson(response, 200, { token, user: publicUser(user) }, {
      'Set-Cookie': secureCookie('sawaari_session', token, SESSION_TTL_SECONDS),
    });
    return;
  }

  if (method === 'GET' && pathname === '/api/auth/session') {
    const user = await authenticatedUser(request);
    sendJson(response, 200, { user: user ? publicUser(user) : null });
    return;
  }

  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = requestToken(request);
    if (token) await pool.query('delete from user_sessions where token_hash = $1', [hashToken(token)]);
    sendJson(response, 200, { signedOut: true }, { 'Set-Cookie': clearCookie('sawaari_session') });
    return;
  }

  if (method === 'GET' && pathname === '/api/admin/session') {
    sendJson(response, 200, { authenticated: isAdminSession(request) });
    return;
  }
  if (method === 'POST' && pathname === '/api/admin/login') {
    if (!loginAllowed(request)) throw fail('Too many sign-in attempts. Try again in 15 minutes.', 429);
    const body = await readJson(request);
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    const usernameMatches = Buffer.from(username.toLowerCase())
      .equals(Buffer.from(config.adminUsername.toLowerCase()));
    const passwordMatches = await verifyPassword(password, config.adminPasswordHash);
    if (!usernameMatches || !passwordMatches) throw fail('Invalid admin username or password.', 401);
    sendJson(response, 200, { authenticated: true }, {
      'Set-Cookie': secureCookie('sawaari_admin', makeAdminCookie(), ADMIN_TTL_SECONDS, '/api/admin'),
    });
    return;
  }
  if (method === 'POST' && pathname === '/api/admin/logout') {
    sendJson(response, 200, { authenticated: false }, {
      'Set-Cookie': clearCookie('sawaari_admin', '/api/admin'),
    });
    return;
  }

  if (pathname.startsWith('/api/admin/')) {
    if (!isAdminSession(request)) throw fail('Admin sign-in is required.', 401);
    if (method === 'GET' && pathname === '/api/admin/dashboard') {
      sendJson(response, 200, await adminDashboard());
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/users') {
      const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
      const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
      const search = (url.searchParams.get('search') ?? '').trim().slice(0, 120);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100
        || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
        throw fail('Invalid user-list page.');
      }
      const searchPattern = search
        ? `%${search.replace(/[\\%_]/g, '\\$&')}%`
        : null;
      const [count, users] = await Promise.all([
        pool.query(
          `select count(*)::int as total
           from app_users
           where $1::text is null or email ilike $1 escape '\\' or display_name ilike $1 escape '\\'`,
          [searchPattern],
        ),
        pool.query(
          `select u.id as user_id, u.email, u.display_name, u.email_verified_at, u.created_at,
                  da.status as driver_status
           from app_users u
           left join driver_applications da on da.user_id = u.id
           where $1::text is null or u.email ilike $1 escape '\\' or u.display_name ilike $1 escape '\\'
           order by u.created_at desc, u.id
           limit $2 offset $3`,
          [searchPattern, requestedLimit, requestedOffset],
        ),
      ]);
      sendJson(response, 200, {
        users: users.rows,
        total: count.rows[0].total,
        limit: requestedLimit,
        offset: requestedOffset,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/review-queue') {
      const result = await pool.query(
        `select id as application_id, user_id, full_name, vehicle_type, vehicle_make, vehicle_model,
                vehicle_year, documents, submitted_at
         from driver_applications where status = 'pending' order by submitted_at asc limit 100`,
      );
      sendJson(response, 200, result.rows);
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/review') {
      const body = await readJson(request);
      if (!isUuid(body.applicationId)
        || !['approved', 'needs_changes', 'rejected'].includes(body.decision)
        || typeof body.note !== 'string' || body.note.length > 1000
        || (body.decision !== 'approved' && body.note.trim().length < 5)) {
        throw fail('Invalid review decision or feedback.');
      }
      const result = await pool.query(
        `update driver_applications
         set status = $2, review_note = $3, reviewed_at = now(), reviewed_by = $4
         where id = $1 and status = 'pending' returning user_id`,
        [body.applicationId, body.decision, body.note.trim(), config.adminUsername],
      );
      if (!result.rowCount) throw fail('This application is no longer waiting for review.', 409);
      if (body.decision !== 'approved') {
        await pool.query('update driver_presence set is_online = false where user_id = $1', [result.rows[0].user_id]);
      }
      sendJson(response, 200, { success: true });
      return;
    }
    if (method === 'POST' && pathname === '/api/admin/document-url') {
      const body = await readJson(request);
      const path = typeof body.path === 'string' ? body.path : '';
      if (!/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(path)) throw fail('Invalid document path.');
      const payload = Buffer.from(JSON.stringify({
        path,
        exp: Math.floor(Date.now() / 1000) + 120,
      })).toString('base64url');
      const signature = signAdminPayload(payload);
      sendJson(response, 200, { url: `${config.publicOrigin}/api/admin/document?token=${payload}&sig=${signature}` });
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/document') {
      const payload = url.searchParams.get('token') ?? '';
      const signature = url.searchParams.get('sig') ?? '';
      const expected = Buffer.from(signAdminPayload(payload));
      const received = Buffer.from(signature);
      if (!payload || expected.length !== received.length || !timingSafeEqual(expected, received)) {
        throw fail('This document link is invalid or expired.', 403);
      }
      let document;
      try {
        document = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      } catch {
        throw fail('This document link is invalid or expired.', 403);
      }
      if (!Number.isSafeInteger(document.exp) || document.exp <= Math.floor(Date.now() / 1000)
        || !/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(document.path)) {
        throw fail('This document link is invalid or expired.', 403);
      }
      const filePath = join(config.privateDocumentsDir, document.path);
      response.writeHead(200, {
        'Content-Type': extname(document.path) === '.pdf'
          ? 'application/pdf'
          : extname(document.path) === '.png' ? 'image/png' : 'image/jpeg',
        'Content-Disposition': `inline; filename="${basename(document.path)}"`,
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
      });
      const stream = createReadStream(filePath);
      stream.on('error', (error) => {
        console.error('Private document read failed:', error);
        if (!response.headersSent) sendJson(response, 404, { error: 'Document not found.' });
        else response.destroy(error);
      });
      stream.pipe(response);
      return;
    }
    throw fail('Not found.', 404);
  }

  if (method === 'GET' && pathname === '/api/driver/application') {
    const user = await requireUser(request);
    sendJson(response, 200, { application: await driverApplication(user.id) });
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/dashboard') {
    const user = await requireUser(request);
    const [application, summary, rides] = await Promise.all([
      pool.query(
        `select full_name, vehicle_type, vehicle_make, vehicle_model, vehicle_year,
                status, review_note, submitted_at
         from driver_applications where user_id=$1`,
        [user.id],
      ),
      pool.query(
        `select count(*) filter (where status='completed') as completed_rides,
                coalesce(sum(offered_fare) filter (
                  where status='completed' and cash_collected
                ), 0)::text as cash_collected,
                coalesce(sum(offered_fare) filter (
                  where status='completed' and not cash_collected
                ), 0)::text as cash_not_confirmed
         from ride_requests where driver_id=$1`,
        [user.id],
      ),
      pool.query(
        `select id as request_id, pickup_address, destination_address, vehicle,
                offered_fare, cash_collected, updated_at as completed_at
         from ride_requests
         where driver_id=$1 and status='completed'
         order by updated_at desc limit 50`,
        [user.id],
      ),
    ]);
    sendJson(response, 200, {
      profile: { display_name: user.display_name, email: user.email },
      application: application.rows[0] ?? null,
      summary: summary.rows[0],
      recent_rides: rides.rows,
      payment_method: 'cash',
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/application') {
    const user = await requireUser(request);
    const upload = await parseDriverUpload(request, user.id);
    const { fields, documents } = upload;
    const fullName = (fields.full_name ?? '').trim();
    const vehicleType = fields.vehicle_type ?? '';
    const vehicleMake = (fields.vehicle_make ?? '').trim();
    const vehicleModel = (fields.vehicle_model ?? '').trim();
    const vehicleYear = Number(fields.vehicle_year);
    if (fullName.length < 2 || fullName.length > 80 || !VEHICLES.has(vehicleType)
      || vehicleMake.length < 1 || vehicleMake.length > 80
      || vehicleModel.length < 1 || vehicleModel.length > 80
      || !Number.isInteger(vehicleYear) || vehicleYear < 1980 || vehicleYear > 2100) {
      await Promise.all(upload.createdFiles.map((path) => rm(path, { force: true })));
      throw fail('Enter a valid name and vehicle make, model, year, and category.');
    }
    const client = await pool.connect();
    let previousDocumentPaths = [];
    try {
      await client.query('begin');
      const existing = await client.query(
        'select id, status, documents from driver_applications where user_id = $1 for update',
        [user.id],
      );
      if (existing.rows[0]?.status === 'pending' || existing.rows[0]?.status === 'approved') {
        throw fail('An application is already under review or approved.', 409);
      }
      const application = existing.rows[0]
        ? await client.query(
          `update driver_applications set full_name=$2, vehicle_type=$3, vehicle_make=$4,
             vehicle_model=$5, vehicle_year=$6, documents=$7, status='pending',
             review_note='', submitted_at=now(), reviewed_at=null, reviewed_by=null
           where id=$1 returning id, status`,
          [existing.rows[0].id, fullName, vehicleType, vehicleMake, vehicleModel, vehicleYear, JSON.stringify(documents)],
        )
        : await client.query(
          `insert into driver_applications
             (user_id, full_name, vehicle_type, vehicle_make, vehicle_model, vehicle_year, documents)
           values ($1,$2,$3,$4,$5,$6,$7) returning id, status`,
          [user.id, fullName, vehicleType, vehicleMake, vehicleModel, vehicleYear, JSON.stringify(documents)],
        );
      if (existing.rows[0] && Array.isArray(existing.rows[0].documents)) {
        previousDocumentPaths = existing.rows[0].documents
          .map((document) => document?.path)
          .filter((path) => typeof path === 'string'
            && /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(path))
          .map((path) => join(config.privateDocumentsDir, path));
      }
      await client.query('commit');
      await Promise.all(previousDocumentPaths.map((path) => rm(path, { force: true })))
        .catch((error) => console.error('Previous private document cleanup failed:', error));
      sendJson(response, 201, { application_id: application.rows[0].id, status: application.rows[0].status });
    } catch (error) {
      await client.query('rollback');
      await Promise.all(upload.createdFiles.map((path) => rm(path, { force: true })));
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/presence') {
    const user = await requireUser(request);
    const result = await pool.query(
      `select dp.is_online, dp.vehicle, dp.latitude, dp.longitude,
              exists(select 1 from ride_requests r
                     where r.driver_id=dp.user_id and r.status='accepted') as has_active_ride
       from driver_presence dp
       where dp.user_id=$1`,
      [user.id],
    );
    if (!result.rowCount) {
      sendJson(response, 200, { is_online: false, vehicle: '', latitude: null, longitude: null });
      return;
    }
    const presence = result.rows[0];
    sendJson(response, 200, {
      is_online: presence.is_online && !presence.has_active_ride,
      vehicle: presence.vehicle,
      latitude: presence.latitude,
      longitude: presence.longitude,
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/presence') {
    const user = await requireUser(request);
    const body = await readJson(request);
    const vehicle = body.vehicle;
    const online = body.is_online;
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!VEHICLES.has(vehicle) || typeof online !== 'boolean'
      || displayName.length < 2 || displayName.length > 80
      || !validCoordinates(latitude, longitude)) {
      throw fail('Provide a valid name, vehicle, and location.');
    }
    if (online) {
      const application = await pool.query(
        'select 1 from driver_applications where user_id = $1 and status = \'approved\'',
        [user.id],
      );
      if (!application.rowCount) throw fail('Driver approval is required before going online.', 403);
      const active = await pool.query(
        `select 1 from ride_requests where driver_id = $1 and status = 'accepted'`,
        [user.id],
      );
      if (active.rowCount) throw fail('Complete your active ride before going online.');
    }
    await pool.query(
      `update app_users set display_name = $2 where id = $1`,
      [user.id, displayName],
    );
    await pool.query(
      `insert into driver_presence (user_id, vehicle, is_online, latitude, longitude, updated_at)
       values ($1,$2,$3,$4,$5,now())
       on conflict (user_id) do update set vehicle=excluded.vehicle, is_online=excluded.is_online,
         latitude=excluded.latitude, longitude=excluded.longitude, updated_at=now()`,
      [user.id, vehicle, online, latitude, longitude],
    );
    sendJson(response, 200, { success: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/location') {
    const user = await requireUser(request);
    const body = await readJson(request);
    const latitude = Number(body.latitude);
    const longitude = Number(body.longitude);
    if (!isUuid(body.request_id) || !validCoordinates(latitude, longitude)) {
      throw fail('Provide a valid active ride and driver location.');
    }
    const result = await pool.query(
      `update driver_presence as dp
       set latitude = $3, longitude = $4, is_online = false, updated_at = now()
       from ride_requests as r
       where dp.user_id = $1 and r.id = $2 and r.driver_id = $1 and r.status = 'accepted'
       returning dp.user_id`,
      [user.id, body.request_id, latitude, longitude],
    );
    if (!result.rowCount) throw fail('This active ride is no longer available for location sharing.', 404);
    sendJson(response, 200, { success: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/requests') {
    const user = await requireUser(request);
    const presence = await pool.query(
      `select vehicle, latitude, longitude from driver_presence
       where user_id=$1 and is_online and updated_at > now() - interval '90 seconds'`,
      [user.id],
    );
    if (!presence.rowCount) {
      sendJson(response, 200, []);
      return;
    }
    const { vehicle, latitude, longitude } = presence.rows[0];
    const sqlDistance = distanceSql('r.pickup_latitude', 'r.pickup_longitude');
    const result = await pool.query(
      `select r.id as request_id, rider.display_name as rider_name, r.pickup_address,
              r.destination_address, r.vehicle, r.offered_fare, ${sqlDistance} as distance_m,
              r.created_at,
              case when r.driver_offer_id=$5 then r.driver_offer_status else null end as my_offer_status,
              case when r.driver_offer_id=$5 then r.driver_offer_fare else null end as my_offer_fare
       from ride_requests r join app_users rider on rider.id=r.rider_id
       where r.status='searching' and r.vehicle=$3 and r.rider_id<>$4
         and (r.driver_offer_status is distinct from 'pending' or r.driver_offer_id=$5)
         and ${sqlDistance} <= 10000
       order by distance_m, r.created_at limit 50`,
      [latitude, longitude, vehicle, user.id, user.id],
    );
    sendJson(response, 200, result.rows);
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/offer') {
    const user = await requireUser(request);
    const body = await readJson(request);
    const offeredFare = Number(body.offered_fare);
    if (!isUuid(body.request_id) || !Number.isInteger(offeredFare)
      || offeredFare < 1 || offeredFare > 1000000) {
      throw fail('Provide a valid ride request and fare offer.');
    }

    const client = await pool.connect();
    try {
      await client.query('begin');
      const approval = await client.query(
        `select 1 from driver_applications where user_id=$1 and status='approved' for update`,
        [user.id],
      );
      if (!approval.rowCount) throw fail('Driver approval is required to send a fare offer.', 403);
      const request = await client.query(
        `select id, rider_id, vehicle, pickup_latitude, pickup_longitude,
                driver_offer_id, driver_offer_status
         from ride_requests where id=$1 and status='searching' for update`,
        [body.request_id],
      );
      if (!request.rowCount) throw fail('This ride request is no longer available.', 404);
      const ride = request.rows[0];
      const presence = await client.query(
        `select vehicle, latitude, longitude from driver_presence
         where user_id=$1 and is_online and updated_at > now() - interval '90 seconds'
         for update`,
        [user.id],
      );
      if (!presence.rowCount) throw fail('Go online with location enabled before sending an offer.');
      const driver = presence.rows[0];
      if (ride.rider_id === user.id) throw fail('You cannot offer on your own ride request.', 403);
      if (ride.vehicle !== driver.vehicle) throw fail('Your vehicle does not match this ride request.', 409);
      const distance = distanceMeters(
        Number(driver.latitude),
        Number(driver.longitude),
        Number(ride.pickup_latitude),
        Number(ride.pickup_longitude),
      );
      if (distance > 10000) throw fail('This ride request is outside your 10 km matching area.', 409);
      if (ride.driver_offer_status === 'pending' && ride.driver_offer_id !== user.id) {
        throw fail('Another driver already has an offer waiting for the rider.', 409);
      }

      await client.query(
        `update ride_requests
         set driver_offer_id=$2, driver_offer_fare=$3, driver_offer_status='pending', updated_at=now()
         where id=$1`,
        [body.request_id, user.id, offeredFare],
      );
      await client.query('commit');
      sendJson(response, 200, { success: true, offered_fare: offeredFare, status: 'pending' });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/active-ride') {
    const user = await requireUser(request);
    const result = await pool.query(
      `select r.id as request_id, rider.display_name as rider_name, r.pickup_address,
              r.destination_address, r.vehicle, r.offered_fare, 0::double precision as distance_m,
              r.created_at, null::text as my_offer_status, null::integer as my_offer_fare
       from ride_requests r join app_users rider on rider.id=r.rider_id
       where r.driver_id=$1 and r.status='accepted' order by r.updated_at desc limit 1`,
      [user.id],
    );
    sendJson(response, 200, { ride: result.rows[0] ?? null });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/complete') {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (!isUuid(body.request_id)) throw fail('Invalid ride request.');
    if (body.cash_collected !== undefined && typeof body.cash_collected !== 'boolean') {
      throw fail('Cash collection status must be true or false.');
    }
    const result = await pool.query(
      `update ride_requests set status='completed', cash_collected=$3, updated_at=now()
       where id=$1 and driver_id=$2 and status='accepted' returning id`,
      [body.request_id, user.id, body.cash_collected === true],
    );
    if (!result.rowCount) throw fail('This active ride could not be found.', 404);
    sendJson(response, 200, { success: true });
    return;
  }

  if (method === 'POST' && pathname === '/api/rides') {
    const user = await requireUser(request);
    const body = await readJson(request);
    const pickupLatitude = Number(body.pickup_latitude);
    const pickupLongitude = Number(body.pickup_longitude);
    const destinationLatitude = Number(body.destination_latitude);
    const destinationLongitude = Number(body.destination_longitude);
    const vehicle = body.vehicle;
    const offeredFare = Number(body.offered_fare);
    const pickupAddress = typeof body.pickup_address === 'string' ? body.pickup_address.trim() : '';
    const destinationAddress = typeof body.destination_address === 'string' ? body.destination_address.trim() : '';
    if (!validCoordinates(pickupLatitude, pickupLongitude)
      || !validCoordinates(destinationLatitude, destinationLongitude)
      || !VEHICLES.has(vehicle) || !Number.isInteger(offeredFare) || offeredFare < 1 || offeredFare > 1000000
      || pickupAddress.length < 1 || pickupAddress.length > 300
      || destinationAddress.length < 1 || destinationAddress.length > 300) {
      throw fail('Enter valid ride locations, vehicle, and fare offer.');
    }
    const result = await pool.query(
      `insert into ride_requests
       (rider_id,pickup_address,destination_address,pickup_latitude,pickup_longitude,
        destination_latitude,destination_longitude,vehicle,offered_fare)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
      [user.id, pickupAddress, destinationAddress, pickupLatitude, pickupLongitude,
        destinationLatitude, destinationLongitude, vehicle, offeredFare],
    );
    sendJson(response, 201, { request_id: result.rows[0].id });
    return;
  }

  const rideStatusMatch = pathname.match(/^\/api\/rides\/([0-9a-f-]{36})\/matches$/i);
  if (method === 'GET' && rideStatusMatch) {
    const user = await requireUser(request);
    const rideId = rideStatusMatch[1];
    const rideResult = await pool.query(
      `select r.status, r.offered_fare as agreed_fare,
              coalesce(driver.display_name, '') as driver_name,
              coalesce(presence.vehicle, '') as driver_vehicle,
              r.driver_offer_status,
              case when r.driver_offer_status='pending' then offer_driver.display_name else '' end
                as offer_driver_name,
              case when r.driver_offer_status='pending' then offer_presence.vehicle else '' end
                as offer_driver_vehicle,
              case when r.driver_offer_status='pending' then r.driver_offer_fare else null end
                as driver_offer_fare,
              case when r.status='accepted' and presence.updated_at > now() - interval '60 seconds'
                then presence.latitude else null end as driver_latitude,
              case when r.status='accepted' and presence.updated_at > now() - interval '60 seconds'
                then presence.longitude else null end as driver_longitude,
              case when r.status='accepted' and presence.updated_at > now() - interval '60 seconds'
                then presence.updated_at else null end as driver_location_updated_at
       from ride_requests r left join app_users driver on driver.id=r.driver_id
       left join driver_presence presence on presence.user_id=r.driver_id
       left join app_users offer_driver on offer_driver.id=r.driver_offer_id
       left join driver_presence offer_presence on offer_presence.user_id=r.driver_offer_id
       where r.id=$1 and r.rider_id=$2`,
      [rideId, user.id],
    );
    if (!rideResult.rowCount) throw fail('Ride request not found.', 404);
    const status = rideResult.rows[0];
    const drivers = status.status === 'searching' ? await getNearbyDrivers(user.id, rideId) : [];
    sendJson(response, 200, { status, drivers });
    return;
  }

  const driverOfferResponseMatch = pathname.match(
    /^\/api\/rides\/([0-9a-f-]{36})\/driver-offer\/respond$/i,
  );
  if (method === 'POST' && driverOfferResponseMatch) {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (!['accept', 'reject'].includes(body.action)
      || !Number.isInteger(body.offered_fare)
      || body.offered_fare < 1
      || body.offered_fare > 1000000) {
      throw fail('Provide a valid action and fare shown to the rider.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const rideResult = await client.query(
        `select driver_offer_id, driver_offer_fare
         from ride_requests
         where id=$1 and rider_id=$2 and status='searching'
           and driver_offer_status='pending'
         for update`,
        [driverOfferResponseMatch[1], user.id],
      );
      if (!rideResult.rowCount) throw fail('This driver offer is no longer available.', 409);
      const ride = rideResult.rows[0];
      if (Number(ride.driver_offer_fare) !== body.offered_fare) {
        throw fail('The driver changed the fare. Review the updated offer before responding.', 409);
      }
      if (body.action === 'accept') {
        const accepted = await client.query(
          `update ride_requests
           set status='accepted', driver_id=driver_offer_id, offered_fare=driver_offer_fare,
               driver_offer_status='accepted', updated_at=now()
           where id=$1 and rider_id=$2 and status='searching' and driver_offer_status='pending'
           returning driver_id`,
          [driverOfferResponseMatch[1], user.id],
        );
        if (!accepted.rowCount) throw fail('This driver offer is no longer available.', 409);
        await client.query(
          'update driver_presence set is_online=false where user_id=$1',
          [accepted.rows[0].driver_id],
        );
      } else {
        await client.query(
          `update ride_requests set driver_offer_status='rejected', updated_at=now()
           where id=$1 and rider_id=$2`,
          [driverOfferResponseMatch[1], user.id],
        );
      }
      await client.query('commit');
      sendJson(response, 200, {
        success: true,
        action: body.action,
        offered_fare: Number(ride.driver_offer_fare),
      });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  const rideCancelMatch = pathname.match(/^\/api\/rides\/([0-9a-f-]{36})\/cancel$/i);
  const rideOfferMatch = pathname.match(/^\/api\/rides\/([0-9a-f-]{36})\/offer$/i);
  if (method === 'POST' && rideOfferMatch) {
    const user = await requireUser(request);
    const body = await readJson(request);
    const offeredFare = Number(body.offered_fare);
    if (!Number.isInteger(offeredFare) || offeredFare < 1 || offeredFare > 1000000) {
      throw fail('Enter a fare offer between PKR 1 and PKR 1,000,000.');
    }
    const result = await pool.query(
      `update ride_requests set offered_fare=$3, updated_at=now()
       where id=$1 and rider_id=$2 and status='searching' returning id`,
      [rideOfferMatch[1], user.id, offeredFare],
    );
    if (!result.rowCount) throw fail('This ride offer can no longer be changed.', 409);
    sendJson(response, 200, { success: true, offered_fare: offeredFare });
    return;
  }

  if (method === 'POST' && rideCancelMatch) {
    const user = await requireUser(request);
    const result = await pool.query(
      `update ride_requests set status='cancelled', updated_at=now()
       where id=$1 and rider_id=$2 and status='searching' returning id`,
      [rideCancelMatch[1], user.id],
    );
    if (!result.rowCount) throw fail('This ride request cannot be cancelled.', 409);
    sendJson(response, 200, { success: true });
    return;
  }

  throw fail('Not found.', 404);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    await route(request, response, url);
  } catch (error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    if (status >= 500) console.error('Sawaari API request failed:', error);
    if (!response.headersSent) {
      sendJson(response, status, {
        error: status >= 500 ? 'Sawaari service encountered an error.' : error.message,
      });
    } else {
      response.destroy(error);
    }
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`Sawaari VPS API listening on 127.0.0.1:${PORT}`);
});

const cleanupTimer = setInterval(() => {
  void pool.query('delete from user_sessions where expires_at <= now()')
    .then(() => pool.query('delete from email_verification_tokens where expires_at <= now()'))
    .catch((error) => console.error('Expired session cleanup failed:', error));
}, 60 * 60 * 1000);
cleanupTimer.unref();

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
