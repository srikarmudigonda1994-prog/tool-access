/**
 * Database layer for per-customer tool access, backed by Postgres
 * (designed for Neon's free tier, which - unlike Render's free Postgres -
 * doesn't expire after 30 days).
 *
 * Two tables:
 *   customers   - one row per issued access link (name, which tools it
 *                 unlocks, whether it's been revoked)
 *   access_log  - one row every time someone actually uses a link, so
 *                 you can see who accessed what and when
 *
 * Required environment variable:
 *   DATABASE_URL - the connection string Neon gives you, looks like:
 *     postgresql://user:password@ep-xxxx.neon.tech/dbname?sslmode=require
 */

const { Pool } = require('pg');

let pool = null;
function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('Missing required environment variable: DATABASE_URL');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

/**
 * Creates the tables if they don't already exist. Safe to call every
 * time the server starts - it's a no-op if they're already there.
 */
async function initSchema() {
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id SERIAL PRIMARY KEY,
      token TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      tools TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      revoked BOOLEAN NOT NULL DEFAULT false
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS access_log (
      id SERIAL PRIMARY KEY,
      token TEXT NOT NULL,
      accessed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      user_agent TEXT
    );
  `);
  await db.query(`
    CREATE TABLE IF NOT EXISTS leads (
      id SERIAL PRIMARY KEY,
      tool_code TEXT,
      name TEXT,
      email TEXT,
      phone TEXT,
      lang TEXT,
      verdict TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}

function generateToken() {
  // 24 random hex characters - short enough to paste in a URL,
  // long enough that guessing one isn't practical.
  const bytes = require('crypto').randomBytes(12);
  return bytes.toString('hex');
}

/**
 * @param {string} name    label for you to recognize this customer by
 * @param {string[]} tools tool codes this link unlocks, e.g. ['prod','fin']
 */
async function createCustomer(name, tools) {
  const db = getPool();
  const token = generateToken();
  const toolsStr = tools.join(',');
  const result = await db.query(
    `INSERT INTO customers (token, name, tools) VALUES ($1, $2, $3)
     RETURNING id, token, name, tools, created_at, revoked`,
    [token, name, toolsStr]
  );
  return result.rows[0];
}

async function listCustomers() {
  const db = getPool();
  const result = await db.query(
    `SELECT id, token, name, tools, created_at, revoked
     FROM customers ORDER BY created_at DESC`
  );
  return result.rows;
}

async function setRevoked(token, revoked) {
  const db = getPool();
  const result = await db.query(
    `UPDATE customers SET revoked = $1 WHERE token = $2
     RETURNING id, token, name, tools, created_at, revoked`,
    [revoked, token]
  );
  return result.rows[0] || null;
}

async function getCustomerByToken(token) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, token, name, tools, created_at, revoked
     FROM customers WHERE token = $1`,
    [token]
  );
  return result.rows[0] || null;
}

async function logAccess(token, userAgent) {
  const db = getPool();
  await db.query(
    `INSERT INTO access_log (token, user_agent) VALUES ($1, $2)`,
    [token, userAgent || null]
  );
}

async function getAccessLog(limit) {
  const db = getPool();
  const result = await db.query(
    `SELECT access_log.id, access_log.token, access_log.accessed_at,
            access_log.user_agent, customers.name AS customer_name,
            customers.tools AS customer_tools
     FROM access_log
     LEFT JOIN customers ON access_log.token = customers.token
     ORDER BY access_log.accessed_at DESC
     LIMIT $1`,
    [limit || 200]
  );
  return result.rows;
}

/**
 * Records one lead - every time any of the 6 tools' forms is submitted,
 * regardless of whether it came through a customer access link, the
 * owner preview, or the plain public site. This is your master list of
 * everyone who has ever used any tool, separate from the access-link
 * tracking above.
 */
async function logLead({ toolCode, name, email, phone, lang, verdict }) {
  const db = getPool();
  await db.query(
    `INSERT INTO leads (tool_code, name, email, phone, lang, verdict)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [toolCode || null, name || null, email || null, phone || null, lang || null, verdict || null]
  );
}

async function getLeads(limit) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, tool_code, name, email, phone, lang, verdict, created_at
     FROM leads ORDER BY created_at DESC LIMIT $1`,
    [limit || 300]
  );
  return result.rows;
}

module.exports = {
  initSchema,
  createCustomer,
  listCustomers,
  setRevoked,
  getCustomerByToken,
  logAccess,
  getAccessLog,
  logLead,
  getLeads,
};
