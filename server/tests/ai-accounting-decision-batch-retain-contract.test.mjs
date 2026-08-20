import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');

test('256 retains an AI decision population through one root idempotency transaction',async()=>{
  const up=await read('../db/migrations/256_ai_accounting_decision_batch_retain.sql');
  for(const token of ["'AI_ACCOUNTING_DECISION_BATCH_RETAIN:'","refs_retain_ai_accounting_decision(","'parent_idempotency_key'","'packet_index'","'AI_ACCOUNTING_DECISION_RUN_RECEIPT_V1'","item->>'can_post'<>'false'","p_period","row_count>500","GROUP BY refs_jsonb_hash(value) HAVING count(*)>1","GROUP BY value#>>'{source,source_document_id}' HAVING count(*)>1"])assert.ok(up.includes(token),`missing ${token}`);
  assert.doesNotMatch(up,/p_idempotency_key\s*\|\|\s*':'/);
});

test('256 down removes only the batch command',async()=>{
  const down=await read('../db/migrations/down/256_ai_accounting_decision_batch_retain.sql');
  assert.match(down,/DROP FUNCTION refs_retain_ai_accounting_decision_batch/);assert.doesNotMatch(down,/DROP TABLE|TRUNCATE|DELETE FROM/);
});
