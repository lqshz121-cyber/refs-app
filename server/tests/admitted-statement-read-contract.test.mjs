import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/093_wbs_admitted_statement_read.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/093_wbs_admitted_statement_read.sql',import.meta.url),'utf8');
const kernel=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');

test('admitted statement reads require both bank permissions and expose only closed receipt facts',()=>{
  for(const permission of ['BANK.VIEW','BANK.RECONCILIATION.START'])assert.match(up,new RegExp(`refs_assert_scope\\(p_tenant,p_entity,'${permission.replace('.','\\.')}'\\)`));
  for(const field of ['wbs_bank_statement_receipt_id','bank_account_ref','statement_start_date','statement_end_date','currency','opening_balance','ending_balance','transaction_count','statement_activity_amount','admission_hash','selection_state'])assert.match(up,new RegExp(`\\b${field}\\b`));
  assert.match(up,/statement_start_date text/);assert.match(up,/statement_end_date text/);
  assert.equal((up.match(/pg_catalog\.to_char\(s\.statement_start_date,'YYYY-MM-DD'\)/g)||[]).length,2);
  assert.equal((up.match(/pg_catalog\.to_char\(s\.statement_end_date,'YYYY-MM-DD'\)/g)||[]).length,2);
  for(const forbidden of ['statement_payload_ref','signature_key_id','statement_id text'])assert.doesNotMatch(up,new RegExp(forbidden));
  assert.match(up,/signature_verified AND s\.admission_status='ADMITTED'/);
  assert.match(up,/AVAILABLE_FOR_SERVER_VALIDATION/);assert.match(up,/BLOCKED_OPEN_RECONCILIATION/);assert.match(up,/ALREADY_STARTED/);
});

test('receipt-linked summaries use exact immutable receipt rows while legacy summaries preserve account-date scope',()=>{
  assert.match(up,/r\.wbs_bank_statement_receipt_id IS NULL[\s\S]*b\.transaction_date<=r\.statement_ending_date/);
  assert.match(up,/wbs_bank_statement_transaction t[\s\S]*t\.wbs_bank_statement_receipt_id=r\.wbs_bank_statement_receipt_id[\s\S]*t\.bank_source_id=b\.bank_source_id/);
  assert.match(up,/r\.status IN \('DRAFT','IN_REVIEW','REOPENED'\)/);
  assert.match(down,/CREATE OR REPLACE FUNCTION refs_get_reconciliation_summary/);
  assert.doesNotMatch(down,/wbs_bank_statement_transaction/);
});

test('kernel exposes only list and detail reads over the SECURITY DEFINER contracts',()=>{
  assert.match(kernel,/async listAdmittedWbsBankStatementReceipts[\s\S]*refs_list_admitted_wbs_bank_statement_receipts/);
  assert.match(kernel,/async getAdmittedWbsBankStatementReceipt[\s\S]*refs_get_admitted_wbs_bank_statement_receipt/);
  assert.match(up,/REVOKE ALL ON FUNCTION refs_list_admitted_wbs_bank_statement_receipts[\s\S]*GRANT EXECUTE ON FUNCTION refs_get_admitted_wbs_bank_statement_receipt/);
});
