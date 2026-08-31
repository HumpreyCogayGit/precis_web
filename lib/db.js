const { Pool } = require('pg');
require('dotenv').config();

let pool;

const LOCAL_FALLBACK_DATABASE_URL = 'postgresql://localhost:5432/Precis_Scraper';
const DATABASE_URL_ENV_VARS = [
  'DATABASE_URL',
  'POSTGRES_URL',
  'POSTGRES_PRISMA_URL',
  'DATABASE_URL_UNPOOLED',
  'POSTGRES_URL_NON_POOLING',
];

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

  return LOCAL_FALLBACK_DATABASE_URL;
}

function shouldUseSsl(connectionString) {
  if (process.env.PGSSLMODE === 'disable') {
    return false;
  }

  if (/sslmode=(require|verify-ca|verify-full)/i.test(connectionString)) {
    return { rejectUnauthorized: false };
  }

  if (/localhost|127\.0\.0\.1/i.test(connectionString) && process.env.NODE_ENV !== 'production') {
    return false;
  }

  return process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false;
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

function query(text, params) {
  return getPool().query(text, params);
}

async function checkDatabase() {
  await query('SELECT 1');
  return true;
}

module.exports = {
  checkDatabase,
  getPool,
  query,
};