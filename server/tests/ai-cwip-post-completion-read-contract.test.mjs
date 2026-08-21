import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/230_ai_cwip_post_completion_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/230_ai_cwip_post_completion_read.sql',import.meta.url),'utf8');
const kernel=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('CWIP source reader is explanation-only, primary-period bound, and write free',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);
  assert.match(up,/p\.period_id=p_period AND p\.ledger_code='PRIMARY'/);
  assert.match(up,/j\.status='POSTED'/);assert.match(up,/l\.period_id=p_period/);assert.match(up,/l\.debit_amount>0/);
  assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\s+(?:INTO|FROM|[A-Za-z_])/i);
});

test('CWIP classification and lifecycle evidence require unique approved canonical snapshots',()=>{
  assert.match(up,/family='AI_PROJECT_LIFECYCLE_EVIDENCE'/);
  assert.match(up,/snapshot_hash=refs_jsonb_hash\(s\.snapshot\)/);
  assert.match(up,/schema_version'='AI_PROJECT_LIFECYCLE_EVIDENCE_V1'/);
  assert.match(up,/m\.candidate_count=1 AND m\.classification='CWIP'/);
  assert.match(up,/project_status_snapshot_hash/);assert.match(up,/account_mapping_snapshot_hash/);
});

test('every posted CWIP debit remains visible when lifecycle or source evidence is missing',()=>{
  assert.match(up,/FROM posted_cwip l JOIN mapped_accounts m/);
  assert.match(up,/CROSS JOIN lifecycle/);
  assert.match(up,/LEFT JOIN LATERAL \(SELECT lifecycle\.snapshot->'projects'->l\.project_ref AS entry\)/);
  assert.match(up,/CASE WHEN trace\.match_count=1 THEN jsonb_build_object/);
  assert.doesNotMatch(up,/WHERE lifecycle\.candidate_count<>1/);
});

test('repository uses the exact four-argument reader and rollback removes only the reader',()=>{
  assert.match(kernel,/readAiCwipPostCompletionSource\(\{tenantId,entityId,accountingPeriodId,limit=500\}\)/);
  assert.match(kernel,/refs_read_ai_cwip_post_completion_source\(\$1,\$2,\$3,\$4\)/);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_read_ai_cwip_post_completion_source\(uuid,uuid,uuid,integer\)/);
});
