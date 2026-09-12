import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const digest=value=>createHash('sha256').update(value.replace(/\r\n/g,'\n')).digest('hex');

test('sales receipts are accepted as exact posted reconciliation evidence without bypassing 385 actor binding',async()=>{
  const up=await readFile(new URL('../db/migrations/400_sales_receipt_reconciliation_evidence.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/400_sales_receipt_reconciliation_evidence.sql',import.meta.url),'utf8');
  assert.deepEqual(MIGRATION_MANIFEST.find(x=>x.name==='400_sales_receipt_reconciliation_evidence.sql'),{name:'400_sales_receipt_reconciliation_evidence.sql',up:digest(up),down:digest(down)});
  for(const fn of ['refs_set_reconciliation_clearance_385','refs_transition_reconciliation_adjustment_aware_385'])assert.match(up,new RegExp(`CREATE OR REPLACE FUNCTION ${fn}`));
  for(const token of ['EXACT_POSTED_SALES_RECEIPT','POSTED_SALES_RECEIPT_BANK_MATCH','m.payment_occurrence_id IS NULL','m.business_source_document_id IS NULL',"s.status='POSTED'",'s.journal_entry_id=m.journal_entry_id','s.bank_member_ref=bank.bank_account_ref','s.amount=abs(bank.amount)'])assert.ok(up.includes(token),token);
  assert.doesNotMatch(up,/CREATE FUNCTION refs_set_reconciliation_clearance\(/);
  assert.doesNotMatch(up,/CREATE FUNCTION refs_transition_reconciliation_adjustment_aware\(/);
  assert.match(down,/Sales receipt reconciliation evidence prevents destructive rollback/);
  for(const fn of ['refs_set_reconciliation_clearance_385','refs_transition_reconciliation_adjustment_aware_385'])assert.match(down,new RegExp(`CREATE FUNCTION ${fn}`));
});
