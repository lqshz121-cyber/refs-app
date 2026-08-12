import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/098_signed_reconciliation_lifecycle_sod.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/098_signed_reconciliation_lifecycle_sod.sql',import.meta.url),'utf8');

test('signed statement lifecycle SoD survives role rotation without changing legacy reconciliation',()=>{
  for(const token of ['wbs_bank_statement_receipt_id IS NOT NULL','started_by=p_actor','i.cleared_by','i.uncleared_by','m.matched_by','m.unmatched_by','d.created_by=p_actor',"p_target_status IN ('RECONCILED','REOPENED')","p_target_status='REOPENED'",'refs_current_actor()','42501'])assert.match(up,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(up,/NEW\.wbs_bank_statement_receipt_id IS NULL[\s\S]*RETURN NEW/,'legacy reconciliation must retain its existing lifecycle');
  assert.match(up,/NEW\.status NOT IN \('IN_REVIEW','RECONCILED','REOPENED'\)/);
  assert.match(up,/IF actor IS NULL THEN[\s\S]*Authenticated actor missing[\s\S]*42501/,'direct or maintenance status changes without an authenticated actor must fail closed');
  assert.equal((up.match(/CREATE TRIGGER/g)??[]).length,1,'the guard must install exactly one non-recursive status trigger');
  assert.doesNotMatch(up,/UPDATE\s+reconciliation\b/i,'the trigger and helper must not recursively update reconciliation');
  assert.doesNotMatch(up,/WBS_LIVE_PILOT|UNSIGNED_PILOT|NOT_ADMITTED|INSERT INTO journal_entry|INSERT INTO ledger_line|refs_post_journal/i);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_signed_reconciliation_actor_conflict[\s\S]*REVOKE ALL ON FUNCTION refs_guard_signed_reconciliation_lifecycle_sod/);
});

test('signed statement lifecycle SoD down migration removes only its trigger and functions',()=>{
  for(const token of ['signed_reconciliation_lifecycle_sod_guard','refs_guard_signed_reconciliation_lifecycle_sod','refs_signed_reconciliation_actor_conflict'])assert.match(down,new RegExp(token));
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});
