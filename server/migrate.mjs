import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required.');

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  connectionTimeoutMillis: 10000,
});

try {
  const directory = dirname(fileURLToPath(import.meta.url));
  const schema = await readFile(join(directory, 'schema.sql'), 'utf8');
  await pool.query('select pg_advisory_lock($1)', [731942081]);
  try {
    await pool.query(schema);
    console.log('Sawaari PostgreSQL schema is up to date.');
  } finally {
    await pool.query('select pg_advisory_unlock($1)', [731942081]);
  }
} finally {
  await pool.end();
}
