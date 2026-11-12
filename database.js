'use strict';

const fs = require('node:fs');
const path = require('node:path');

const usePostgres = Boolean(process.env.DATABASE_URL);
if (process.env.NODE_ENV === 'production' && !usePostgres) {
  throw new Error('DATABASE_URL must be set in production. Add a hosted PostgreSQL database to your Vercel project.');
}

let sqlite;
let pool;
if (usePostgres) {
  const { Pool, types } = require('pg');
  types.setTypeParser(1114, (value) => value);
  types.setTypeParser(1184, (value) => value);
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000
  });
} else {
  const Database = require('better-sqlite3');
  const dataDir = process.env.MEDICORE_DATA_DIR || path.join(__dirname, 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  sqlite = new Database(path.join(dataDir, 'medicore.sqlite'));
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
}

const sqliteSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Administrator','Manager','Salesperson','Storekeeper','Accountant')),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expired_at);
  CREATE TABLE IF NOT EXISTS medicines (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'unit',
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK(reorder_level >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS batches (
    id INTEGER PRIMARY KEY,
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    unit_cost REAL NOT NULL CHECK(unit_cost >= 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(medicine_id, batch_number)
  );
  CREATE INDEX IF NOT EXISTS batches_fefo ON batches(medicine_id, expiry_date, id);
  CREATE TABLE IF NOT EXISTS purchases (
    id INTEGER PRIMARY KEY,
    supplier TEXT NOT NULL,
    reference TEXT NOT NULL,
    total REAL NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS purchase_items (
    id INTEGER PRIMARY KEY,
    purchase_id INTEGER NOT NULL REFERENCES purchases(id),
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_cost REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id INTEGER PRIMARY KEY,
    customer TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    total REAL NOT NULL,
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    id INTEGER PRIMARY KEY,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    medicine_id INTEGER NOT NULL REFERENCES medicines(id),
    batch_id INTEGER NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_price REAL NOT NULL,
    unit_cost REAL NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY,
    party_type TEXT NOT NULL CHECK(party_type IN ('Customer','Supplier')),
    party TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('Received','Paid')),
    amount REAL NOT NULL CHECK(amount > 0),
    method TEXT NOT NULL DEFAULT 'Cash',
    note TEXT NOT NULL DEFAULT '',
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount REAL NOT NULL CHECK(amount > 0),
    user_id INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`;

const postgresSchema = `
  CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,
    username TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('Administrator','Manager','Salesperson','Storekeeper','Accountant')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower ON users(lower(username));
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expired_at);
  CREATE TABLE IF NOT EXISTS medicines (
    id BIGSERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    sku TEXT NOT NULL UNIQUE,
    unit TEXT NOT NULL DEFAULT 'unit',
    reorder_level INTEGER NOT NULL DEFAULT 10 CHECK(reorder_level >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS batches (
    id BIGSERIAL PRIMARY KEY,
    medicine_id BIGINT NOT NULL REFERENCES medicines(id),
    batch_number TEXT NOT NULL,
    expiry_date TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK(quantity >= 0),
    unit_cost DOUBLE PRECISION NOT NULL CHECK(unit_cost >= 0),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(medicine_id, batch_number)
  );
  CREATE INDEX IF NOT EXISTS batches_fefo ON batches(medicine_id, expiry_date, id);
  CREATE TABLE IF NOT EXISTS purchases (
    id BIGSERIAL PRIMARY KEY,
    supplier TEXT NOT NULL,
    reference TEXT NOT NULL,
    total DOUBLE PRECISION NOT NULL,
    user_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS purchase_items (
    id BIGSERIAL PRIMARY KEY,
    purchase_id BIGINT NOT NULL REFERENCES purchases(id),
    medicine_id BIGINT NOT NULL REFERENCES medicines(id),
    batch_id BIGINT NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_cost DOUBLE PRECISION NOT NULL
  );
  CREATE TABLE IF NOT EXISTS invoices (
    id BIGSERIAL PRIMARY KEY,
    customer TEXT NOT NULL,
    reference TEXT NOT NULL UNIQUE,
    total DOUBLE PRECISION NOT NULL,
    user_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS invoice_items (
    id BIGSERIAL PRIMARY KEY,
    invoice_id BIGINT NOT NULL REFERENCES invoices(id),
    medicine_id BIGINT NOT NULL REFERENCES medicines(id),
    batch_id BIGINT NOT NULL REFERENCES batches(id),
    quantity INTEGER NOT NULL,
    unit_price DOUBLE PRECISION NOT NULL,
    unit_cost DOUBLE PRECISION NOT NULL
  );
  CREATE TABLE IF NOT EXISTS payments (
    id BIGSERIAL PRIMARY KEY,
    party_type TEXT NOT NULL CHECK(party_type IN ('Customer','Supplier')),
    party TEXT NOT NULL,
    direction TEXT NOT NULL CHECK(direction IN ('Received','Paid')),
    amount DOUBLE PRECISION NOT NULL CHECK(amount > 0),
    method TEXT NOT NULL DEFAULT 'Cash',
    note TEXT NOT NULL DEFAULT '',
    user_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS expenses (
    id BIGSERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    amount DOUBLE PRECISION NOT NULL CHECK(amount > 0),
    user_id BIGINT REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS audit_log (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT REFERENCES users(id),
    username TEXT NOT NULL,
    action TEXT NOT NULL,
    details TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`;

let initialization;
function initialize() {
  if (!initialization) {
    initialization = usePostgres
      ? pool.query(postgresSchema)
      : Promise.resolve().then(() => sqlite.exec(sqliteSchema));
  }
  return initialization;
}

function pgSql(sql) {
  let index = 0;
  return sql.replace(/\?/g, () => `$${++index}`);
}

function sqliteSql(sql) {
  return sql
    .replace(/\(CURRENT_DATE \+ INTERVAL '90 days'\)::text/g, "date('now','+90 days')")
    .replace(/CURRENT_DATE::text/g, "date('now')")
    .replace(/CURRENT_DATE/g, "date('now')")
    .replace(/([a-z]\.)?created_at::date/g, (_, prefix = '') => `date(${prefix}created_at)`)
    .replace(/\s+FOR UPDATE\b/g, '');
}

let sqliteQueue = Promise.resolve();
function serializeSqlite(work) {
  const result = sqliteQueue.then(work);
  sqliteQueue = result.catch(() => {});
  return result;
}

function makeOperations(client, local = false) {
  const execute = (sql, params = []) => local
    ? sqlite.prepare(sqliteSql(sql))
    : client.query(pgSql(sql), params);

  return {
    get(sql, ...params) {
      if (local) return execute(sql).get(...params);
      return execute(sql, params).then((result) => result.rows[0]);
    },
    all(sql, ...params) {
      if (local) return execute(sql).all(...params);
      return execute(sql, params).then((result) => result.rows);
    },
    run(sql, ...params) {
      if (local) {
        const result = execute(sql).run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
      return execute(sql, params).then((result) => ({ changes: result.rowCount }));
    },
    insert(sql, ...params) {
      if (local) {
        const result = execute(sql).run(...params);
        return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
      }
      const statement = `${sql.trim().replace(/;$/, '')} RETURNING id`;
      return execute(statement, params).then((result) => ({
        changes: result.rowCount,
        lastInsertRowid: result.rows[0] && Number(result.rows[0].id)
      }));
    }
  };
}

const localOperations = makeOperations(null, true);
const postgresOperations = makeOperations(pool, false);

function operation(method, sql, params) {
  if (usePostgres) return initialize().then(() => postgresOperations[method](sql, ...params));
  return serializeSqlite(() => {
    if (!initialization) initialization = Promise.resolve().then(() => sqlite.exec(sqliteSchema));
    return initialization.then(() => localOperations[method](sql, ...params));
  });
}

const database = {
  get(sql, ...params) {
    return operation('get', sql, params);
  },
  all(sql, ...params) {
    return operation('all', sql, params);
  },
  run(sql, ...params) {
    return operation('run', sql, params);
  },
  insert(sql, ...params) {
    return operation('insert', sql, params);
  },
  initialize,
  async transaction(work) {
    await initialize();
    if (!usePostgres) {
      return serializeSqlite(async () => {
        sqlite.exec('BEGIN IMMEDIATE');
        try {
          const result = await work(localOperations);
          sqlite.exec('COMMIT');
          return result;
        } catch (error) {
          sqlite.exec('ROLLBACK');
          throw error;
        }
      });
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(makeOperations(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
};

module.exports = { ...database, usePostgres, pool };
