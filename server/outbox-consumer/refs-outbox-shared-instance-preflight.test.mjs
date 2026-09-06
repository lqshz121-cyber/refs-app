import test from 'node:test';
import assert from 'node:assert/strict';
import { configuration, evaluate, preflight, inventorySql, targetSql } from './refs-outbox-shared-instance-preflight.mjs';

const env = { SHARED_PREFLIGHT_CONFIRM: 'STAGING_COST_EVALUATION_ONLY',
  SHARED_PREFLIGHT_DATABASE_URL: 'postgresql://operator:secret@localhost/accounting',
  SHARED_PREFLIGHT_ACCOUNTING_DATABASE: 'accounting', SHARED_PREFLIGHT_CONSUMER_DATABASE: 'refs_outbox_consumer_staging',
  SHARED_PREFLIGHT_CONSUMER_LOGIN: 'refs_outbox_consumer_staging_login', SHARED_PREFLIGHT_PROVIDER_CONNECTION_LIMIT: '100' };
const snapshot = { target_matches: true, consumer_database_exists: false, consumer_login_exists: false,
  runtime_group_exists: false, max_connections: 103, superuser_reserved: 3, reserved: 0, observed_clients: 6 };

test('configuration validates exact target and separate proposed names before connection', () => {
  for (const patch of [{ SHARED_PREFLIGHT_CONFIRM: 'production' }, { SHARED_PREFLIGHT_ACCOUNTING_DATABASE: 'other' },
    { SHARED_PREFLIGHT_CONSUMER_LOGIN: 'refs_outbox_consumer_runtime' }, { SHARED_PREFLIGHT_PROVIDER_CONNECTION_LIMIT: '' }]) {
    assert.throws(() => configuration({ ...env, ...patch }));
  }
  assert.equal(configuration(env).proposedPeak, 50);
});

test('quiet observed snapshot cannot prove performance or configured connection headroom', () => {
  const report = evaluate(snapshot, [], configuration(env));
  assert.equal(report.status, 'NOT_PROVEN');
  assert.equal(report.connectionBudget.required, null);
  assert.ok(report.notProven.includes('EXISTING_CONFIGURED_POOL_PEAK'));
  assert.ok(report.notProven.includes('SHARED_CPU_RAM_IO_AND_STORAGE_HEADROOM'));
  assert.ok(!JSON.stringify(report).includes('secret'));
});

test('PUBLIC CONNECT/TEMP, every proposed role/database collision, and over-budget stop', () => {
  for (const key of ['consumer_database_exists', 'consumer_login_exists', 'runtime_group_exists']) {
    assert.ok(evaluate({ ...snapshot, [key]: true }, [], configuration(env)).stops.includes('PROPOSED_NAME_COLLISION'));
  }
  const acl = ['CONNECT', 'TEMPORARY'].map(privilege_type => ({ category: 'database', privilege_type, security_definer: false, count: 1 }));
  const report = evaluate(snapshot, acl, configuration({ ...env, SHARED_PREFLIGHT_EXISTING_PEAK_CONNECTIONS: '38' }));
  assert.equal(report.status, 'STOP');
  assert.equal(report.connectionBudget.required, 98);
  assert.equal(report.connectionBudget.capacity, 97);
  assert.deepEqual(report.stops, ['ACCOUNTING_PUBLIC_CONNECT', 'ACCOUNTING_PUBLIC_DATABASE_PRIVILEGES', 'CONNECTION_BUDGET_EXCEEDED']);
});

test('missing or malformed catalog evidence fails closed', () => {
  for (const patch of [{ reserved: undefined }, { max_connections: '103' }, { consumer_login_exists: null }]) {
    assert.throws(() => evaluate({ ...snapshot, ...patch }, [], configuration(env)), /Incomplete catalog/);
  }
  assert.throws(() => evaluate(snapshot, [{ category: 'database', privilege_type: 'CONNECT' }], configuration(env)), /Incomplete catalog/);
});

test('pure catalog transaction always rolls back and never calls context or consumer functions', async () => {
  const queries = [];
  const client = { async query(sql, params) {
    queries.push({ sql, params });
    if (sql === targetSql) return { rows: [snapshot] };
    if (sql === inventorySql) return { rows: [] };
    return { rows: [] };
  } };
  await preflight(client, configuration(env));
  assert.deepEqual(queries.map(q => q.sql), ['BEGIN READ ONLY', "SET LOCAL statement_timeout = '5s'", "SET LOCAL lock_timeout = '1s'", targetSql, inventorySql, 'ROLLBACK']);
  assert.deepEqual(queries[3].params, ['accounting', 'refs_outbox_consumer_staging', 'refs_outbox_consumer_staging_login']);
  assert.doesNotMatch(inventorySql, /\b(prosrc|probin|refs_issue|refs_accept|INSERT|UPDATE|DELETE|CREATE|GRANT|REVOKE)\b/i);
  for (const kind of ['database', 'schema', 'relation', 'sequence', 'column', 'routine', 'default:']) assert.ok(inventorySql.includes(kind));
  assert.match(inventorySql, /acldefault\('d'/);
  assert.match(inventorySql, /acldefault\('f'/);
  assert.match(inventorySql, /a\.grantee = 0/);
});

test('wrong target and failed catalog query roll back without further reads or writes', async () => {
  for (const failure of ['target', 'inventory']) {
    const queries = [];
    const client = { async query(sql) {
      queries.push(sql);
      if (sql === targetSql) return { rows: [{ ...snapshot, target_matches: failure !== 'target' }] };
      if (sql === inventorySql) throw new Error('private diagnostic');
      return { rows: [] };
    } };
    await assert.rejects(preflight(client, configuration(env)));
    assert.equal(queries.at(-1), 'ROLLBACK');
    if (failure === 'target') assert.ok(!queries.includes(inventorySql));
  }
});
