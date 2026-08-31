const { Pool } = require('pg');
require('dotenv').config();

let pool;

function getDatabaseUrl() {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL || 'postgresql://localhost:5432/Precis_Scraper';
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