import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/381_bank_match_candidate_signed_reconciliation_filter.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/381_bank_match_candidate_signed_reconciliation_filter.sql',import.meta.url),'utf8');
const signedScope="signed_statement.tenant_id=p_tenant AND signed_statement.entity_id=p_entity";
const signedCutoff="signed_statement.status='RECONCILED' AND signed_statement.statement_ending_date>=bank_row.transaction_date";

test('bank-match candidate readers exclude signed-off reconciliation bank lines before manual selection',()=>{
  for(const fn of ['refs_list_bank_match_candidates','refs_read_sales_receipt_bank_candidates'])assert.match(up,new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`));
  assert.equal((up.match(/FROM public\.reconciliation signed_statement/g)||[]).length,2);
  assert.equal((up.match(new RegExp(signedScope.replaceAll('.','\\.'),'g'))||[]).length,2);
  assert.equal((up.match(new RegExp(signedCutoff.replaceAll('.','\\.'),'g'))||[]).length,2);
  assert.match(up,/PERFORM public\.refs_assert_scope\(p_tenant,p_entity,'BANK\.MATCH\.CREATE'\)/);
});

test('rollback restores candidate reader definitions without altering retained bank evidence',()=>{
  for(const fn of ['refs_list_bank_match_candidates','refs_read_sales_receipt_bank_candidates'])assert.match(down,new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`));
  assert.doesNotMatch(down,/FROM public\.reconciliation signed_statement/);
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE |DELETE FROM)\s+(?:bank_source|bank_match|reconciliation|journal_entry|ledger_line)\b/i);
  assert.doesNotMatch(down,/\b(?:INSERT INTO|UPDATE |DELETE FROM)\s+(?:bank_source|bank_match|reconciliation|journal_entry|ledger_line)\b/i);
});