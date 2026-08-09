import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('WBS multi-receipt inbound persistence is one scoped, append-only transaction with stable replay',async()=>{
  const sql=await readFile(new URL('../db/migrations/061_wbs_inbound_multireceipt_atomic_persistence.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/061_wbs_inbound_multireceipt_atomic_persistence.sql',import.meta.url),'utf8');
  const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  for(const token of ['refs_persist_wbs_inbound_snapshot_rows','WBS_INBOUND_SNAPSHOT:','WBS_INBOUND_SNAPSHOT_PERSISTED','WBS.SNAPSHOT.IMPORT','rec.request_hash<>p_request_hash','rec.status=\'SUCCEEDED\'','can_create_draft','can_post'])assert.match(sql,new RegExp(token));
  assert.match(sql,/receipt_hash=ANY\(seen_hashes\)/);assert.match(sql,/source_key=ANY\(seen_sources\)/);
  assert.match(sql,/FOR group_item IN SELECT value FROM jsonb_array_elements\(p_groups\)/);assert.match(sql,/FOR row_item IN SELECT value FROM jsonb_array_elements\(group_rows\)/);
  assert.doesNotMatch(sql,/journal_entry|refs_create_auto_journal|refs_post_journal/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_persist_wbs_inbound_snapshot_rows/);
  assert.match(repository,/async persistWbsInboundSnapshotRows\(/);
});
