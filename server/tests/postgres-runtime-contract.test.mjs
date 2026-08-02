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
const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
const issuer=await readFile(new URL('../runtime/context-issuer.mjs',import.meta.url),'utf8');

test('migration manifest freezes normalized up and down artifacts without AutoRec scope',async()=>{
  assert.deepEqual(MIGRATION_MANIFEST.map(item=>item.name),['001_wbs_accounting_core.sql','002_accounting_runtime.sql','003_attachment_runtime.sql','004_ap_ar_business_runtime.sql','005_ap_bill_void_command.sql','006_ap_bill_void_http_cas.sql','007_ap_vendor_credit_command.sql']);
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

test('AP/AR business runtime schema exists without mutating journal or ledger immutability',()=>{
  for(const table of ['business_document','payment_occurrence','business_adjustment','business_allocation','je_reversal_link']){
    assert.match(apArSql,new RegExp(`CREATE TABLE ${table}`));
    assert.match(apArSql,new RegExp(`ALTER TABLE %I ENABLE ROW LEVEL SECURITY|ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(apArDown,new RegExp(`DROP TABLE IF EXISTS ${table}`));
  }
  for(const permission of ['AP.BILL.VOID.CREATE','AP.VENDOR_CREDIT.CREATE','AP.PAYMENT.REVERSE','AR.CREDIT_MEMO.CREATE','AR.REFUND.CREATE','AR.RECEIPT.REVERSE']){
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
