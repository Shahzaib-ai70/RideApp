import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { chmodSync, chownSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

if (!stdin.isTTY) throw new Error('Run this setup command directly in the VPS terminal.');

const envPath = '/etc/sawaari/api.env';
const wwwDataUid = Number(execFileSync('id', ['-u', 'www-data'], { encoding: 'utf8' }).trim());
const wwwDataGid = Number(execFileSync('id', ['-g', 'www-data'], { encoding: 'utf8' }).trim());
if (!Number.isSafeInteger(wwwDataUid) || !Number.isSafeInteger(wwwDataGid)) {
  throw new Error('Could not resolve the www-data user and group IDs.');
}

function question(prompt) {
  const terminal = createInterface({ input: stdin, output: stdout });
  return terminal.question(prompt).finally(() => terminal.close());
}

function secret(prompt) {
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

if (existsSync(envPath) && (await question(`${envPath} exists. Replace VPS settings? Type YES: `)) !== 'YES') {
  throw new Error('Setup cancelled; existing VPS settings were not changed.');
}

const databaseUrl = (await question('PostgreSQL connection URL: ')).trim();
const parsedDatabaseUrl = new URL(databaseUrl);
if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
  throw new Error('Enter a PostgreSQL connection URL.');
}
const databaseSsl = (await question('Require TLS for PostgreSQL? [y/N]: ')).trim().toLowerCase() === 'y';

const publicOrigin = (await question('Public website URL [https://sawaari.online]: ')).trim()
  || 'https://sawaari.online';
const parsedOrigin = new URL(publicOrigin);
if (parsedOrigin.protocol !== 'https:') throw new Error('Public website URL must use HTTPS.');

const smtpHost = (await question('Hostinger SMTP host (usually smtp.hostinger.com): ')).trim();
const smtpPort = (await question('SMTP port [465]: ')).trim() || '465';
const smtpUser = (await question('Hostinger email address (SMTP username): ')).trim();
const smtpPassword = await secret('Hostinger email password (input hidden): ');
const smtpFrom = (await question(`Sender address [${smtpUser}]: `)).trim() || smtpUser;
const adminUsername = (await question('Admin username [ShahzaibKS]: ')).trim() || 'ShahzaibKS';
if (!/^[A-Za-z0-9._-]{3,64}$/.test(adminUsername)) {
  throw new Error('Admin username must be 3-64 letters, numbers, dots, underscores or hyphens.');
}
const adminPassword = await secret('New admin password (minimum 14 characters): ');
const adminPasswordConfirm = await secret('Re-enter admin password: ');
if (adminPassword.length < 14 || adminPassword.length > 1024 || adminPassword !== adminPasswordConfirm) {
  throw new Error('Admin passwords must match and be between 14 and 1024 characters.');
}
const salt = randomBytes(16);
const digest = await scrypt(adminPassword, salt, 64);
const adminPasswordHash = `scrypt$${salt.toString('base64url')}$${digest.toString('base64url')}`;
const apiSecret = randomBytes(48).toString('base64url');
const port = Number(smtpPort);
if (!smtpHost || !smtpUser || !smtpPassword || !smtpFrom || !Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('SMTP settings are incomplete or invalid.');
}

const contents = [
  `DATABASE_URL=${JSON.stringify(databaseUrl)}`,
  `DATABASE_SSL=${databaseSsl}`,
  `PUBLIC_ORIGIN=${JSON.stringify(parsedOrigin.origin)}`,
  'API_PORT=3210',
  'NODE_ENV=production',
  `SESSION_SECRET=${JSON.stringify(apiSecret)}`,
  `SMTP_HOST=${JSON.stringify(smtpHost)}`,
  `SMTP_PORT=${port}`,
  `SMTP_SECURE=${port === 465}`,
  `SMTP_USER=${JSON.stringify(smtpUser)}`,
  `SMTP_PASSWORD=${JSON.stringify(smtpPassword)}`,
  `SMTP_FROM=${JSON.stringify(smtpFrom)}`,
  `ADMIN_USERNAME=${JSON.stringify(adminUsername)}`,
  `ADMIN_PASSWORD_HASH=${JSON.stringify(adminPasswordHash)}`,
  'PRIVATE_DOCUMENTS_DIR="/var/lib/sawaari/private-documents"',
  '',
].join('\n');

mkdirSync('/etc/sawaari', { recursive: true, mode: 0o750 });
chownSync('/etc/sawaari', 0, wwwDataGid);
chmodSync('/etc/sawaari', 0o750);
writeFileSync(envPath, contents, { mode: 0o640 });
chownSync(envPath, 0, wwwDataGid);
chmodSync(envPath, 0o640);
mkdirSync('/var/lib/sawaari', { recursive: true, mode: 0o750 });
chownSync('/var/lib/sawaari', wwwDataUid, wwwDataGid);
chmodSync('/var/lib/sawaari', 0o750);
mkdirSync('/var/lib/sawaari/private-documents', { recursive: true, mode: 0o700 });
chownSync('/var/lib/sawaari/private-documents', wwwDataUid, wwwDataGid);
chmodSync('/var/lib/sawaari/private-documents', 0o700);
console.log('Saved VPS database, SMTP, and admin settings to /etc/sawaari/api.env.');
