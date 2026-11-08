import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

function ask(prompt) {
  const interface_ = createInterface({ input: stdin, output: stdout });
  return interface_.question(prompt).finally(() => interface_.close());
}

function askSecret(prompt) {
  stdout.write(prompt);
  stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const onData = (key) => {
      if (key === '\u0003') {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdout.write('\n');
        reject(new Error('Setup cancelled.'));
      } else if (key === '\r' || key === '\n') {
        stdin.off('data', onData);
        stdin.setRawMode(false);
        stdin.pause();
        stdout.write('\n');
        resolve(value);
      } else if (key === '\u007f' || key === '\b') {
        value = value.slice(0, -1);
      } else if (key >= ' ') {
        value += key;
      }
    };
    stdin.on('data', onData);
  });
}

if (!stdin.isTTY) {
  throw new Error('Run this setup command directly in the VPS terminal.');
}

const target = '/etc/sawaari/admin.env';
if (existsSync(target) && (await ask(`${target} already exists. Replace it? Type YES: `)) !== 'YES') {
  throw new Error('Setup cancelled; the existing admin environment was not changed.');
}

const username = (await ask('Admin username [ShahzaibKS]: ')).trim() || 'ShahzaibKS';
if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) {
  throw new Error('Username must be 3-64 letters, numbers, dots, underscores or hyphens.');
}

const password = await askSecret('New admin password (minimum 14 characters): ');
const confirmation = await askSecret('Re-enter admin password: ');
if (password.length < 14 || password.length > 1024 || password !== confirmation) {
  throw new Error('Passwords must match and be between 14 and 1024 characters.');
}

const supabaseUrl = (await ask('Supabase project URL: ')).trim().replace(/\/+$/, '');
const parsedUrl = new URL(supabaseUrl);
if (parsedUrl.protocol !== 'https:' || !parsedUrl.hostname.endsWith('.supabase.co')) {
  throw new Error('Enter the HTTPS URL for your Supabase project.');
}
const serviceRoleKey = (await askSecret('Supabase service_role key (input hidden): ')).trim();
if (!serviceRoleKey) throw new Error('Supabase service_role key is required for server-side data access.');

const salt = randomBytes(16);
const digest = await scrypt(password, salt, 64);
const passwordHash = `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
const sessionSecret = randomBytes(48).toString('base64url');
const contents = [
  `ADMIN_USERNAME=${username}`,
  `ADMIN_PASSWORD_HASH=${passwordHash}`,
  `ADMIN_SESSION_SECRET=${sessionSecret}`,
  `ADMIN_ORIGIN=https://sawaari.online`,
  `SUPABASE_URL=${supabaseUrl}`,
  `SUPABASE_SERVICE_ROLE_KEY=${serviceRoleKey}`,
  'NODE_ENV=production',
  'ADMIN_API_PORT=3210',
  '',
].join('\n');

mkdirSync('/etc/sawaari', { recursive: true, mode: 0o700 });
writeFileSync(target, contents, { mode: 0o600 });
chmodSync(target, 0o600);
console.log(`Saved admin settings to ${target} with owner-only permissions.`);
