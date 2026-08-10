import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('reconciliation adjustment Draft is scoped, evidence-backed, versioned and cannot bypass JE workflow',async()=>{
  const up=await readFile(new URL('../db/migrations/067_reconciliation_adjustment_draft.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/067_reconciliation_adjustment_draft.sql',import.meta.url),'utf8');
  for(const token of ['BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE','reconciliation_adjustment_draft','refs_create_reconciliation_adjustment_draft','refs_set_reconciliation_adjustment_clearance','refs_transition_reconciliation_adjustment_aware','FOR UPDATE','RECONCILIATION_ADJUSTMENT_DRAFT:','Reconciliation version conflict','tenant-owned attachment evidence','exactly one bank-account line','RECONCILIATION_ADJUSTMENT_DRAFT_CREATED','ENABLE ROW LEVEL SECURITY','refs_entity_allowed'])assert.match(up,new RegExp(token.replaceAll('.','\\.')));
  assert.match(up,/rec\.status NOT IN \('DRAFT','REOPENED'\)/);
  assert.match(up,/rec\.currency<>p_currency/);
  assert.match(up,/bank_delta<>rec\.difference/);
  assert.match(up,/bank\.amount<>rec\.difference/);
  assert.match(up,/Adjustment Draft must be an exact Posted Journal Entry before clearance/);
  assert.match(up,/exact posted evidence/);
  assert.match(up,/p_journal_date>rec\.statement_ending_date/);
  assert.match(up,/NEW\.status='POSTED'/);
  assert.match(up,/Reconciliation adjustment cannot post after review or sign-off/);
  assert.match(up,/final_book_balance<>rec\.statement_ending_balance/);
  assert.match(up,/Adjustment Draft creator cannot review or sign off/);
  assert.match(up,/RECONCILIATION_ADJUSTMENT_DRAFT/);
  assert.doesNotMatch(up,/refs_transition_journal\(/);
  assert.doesNotMatch(up,/refs_post_journal\(/);
  for(const token of ['reconciliation_adjustment_post_guard','reconciliation_adjustment_review_sod_guard','refs_create_reconciliation_adjustment_draft','refs_set_reconciliation_adjustment_clearance','refs_transition_reconciliation_adjustment_aware','reconciliation_adjustment_draft'])assert.match(down,new RegExp(token));
});
