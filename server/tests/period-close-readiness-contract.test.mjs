import assert from'node:assert/strict';import test from'node:test';import{readFile}from'node:fs/promises';
import{MIGRATION_MANIFEST}from'../runtime/migration-manifest.mjs';
const up=await readFile(new URL('../db/migrations/289_period_close_readiness.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/289_period_close_readiness.sql',import.meta.url),'utf8');
const repo=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
test('period close is bound to complete current evidence and seals the legacy command',()=>{
  for(const token of ['refs_read_wbs_ai_approved_entity_period_settings','UNPOSTED_JOURNALS','ADMITTED_SOURCE_REVIEW_OPEN','APPROVED_STATEMENT_SNAPSHOT_MISSING','APPROVED_STATEMENT_SNAPSHOT_STALE','refs_get_financial_statements','readiness_hash','refs_close_period_v2','PERIOD_CLOSED_V2','REVOKE EXECUTE ON FUNCTION refs_close_period'])assert.ok(up.includes(token),`missing ${token}`);
  assert.match(up,/v_readiness->>'readiness_hash'<>p_expected_readiness_hash/);assert.match(up,/jsonb_array_length\(v_readiness->'blockers'\)<>0/);
  assert.match(up,/status='CLOSED'.*version=version\+1/s);assert.doesNotMatch(up,/INSERT INTO journal_entry|INSERT INTO journal_line|INSERT INTO ledger_line/);
  assert.match(repo,/refs_close_period_v2/);assert.match(repo,/readPeriodCloseReadiness/);assert.match(down,/Cannot roll back retained period-close evidence/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='289_period_close_readiness.sql'));
});
