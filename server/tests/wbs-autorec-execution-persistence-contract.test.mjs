import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

test('WBS AutoRec Reserve and Release persist only receipt-bound immutable REFS events',async()=>{
  const up=await readFile(new URL('../db/migrations/073_wbs_autorec_execution_reservation.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/073_wbs_autorec_execution_reservation.sql',import.meta.url),'utf8');
  const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  for(const token of ['CREATE TABLE wbs_autorec_execution_event','CREATE TABLE wbs_autorec_source_reservation','ENABLE ROW LEVEL SECURITY','reject_mutation','refs_execute_wbs_autorec_intent','BANK.AUTOREC.MANAGE','WBS_AUTOREC_EXECUTION:','FOR UPDATE','WBS AutoRec source capacity is already reserved','WBS AutoRec release requires fully reserved source capacity','WBS_AUTOREC_EXECUTION_PERSISTED','can_write_wbs','can_create_draft','can_post'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/refs_create_auto_journal|refs_post_journal|https?:\/\/|wbs\.lvshiwanyang/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_execute_wbs_autorec_intent/);
  assert.match(down,/DROP TABLE IF EXISTS wbs_autorec_source_reservation/);
  assert.match(repository,/async executeWbsAutoRecIntent/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='073_wbs_autorec_execution_reservation.sql'));
});
