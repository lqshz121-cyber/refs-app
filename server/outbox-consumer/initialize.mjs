import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import pg from 'pg';

// Explicit operator-only bootstrap. Admin URL is NOT attached to the web service.
const env = process.env;
let client;
try {
  const name = env.OUTBOX_CONSUMER_DATABASE_NAME;
  if (!/^refs_outbox_consumer_[a-z0-9_]+$/.test(name || '') || env.OUTBOX_CONSUMER_INITIALIZE_CONFIRM !== `INITIALIZE:${name}`) throw new Error('confirmation');
  const url = new URL(env.OUTBOX_CONSUMER_ADMIN_DATABASE_URL);
  if (decodeURIComponent(url.pathname.slice(1)) !== name) throw new Error('database');
  const sql = await readFile(new URL('./bootstrap.sql', import.meta.url), 'utf8');
  const hash = createHash('sha256').update(sql).digest('hex');
  client = new pg.Client({ connectionString: url.toString(), connectionTimeoutMillis: 5000, statement_timeout: 15000 });
  await client.connect(); await client.query('BEGIN');
  const guard = await client.query("SELECT current_database() AS name, to_regclass('public.journal_entry') AS accounting, to_regclass('public.refs_schema_migration') AS migration, to_regclass('refs_outbox_consumer.configuration') AS installed");
  if (guard.rows[0].name !== name || guard.rows[0].accounting || guard.rows[0].migration) throw new Error('authority');
  if (guard.rows[0].installed) {
    const old = await client.query('SELECT * FROM refs_outbox_consumer.configuration');
    if (old.rows.length !== 1 || old.rows[0].bootstrap_sha256 !== hash || old.rows[0].tenant_id !== env.OUTBOX_CONSUMER_TENANT_ID || old.rows[0].entity_id !== env.OUTBOX_CONSUMER_ENTITY_ID) throw new Error('drift');
  } else {
    const populated = await client.query("SELECT count(*)::int AS count FROM pg_tables WHERE schemaname NOT IN ('pg_catalog','information_schema')");
    if (populated.rows[0].count !== 0) throw new Error('not_empty');
    await client.query(sql);
    await client.query('INSERT INTO refs_outbox_consumer.configuration(database_name,tenant_id,entity_id,bootstrap_sha256) VALUES($1,$2,$3,$4)', [name,env.OUTBOX_CONSUMER_TENANT_ID,env.OUTBOX_CONSUMER_ENTITY_ID,hash]);
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ event: 'outbox_consumer_initialized', bootstrap_sha256: hash }));
} catch {
  await client?.query('ROLLBACK').catch(() => {});
  console.error(JSON.stringify({ event: 'outbox_consumer_initialization_failed' })); process.exitCode = 1;
} finally { await client?.end(); }
