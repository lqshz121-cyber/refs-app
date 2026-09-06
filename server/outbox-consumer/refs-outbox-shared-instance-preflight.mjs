import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export const inventorySql = await readFile(new URL('./refs-outbox-shared-instance-preflight.sql', import.meta.url), 'utf8');
export const targetSql = `SELECT current_database() = $1 AS target_matches,
  EXISTS (SELECT 1 FROM pg_catalog.pg_database WHERE datname = $2) AS consumer_database_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $3) AS consumer_login_exists,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'refs_outbox_consumer_runtime') AS runtime_group_exists,
  current_setting('max_connections')::integer AS max_connections,
  current_setting('superuser_reserved_connections')::integer AS superuser_reserved,
  COALESCE(current_setting('reserved_connections', true), '0')::integer AS reserved,
  (SELECT count(*)::integer FROM pg_catalog.pg_stat_activity WHERE backend_type = 'client backend') AS observed_clients`;

function integer(value, minimum, label) {
  const result = Number(value);
  if (value === undefined || value === '' || !Number.isSafeInteger(result) || result < minimum) throw new Error(`Invalid ${label}`);
  return result;
}

export function configuration(env) {
  if (env.SHARED_PREFLIGHT_CONFIRM !== 'STAGING_COST_EVALUATION_ONLY') throw new Error('Explicit staging evaluation confirmation required');
  const url = new URL(env.SHARED_PREFLIGHT_DATABASE_URL);
  const database = env.SHARED_PREFLIGHT_ACCOUNTING_DATABASE;
  const consumerDatabase = env.SHARED_PREFLIGHT_CONSUMER_DATABASE;
  const consumerLogin = env.SHARED_PREFLIGHT_CONSUMER_LOGIN;
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !database || decodeURIComponent(url.pathname.slice(1)) !== database) throw new Error('Exact accounting database required');
  if (!/^refs_outbox_consumer_[a-z0-9_]+$/.test(consumerDatabase ?? '') || !/^refs_outbox_consumer_[a-z0-9_]+$/.test(consumerLogin ?? '') || consumerDatabase === database || consumerLogin === 'refs_outbox_consumer_runtime') throw new Error('Distinct proposed consumer database/login required');
  return { connectionString: url.href, database, consumerDatabase, consumerLogin,
    providerLimit: integer(env.SHARED_PREFLIGHT_PROVIDER_CONNECTION_LIMIT, 1, 'provider connection limit'),
    existingPeak: env.SHARED_PREFLIGHT_EXISTING_PEAK_CONNECTIONS === undefined ? null : integer(env.SHARED_PREFLIGHT_EXISTING_PEAK_CONNECTIONS, 0, 'existing configured peak'),
    // Existing consumer max 5 + two dispatcher pools max 10, with 2x rollout overlap.
    proposedPeak: 50, operationsReserve: 10 };
}

export function evaluate(snapshot, acl, config) {
  if (!snapshot || ['target_matches', 'consumer_database_exists', 'consumer_login_exists', 'runtime_group_exists'].some(key => typeof snapshot[key] !== 'boolean') ||
      ['max_connections', 'superuser_reserved', 'reserved', 'observed_clients'].some(key => !Number.isSafeInteger(snapshot[key]) || snapshot[key] < 0) ||
      !Array.isArray(acl) || acl.some(row => !row || typeof row.category !== 'string' || typeof row.privilege_type !== 'string' || typeof row.security_definer !== 'boolean' || !Number.isSafeInteger(row.count) || row.count < 1)) {
    throw new Error('Incomplete catalog evidence');
  }
  const stops = [];
  if (snapshot.target_matches !== true) stops.push('WRONG_DATABASE');
  if (snapshot.consumer_database_exists || snapshot.consumer_login_exists || snapshot.runtime_group_exists) stops.push('PROPOSED_NAME_COLLISION');
  if (acl.some(row => row.category === 'database' && row.privilege_type === 'CONNECT' && row.count > 0)) stops.push('ACCOUNTING_PUBLIC_CONNECT');
  if (acl.some(row => row.category === 'database' && ['CREATE', 'TEMPORARY'].includes(row.privilege_type) && row.count > 0)) stops.push('ACCOUNTING_PUBLIC_DATABASE_PRIVILEGES');
  const capacity = Math.min(config.providerLimit, snapshot.max_connections) - snapshot.superuser_reserved - snapshot.reserved;
  const required = config.existingPeak === null ? null : config.existingPeak + config.proposedPeak + config.operationsReserve;
  if (capacity < 1 || (required !== null && (!Number.isSafeInteger(required) || required > capacity))) stops.push('CONNECTION_BUDGET_EXCEEDED');
  return { purpose: 'staging-cost-evaluation-only', status: stops.length ? 'STOP' : 'NOT_PROVEN', stops,
    notProven: ['STAGING_TARGET_ATTESTATION', 'FUTURE_LOGIN_EFFECTIVE_CROSS_DATABASE_DENIAL', 'ACL_CHANGE_IMPACT_AND_ALLOWLIST',
      'SHARED_CPU_RAM_IO_AND_STORAGE_HEADROOM', 'INDEPENDENT_BACKUP_RESTORE', 'REAL_RECEIPT_AND_REPLAY',
      ...(required === null ? ['EXISTING_CONFIGURED_POOL_PEAK'] : [])],
    connectionBudget: { capacity, required, proposedPeak: config.proposedPeak, operationsReserve: config.operationsReserve,
      observedClients: snapshot.observed_clients, observationIsNotConfiguredPeak: true }, publicAcl: acl };
}

export async function preflight(client, config) {
  await client.query('BEGIN READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '5s'");
    await client.query("SET LOCAL lock_timeout = '1s'");
    const { rows: [snapshot] } = await client.query(targetSql, [config.database, config.consumerDatabase, config.consumerLogin]);
    if (snapshot?.target_matches !== true) throw new Error('Wrong database');
    const { rows } = await client.query(inventorySql);
    return evaluate(snapshot, rows, config);
  } finally { await client.query('ROLLBACK'); }
}

async function main() {
  let client;
  try {
    const config = configuration(process.env);
    const { Client } = await import('pg');
    client = new Client({ connectionString: config.connectionString, connectionTimeoutMillis: 5000,
      application_name: 'refs-outbox-shared-instance-preflight', options: '-c default_transaction_read_only=on' });
    await client.connect();
    const report = await preflight(client, config);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    process.exitCode = report.status === 'STOP' ? 2 : 3;
  } catch { process.stderr.write('Shared-instance preflight STOP: configuration, permissions, connection or catalog query failed. No readiness claim.\n'); process.exitCode = 2;
  } finally { if (client) await client.end(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
