const { Pool } = require('pg');
require('dotenv').config();

const { logMetric } = require('./http');

let pool;

const LOCAL_FALLBACK_DATABASE_URL = 'postgresql://localhost:5432/Precis_Scraper';
const DATABASE_URL_ENV_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
];

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

function hasDatabaseEnv() {
  return DATABASE_URL_ENV_VARS.some((envVar) => Boolean(process.env[envVar]))
    || Boolean(process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_DATABASE);
}

function getDatabaseUrl() {
  for (const envVar of DATABASE_URL_ENV_VARS) {
    if (process.env[envVar]) {
      return process.env[envVar];
    }
  }

  if (process.env.POSTGRES_HOST && process.env.POSTGRES_USER && process.env.POSTGRES_DATABASE) {
    const user = encodeURIComponent(process.env.POSTGRES_USER);
    const password = process.env.POSTGRES_PASSWORD ? `:${encodeURIComponent(process.env.POSTGRES_PASSWORD)}` : '';
    const host = process.env.POSTGRES_HOST;
    const database = encodeURIComponent(process.env.POSTGRES_DATABASE);
    return `postgresql://${user}${password}@${host}/${database}?sslmode=require`;
  }

  if (isProduction()) {
    throw new Error(
      'Production database configuration is missing. Set DATABASE_URL, POSTGRES_URL, or POSTGRES_HOST/POSTGRES_USER/POSTGRES_DATABASE.',
    );
  }

  return LOCAL_FALLBACK_DATABASE_URL;
}

function shouldUseSsl(connectionString) {
  const sslMode = getSslMode(connectionString);

  if (sslMode === 'disable') {
    if (isProduction()) {
      throw new Error('PGSSLMODE=disable is not allowed in production. Use require, verify-ca, or verify-full.');
    }

    return false;
  }

  if (isLocalDatabaseUrl(connectionString) && !isProduction()) {
    return false;
  }

  if (sslMode === 'allow' || sslMode === 'prefer') {
    if (isProduction()) {
      throw new Error('Production database SSL mode must be require, verify-ca, or verify-full.');
    }

    return false;
  }

  const sslConfig = {
    rejectUnauthorized: !isInsecureTlsAllowed(),
  };

  const ca = getDatabaseCa();
  if (ca) {
    sslConfig.ca = ca;
  }

  if (isProduction() && sslConfig.rejectUnauthorized === false) {
    console.warn('Database TLS certificate verification disabled by explicit opt-in. Prefer PG_SSL_CA or provider CA configuration.');
  }

  return sslConfig;
}

function getSslMode(connectionString) {
  const envMode = process.env.PGSSLMODE && process.env.PGSSLMODE.trim().toLowerCase();
  if (envMode) {
    return envMode;
  }

  try {
    return new URL(connectionString).searchParams.get('sslmode')?.toLowerCase() || '';
  } catch (_err) {
    return '';
  }
}

function isLocalDatabaseUrl(connectionString) {
  try {
    const { hostname } = new URL(connectionString);
    return ['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch (_err) {
    return /localhost|127\.0\.0\.1/i.test(connectionString);
  }
}

function isInsecureTlsAllowed() {
  return ['1', 'true', 'yes'].includes(String(process.env.PG_SSL_ALLOW_UNAUTHORIZED || '').trim().toLowerCase());
}

function getDatabaseCa() {
  const inlineCa = process.env.PG_SSL_CA || process.env.POSTGRES_CA_CERT;

  if (inlineCa) {
    return inlineCa.replace(/\\n/g, '\n');
  }

  return undefined;
}

function getPool() {
  if (!pool) {
    const connectionString = getDatabaseUrl();
    const defaultPoolMax = process.env.VERCEL ? 1 : 5;

    pool = new Pool({
      connectionString,
      ssl: shouldUseSsl(connectionString),
      max: Number(process.env.PG_POOL_MAX || defaultPoolMax),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.PG_CONNECTION_TIMEOUT_MS || 10000),
    });
  }

  return pool;
}

async function query(text, params) {
  const startedAt = Date.now();

  try {
    return await getPool().query(text, params);
  } finally {
    logMetric('db.query.duration_ms', Date.now() - startedAt);
  }
}

async function checkDatabase() {
  await query('SELECT 1');
  return true;
}

module.exports = {
  DATABASE_URL_ENV_VARS,
  LOCAL_FALLBACK_DATABASE_URL,
  checkDatabase,
  getDatabaseCa,
  getDatabaseUrl,
  getPool,
  hasDatabaseEnv,
  query,
  shouldUseSsl,
};