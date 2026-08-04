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
const arCreditMemoAllocationSql=await readFile(new URL('../db/migrations/018_ar_credit_memo_allocation.sql',import.meta.url),'utf8');
const arCreditMemoAllocationDown=await readFile(new URL('../db/migrations/down/018_ar_credit_memo_allocation.sql',import.meta.url),'utf8');
const arCreditMemoPostSql=await readFile(new URL('../db/migrations/019_ar_credit_memo_post_reducer.sql',import.meta.url),'utf8');
const arCreditMemoPostDown=await readFile(new URL('../db/migrations/down/019_ar_credit_memo_post_reducer.sql',import.meta.url),'utf8');
const arRefundSql=await readFile(new URL('../db/migrations/020_ar_refund_command.sql',import.meta.url),'utf8');
const arRefundDown=await readFile(new URL('../db/migrations/down/020_ar_refund_command.sql',import.meta.url),'utf8');
const arRefundPostSql=await readFile(new URL('../db/migrations/021_ar_refund_post_reducer.sql',import.meta.url),'utf8');
const arRefundPostDown=await readFile(new URL('../db/migrations/down/021_ar_refund_post_reducer.sql',import.meta.url),'utf8');
const apPaymentReversalSql=await readFile(new URL('../db/migrations/022_ap_payment_reversal_command.sql',import.meta.url),'utf8');
const apPaymentReversalDown=await readFile(new URL('../db/migrations/down/022_ap_payment_reversal_command.sql',import.meta.url),'utf8');
const apPaymentReversalPostSql=await readFile(new URL('../db/migrations/023_ap_payment_reversal_post_reducer.sql',import.meta.url),'utf8');
const apPaymentReversalPostDown=await readFile(new URL('../db/migrations/down/023_ap_payment_reversal_post_reducer.sql',import.meta.url),'utf8');
const arReceiptScopeFixSql=await readFile(new URL('../db/migrations/024_ar_receipt_trigger_scope_fix.sql',import.meta.url),'utf8');
const arReceiptScopeFixDown=await readFile(new URL('../db/migrations/down/024_ar_receipt_trigger_scope_fix.sql',import.meta.url),'utf8');
const idempotencyScopeSql=await readFile(new URL('../db/migrations/025_idempotency_business_scope_allowlist.sql',import.meta.url),'utf8');
const idempotencyScopeDown=await readFile(new URL('../db/migrations/down/025_idempotency_business_scope_allowlist.sql',import.meta.url),'utf8');
const autoReversalSql=await readFile(new URL('../db/migrations/026_allow_evidence_backed_auto_reversal.sql',import.meta.url),'utf8');
const autoReversalDown=await readFile(new URL('../db/migrations/down/026_allow_evidence_backed_auto_reversal.sql',import.meta.url),'utf8');
const autoReversalRewriteSql=await readFile(new URL('../db/migrations/027_fix_auto_reversal_predicate_rewrite.sql',import.meta.url),'utf8');
const autoReversalRewriteDown=await readFile(new URL('../db/migrations/down/027_fix_auto_reversal_predicate_rewrite.sql',import.meta.url),'utf8');
const arReceiptReversalScopeSql=await readFile(new URL('../db/migrations/028_ar_receipt_reversal_trigger_scope_fix.sql',import.meta.url),'utf8');
const arReceiptReversalScopeDown=await readFile(new URL('../db/migrations/down/028_ar_receipt_reversal_trigger_scope_fix.sql',import.meta.url),'utf8');
const apPaymentScopeSql=await readFile(new URL('../db/migrations/029_ap_payment_trigger_scope_fix.sql',import.meta.url),'utf8');
const apPaymentScopeDown=await readFile(new URL('../db/migrations/down/029_ap_payment_trigger_scope_fix.sql',import.meta.url),'utf8');
const allocationReservationFixSql=await readFile(new URL('../db/migrations/030_allocation_reservation_balance_fix.sql',import.meta.url),'utf8');
const allocationReservationFixDown=await readFile(new URL('../db/migrations/down/030_allocation_reservation_balance_fix.sql',import.meta.url),'utf8');
const apPaymentReversalScopeSql=await readFile(new URL('../db/migrations/031_ap_payment_reversal_trigger_scope_fix.sql',import.meta.url),'utf8');
const apPaymentReversalScopeDown=await readFile(new URL('../db/migrations/down/031_ap_payment_reversal_trigger_scope_fix.sql',import.meta.url),'utf8');
const apBillVoidWorkflowSql=await readFile(new URL('../db/migrations/032_ap_bill_void_direct_source_workflow.sql',import.meta.url),'utf8');
const apBillVoidWorkflowDown=await readFile(new URL('../db/migrations/down/032_ap_bill_void_direct_source_workflow.sql',import.meta.url),'utf8');
const apBillVoidPostEvidenceSql=await readFile(new URL('../db/migrations/033_ap_bill_void_post_evidence.sql',import.meta.url),'utf8');
const apBillVoidPostEvidenceDown=await readFile(new URL('../db/migrations/down/033_ap_bill_void_post_evidence.sql',import.meta.url),'utf8');
const apBillVoidStageSql=await readFile(new URL('../db/migrations/034_ap_bill_void_post_stage_state.sql',import.meta.url),'utf8');
const apBillVoidStageDown=await readFile(new URL('../db/migrations/down/034_ap_bill_void_post_stage_state.sql',import.meta.url),'utf8');
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
const arCreditMemoSql=await readFile(new URL('../db/migrations/017_ar_credit_memo_command.sql',import.meta.url),'utf8');
const arCreditMemoDown=await readFile(new URL('../db/migrations/down/017_ar_credit_memo_command.sql',import.meta.url),'utf8');
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const issuer=await readFile(new URL('../runtime/context-issuer.mjs',import.meta.url),'utf8');
const postedCreditAllocationSql=await readFile(new URL('../db/migrations/035_posted_credit_allocation_reducer.sql',import.meta.url),'utf8');
const postedCreditAllocationDown=await readFile(new URL('../db/migrations/down/035_posted_credit_allocation_reducer.sql',import.meta.url),'utf8');
const postedArCreditAllocationSql=await readFile(new URL('../db/migrations/036_posted_ar_credit_allocation_reducer.sql',import.meta.url),'utf8');
const postedArCreditAllocationDown=await readFile(new URL('../db/migrations/down/036_posted_ar_credit_allocation_reducer.sql',import.meta.url),'utf8');
const postIntegritySql=await readFile(new URL('../db/migrations/051_post_journal_response_integrity.sql',import.meta.url),'utf8');
const postIntegrityDown=await readFile(new URL('../db/migrations/down/051_post_journal_response_integrity.sql',import.meta.url),'utf8');
const creditAllocationResponseSql=await readFile(new URL('../db/migrations/053_credit_allocation_response_state.sql',import.meta.url),'utf8');
const creditAllocationResponseDown=await readFile(new URL('../db/migrations/down/053_credit_allocation_response_state.sql',import.meta.url),'utf8');
const wbsSnapshotSql=await readFile(new URL('../db/migrations/054_wbs_snapshot_observation.sql',import.meta.url),'utf8');
const wbsSnapshotDown=await readFile(new URL('../db/migrations/down/054_wbs_snapshot_observation.sql',import.meta.url),'utf8');
const wbsSnapshotEmptyViewSql=await readFile(new URL('../db/migrations/055_wbs_snapshot_empty_view_observation.sql',import.meta.url),'utf8');
const wbsSnapshotEmptyViewDown=await readFile(new URL('../db/migrations/down/055_wbs_snapshot_empty_view_observation.sql',import.meta.url),'utf8');
const wbsSnapshotDeliverySql=await readFile(new URL('../db/migrations/056_wbs_snapshot_delivery_attestation.sql',import.meta.url),'utf8');
const wbsSnapshotDeliveryDown=await readFile(new URL('../db/migrations/down/056_wbs_snapshot_delivery_attestation.sql',import.meta.url),'utf8');

test('migration manifest freezes normalized up and down artifacts without AutoRec scope',async()=>{
  assert.deepEqual(MIGRATION_MANIFEST.map(item=>item.name),['001_wbs_accounting_core.sql','002_accounting_runtime.sql','003_attachment_runtime.sql','004_ap_ar_business_runtime.sql','005_ap_bill_void_command.sql','006_ap_bill_void_http_cas.sql','007_ap_vendor_credit_command.sql','008_ap_vendor_credit_allocation.sql','009_ap_ar_posted_adjustment_reducer.sql','010_ap_bill_void_post_reducer.sql','011_ap_payment_command.sql','012_ap_payment_post_reducer.sql','013_ar_receipt_command.sql','014_ar_receipt_post_reducer.sql','015_ar_receipt_reversal_command.sql','016_ar_receipt_reversal_post_reducer.sql','017_ar_credit_memo_command.sql','018_ar_credit_memo_allocation.sql','019_ar_credit_memo_post_reducer.sql','020_ar_refund_command.sql','021_ar_refund_post_reducer.sql','022_ap_payment_reversal_command.sql','023_ap_payment_reversal_post_reducer.sql','024_ar_receipt_trigger_scope_fix.sql','025_idempotency_business_scope_allowlist.sql','026_allow_evidence_backed_auto_reversal.sql','027_fix_auto_reversal_predicate_rewrite.sql','028_ar_receipt_reversal_trigger_scope_fix.sql','029_ap_payment_trigger_scope_fix.sql','030_allocation_reservation_balance_fix.sql','031_ap_payment_reversal_trigger_scope_fix.sql','032_ap_bill_void_direct_source_workflow.sql','033_ap_bill_void_post_evidence.sql','034_ap_bill_void_post_stage_state.sql','035_posted_credit_allocation_reducer.sql','036_posted_ar_credit_allocation_reducer.sql','037_order_ar_credit_post_reducer.sql','038_order_ar_refund_post_reducer.sql','039_ap_ar_control_reconciliation.sql','040_ar_aging.sql','041_ap_aging.sql','042_ap_ar_control_total_read.sql','043_ar_refund_available_credit.sql','044_ar_credit_memo_control_integrity.sql','045_ap_vendor_credit_control_integrity.sql','046_ap_ar_aging_available_credits.sql','047_ap_ar_business_document_read.sql','048_ap_ar_native_document_command.sql','049_ap_ar_business_document_ui_read.sql','050_ap_ar_document_journal_workflow_read.sql','051_post_journal_response_integrity.sql','052_ap_ar_adjustment_read.sql','053_credit_allocation_response_state.sql','054_wbs_snapshot_observation.sql','055_wbs_snapshot_empty_view_observation.sql','056_wbs_snapshot_delivery_attestation.sql']);
  for(const item of MIGRATION_MANIFEST){
    for(const direction of ['up','down']){
      const relative=direction==='up'?`../db/migrations/${item.name}`:`../db/migrations/down/${item.name}`;
      const raw=await readFile(new URL(relative,import.meta.url),'utf8');
      const checksum=createHash('sha256').update(raw.replace(/\r\n/g,'\n')).digest('hex');
      assert.equal(checksum,item[direction],`${direction} checksum mismatch for ${item.name}`);
    }
  }
});

test('WBS snapshots are immutable scoped observations, not current source events or journals',()=>{
  assert.match(wbsSnapshotSql,/CREATE TABLE wbs_snapshot_import/);
  assert.match(wbsSnapshotSql,/CREATE TABLE wbs_snapshot_receipt/);
  assert.match(wbsSnapshotSql,/wbs_snapshot_import_append_only/);
  assert.match(wbsSnapshotSql,/wbs_snapshot_receipt_append_only/);
  assert.match(wbsSnapshotSql,/refs_assert_scope\(p_tenant,p_entity,'WBS\.SNAPSHOT\.IMPORT'\)/);
  assert.match(wbsSnapshotSql,/entity_source_system<>'WBS'/);
  assert.match(wbsSnapshotSql,/item_entity<>entity_source_id/);
  assert.match(wbsSnapshotSql,/INSERT INTO audit_event/);
  assert.match(wbsSnapshotSql,/INSERT INTO outbox_event/);
  assert.doesNotMatch(wbsSnapshotSql,/INSERT INTO journal_entry/);
  assert.doesNotMatch(wbsSnapshotSql,/INSERT INTO ledger_line/);
  assert.match(wbsSnapshotDown,/DROP TABLE IF EXISTS wbs_snapshot_receipt/);
  assert.match(wbsSnapshotDown,/DROP TABLE IF EXISTS wbs_snapshot_import/);
});

test('empty scoped production observations are introduced only by a forward migration',()=>{
  assert.match(wbsSnapshotEmptyViewSql,/CREATE OR REPLACE FUNCTION refs_record_wbs_snapshot_receipts/);
  assert.match(wbsSnapshotEmptyViewSql,/jsonb_array_length\(p_receipts\)=0 AND upper\(btrim\(p_environment\)\)<>'PRODUCTION'/);
  assert.doesNotMatch(wbsSnapshotEmptyViewSql,/INSERT INTO journal_entry/);
  assert.doesNotMatch(wbsSnapshotEmptyViewSql,/INSERT INTO ledger_line/);
  assert.match(wbsSnapshotEmptyViewDown,/jsonb_array_length\(p_receipts\)=0/);
  assert.doesNotMatch(wbsSnapshotEmptyViewDown,/upper\(btrim\(p_environment\)\)<>'PRODUCTION'/);
});

test('delivery attestations make complete production view scopes immutable without creating accounting data',()=>{
  assert.match(wbsSnapshotDeliverySql,/CREATE TABLE wbs_snapshot_delivery_attestation/);
  assert.match(wbsSnapshotDeliverySql,/wbs_snapshot_delivery_attestation_append_only/);
  assert.match(wbsSnapshotDeliverySql,/Production WBS snapshot delivery attestation is required/);
  assert.match(wbsSnapshotDeliverySql,/REVOKE EXECUTE ON FUNCTION refs_record_wbs_snapshot_receipts\(uuid,uuid,uuid,timestamptz,text,text,text,jsonb,text,text\) FROM refs_app/);
  assert.doesNotMatch(wbsSnapshotDeliverySql,/INSERT INTO journal_entry/);
  assert.doesNotMatch(wbsSnapshotDeliverySql,/INSERT INTO ledger_line/);
  assert.match(wbsSnapshotDeliveryDown,/DROP TABLE IF EXISTS wbs_snapshot_delivery_attestation/);
});

test('post integrity is introduced only by a forward migration and rolls back symmetrically',()=>{
  assert.match(postIntegritySql,/pg_get_functiondef\('refs_post_journal/);
  assert.match(postIntegritySql,/posted_state_hash/);
  assert.match(postIntegritySql,/jsonb_build_object\(''request_hash'',p_request_hash\)/);
  assert.match(postIntegritySql,/''revision'',p_expected_revision\+1/);
  assert.match(postIntegrityDown,/Post integrity rollback/);
  assert.doesNotMatch(sql,/posted_state_hash/);
});

test('credit allocation command response reads the committed allocation state and rolls back symmetrically',()=>{
  assert.match(creditAllocationResponseSql,/refs_apply_ap_vendor_credit/);
  assert.match(creditAllocationResponseSql,/refs_apply_ar_credit_memo/);
  assert.match(creditAllocationResponseSql,/''status'',status::text/);
  assert.match(creditAllocationResponseDown,/response rollback was not applied/);
});

test('posted vendor credit allocation activates only on the posted adjustment path',()=>{
  assert.match(postedCreditAllocationSql,/refs_activate_posted_credit_allocation/);
  assert.match(postedCreditAllocationSql,/adj\.status<>'POSTED'/);
  assert.match(postedCreditAllocationSql,/CREATE TRIGGER posted_credit_allocation_reducer/);
  assert.match(postedCreditAllocationDown,/DROP TRIGGER IF EXISTS posted_credit_allocation_reducer/);
});
test('posted AR credit allocation activates only on the posted adjustment path',()=>{
  assert.match(postedArCreditAllocationSql,/refs_activate_posted_ar_credit_allocation/);
  assert.match(postedArCreditAllocationSql,/adj\.status<>'POSTED'/);
  assert.match(postedArCreditAllocationSql,/CREATE TRIGGER posted_ar_credit_allocation_reducer/);
  assert.match(postedArCreditAllocationDown,/DROP TRIGGER IF EXISTS posted_ar_credit_allocation_reducer/);
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

test('AR Credit Memo command is Draft-only and leaves invoice balances unchanged',()=>{
  assert.match(arCreditMemoSql,/AR\.CREDIT_MEMO\.CREATE/);
  assert.match(arCreditMemoSql,/CREATE OR REPLACE FUNCTION refs_create_ar_credit_memo/);
  assert.match(arCreditMemoSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(arCreditMemoSql,/INSERT INTO business_adjustment[\s\S]*'AR_CREDIT_MEMO'[\s\S]*'DRAFT'/);
  assert.doesNotMatch(arCreditMemoSql,/UPDATE business_document/);
  assert.doesNotMatch(arCreditMemoSql,/INSERT INTO ledger_line/);
  assert.match(arCreditMemoDown,/DROP FUNCTION IF EXISTS refs_create_ar_credit_memo/);
});

test('AR Credit Memo allocation is pending-only, idempotent and leaves invoice balances for post reducer',()=>{
  assert.match(arCreditMemoAllocationSql,/AR\.CREDIT_MEMO\.APPLY/);
  assert.match(arCreditMemoAllocationSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_credit_memo/);
  assert.match(arCreditMemoAllocationSql,/credit\.status<>'POSTED'/);
  assert.match(arCreditMemoAllocationSql,/invoice\.status NOT IN \('APPROVED','OPEN','PARTIALLY_PAID'\)/);
  assert.match(arCreditMemoAllocationSql,/INSERT INTO business_allocation[\s\S]*'PENDING'/);
  assert.doesNotMatch(arCreditMemoAllocationSql,/UPDATE business_document/);
  assert.doesNotMatch(arCreditMemoAllocationSql,/INSERT INTO ledger_line/);
  assert.match(arCreditMemoAllocationDown,/DROP FUNCTION IF EXISTS refs_apply_ar_credit_memo/);
});

test('AR Credit Memo post reducer activates allocations and updates invoice atomically',()=>{
  assert.match(arCreditMemoPostSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_credit_memo_posted/);
  assert.match(arCreditMemoPostSql,/AR_CREDIT_MEMO/);
  assert.match(arCreditMemoPostSql,/d\.document_kind<>'AR_INVOICE'/);
  assert.match(arCreditMemoPostSql,/UPDATE business_allocation[\s\S]*status='ACTIVE'/);
  assert.match(arCreditMemoPostSql,/UPDATE business_document[\s\S]*open_balance=d\.open_balance-p\.amount/);
  assert.match(arCreditMemoPostSql,/UPDATE business_adjustment[\s\S]*status='POSTED'/);
  assert.match(arCreditMemoPostSql,/INSERT INTO audit_event/);
  assert.match(arCreditMemoPostSql,/INSERT INTO outbox_event/);
  assert.match(arCreditMemoPostDown,/DROP TRIGGER IF EXISTS ar_credit_memo_posted_reducer/);
});

test('AR Refund is Draft-only, requires posted credit and enforces available credit',()=>{
  assert.match(arRefundSql,/AR\.REFUND\.CREATE/);
  assert.match(arRefundSql,/source_adj\.adjustment_kind<>'AR_CREDIT_MEMO'/);
  assert.match(arRefundSql,/source_adj\.status<>'POSTED'/);
  assert.match(arRefundSql,/refunded\+p_amount>source_adj\.amount/);
  assert.match(arRefundSql,/INSERT INTO journal_entry[\s\S]*'AUTO','DRAFT'/);
  assert.match(arRefundSql,/INSERT INTO business_adjustment[\s\S]*'AR_REFUND'/);
  assert.doesNotMatch(arRefundSql,/UPDATE business_document/);
  assert.doesNotMatch(arRefundSql,/INSERT INTO ledger_line/);
  assert.match(arRefundDown,/DROP FUNCTION IF EXISTS refs_create_ar_refund/);
});

test('AR Refund post reducer locks source credit and records immutable Posted refund',()=>{
  assert.match(arRefundPostSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_refund_posted/);
  assert.match(arRefundPostSql,/source_adj\.adjustment_kind<>'AR_CREDIT_MEMO'/);
  assert.match(arRefundPostSql,/source_adj\.status<>'POSTED'/);
  assert.match(arRefundPostSql,/reserved>source_adj\.amount/);
  assert.match(arRefundPostSql,/UPDATE business_adjustment[\s\S]*status='POSTED'/);
  assert.match(arRefundPostSql,/INSERT INTO audit_event/);
  assert.match(arRefundPostSql,/INSERT INTO outbox_event/);
  assert.match(arRefundPostDown,/DROP TRIGGER IF EXISTS ar_refund_posted_reducer/);
});

test('AP Payment reversal is Draft-only and preserves the Posted payment source',()=>{
  assert.match(apPaymentReversalSql,/AP\.PAYMENT\.REVERSE/);
  assert.match(apPaymentReversalSql,/occ\.occurrence_kind<>'AP_PAYMENT'/);
  assert.match(apPaymentReversalSql,/occ\.status<>'POSTED'/);
  assert.match(apPaymentReversalSql,/reversal_of_id/);
  assert.match(apPaymentReversalSql,/INSERT INTO business_adjustment[\s\S]*'AP_PAYMENT_REVERSAL'/);
  assert.doesNotMatch(apPaymentReversalSql,/UPDATE payment_occurrence/);
  assert.doesNotMatch(apPaymentReversalSql,/INSERT INTO ledger_line/);
  assert.match(apPaymentReversalDown,/DROP FUNCTION IF EXISTS refs_create_ap_payment_reversal/);
});

test('AP Payment reversal post reducer reverses allocation and restores bill balance atomically',()=>{
  assert.match(apPaymentReversalPostSql,/CREATE OR REPLACE FUNCTION refs_apply_ap_payment_reversal_posted/);
  assert.match(apPaymentReversalPostSql,/occ\.occurrence_kind<>'AP_PAYMENT'/);
  assert.match(apPaymentReversalPostSql,/active_amount<>occ\.amount/);
  assert.match(apPaymentReversalPostSql,/UPDATE business_allocation[\s\S]*status='REVERSED'/);
  assert.match(apPaymentReversalPostSql,/UPDATE business_document[\s\S]*open_balance=bill\.open_balance\+occ\.amount/);
  assert.match(apPaymentReversalPostSql,/UPDATE payment_occurrence[\s\S]*status='REVERSED'/);
  assert.match(apPaymentReversalPostSql,/INSERT INTO audit_event/);
  assert.match(apPaymentReversalPostSql,/INSERT INTO outbox_event/);
  assert.match(apPaymentReversalPostDown,/DROP TRIGGER IF EXISTS ap_payment_reversal_posted_reducer/);
});

test('AR receipt posted trigger ignores AP payment occurrences',()=>{
  assert.match(arReceiptScopeFixSql,/NOT FOUND OR occ\.occurrence_kind<>'AR_RECEIPT'/);
  assert.match(arReceiptScopeFixSql,/CREATE OR REPLACE FUNCTION refs_apply_ar_receipt_posted_occurrence/);
  assert.match(arReceiptScopeFixDown,/retained on rollback/);
});

test('AUTO reversal evidence predicate is extended only by a 후속 migration',()=>{
  assert.match(autoReversalSql,/pg_get_functiondef/);
  assert.match(autoReversalSql,/RECLASS'',''AUTO/);
  assert.match(autoReversalDown,/AUTO/);
});

test('AUTO reversal predicate rewrite is idempotent and preserves installed function body',()=>{
  assert.match(autoReversalRewriteSql,/pg_get_functiondef/);
  assert.match(autoReversalRewriteSql,/position\('AUTO' in fn\)/);
  assert.match(autoReversalRewriteDown,/pg_get_functiondef/);
});

test('AR receipt reversal trigger is scoped and ignores AP payment adjustments',()=>{
  assert.match(arReceiptReversalScopeSql,/AR_RECEIPT_REVERSAL/);
  assert.match(arReceiptReversalScopeDown,/pg_get_functiondef/);
});

test('AP payment posted trigger is scoped and ignores AR receipt occurrences',()=>{
  assert.match(apPaymentScopeSql,/refs_apply_ap_payment_posted_occurrence/);
  assert.match(apPaymentScopeSql,/occ\.occurrence_kind<>''AP_PAYMENT''/);
  assert.match(apPaymentScopeDown,/IF NOT FOUND THEN RETURN NEW; END IF;/);
});

test('posted allocations are not double-counted as new command reservations',()=>{
  assert.match(allocationReservationFixSql,/refs_create_ap_payment/);
  assert.match(allocationReservationFixSql,/refs_create_ar_receipt/);
  assert.match(allocationReservationFixSql,/status=''PENDING''/);
  assert.match(allocationReservationFixDown,/status IN \(''PENDING'',''ACTIVE''\)/);
});

test('AP payment reversal trigger ignores AR receipt reversals',()=>{
  assert.match(apPaymentReversalScopeSql,/refs_apply_ap_payment_reversal_posted/);
  assert.match(apPaymentReversalScopeSql,/adj\.adjustment_kind<>''AP_PAYMENT_REVERSAL''/);
  assert.match(apPaymentReversalScopeDown,/IF NOT FOUND THEN RETURN NEW; END IF;/);
});

test('AP bill void AUTO workflow accepts its direct immutable source evidence',()=>{
  assert.match(apBillVoidWorkflowSql,/adjustment_kind=''AP_BILL_VOID''/);
  assert.match(apBillVoidWorkflowSql,/staging_item_id IS NULL/);
  assert.match(apBillVoidWorkflowDown,/Automatic journal staging linkage is missing/);
});

test('AP bill void posting accepts the same direct source evidence',()=>{
  assert.match(apBillVoidPostEvidenceSql,/adjustment_kind=''AP_BILL_VOID''/);
  assert.match(apBillVoidPostEvidenceSql,/source_document_id IS NOT NULL/);
  assert.match(apBillVoidPostEvidenceDown,/IF je\.journal_type=''AUTO'' AND NOT EXISTS \(/);
});

test('AP bill void posting does not require a staging row for direct source evidence',()=>{
  assert.match(apBillVoidStageSql,/adjustment_kind=''AP_BILL_VOID''/);
  assert.match(apBillVoidStageSql,/Automatic journal staging state is not approved/);
  assert.match(apBillVoidStageDown,/IF NOT FOUND THEN RAISE EXCEPTION/);
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
