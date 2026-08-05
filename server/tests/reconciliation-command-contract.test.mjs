import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('reconciliation lifecycle is permissioned, idempotent, scoped and immutable after sign-off',async()=>{
  const up=await readFile(new URL('../db/migrations/063_reconciliation_command_lifecycle.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/063_reconciliation_command_lifecycle.sql',import.meta.url),'utf8');
  for(const permission of ['BANK.RECONCILIATION.START','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REVIEW','BANK.RECONCILIATION.SIGN_OFF','BANK.RECONCILIATION.REOPEN'])assert.match(up,new RegExp(permission.replaceAll('.','\\.')));
  for(const fn of ['refs_start_reconciliation','refs_set_reconciliation_clearance','refs_transition_reconciliation'])assert.match(up,new RegExp(`CREATE FUNCTION ${fn}`));
  for(const token of ['FOR UPDATE','Idempotency key reused with a different request','Reconciliation version conflict','Bank transaction version conflict','Reviewer cannot sign off','Signer cannot reopen','reconciliation_snapshot','ENABLE ROW LEVEL SECURITY','refs_entity_allowed'])assert.match(up,new RegExp(token));
  assert.match(up,/Only exact actively matched bank evidence can be cleared/);
  assert.match(up,/Signed-off reconciliation must be reopened before its bank match can change/);
  assert.match(up,/total_items<>scoped_bank_items/);
  assert.match(up,/status='RECONCILED'/);
  assert.match(up,/pg_advisory_xact_lock\(hashtextextended/);
  assert.match(up,/reconciliation_one_open_account_uq/);
  assert.match(up,/JOIN payment_occurrence po/);
  assert.match(up,/po\.status='POSTED'/);
  assert.match(up,/po\.posted_journal_entry_id=m\.journal_entry_id/);
  assert.match(up,/po\.source_document_id IS NOT DISTINCT FROM m\.business_source_document_id/);
  assert.match(up,/source_document_id IS NOT DISTINCT FROM po\.source_document_id/);
  assert.match(up,/FROM reconciliation_snapshot s JOIN reconciliation/);
  assert.doesNotMatch(up,/refs_post_journal|INSERT INTO journal_entry|UPDATE journal_entry|DELETE FROM journal_entry/i);
  for(const fn of ['refs_transition_reconciliation','refs_set_reconciliation_clearance','refs_start_reconciliation'])assert.match(down,new RegExp(`DROP FUNCTION IF EXISTS ${fn}`));
  assert.match(down,/DROP TABLE IF EXISTS reconciliation_snapshot/);assert.match(down,/DROP INDEX IF EXISTS reconciliation_one_open_account_uq/);assert.match(down,/DROP TABLE IF EXISTS reconciliation_item/);
});
