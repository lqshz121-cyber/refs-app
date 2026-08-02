import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const sql=await readFile(new URL('../db/migrations/002_accounting_runtime.sql',import.meta.url),'utf8');
const apArSql=await readFile(new URL('../db/migrations/004_ap_ar_business_runtime.sql',import.meta.url),'utf8');
const apArDown=await readFile(new URL('../db/migrations/down/004_ap_ar_business_runtime.sql',import.meta.url),'utf8');
const apBillVoidSql=await readFile(new URL('../db/migrations/005_ap_bill_void_command.sql',import.meta.url),'utf8');
const apBillVoidDown=await readFile(new URL('../db/migrations/down/005_ap_bill_void_command.sql',import.meta.url),'utf8');
const apBillVoidHttpSql=await readFile(new URL('../db/migrations/006_ap_bill_void_http_cas.sql',import.meta.url),'utf8');
const apBillVoidHttpDown=await readFile(new URL('../db/migrations/down/006_ap_bill_void_http_cas.sql',import.meta.url),'utf8');
const apVendorCreditSql=await readFile(new URL('../db/migrations/007_ap_vendor_credit_command.sql',import.meta.url),'utf8');
const apVendorCreditDown=await readFile(new URL('../db/migrations/down/007_ap_vendor_credit_command.sql',import.meta.url),'utf8');
const apVendorCreditAllocationSql=await readFile(new URL('../db/migrations/008_ap_vendor_credit_allocation.sql',import.meta.url),'utf8');
const apVendorCreditAllocationDown=await readFile(new URL('../db/migrations/down/008_ap_vendor_credit_allocation.sql',import.meta.url),'utf8');
const apArPostedReducerSql=await readFile(new URL('../db/migrations/009_ap_ar_posted_adjustment_reducer.sql',import.meta.url),'utf8');
const apArPostedReducerDown=await readFile(new URL('../db/migrations/down/009_ap_ar_posted_adjustment_reducer.sql',import.meta.url),'utf8');
const apBillVoidPostReducerSql=await readFile(new URL('../db/migrations/010_ap_bill_void_post_reducer.sql',import.meta.url),'utf8');
const apBillVoidPostReducerDown=await readFile(new URL('../db/migrations/down/010_ap_bill_void_post_reducer.sql',import.meta.url),'utf8');
const apPaymentSql=await readFile(new URL('../db/migrations/011_ap_payment_command.sql',import.meta.url),'utf8');
const apPaymentDown=await readFile(new URL('../db/migrations/down/011_ap_payment_command.sql',import.meta.url),'utf8');
const apPaymentPostReducerSql=await readFile(new URL('../db/migrations/012_ap_payment_post_reducer.sql',import.meta.url),'utf8');
const apPaymentPostReducerDown=await readFile(new URL('../db/migrations/down/012_ap_payment_post_reducer.sql',import.meta.url),'utf8');
const arReceiptSql=await readFile(new URL('../db/migrations/013_ar_receipt_command.sql',import.meta.url),'utf8');
const arReceiptDown=await readFile(new URL('../db/migrations/down/013_ar_receipt_command.sql',import.meta.url),'utf8');
const arReceiptPostReducerSql=await readFile(new URL('../db/migrations/014_ar_receipt_post_reducer.sql',import.meta.url),'utf8');
const arReceiptPostReducerDown=await readFile(new URL('../db/migrations/down/014_ar_receipt_post_reducer.sql',import.meta.url),'utf8');
const arReceiptReversalSql=await readFile(new URL('../db/migrations/015_ar_receipt_reversal_command.sql',import.meta.url),'utf8');
const arReceiptReversalDown=await readFile(new URL('../db/migrations/down/015_ar_receipt_reversal_command.sql',import.meta.url),'utf8');
const arReceiptReversalPostSql=await readFile(new URL('../db/migrations/016_ar_receipt_reversal_post_reducer.sql',import.meta.url),'utf8');
const arReceiptReversalPostDown=await readFile(new URL('../db/migrations/down/016_ar_receipt_reversal_post_reducer.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const issuer=await readFile(new URL('../runtime/context-issuer.mjs',import.meta.url),'utf8');

test('migration manifest freezes normalized up and down artifacts without AutoRec scope',async()=>{
  assert.deepEqual(MIGRATION_MANIFEST.map(item=>item.name),['001_wbs_accounting_core.sql','002_accounting_runtime.sql','003_attachment_runtime.sql','004_ap_ar_business_runtime.sql','005_ap_bill_void_command.sql','006_ap_bill_void_http_cas.sql','007_ap_vendor_credit_command.sql','008_ap_vendor_credit_allocation.sql','009_ap_ar_posted_adjustment_reducer.sql','010_ap_bill_void_post_reducer.sql','011_ap_payment_command.sql','012_ap_payment_post_reducer.sql','013_ar_receipt_command.sql','014_ar_receipt_post_reducer.sql','015_ar_receipt_reversal_command.sql','016_ar_receipt_reversal_post_reducer.sql']);
  for(const item of MIGRATION_MANIFEST){
    for(const direction of ['up','down']){
      const relative=direction==='up'?`../db/migrations/${item.name}`:`../db/migrations/down/${item.name}`;
      const raw=await readFile(new URL(relative,import.meta.url),'utf8');
      const checksum=createHash('sha256').update(raw.replace(/\r\n/g,'\n')).digest('hex');
      assert.equal(checksum,item[direction],`${direction} checksum mismatch for ${item.name}`);
    }
  }
});

test('AP Bill Void HTTP contract adds optimistic CAS and disables the pre-CAS function grant',()=>{
  assert.match(apBillVoidHttpSql,/REVOKE EXECUTE ON FUNCTION refs_create_ap_bill_void\(uuid,uuid,uuid,uuid,text,date,text,text,text\) FROM refs_app/);
  assert.match(apBillVoidHttpSql,/p_expected_version bigint/);
  assert.match(apBillVoidHttpSql,/expected_version',p_expected_version/);
  assert.match(apBillVoidHttpSql,/bill\.version<>p_expected_version/);
  assert.match(repository,/expectedVersion/);
  assert.match(apBillVoidHttpSql,/GRANT EXECUTE ON FUNCTION refs_create_ap_bill_void\(uuid,uuid,uuid,uuid,bigint,text,date,text,text,text\) TO refs_app/);
  assert.match(apBillVoidHttpDown,/GRANT EXECUTE ON FUNCTION refs_create_ap_bill_void\(uuid,uuid,uuid,uuid,text,date,text,text,text\) TO refs_app/);
});

test('AP Bill Void command is Draft-only, idempotent and leaves posted source immutable',()=>{
  assert.match(apBillVoidSql,/CREATE OR REPLACE FUNCTION refs_ap_bill_void_hash/);
  assert.match(apBillVoidSql,/CREATE OR REPLACE FUNCTION refs_create_ap_bill_void/);
  assert.match(repository,/async createApBillVoid/);
  assert.match(repository,/refs_ap_bill_void_hash/);
  assert.match(repository,/refs_create_ap_bill_void/);
  assert.match(apBillVoidSql,/refs_assert_scope\(p_tenant,p_entity,'AP\.BILL\.VOID\.CREATE'\)/);
  assert.match(apBillVoidSql,/operation_scope='AP_BILL_VOID:'\|\|p_entity/);
  assert.match(apBillVoidSql,/receipt\.status='SUCCEEDED'[\s\S]*response_body\|\|jsonb_build_object\('idempotent',true\)/);
  assert.match(apBillVoidSql,/business_document[\s\S]*FOR UPDATE/);
  assert.match(apBillVoidSql,/journal_entry[\s\S]*FOR SHARE/);
  assert.match(apBillVoidSql,/bill\.status<>'APPROVED'/);
  assert.match(apBillVoidSql,/bill\.open_balance<>bill\.gross_amount/);
  assert.match(apBillVoidSql,/business_allocation[\s\S]*status='ACTIVE'/);
  assert.match(apBillVoidSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(apBillVoidSql,/SELECT p_tenant,p_entity,p_period,journal_id,line_no,account_code,credit_amount,debit_amount/);
  assert.match(apBillVoidSql,/INSERT INTO business_adjustment[\s\S]*'AP_BILL_VOID'/);
  assert.match(apBillVoidSql,/INSERT INTO audit_event[\s\S]*AP_BILL_VOID_DRAFT_CREATED/);
  assert.match(apBillVoidSql,/INSERT INTO outbox_event[\s\S]*AP_BILL_VOID_DRAFT_CREATED/);
  assert.doesNotMatch(apBillVoidSql,/UPDATE business_document/);
  assert.doesNotMatch(apBillVoidSql,/UPDATE journal_entry SET status='REVERSED'/);
  assert.doesNotMatch(apBillVoidSql,/INSERT INTO ledger_line/);
  assert.match(apBillVoidDown,/DROP FUNCTION IF EXISTS refs_create_ap_bill_void/);
  assert.match(apBillVoidDown,/DROP FUNCTION IF EXISTS refs_ap_bill_void_hash/);
});

test('AP Vendor Credit command is Draft-only, idempotent and allocation-separated',()=>{
  assert.match(apVendorCreditSql,/CREATE OR REPLACE FUNCTION refs_ap_vendor_credit_hash/);
  assert.match(apVendorCreditSql,/CREATE OR REPLACE FUNCTION refs_create_ap_vendor_credit/);
  assert.match(repository,/async createApVendorCredit/);
  assert.match(repository,/refs_ap_vendor_credit_hash/);
  assert.match(repository,/refs_create_ap_vendor_credit/);
  assert.match(apVendorCreditSql,/refs_assert_scope\(p_tenant,p_entity,'AP\.VENDOR_CREDIT\.CREATE'\)/);
  assert.match(apVendorCreditSql,/operation_scope='AP_VENDOR_CREDIT:'\|\|p_entity/);
  assert.match(apVendorCreditSql,/receipt\.status='SUCCEEDED'[\s\S]*response_body\|\|jsonb_build_object\('idempotent',true\)/);
  assert.match(apVendorCreditSql,/period_row\.status<>'OPEN'/);
  assert.match(apVendorCreditSql,/jsonb_to_recordset\(p_lines\)/);
  assert.match(apVendorCreditSql,/COALESCE\(sum\(x\.amount\),0\)<>p_amount/);
  assert.match(apVendorCreditSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(apVendorCreditSql,/VALUES\(p_tenant,p_entity,p_period,journal_id,1,'291001',p_amount,0/);
  assert.match(apVendorCreditSql,/SELECT p_tenant,p_entity,p_period,journal_id,x\.line_no\+1,btrim\(x\.account_code\),0,x\.amount/);
  assert.match(apVendorCreditSql,/INSERT INTO business_adjustment[\s\S]*'AP_VENDOR_CREDIT'/);
  assert.match(apVendorCreditSql,/AP_VENDOR_CREDIT_DRAFT_CREATED/);
  assert.doesNotMatch(apVendorCreditSql,/INSERT INTO business_allocation/);
  assert.doesNotMatch(apVendorCreditSql,/INSERT INTO ledger_line/);
  assert.match(apVendorCreditDown,/DROP FUNCTION IF EXISTS refs_create_ap_vendor_credit/);
  assert.match(apVendorCreditDown,/DROP FUNCTION IF EXISTS refs_ap_vendor_credit_hash/);
});

test('AP Vendor Credit allocation is pending-only, idempotent and does not mutate balances',()=>{
  assert.match(apVendorCreditAllocationSql,/CREATE OR REPLACE FUNCTION refs_ap_vendor_credit_allocation_hash/);
  assert.match(apVendorCreditAllocationSql,/CREATE OR REPLACE FUNCTION refs_apply_ap_vendor_credit/);
  assert.match(repository,/async applyApVendorCredit/);
  assert.match(repository,/refs_ap_vendor_credit_allocation_hash/);
  assert.match(repository,/refs_apply_ap_vendor_credit/);
  assert.match(apVendorCreditAllocationSql,/refs_assert_scope\(p_tenant,p_entity,'AP\.VENDOR_CREDIT\.APPLY'\)/);
  assert.match(apVendorCreditAllocationSql,/operation_scope='AP_VENDOR_CREDIT_APPLY:'\|\|p_entity/);
  assert.match(apVendorCreditAllocationSql,/credit\.adjustment_kind<>'AP_VENDOR_CREDIT' OR credit\.status<>'POSTED'/);
  assert.match(apVendorCreditAllocationSql,/bill\.document_kind<>'AP_BILL'/);
  assert.match(apVendorCreditAllocationSql,/bill\.open_balance<=0/);
  assert.match(apVendorCreditAllocationSql,/bill\.currency<>credit\.currency/);
  assert.match(apVendorCreditAllocationSql,/FOR UPDATE/);
  assert.match(apVendorCreditAllocationSql,/allocated\+p_amount>credit\.amount OR p_amount>bill\.open_balance/);
  assert.match(apVendorCreditAllocationSql,/INSERT INTO business_allocation[\s\S]*'PENDING'/);
  assert.match(apVendorCreditAllocationSql,/AP_VENDOR_CREDIT_ALLOCATION_PENDING/);
  assert.doesNotMatch(apVendorCreditAllocationSql,/UPDATE business_document/);
  assert.doesNotMatch(apVendorCreditAllocationSql,/UPDATE business_adjustment/);
  assert.doesNotMatch(apVendorCreditAllocationSql,/INSERT INTO ledger_line/);
  assert.match(apVendorCreditAllocationDown,/DROP FUNCTION IF EXISTS refs_apply_ap_vendor_credit/);
  assert.match(apVendorCreditAllocationDown,/DROP FUNCTION IF EXISTS refs_ap_vendor_credit_allocation_hash/);
});

test('AP/AR posted adjustment reducer activates vendor-credit allocations inside JE post transaction',()=>{
  assert.match(apArPostedReducerSql,/CREATE OR REPLACE FUNCTION refs_apply_ap_ar_posted_adjustment/);
  assert.match(apArPostedReducerSql,/CREATE TRIGGER business_adjustment_posted_reducer/);
  assert.match(apArPostedReducerSql,/AFTER UPDATE OF status ON journal_entry/);
  assert.match(apArPostedReducerSql,/NEW\.status<>'POSTED' OR OLD\.status='POSTED'/);
  assert.match(apArPostedReducerSql,/adj\.adjustment_kind='AP_VENDOR_CREDIT'/);
  assert.match(apArPostedReducerSql,/status='PENDING'[\s\S]*FOR UPDATE/);
  assert.match(apArPostedReducerSql,/pending_total>adj\.amount/);
  assert.match(apArPostedReducerSql,/pending\.amount>bd\.open_balance/);
  assert.match(apArPostedReducerSql,/UPDATE business_document[\s\S]*posted_credit_adjustments=bd\.posted_credit_adjustments\+pending\.amount/);
  assert.match(apArPostedReducerSql,/open_balance=bd\.open_balance-pending\.amount/);
  assert.match(apArPostedReducerSql,/status=CASE WHEN bd\.open_balance-pending\.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END/);
  assert.match(apArPostedReducerSql,/UPDATE business_allocation[\s\S]*status='ACTIVE',posted_journal_entry_id=NEW\.journal_entry_id/);
  assert.match(apArPostedReducerSql,/UPDATE business_adjustment[\s\S]*status='POSTED',posted_journal_entry_id=NEW\.journal_entry_id/);
  assert.match(apArPostedReducerSql,/AP_VENDOR_CREDIT_POSTED/);
  assert.match(apArPostedReducerSql,/INSERT INTO outbox_event/);
  assert.doesNotMatch(apArPostedReducerSql,/INSERT INTO ledger_line/);
  assert.match(apArPostedReducerDown,/DROP TRIGGER IF EXISTS business_adjustment_posted_reducer/);
  assert.match(apArPostedReducerDown,/DROP FUNCTION IF EXISTS refs_apply_ap_ar_posted_adjustment/);
});

test('AP Bill Void post reducer voids only fully-open bills inside JE post transaction',()=>{
  assert.match(apBillVoidPostReducerSql,/CREATE OR REPLACE FUNCTION refs_apply_ap_ar_posted_adjustment/);
  assert.match(apBillVoidPostReducerSql,/adj\.adjustment_kind='AP_BILL_VOID'/);
  assert.match(apBillVoidPostReducerSql,/WHERE tenant_id=NEW\.tenant_id AND entity_id=NEW\.entity_id AND business_document_id=adj\.business_document_id[\s\S]*FOR UPDATE/);
  assert.match(apBillVoidPostReducerSql,/bill\.document_kind<>'AP_BILL' OR bill\.status<>'APPROVED' OR bill\.open_balance<>bill\.gross_amount/);
  assert.match(apBillVoidPostReducerSql,/status IN \('PENDING','ACTIVE'\)[\s\S]*FOR UPDATE/);
  assert.match(apBillVoidPostReducerSql,/posted_credit_adjustments=posted_credit_adjustments\+bill\.open_balance/);
  assert.match(apBillVoidPostReducerSql,/open_balance=0/);
  assert.match(apBillVoidPostReducerSql,/status='VOID'/);
  assert.match(apBillVoidPostReducerSql,/UPDATE business_adjustment[\s\S]*status='POSTED',posted_journal_entry_id=NEW\.journal_entry_id/);
  assert.match(apBillVoidPostReducerSql,/AP_BILL_VOID_POSTED/);
  assert.match(apBillVoidPostReducerSql,/INSERT INTO outbox_event/);
  assert.doesNotMatch(apBillVoidPostReducerSql,/INSERT INTO ledger_line/);
  assert.match(apBillVoidPostReducerDown,/CREATE OR REPLACE FUNCTION refs_apply_ap_ar_posted_adjustment/);
  assert.doesNotMatch(apBillVoidPostReducerDown,/AP_BILL_VOID_POSTED/);
});

test('AP Payment command creates Draft occurrence and pending allocation without touching balances',()=>{
  assert.match(apPaymentSql,/AP\.PAYMENT\.CREATE/);
  assert.match(apPaymentSql,/CREATE OR REPLACE FUNCTION refs_ap_payment_hash/);
  assert.match(apPaymentSql,/CREATE OR REPLACE FUNCTION refs_create_ap_payment/);
  assert.match(repository,/async createApPayment/);
  assert.match(repository,/refs_ap_payment_hash/);
  assert.match(repository,/refs_create_ap_payment/);
  assert.match(apPaymentSql,/refs_assert_scope\(p_tenant,p_entity,'AP\.PAYMENT\.CREATE'\)/);
  assert.match(apPaymentSql,/operation_scope='AP_PAYMENT:'\|\|p_entity/);
  assert.match(apPaymentSql,/bill\.document_kind<>'AP_BILL'/);
  assert.match(apPaymentSql,/p_amount>bill\.open_balance-reserved/);
  assert.match(apPaymentSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(apPaymentSql,/VALUES\(p_tenant,p_entity,p_period,journal_id,1,'291001',p_amount,0,bill\.counterparty_ref/);
  assert.match(apPaymentSql,/btrim\(p_cash_account_code\),0,p_amount/);
  assert.match(apPaymentSql,/INSERT INTO payment_occurrence[\s\S]*'AP_PAYMENT'[\s\S]*'DRAFT'/);
  assert.match(apPaymentSql,/INSERT INTO business_allocation[\s\S]*occurrence_id[\s\S]*'PENDING'/);
  assert.doesNotMatch(apPaymentSql,/UPDATE business_document/);
  assert.doesNotMatch(apPaymentSql,/INSERT INTO ledger_line/);
  assert.match(apPaymentDown,/DROP FUNCTION IF EXISTS refs_create_ap_payment/);
  assert.match(apPaymentDown,/DROP FUNCTION IF EXISTS refs_ap_payment_hash/);
});

test('AP Payment post reducer activates occurrence allocation and updates bill inside JE post transaction',()=>{
  assert.match(apPaymentPostReducerSql,/CREATE OR REPLACE FUNCTION refs_apply_ap_payment_posted_occurrence/);
  assert.match(apPaymentPostReducerSql,/CREATE TRIGGER payment_occurrence_posted_reducer/);
  assert.match(apPaymentPostReducerSql,/AFTER UPDATE OF status ON journal_entry/);
  assert.match(apPaymentPostReducerSql,/WHERE tenant_id=NEW\.tenant_id AND entity_id=NEW\.entity_id AND draft_journal_entry_id=NEW\.journal_entry_id[\s\S]*FOR UPDATE/);
  assert.match(apPaymentPostReducerSql,/occ\.occurrence_kind<>'AP_PAYMENT' OR occ\.status<>'DRAFT'/);
  assert.match(apPaymentPostReducerSql,/bill\.document_kind<>'AP_BILL'/);
  assert.match(apPaymentPostReducerSql,/pending_total<>occ\.amount OR pending_total>bill\.open_balance/);
  assert.match(apPaymentPostReducerSql,/UPDATE business_document[\s\S]*open_balance=bill\.open_balance-occ\.amount/);
  assert.match(apPaymentPostReducerSql,/status=CASE WHEN bill\.open_balance-occ\.amount=0 THEN 'PAID' ELSE 'PARTIALLY_PAID' END/);
  assert.match(apPaymentPostReducerSql,/UPDATE business_allocation[\s\S]*status='ACTIVE',posted_journal_entry_id=NEW\.journal_entry_id/);
  assert.match(apPaymentPostReducerSql,/UPDATE payment_occurrence[\s\S]*status='POSTED',posted_journal_entry_id=NEW\.journal_entry_id/);
  assert.match(apPaymentPostReducerSql,/AP_PAYMENT_POSTED/);
  assert.match(apPaymentPostReducerSql,/INSERT INTO outbox_event/);
  assert.doesNotMatch(apPaymentPostReducerSql,/INSERT INTO ledger_line/);
  assert.match(apPaymentPostReducerDown,/DROP TRIGGER IF EXISTS payment_occurrence_posted_reducer/);
  assert.match(apPaymentPostReducerDown,/DROP FUNCTION IF EXISTS refs_apply_ap_payment_posted_occurrence/);
});

test('AR Receipt command creates Draft occurrence and pending allocation without touching balances',()=>{
  assert.match(arReceiptSql,/AR\.RECEIPT\.CREATE/);
  assert.match(arReceiptSql,/CREATE OR REPLACE FUNCTION refs_ar_receipt_hash/);
  assert.match(arReceiptSql,/CREATE OR REPLACE FUNCTION refs_create_ar_receipt/);
  assert.match(repository,/async createArReceipt/);
  assert.match(repository,/refs_ar_receipt_hash/);
  assert.match(repository,/refs_create_ar_receipt/);
  assert.match(arReceiptSql,/refs_assert_scope\(p_tenant,p_entity,'AR\.RECEIPT\.CREATE'\)/);
  assert.match(arReceiptSql,/operation_scope='AR_RECEIPT:'\|\|p_entity/);
  assert.match(arReceiptSql,/invoice\.document_kind<>'AR_INVOICE'/);
  assert.match(arReceiptSql,/p_amount>invoice\.open_balance-reserved/);
  assert.match(arReceiptSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(arReceiptSql,/btrim\(p_cash_account_code\),p_amount,0/);
  assert.match(arReceiptSql,/p_tenant,p_entity,p_period,journal_id,2,'120200',0,p_amount,invoice\.counterparty_ref/);
  assert.match(arReceiptSql,/INSERT INTO payment_occurrence[\s\S]*'AR_RECEIPT'[\s\S]*'DRAFT'/);
  assert.match(arReceiptSql,/INSERT INTO business_allocation[\s\S]*occurrence_id[\s\S]*'PENDING'/);
  assert.match(arReceiptSql,/AR_RECEIPT_DRAFT_CREATED/);
  assert.doesNotMatch(arReceiptSql,/UPDATE business_document/);
  assert.doesNotMatch(arReceiptSql,/INSERT INTO ledger_line/);
  assert.match(arReceiptDown,/DROP FUNCTION IF EXISTS refs_create_ar_receipt/);
  assert.match(arReceiptDown,/DROP FUNCTION IF EXISTS refs_ar_receipt_hash/);
});

test('AR Receipt post reducer activates allocation and updates invoice inside JE post transaction',()=>{
  assert.match(arReceiptPostReducerSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_receipt_posted_occurrence/);
  assert.match(arReceiptPostReducerSql,/occ\.occurrence_kind<>'AR_RECEIPT'/);
  assert.match(arReceiptPostReducerSql,/invoice\.document_kind<>'AR_INVOICE'/);
  assert.match(arReceiptPostReducerSql,/UPDATE business_document[\s\S]*open_balance=invoice\.open_balance-occ\.amount/);
  assert.match(arReceiptPostReducerSql,/UPDATE business_allocation[\s\S]*status='ACTIVE'/);
  assert.match(arReceiptPostReducerSql,/UPDATE payment_occurrence[\s\S]*status='POSTED'/);
  assert.match(arReceiptPostReducerSql,/CREATE TRIGGER ar_receipt_occurrence_posted_reducer/);
  assert.match(arReceiptPostReducerDown,/DROP TRIGGER IF EXISTS ar_receipt_occurrence_posted_reducer/);
});

test('AR Receipt reversal is Draft-only, idempotent and preserves the Posted source',()=>{
  assert.match(arReceiptReversalSql,/AR\.RECEIPT\.REVERSE/);
  assert.match(arReceiptReversalSql,/CREATE OR REPLACE FUNCTION refs_create_ar_receipt_reversal/);
  assert.match(arReceiptReversalSql,/occ\.occurrence_kind<>'AR_RECEIPT' OR occ\.status<>'POSTED'/);
  assert.match(arReceiptReversalSql,/journal_type,status,journal_date[\s\S]*'REVERSAL','DRAFT'/);
  assert.match(arReceiptReversalSql,/reversal_of_id/);
  assert.match(arReceiptReversalSql,/INSERT INTO business_adjustment[\s\S]*'AR_RECEIPT_REVERSAL'[\s\S]*'DRAFT'/);
  assert.doesNotMatch(arReceiptReversalSql,/UPDATE payment_occurrence/);
  assert.doesNotMatch(arReceiptReversalSql,/UPDATE business_document/);
  assert.match(arReceiptReversalDown,/DROP FUNCTION IF EXISTS refs_create_ar_receipt_reversal/);
});

test('AR Receipt reversal post reducer restores invoice and reverses active allocation atomically',()=>{
  assert.match(arReceiptReversalPostSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_receipt_reversal_posted/);
  assert.match(arReceiptReversalPostSql,/adj\.adjustment_kind<>'AR_RECEIPT_REVERSAL'/);
  assert.match(arReceiptReversalPostSql,/occ\.status<>'POSTED'/);
  assert.match(arReceiptReversalPostSql,/UPDATE business_allocation[\s\S]*status='REVERSED'/);
  assert.match(arReceiptReversalPostSql,/UPDATE business_document[\s\S]*open_balance=invoice\.open_balance\+occ\.amount/);
  assert.match(arReceiptReversalPostSql,/UPDATE payment_occurrence[\s\S]*status='REVERSED'/);
  assert.match(arReceiptReversalPostSql,/UPDATE business_adjustment[\s\S]*status='POSTED'/);
  assert.match(arReceiptReversalPostSql,/AR_RECEIPT_REVERSAL_POSTED/);
  assert.match(arReceiptReversalPostDown,/DROP TRIGGER IF EXISTS ar_receipt_reversal_posted_reducer/);
});

test('AP/AR business runtime schema exists without mutating journal or ledger immutability',()=>{
  for(const table of ['business_document','payment_occurrence','business_adjustment','business_allocation','je_reversal_link']){
    assert.match(apArSql,new RegExp(`CREATE TABLE ${table}`));
    assert.match(apArSql,new RegExp(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY|ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(apArDown,new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  for(const permission of ['AP.BILL.VOID.CREATE','AP.VENDOR_CREDIT.CREATE','AP.VENDOR_CREDIT.APPLY','AP.PAYMENT.REVERSE','AR.CREDIT_MEMO.CREATE','AR.CREDIT_MEMO.APPLY','AR.REFUND.CREATE','AR.RECEIPT.REVERSE']){
    assert.match(apArSql,new RegExp(permission.replaceAll('.','\\.')));
  }
  assert.match(apArSql,/document_kind text NOT NULL CHECK \(document_kind IN \('AP_BILL','AR_INVOICE'\)\)/);
  assert.match(apArSql,/adjustment_kind text NOT NULL CHECK \(adjustment_kind IN \('AP_BILL_VOID','AP_VENDOR_CREDIT','AP_PAYMENT_REVERSAL','AR_CREDIT_MEMO','AR_REFUND','AR_RECEIPT_REVERSAL'\)\)/);
  assert.match(apArSql,/CHECK \(num_nonnulls\(payment_occurrence_id,business_adjustment_id\)=1\)/);
  assert.match(apArSql,/Only ACTIVE allocations reduce open balance/);
  assert.match(apArSql,/Original Posted JE and ledger remain immutable/);
  assert.doesNotMatch(apArSql,/UPDATE journal_entry SET status='REVERSED'/);
  assert.doesNotMatch(apArSql,/CREATE OR REPLACE FUNCTION refs_post_journal/);
});

test('outbox entity column exists before entity-scoped RLS policy',()=>{
  const column=sql.indexOf('ALTER TABLE outbox_event\n  ADD COLUMN entity_id');
  const policy=sql.indexOf("'bank_source','bank_match','reconciliation','source_link','audit_event','outbox_event'");
  assert.ok(column>0&&policy>column);
});

test('runtime identity uses opaque DB-owned transaction context, not caller claims',()=>{
  assert.match(sql,/CREATE TABLE runtime_auth_context/);
  assert.match(sql,/bound_txid=txid_current\(\)/);
  assert.match(sql,/CREATE TABLE runtime_actor_grant/);
  assert.match(sql,/jsonb_agg\(jsonb_build_object\('entity_id',g\.entity_id,'permission',g\.permission\)/);
  assert.doesNotMatch(repository,/set_config\('refs\.(tenant_id|entity_ids|permissions|actor_id)/);
  assert.match(repository,/refs_bootstrap_context/);
  assert.match(sql,/REVOKE ALL ON TABLE runtime_auth_context,runtime_actor_grant,runtime_actor_grant_set,runtime_grant_sync_receipt FROM PUBLIC,refs_app,refs_runtime,refs_context_issuer,refs_grant_sync/);
});

test('isolated issuer derives authorization from DB grants and supports revoke and cleanup',()=>{
  assert.match(sql,/session_user<>'refs_context_issuer'/);
  assert.match(sql,/FROM runtime_actor_grant/);
  assert.match(sql,/refs_revoke_context/);
  assert.match(sql,/refs_cleanup_contexts/);
  assert.match(issuer,/randomBytes\(32\)/);
  assert.match(issuer,/principalProvider/);
  assert.doesNotMatch(issuer,/entityIds|permissions/);
});

test('posting enforces evidence, accounting controls and production-safe signature',()=>{
  assert.doesNotMatch(sql,/p_inject_failure/);
  assert.match(sql,/Manual and reclass journals require a verified clean attachment/);
  assert.match(sql,/Automatic journals require immutable source evidence/);
  assert.match(sql,/jl\.member_ref IS NOT NULL AND m\.member_ref IS NULL/);
  assert.match(sql,/receipt:=refs_reserve_idempotency[\s\S]+receipt\.status='SUCCEEDED'[\s\S]+je\.status<>'APPROVED'/);
});

test('outbox is entity-scoped and its entity ownership is immutable',()=>{
  assert.match(sql,/ADD COLUMN entity_id uuid/);
  assert.match(sql,/refs_entity_has_permission\(entity_id,'OUTBOX\.DISPATCH'\)/);
  assert.match(sql,/NEW\.tenant_id,NEW\.entity_id,NEW\.aggregate_type/);
  assert.doesNotMatch(sql,/GRANT SELECT ON ALL TABLES/);
});
