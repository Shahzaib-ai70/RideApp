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

async function ensureAccountCanUseServices(userId, database = pool) {
  const result = await database.query(
    `select reason, restricted_until from account_restrictions
     where user_id=$1 and lifted_at is null
       and (restricted_until is null or restricted_until > now())
     order by created_at desc limit 1`,
    [userId],
  );
  if (!result.rowCount) return;
  const restriction = result.rows[0];
  const expiry = restriction.restricted_until
    ? ` until ${new Date(restriction.restricted_until).toLocaleString()}`
    : ' permanently';
  throw fail(`Account activity is restricted${expiry}. Reason: ${restriction.reason}`, 403);
}

async function lockAndEnsureAccountCanUseServices(client, userId) {
  const account = await client.query(
    'select id from app_users where id=$1 for update',
    [userId],
  );
  if (!account.rowCount) throw fail('User account not found.', 404);
  await ensureAccountCanUseServices(userId, client);
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
  let driverPhotoPath = null;
  const createdFiles = [];
  const streamTasks = [];
  let parseError = null;
  const parser = Busboy({
    headers: request.headers,
    limits: { files: 5, fileSize: MAX_DOCUMENT_BYTES, fields: 10, fieldSize: 2048 },
  });

  parser.on('field', (name, value) => {
    fields[name] = value;
  });
  parser.on('filesLimit', () => { parseError = fail('Upload four driver documents and one profile photo.'); });
  parser.on('fieldsLimit', () => { parseError = fail('Too many form fields.'); });
  parser.on('file', (fieldName, stream, info) => {
    const mimeType = info.mimeType.toLowerCase();
    const extension = EXTENSIONS_BY_MIME.get(mimeType);
    const isDriverPhoto = fieldName === 'driver_photo';
    if ((!DOCUMENT_TYPES.has(fieldName) && !isDriverPhoto) || !extension
      || (isDriverPhoto && mimeType === 'application/pdf')) {
      parseError = fail('Choose a PDF, JPG, or PNG for each required document and a JPG or PNG profile photo.');
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
        if (isDriverPhoto) {
          if (driverPhotoPath) {
            parseError = fail('Upload exactly one driver profile photo.');
            rejectTask(parseError);
            return;
          }
          driverPhotoPath = storedName;
        } else {
          documents.push({
            doc_type: fieldName,
            path: storedName,
            content_type: mimeType,
            size,
            name: basename(info.filename).slice(0, 180),
          });
        }
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
    if (!driverPhotoPath) throw fail('Upload a driver profile photo.');
    for (const document of documents) {
      if (document.size < 1 || document.size > MAX_DOCUMENT_BYTES) {
        throw fail('Each driver document must be between 1 byte and 10 MB.');
      }
    }
    return { fields, documents, driverPhotoPath, createdFiles };
  } catch (error) {
    await Promise.all(createdFiles.map((path) => rm(path, { force: true })));
    throw error;
  }
}

async function parseDriverProfilePhoto(request, userId) {
  await mkdir(config.privateDocumentsDir, { recursive: true, mode: 0o700 });
  const fields = {};
  const createdFiles = [];
  let photoPath = null;
  let parseError = null;
  let streamTask = Promise.resolve();
  const parser = Busboy({
    headers: request.headers,
    limits: { files: 1, fileSize: MAX_DOCUMENT_BYTES, fields: 2, fieldSize: 80 },
  });
  parser.on('field', (name, value) => {
    if (name !== 'vehicle_color' && name !== 'vehicle_registration_number') {
      parseError = fail('Unexpected driver profile field.');
      return;
    }
    fields[name] = value;
  });
  parser.on('filesLimit', () => { parseError = fail('Upload exactly one driver profile photo.'); });
  parser.on('fieldsLimit', () => { parseError = fail('Too many driver profile fields.'); });
  parser.on('file', (fieldName, stream, info) => {
    const mimeType = info.mimeType.toLowerCase();
    const extension = EXTENSIONS_BY_MIME.get(mimeType);
    if (fieldName !== 'driver_photo' || !extension || mimeType === 'application/pdf') {
      parseError = fail('Choose a JPG or PNG driver photo.');
      stream.resume();
      return;
    }
    const storedName = `${userId}-${randomUUID()}${extension}`;
    const fullPath = join(config.privateDocumentsDir, storedName);
    createdFiles.push(fullPath);
    const file = createWriteStream(fullPath, { flags: 'wx', mode: 0o600 });
    stream.on('limit', () => { parseError = fail('The driver photo must be 10 MB or smaller.', 413); });
    streamTask = new Promise((resolveTask, rejectTask) => {
      file.on('error', rejectTask);
      file.on('finish', async () => {
        if (stream.truncated) {
          parseError = fail('The driver photo must be 10 MB or smaller.', 413);
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
          const validSignature = mimeType === 'image/png'
            ? bytesRead >= 8 && header.equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            : bytesRead >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255;
          if (!validSignature) {
            parseError = fail('The selected driver photo does not match its image type.');
            rejectTask(parseError);
            return;
          }
          photoPath = storedName;
          resolveTask();
        } catch (error) {
          rejectTask(error);
        }
      });
    });
    streamTask = streamTask.catch((error) => {
      parseError ??= error;
    });
    stream.pipe(file);
  });
  const parsed = new Promise((resolveParsed, rejectParsed) => {
    parser.on('error', rejectParsed);
    parser.on('finish', resolveParsed);
  });
  request.pipe(parser);
  try {
    await parsed;
    await streamTask;
    if (parseError) throw parseError;
    return { fields, photoPath, createdFiles };
  } catch (error) {
    await Promise.all(createdFiles.map((path) => rm(path, { force: true })));
    throw error;
  }
}

async function driverApplication(userId) {
  const result = await pool.query(
    `select id as application_id, full_name, vehicle_type, vehicle_make, vehicle_model,
            vehicle_year, vehicle_color, vehicle_registration_number, driver_photo_path,
            documents, status, review_note, submitted_at
     from driver_applications where user_id = $1`,
    [userId],
  );
  const application = result.rows[0] ?? null;
  if (!application) return null;
  return {
    ...application,
    driver_photo_url: createDriverPhotoUrl(application.driver_photo_path),
    driver_photo_path: undefined,
  };
}

function createDriverPhotoUrl(path) {
  if (typeof path !== 'string'
    || !/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png)$/i.test(path)) return null;
  const payload = Buffer.from(JSON.stringify({
    exp: Math.floor(Date.now() / 3600000) * 3600 + 7200,
    path,
  })).toString('base64url');
  const signature = signAdminPayload(payload);
  return `${config.publicOrigin}/api/driver/photo?token=${encodeURIComponent(`${payload}.${signature}`)}`;
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
        (select count(*)::int from ride_requests where status = 'completed' and updated_at >= date_trunc('day', now())) as completed_today,
        (select count(*)::int from ride_reports where status in ('open', 'reviewing')) as open_reports`,
    ),
    pool.query(
      `select dp.user_id as driver_id, u.display_name as driver_name, u.email as driver_email, dp.vehicle,
              dp.updated_at as last_seen_at
       from driver_presence dp join app_users u on u.id = dp.user_id
       join driver_applications da on da.user_id = dp.user_id and da.status = 'approved'
       where dp.is_online and dp.updated_at > now() - interval '90 seconds'
       order by dp.updated_at desc limit 20`,
    ),
    pool.query(
      `select r.id as request_id, r.status, r.rider_id, rider.display_name as rider_name,
              rider.email as rider_email, r.driver_id,
              coalesce(driver.display_name, '') as driver_name,
              coalesce(driver.email, '') as driver_email,
              r.pickup_address, r.destination_address,
              r.pickup_latitude, r.pickup_longitude,
              r.destination_latitude, r.destination_longitude,
              r.vehicle, r.offered_fare, r.driver_offer_fare, r.driver_offer_status,
              r.cash_collected, r.created_at, r.updated_at,
              case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                then dp.latitude else r.last_driver_latitude end as driver_latitude,
              case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                then dp.longitude else r.last_driver_longitude end as driver_longitude,
              case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                then dp.updated_at else r.last_driver_location_at end as driver_location_at,
              (r.status='accepted' and dp.updated_at > now() - interval '60 seconds')
                as driver_location_is_live
       from ride_requests r
       join app_users rider on rider.id = r.rider_id
       left join app_users driver on driver.id = r.driver_id
       left join driver_presence dp on dp.user_id = r.driver_id
       where r.status in ('searching', 'accepted')
       order by r.updated_at desc limit 30`,
    ),
  ]);
  return {
    summary: counts.rows[0],
    drivers: drivers.rows,
    rides: rides.rows,
  };
}

async function route(request, response, url) {
  const { pathname } = url;
  const method = request.method ?? 'GET';

  if (method === 'GET' && pathname === '/api/health') {
    await pool.query('select 1');
    sendJson(response, 200, { status: 'ok' });
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/photo') {
    const [payload, signature, extra] = (url.searchParams.get('token') ?? '').split('.');
    if (!payload || !signature || extra) throw fail('This driver photo link is invalid or expired.', 403);
    const expected = Buffer.from(signAdminPayload(payload));
    const received = Buffer.from(signature);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
      throw fail('This driver photo link is invalid or expired.', 403);
    }
    let photo;
    try {
      photo = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    } catch {
      throw fail('This driver photo link is invalid or expired.', 403);
    }
    if (!Number.isSafeInteger(photo.exp) || photo.exp <= Math.floor(Date.now() / 1000)
      || photo.exp > Math.floor(Date.now() / 1000) + 7200
      || typeof photo.path !== 'string'
      || !/^[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png)$/i.test(photo.path)) {
      throw fail('This driver photo link is invalid or expired.', 403);
    }
    response.writeHead(200, {
      'Content-Type': photo.path.endsWith('.png') ? 'image/png' : 'image/jpeg',
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    const stream = createReadStream(join(config.privateDocumentsDir, photo.path));
    stream.on('error', (error) => {
      console.error('Driver photo read failed:', error);
      if (!response.headersSent) sendJson(response, 404, { error: 'Driver photo is unavailable.' });
      else response.destroy(error);
    });
    stream.pipe(response);
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
                  da.status as driver_status,
                  restriction.restricted_until as current_restriction_until,
                  restriction.reason as current_restriction_reason
           from app_users u
           left join driver_applications da on da.user_id = u.id
           left join lateral (
             select restricted_until, reason
             from account_restrictions ar
             where ar.user_id=u.id and ar.lifted_at is null
               and (ar.restricted_until is null or ar.restricted_until > now())
             order by ar.created_at desc limit 1
           ) restriction on true
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
    const userRestrictionMatch = pathname.match(
      /^\/api\/admin\/users\/([0-9a-f-]{36})\/restriction$/i,
    );
    if (method === 'POST' && userRestrictionMatch) {
      const body = await readJson(request);
      const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
      const permanent = body.permanent === true;
      const durationHours = Number(body.duration_hours);
      if (reason.length < 5 || reason.length > 500
        || (permanent && body.duration_hours !== undefined)
        || (!permanent && (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720))) {
        throw fail('Provide a reason and a valid restriction duration (1–720 hours), or choose a permanent block.');
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const account = await client.query(
          'select id from app_users where id=$1 for update',
          [userRestrictionMatch[1]],
        );
        if (!account.rowCount) throw fail('User account not found.', 404);
        await client.query(
          `update account_restrictions
           set lifted_at=now(), lifted_by=$2
           where user_id=$1 and lifted_at is null`,
          [userRestrictionMatch[1], config.adminUsername],
        );
        const restriction = await client.query(
          `insert into account_restrictions
            (user_id, restricted_until, reason, created_by)
           values (
             $1,
             case when $2::boolean then null else now() + ($3::integer * interval '1 hour') end,
             $4, $5
           )
           returning restricted_until, created_at`,
          [userRestrictionMatch[1], permanent, permanent ? null : durationHours,
            reason, config.adminUsername],
        );
        await client.query(
          'update driver_presence set is_online=false, updated_at=now() where user_id=$1',
          [userRestrictionMatch[1]],
        );
        await client.query(
          `update ride_requests
           set driver_offer_status='rejected', updated_at=now()
           where driver_offer_id=$1 and status='searching' and driver_offer_status='pending'`,
          [userRestrictionMatch[1]],
        );
        await client.query('commit');
        sendJson(response, 200, {
          success: true,
          restricted_until: restriction.rows[0].restricted_until,
          created_at: restriction.rows[0].created_at,
        });
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      return;
    }
    if (method === 'DELETE' && userRestrictionMatch) {
      const result = await pool.query(
        `update account_restrictions
         set lifted_at=now(), lifted_by=$2
         where user_id=$1 and lifted_at is null
           and (restricted_until is null or restricted_until > now())
         returning id`,
        [userRestrictionMatch[1], config.adminUsername],
      );
      if (!result.rowCount) throw fail('There is no active restriction to lift.', 404);
      sendJson(response, 200, { success: true });
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/reports') {
      const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
      const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
      const status = url.searchParams.get('status') ?? 'open';
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100
        || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0
        || !['open', 'reviewing', 'resolved', 'dismissed', 'all'].includes(status)) {
        throw fail('Invalid report-list page or status.');
      }
      const statusFilter = status === 'all' ? null : status;
      const [count, reports] = await Promise.all([
        pool.query(
          `select count(*)::int as total from ride_reports
           where $1::text is null or status=$1`,
          [statusFilter],
        ),
        pool.query(
          `select report.id as report_id, report.request_id, report.reporter_id,
                  reporter.display_name as reporter_name, reporter.email as reporter_email,
                  report.reported_user_id, reported.display_name as reported_name,
                  reported.email as reported_email, report.category, report.details,
                  report.status, report.created_at, report.reviewed_at,
                  report.reviewed_by, report.review_note,
                  ride.pickup_address, ride.destination_address, ride.vehicle,
                  ride.offered_fare, ride.created_at as ride_created_at
           from ride_reports report
           join app_users reporter on reporter.id=report.reporter_id
           join app_users reported on reported.id=report.reported_user_id
           join ride_requests ride on ride.id=report.request_id
           where $1::text is null or report.status=$1
           order by report.created_at desc, report.id
           limit $2 offset $3`,
          [statusFilter, requestedLimit, requestedOffset],
        ),
      ]);
      sendJson(response, 200, {
        reports: reports.rows,
        total: count.rows[0].total,
        limit: requestedLimit,
        offset: requestedOffset,
      });
      return;
    }
    if (method === 'GET' && pathname === '/api/admin/support/conversations') {
      const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
      const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
      const status = url.searchParams.get('status') ?? 'open';
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100
        || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0
        || !['open', 'closed', 'all'].includes(status)) {
        throw fail('Invalid support inbox page or status.');
      }
      const statusFilter = status === 'all' ? null : status;
      const [count, conversations] = await Promise.all([
        pool.query(
          `select count(*)::int as total from support_conversations
           where $1::text is null or status=$1`,
          [statusFilter],
        ),
        pool.query(
          `select conversation.id as conversation_id, conversation.user_id,
                  customer.display_name as customer_name, customer.email as customer_email,
                  conversation.status, conversation.created_at, conversation.updated_at,
                  latest.body as last_message, latest.sender_role as last_sender_role,
                  latest.created_at as last_message_at
           from support_conversations conversation
           join app_users customer on customer.id=conversation.user_id
           left join lateral (
             select body, sender_role, created_at
             from support_messages
             where conversation_id=conversation.id
             order by created_at desc, id desc limit 1
           ) latest on true
           where $1::text is null or conversation.status=$1
           order by conversation.updated_at desc, conversation.id
           limit $2 offset $3`,
          [statusFilter, requestedLimit, requestedOffset],
        ),
      ]);
      sendJson(response, 200, {
        conversations: conversations.rows,
        total: count.rows[0].total,
        limit: requestedLimit,
        offset: requestedOffset,
      });
      return;
    }
    const adminSupportMessagesMatch = pathname.match(
      /^\/api\/admin\/support\/conversations\/([0-9a-f-]{36})\/messages$/i,
    );
    if (adminSupportMessagesMatch && method === 'GET') {
      const messages = await pool.query(
        `select message.id, message.sender_role, message.body, message.created_at
         from (
           select id, sender_role, body, created_at
           from support_messages
           where conversation_id=$1
           order by created_at desc, id desc
           limit 500
         ) message
         order by message.created_at, message.id`,
        [adminSupportMessagesMatch[1]],
      );
      if (!messages.rowCount && !(await pool.query(
        'select 1 from support_conversations where id=$1',
        [adminSupportMessagesMatch[1]],
      )).rowCount) {
        throw fail('Support conversation not found.', 404);
      }
      sendJson(response, 200, { messages: messages.rows });
      return;
    }
    if (adminSupportMessagesMatch && method === 'POST') {
      const body = await readJson(request);
      const message = typeof body.message === 'string' ? body.message.trim() : '';
      if (message.length < 1 || message.length > 2000) {
        throw fail('A support reply must contain 1 to 2000 characters.');
      }
      const client = await pool.connect();
      try {
        await client.query('begin');
        const conversation = await client.query(
          'select id from support_conversations where id=$1 for update',
          [adminSupportMessagesMatch[1]],
        );
        if (!conversation.rowCount) throw fail('Support conversation not found.', 404);
        await client.query(
          `insert into support_messages (conversation_id, sender_role, body)
           values ($1, 'admin', $2)`,
          [adminSupportMessagesMatch[1], message],
        );
        await client.query(
          `update support_conversations set status='open', updated_at=now() where id=$1`,
          [adminSupportMessagesMatch[1]],
        );
        await client.query('commit');
      } catch (error) {
        await client.query('rollback');
        throw error;
      } finally {
        client.release();
      }
      sendJson(response, 201, { sent: true });
      return;
    }
    const adminSupportConversationMatch = pathname.match(
      /^\/api\/admin\/support\/conversations\/([0-9a-f-]{36})$/i,
    );
    if (adminSupportConversationMatch && method === 'PATCH') {
      const body = await readJson(request);
      if (body.status !== 'open' && body.status !== 'closed') {
        throw fail('Choose open or closed for the support conversation.');
      }
      const result = await pool.query(
        `update support_conversations set status=$2, updated_at=now()
         where id=$1 returning id, status`,
        [adminSupportConversationMatch[1], body.status],
      );
      if (!result.rowCount) throw fail('Support conversation not found.', 404);
      sendJson(response, 200, { success: true, ...result.rows[0] });
      return;
    }
    const reportReviewMatch = pathname.match(
      /^\/api\/admin\/reports\/([0-9a-f-]{36})$/i,
    );
    if (method === 'PATCH' && reportReviewMatch) {
      const body = await readJson(request);
      const note = typeof body.note === 'string' ? body.note.trim() : '';
      if (!['reviewing', 'resolved', 'dismissed'].includes(body.status)
        || note.length > 500) {
        throw fail('Choose a valid report status and keep the review note under 500 characters.');
      }
      const result = await pool.query(
        `update ride_reports set status=$2, review_note=$3,
           reviewed_at=case when $2='reviewing' then null else now() end,
           reviewed_by=$4
         where id=$1 returning id, status, reviewed_at`,
        [reportReviewMatch[1], body.status, note, config.adminUsername],
      );
      if (!result.rowCount) throw fail('Ride report not found.', 404);
      sendJson(response, 200, { success: true, ...result.rows[0] });
      return;
    }
    const userHistoryMatch = pathname.match(
      /^\/api\/admin\/users\/([0-9a-f-]{36})\/history$/i,
    );
    if (method === 'GET' && userHistoryMatch) {
      const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
      const requestedOffset = Number(url.searchParams.get('offset') ?? 0);
      if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100
        || !Number.isSafeInteger(requestedOffset) || requestedOffset < 0) {
        throw fail('Invalid ride-history page.');
      }
      const userId = userHistoryMatch[1];
      const [count, rides] = await Promise.all([
        pool.query(
          `select count(*)::int as total
           from ride_requests
           where rider_id=$1 or driver_id=$1`,
          [userId],
        ),
        pool.query(
          `select r.id as request_id, r.status,
                  case when r.rider_id=$1 then 'rider' else 'driver' end as user_role,
                  case when r.rider_id=$1 then coalesce(driver.display_name, 'No driver assigned')
                       else rider.display_name end as other_party_name,
                  case when r.rider_id=$1 then coalesce(driver.email, '')
                       else rider.email end as other_party_email,
                  r.pickup_address, r.destination_address,
                  r.pickup_latitude, r.pickup_longitude,
                  r.destination_latitude, r.destination_longitude,
                  r.vehicle, r.offered_fare, r.cash_collected, r.created_at, r.updated_at,
                  case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                    then dp.latitude else r.last_driver_latitude end as driver_latitude,
                  case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                    then dp.longitude else r.last_driver_longitude end as driver_longitude,
                  case when r.status='accepted' and dp.updated_at > now() - interval '60 seconds'
                    then dp.updated_at else r.last_driver_location_at end as driver_location_at,
                  (r.status='accepted' and dp.updated_at > now() - interval '60 seconds')
                    as driver_location_is_live
           from ride_requests r
           join app_users rider on rider.id=r.rider_id
           left join app_users driver on driver.id=r.driver_id
           left join driver_presence dp on dp.user_id=r.driver_id
           where r.rider_id=$1 or r.driver_id=$1
           order by r.updated_at desc, r.id
           limit $2 offset $3`,
          [userId, requestedLimit, requestedOffset],
        ),
      ]);
      sendJson(response, 200, {
        rides: rides.rows,
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

  if (method === 'POST' && pathname === '/api/support/conversations') {
    const user = await requireUser(request);
    const result = await pool.query(
      `insert into support_conversations (user_id)
       values ($1)
       on conflict (user_id) where status='open'
       do update set updated_at=now()
       returning id as conversation_id, status, created_at, updated_at`,
      [user.id],
    );
    sendJson(response, 200, result.rows[0]);
    return;
  }

  const supportMessagesMatch = pathname.match(
    /^\/api\/support\/conversations\/([0-9a-f-]{36})\/messages$/i,
  );
  if (supportMessagesMatch && method === 'GET') {
    const user = await requireUser(request);
    const conversation = await pool.query(
      `select id, status from support_conversations where id=$1 and user_id=$2`,
      [supportMessagesMatch[1], user.id],
    );
    if (!conversation.rowCount) throw fail('Support conversation not found.', 404);
    const messages = await pool.query(
      `select id, sender_role, body, created_at
       from support_messages
       where conversation_id=$1
       order by created_at desc, id desc
       limit 200`,
      [supportMessagesMatch[1]],
    );
    sendJson(response, 200, {
      status: conversation.rows[0].status,
      messages: messages.rows.reverse(),
    });
    return;
  }
  if (supportMessagesMatch && method === 'POST') {
    const user = await requireUser(request);
    const body = await readJson(request);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (message.length < 1 || message.length > 2000) {
      throw fail('A support message must contain 1 to 2000 characters.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      const conversation = await client.query(
        `select id, status from support_conversations
         where id=$1 and user_id=$2 for update`,
        [supportMessagesMatch[1], user.id],
      );
      if (!conversation.rowCount) throw fail('Support conversation not found.', 404);
      if (conversation.rows[0].status !== 'open') {
        throw fail('This support conversation is closed. Start a new chat for more help.', 409);
      }
      await client.query(
        `insert into support_messages (conversation_id, sender_role, sender_user_id, body)
         values ($1, 'customer', $2, $3)`,
        [supportMessagesMatch[1], user.id, message],
      );
      await client.query(
        `update support_conversations set updated_at=now() where id=$1`,
        [supportMessagesMatch[1]],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
    sendJson(response, 201, { sent: true });
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/application') {
    const user = await requireUser(request);
    sendJson(response, 200, { application: await driverApplication(user.id) });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/profile') {
    const user = await requireUser(request);
    const upload = await parseDriverProfilePhoto(request, user.id);
    const color = (upload.fields.vehicle_color ?? '').trim();
    const registrationNumber = (upload.fields.vehicle_registration_number ?? '')
      .trim().toUpperCase();
    if (!/^[\p{L}][\p{L}0-9 -]{0,39}$/u.test(color)
      || !/^[A-Z0-9 -]{2,20}$/.test(registrationNumber)) {
      await Promise.all(upload.createdFiles.map((path) => rm(path, { force: true })));
      throw fail('Enter a valid vehicle color and registration number.');
    }
    const client = await pool.connect();
    let previousPhotoPath = null;
    try {
      await client.query('begin');
      const current = await client.query(
        `select driver_photo_path from driver_applications
         where user_id=$1 and status='approved' for update`,
        [user.id],
      );
      if (!current.rowCount) throw fail('Driver approval is required to update your public profile.', 403);
      previousPhotoPath = current.rows[0].driver_photo_path;
      if (!upload.photoPath && !previousPhotoPath) {
        throw fail('Upload a driver profile photo.');
      }
      await client.query(
        `update driver_applications set vehicle_color=$2,
           vehicle_registration_number=$3, driver_photo_path=coalesce($4, driver_photo_path)
         where user_id=$1`,
        [user.id, color, registrationNumber, upload.photoPath],
      );
      await client.query('commit');
      if (previousPhotoPath && previousPhotoPath !== upload.photoPath
        && /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png)$/i.test(previousPhotoPath)) {
        await rm(join(config.privateDocumentsDir, previousPhotoPath), { force: true });
      }
      sendJson(response, 200, { success: true });
    } catch (error) {
      await client.query('rollback');
      await Promise.all(upload.createdFiles.map((path) => rm(path, { force: true })));
      throw error;
    } finally {
      client.release();
    }
    return;
  }

  if (method === 'GET' && pathname === '/api/driver/dashboard') {
    const user = await requireUser(request);
    const [application, summary, rides] = await Promise.all([
      pool.query(
        `select full_name, vehicle_type, vehicle_make, vehicle_model, vehicle_year,
                vehicle_color, vehicle_registration_number, driver_photo_path,
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
    const driverProfile = application.rows[0] ?? null;
    sendJson(response, 200, {
      profile: { display_name: user.display_name, email: user.email },
      application: driverProfile ? {
        ...driverProfile,
        driver_photo_url: createDriverPhotoUrl(driverProfile.driver_photo_path),
        driver_photo_path: undefined,
      } : null,
      summary: summary.rows[0],
      recent_rides: rides.rows,
      payment_method: 'cash',
    });
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/application') {
    const user = await requireUser(request);
    const upload = await parseDriverUpload(request, user.id);
    const { fields, documents, driverPhotoPath } = upload;
    const fullName = (fields.full_name ?? '').trim();
    const vehicleType = fields.vehicle_type ?? '';
    const vehicleMake = (fields.vehicle_make ?? '').trim();
    const vehicleModel = (fields.vehicle_model ?? '').trim();
    const vehicleYear = Number(fields.vehicle_year);
    const vehicleColor = (fields.vehicle_color ?? '').trim();
    const registrationNumber = (fields.vehicle_registration_number ?? '').trim().toUpperCase();
    if (fullName.length < 2 || fullName.length > 80 || !VEHICLES.has(vehicleType)
      || vehicleMake.length < 1 || vehicleMake.length > 80
      || vehicleModel.length < 1 || vehicleModel.length > 80
      || !Number.isInteger(vehicleYear) || vehicleYear < 1980 || vehicleYear > 2100
      || !/^[\p{L}][\p{L}0-9 -]{0,39}$/u.test(vehicleColor)
      || !/^[A-Z0-9 -]{2,20}$/.test(registrationNumber)) {
      await Promise.all(upload.createdFiles.map((path) => rm(path, { force: true })));
      throw fail('Enter a valid name, vehicle make, model, year, color, and registration number.');
    }
    const client = await pool.connect();
    let previousDocumentPaths = [];
    let previousDriverPhotoPath = null;
    try {
      await client.query('begin');
      const existing = await client.query(
        'select id, status, documents, driver_photo_path from driver_applications where user_id = $1 for update',
        [user.id],
      );
      if (existing.rows[0]?.status === 'pending' || existing.rows[0]?.status === 'approved') {
        throw fail('An application is already under review or approved.', 409);
      }
      const application = existing.rows[0]
        ? await client.query(
          `update driver_applications set full_name=$2, vehicle_type=$3, vehicle_make=$4,
             vehicle_model=$5, vehicle_year=$6, documents=$7, vehicle_color=$8,
             vehicle_registration_number=$9, driver_photo_path=$10, status='pending',
             review_note='', submitted_at=now(), reviewed_at=null, reviewed_by=null
           where id=$1 returning id, status`,
          [existing.rows[0].id, fullName, vehicleType, vehicleMake, vehicleModel, vehicleYear,
            JSON.stringify(documents), vehicleColor, registrationNumber, driverPhotoPath],
        )
        : await client.query(
          `insert into driver_applications
             (user_id, full_name, vehicle_type, vehicle_make, vehicle_model, vehicle_year,
              documents, vehicle_color, vehicle_registration_number, driver_photo_path)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id, status`,
          [user.id, fullName, vehicleType, vehicleMake, vehicleModel, vehicleYear,
            JSON.stringify(documents), vehicleColor, registrationNumber, driverPhotoPath],
        );
      if (existing.rows[0] && Array.isArray(existing.rows[0].documents)) {
        previousDriverPhotoPath = existing.rows[0].driver_photo_path;
        previousDocumentPaths = existing.rows[0].documents
          .map((document) => document?.path)
          .filter((path) => typeof path === 'string'
            && /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(pdf|jpg|png)$/i.test(path))
          .map((path) => join(config.privateDocumentsDir, path));
      }
      await client.query('commit');
      await Promise.all(previousDocumentPaths.map((path) => rm(path, { force: true })))
        .catch((error) => console.error('Previous private document cleanup failed:', error));
      if (previousDriverPhotoPath
        && /^[0-9a-f-]{36}-[0-9a-f-]{36}\.(jpg|png)$/i.test(previousDriverPhotoPath)) {
        await rm(join(config.privateDocumentsDir, previousDriverPhotoPath), { force: true });
      }
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
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (online) {
        await lockAndEnsureAccountCanUseServices(client, user.id);
        const application = await client.query(
          `select 1 from driver_applications
           where user_id = $1 and status = 'approved'
             and vehicle_color <> '' and vehicle_registration_number <> ''
             and driver_photo_path is not null`,
          [user.id],
        );
        if (!application.rowCount) {
          throw fail('Complete your public driver and vehicle profile before going online.', 403);
        }
        const active = await client.query(
          `select 1 from ride_requests where driver_id = $1 and status = 'accepted'`,
          [user.id],
        );
        if (active.rowCount) throw fail('Complete your active ride before going online.');
      }
      await client.query(
        `update app_users set display_name = $2 where id = $1`,
        [user.id, displayName],
      );
      await client.query(
        `insert into driver_presence (user_id, vehicle, is_online, latitude, longitude, updated_at)
         values ($1,$2,$3,$4,$5,now())
         on conflict (user_id) do update set vehicle=excluded.vehicle, is_online=excluded.is_online,
           latitude=excluded.latitude, longitude=excluded.longitude, updated_at=now()`,
        [user.id, vehicle, online, latitude, longitude],
      );
      await client.query('commit');
      sendJson(response, 200, { success: true });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await client.query(
        `update driver_presence as dp
         set latitude = $3, longitude = $4, is_online = false, updated_at = now()
         from ride_requests as r
         where dp.user_id = $1 and r.id = $2 and r.driver_id = $1 and r.status = 'accepted'
         returning dp.user_id`,
        [user.id, body.request_id, latitude, longitude],
      );
      if (!result.rowCount) throw fail('This active ride is no longer available for location sharing.', 404);
      await client.query(
        `update ride_requests
         set last_driver_latitude=$3, last_driver_longitude=$4,
             last_driver_location_at=now(), updated_at=now()
         where id=$1 and driver_id=$2 and status='accepted'`,
        [body.request_id, user.id, latitude, longitude],
      );
      await client.query('commit');
      sendJson(response, 200, { success: true });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
         and not exists (
           select 1 from driver_request_dismissals dismissed
           where dismissed.request_id=r.id and dismissed.driver_id=$4
         )
         and ${sqlDistance} <= 10000
       order by distance_m, r.created_at limit 50`,
      [latitude, longitude, vehicle, user.id, user.id],
    );
    sendJson(response, 200, result.rows);
    return;
  }

  if (method === 'POST' && pathname === '/api/driver/request-response') {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (!isUuid(body.request_id) || !['accept', 'reject'].includes(body.action)) {
      throw fail('Provide a valid ride request and choose accept or reject.');
    }
    const client = await pool.connect();
    try {
      await client.query('begin');
      if (body.action === 'accept') {
        await lockAndEnsureAccountCanUseServices(client, user.id);
      }
      const approval = await client.query(
        `select 1 from driver_applications where user_id=$1 and status='approved' for update`,
        [user.id],
      );
      if (!approval.rowCount) throw fail('Driver approval is required to respond to ride requests.', 403);
      const request = await client.query(
        `select id, rider_id, vehicle, pickup_latitude, pickup_longitude,
                driver_offer_id, driver_offer_status
         from ride_requests where id=$1 and status='searching' for update`,
        [body.request_id],
      );
      if (!request.rowCount) throw fail('This ride request is no longer available.', 409);
      const ride = request.rows[0];
      if (ride.rider_id === user.id) throw fail('You cannot respond to your own ride request.', 403);

      const presence = await client.query(
        `select vehicle, latitude, longitude from driver_presence
         where user_id=$1 and is_online and updated_at > now() - interval '90 seconds'
         for update`,
        [user.id],
      );
      if (!presence.rowCount) throw fail('Go online with location enabled before responding.');
      const driver = presence.rows[0];
      if (ride.vehicle !== driver.vehicle) throw fail('Your vehicle does not match this ride request.', 409);
      const distance = distanceMeters(
        Number(driver.latitude),
        Number(driver.longitude),
        Number(ride.pickup_latitude),
        Number(ride.pickup_longitude),
      );
      if (distance > 10000) throw fail('This ride request is outside your 10 km matching area.', 409);

      if (body.action === 'accept') {
        if (ride.driver_offer_status === 'pending') {
          throw fail('A fare offer is already waiting for the rider. Wait for their response.', 409);
        }
        const accepted = await client.query(
          `update ride_requests
           set status='accepted', driver_id=$2, updated_at=now()
           where id=$1 and status='searching' returning id`,
          [body.request_id, user.id],
        );
        if (!accepted.rowCount) throw fail('This ride request is no longer available.', 409);
        await client.query(
          'update driver_presence set is_online=false where user_id=$1',
          [user.id],
        );
      } else {
        await client.query(
          `insert into driver_request_dismissals (request_id, driver_id)
           values ($1, $2) on conflict (request_id, driver_id) do nothing`,
          [body.request_id, user.id],
        );
        if (ride.driver_offer_id === user.id && ride.driver_offer_status === 'pending') {
          await client.query(
            `update ride_requests set driver_offer_status='rejected', updated_at=now()
             where id=$1`,
            [body.request_id],
          );
        }
      }

      await client.query('commit');
      sendJson(response, 200, { success: true, action: body.action });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
      await lockAndEnsureAccountCanUseServices(client, user.id);
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
    const client = await pool.connect();
    try {
      await client.query('begin');
      await lockAndEnsureAccountCanUseServices(client, user.id);
      const result = await client.query(
        `insert into ride_requests
         (rider_id,pickup_address,destination_address,pickup_latitude,pickup_longitude,
          destination_latitude,destination_longitude,vehicle,offered_fare)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
        [user.id, pickupAddress, destinationAddress, pickupLatitude, pickupLongitude,
          destinationLatitude, destinationLongitude, vehicle, offeredFare],
      );
      await client.query('commit');
      sendJson(response, 201, { request_id: result.rows[0].id });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
              coalesce(driver_application.vehicle_make, '') as driver_vehicle_make,
              coalesce(driver_application.vehicle_model, '') as driver_vehicle_model,
              driver_application.vehicle_year as driver_vehicle_year,
              coalesce(driver_application.vehicle_color, '') as driver_vehicle_color,
              coalesce(driver_application.vehicle_registration_number, '') as driver_vehicle_registration_number,
              driver_application.driver_photo_path,
              (select round(avg(rating)::numeric, 1)::double precision
               from driver_ratings where driver_id=r.driver_id) as driver_rating,
              (select count(*)::int from driver_ratings where driver_id=r.driver_id)
                as driver_rating_count,
              (select count(*)::int from ride_requests
               where driver_id=r.driver_id and status='completed') as driver_completed_rides,
              rider_rating.rating as rider_rating,
              (select status from ride_reports
               where request_id=r.id and reporter_id=r.rider_id) as rider_report_status,
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
       left join driver_applications driver_application
         on driver_application.user_id=r.driver_id
       left join driver_ratings rider_rating
         on rider_rating.request_id=r.id and rider_rating.rider_id=r.rider_id
       left join app_users offer_driver on offer_driver.id=r.driver_offer_id
       left join driver_presence offer_presence on offer_presence.user_id=r.driver_offer_id
       where r.id=$1 and r.rider_id=$2`,
      [rideId, user.id],
    );
    if (!rideResult.rowCount) throw fail('Ride request not found.', 404);
    const status = rideResult.rows[0];
    status.driver_photo_url = createDriverPhotoUrl(status.driver_photo_path);
    delete status.driver_photo_path;
    const drivers = status.status === 'searching' ? await getNearbyDrivers(user.id, rideId) : [];
    sendJson(response, 200, { status, drivers });
    return;
  }

  const rideRatingMatch = pathname.match(/^\/api\/rides\/([0-9a-f-]{36})\/rating$/i);
  if (method === 'POST' && rideRatingMatch) {
    const user = await requireUser(request);
    const body = await readJson(request);
    if (!Number.isInteger(body.rating) || body.rating < 1 || body.rating > 5) {
      throw fail('Choose a rating from 1 to 5 stars.');
    }
    const ride = await pool.query(
      `select driver_id from ride_requests
       where id=$1 and rider_id=$2 and status='completed'`,
      [rideRatingMatch[1], user.id],
    );
    if (!ride.rowCount || !ride.rows[0].driver_id) {
      throw fail('You can rate the driver after this ride is completed.', 409);
    }
    try {
      await pool.query(
        `insert into driver_ratings (request_id, rider_id, driver_id, rating)
         values ($1,$2,$3,$4)`,
        [rideRatingMatch[1], user.id, ride.rows[0].driver_id, body.rating],
      );
    } catch (error) {
      if (error?.code === '23505') throw fail('You have already rated this ride.', 409);
      throw error;
    }
    const result = await pool.query(
      `select round(avg(rating)::numeric, 1)::double precision as rating,
              count(*)::int as rating_count
       from driver_ratings where driver_id=$1`,
      [ride.rows[0].driver_id],
    );
    sendJson(response, 201, result.rows[0]);
    return;
  }

  const rideReportMatch = pathname.match(/^\/api\/rides\/([0-9a-f-]{36})\/report$/i);
  if (method === 'POST' && rideReportMatch) {
    const user = await requireUser(request);
    const body = await readJson(request);
    const details = typeof body.details === 'string' ? body.details.trim() : '';
    if (!['safety', 'behavior', 'vehicle', 'fare', 'other'].includes(body.category)
      || details.length < 10 || details.length > 1500) {
      throw fail('Choose a report reason and describe what happened in at least 10 characters.');
    }
    const ride = await pool.query(
      `select driver_id from ride_requests
       where id=$1 and rider_id=$2 and status in ('accepted', 'completed', 'cancelled')
         and driver_id is not null`,
      [rideReportMatch[1], user.id],
    );
    if (!ride.rowCount) {
      throw fail('You can report a driver only for a ride assigned to your account.', 409);
    }
    try {
      await pool.query(
        `insert into ride_reports
          (request_id, reporter_id, reported_user_id, category, details)
         values ($1,$2,$3,$4,$5)`,
        [rideReportMatch[1], user.id, ride.rows[0].driver_id, body.category, details],
      );
    } catch (error) {
      if (error?.code === '23505') throw fail('A report for this ride has already been submitted.', 409);
      throw error;
    }
    sendJson(response, 201, { success: true, status: 'open' });
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
      const ridePreview = await client.query(
        `select driver_offer_id, driver_offer_fare
         from ride_requests
         where id=$1 and rider_id=$2 and status='searching'
           and driver_offer_status='pending'`,
        [driverOfferResponseMatch[1], user.id],
      );
      if (!ridePreview.rowCount) throw fail('This driver offer is no longer available.', 409);
      if (body.action === 'accept') {
        await lockAndEnsureAccountCanUseServices(client, ridePreview.rows[0].driver_offer_id);
      }
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
      if (ride.driver_offer_id !== ridePreview.rows[0].driver_offer_id) {
        throw fail('This driver offer has changed. Review the current offer.', 409);
      }
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
    const client = await pool.connect();
    try {
      await client.query('begin');
      await lockAndEnsureAccountCanUseServices(client, user.id);
      const result = await client.query(
        `update ride_requests set offered_fare=$3, updated_at=now()
         where id=$1 and rider_id=$2 and status='searching' returning id`,
        [rideOfferMatch[1], user.id, offeredFare],
      );
      if (!result.rowCount) throw fail('This ride offer can no longer be changed.', 409);
      await client.query('commit');
      sendJson(response, 200, { success: true, offered_fare: offeredFare });
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
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
