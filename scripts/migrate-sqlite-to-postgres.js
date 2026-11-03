'use strict';

const path = require('node:path');
const Database = require('better-sqlite3');
const database = require('../database');

const tables = [
  'users',
  'medicines',
  'batches',
  'purchases',
  'purchase_items',
  'invoices',
  'invoice_items',
  'payments',
  'expenses',
  'audit_log'
];

async function main() {
  if (!database.usePostgres) {
    throw new Error('Set DATABASE_URL to the hosted PostgreSQL connection string before running this migration.');
  }

  const sourcePath = process.env.SQLITE_PATH || path.join(__dirname, '..', 'data', 'medicore.sqlite');
  const source = new Database(sourcePath, { readonly: true });
  await database.initialize();
  const client = await database.pool.connect();

  try {
    const targetCount = await client.query(`SELECT
      (SELECT COUNT(*) FROM users) +
      (SELECT COUNT(*) FROM medicines) +
      (SELECT COUNT(*) FROM batches) +
      (SELECT COUNT(*) FROM purchases) +
      (SELECT COUNT(*) FROM purchase_items) +
      (SELECT COUNT(*) FROM invoices) +
      (SELECT COUNT(*) FROM invoice_items) +
      (SELECT COUNT(*) FROM payments) +
      (SELECT COUNT(*) FROM expenses) +
      (SELECT COUNT(*) FROM audit_log) AS count`);
    if (Number(targetCount.rows[0].count) > 0) {
      throw new Error('The PostgreSQL database already contains MediCore records. Migration stopped to avoid duplicating or overwriting data.');
    }

    await client.query('BEGIN');
    const migrated = {};
    for (const table of tables) {
      const rows = source.prepare(`SELECT * FROM "${table}" ORDER BY id`).all();
      migrated[table] = rows.length;
      if (!rows.length) continue;

      const columns = Object.keys(rows[0]);
      const names = columns.map((column) => `"${column}"`).join(',');
      const placeholders = columns.map((_, index) => `$${index + 1}`).join(',');
      const insert = `INSERT INTO "${table}" (${names}) VALUES (${placeholders})`;
      for (const row of rows) {
        await client.query(insert, columns.map((column) => row[column]));
      }

      if (columns.includes('id')) {
        await client.query(
          "SELECT setval(pg_get_serial_sequence($1, 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM " + `"${table}"`,
          [table]
        );
      }
    }
    await client.query('COMMIT');

    for (const [table, count] of Object.entries(migrated)) {
      console.log(`${table}: ${count} record(s)`);
    }
    console.log('Migration completed. Local SQLite data was not modified.');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Could not roll back the PostgreSQL migration:', rollbackError);
    }
    throw error;
  } finally {
    client.release();
    source.close();
    await database.pool.end();
  }
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exitCode = 1;
});
