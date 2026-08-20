import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(new URL(path,import.meta.url),'utf8');
const up=read('../db/migrations/231_ai_invoice_classification_period_source_read.sql');
const down=read('../db/migrations/down/231_ai_invoice_classification_period_source_read.sql');
const upV2=read('../db/migrations/257_ai_invoice_classification_dimension_source_read.sql');
const downV2=read('../db/migrations/down/257_ai_invoice_classification_dimension_source_read.sql');
const repository=read('../runtime/kernel-repository.mjs');
const server=read('../runtime/accounting-server.mjs');

test('invoice population reader is exact-period, analysis-only, retained-payable, bounded, and raw-byte free',()=>{
  assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);
  assert.match(up,/r\.accounting_period_id=p_period AND r\.domain='PAYABLES'/);
  assert.match(up,/p_limit<1 OR p_limit>500/);assert.match(up,/LIMIT p_limit/);
  assert.match(up,/count\(\*\)[\s\S]+>p_limit[\s\S]+ERRCODE='54000'/);
  assert.match(up,/wbs_final1_retained_source_row/);assert.match(up,/r\.raw_row_hash/);
  assert.match(up,/posted_debit_account_classes text\[\]/);assert.match(up,/jl\.debit_amount>0/);
  for(const accountClass of ['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE','UNCLASSIFIED'])assert.match(up,new RegExp(`'${accountClass}'`));
  for(const forbidden of ['raw_event.payload','request_raw','response_raw','package_raw','credential','authorization'])assert.doesNotMatch(up,new RegExp(forbidden,'i'));
  assert.match(up,/false|NOT_RECORDED/);assert.doesNotMatch(up,/\b(?:INSERT|UPDATE|DELETE)\b/i);
});

test('production classification uses the dedicated reader and rollback removes only that function',()=>{
  assert.match(repository,/readAiInvoiceClassificationSource/);assert.match(repository,/refs_read_ai_invoice_classification_source_v2\(\$1,\$2,\$3,\$4\)/);
  assert.match(server,/classificationInputReader:scope=>kernel\.readAiInvoiceClassificationSource\(scope\)/);
  assert.doesNotMatch(server,/aiInvoiceAccountingClassificationServiceFactory[\s\S]{0,250}listSourceDocuments/);
  assert.match(down,/DROP FUNCTION refs_read_ai_invoice_classification_source\(uuid,uuid,uuid,integer\)/);assert.match(downV2,/DROP FUNCTION refs_read_ai_invoice_classification_source_v2\(uuid,uuid,uuid,integer\)/);
});

test('v2 binds dimensions, vendor/member, complete attachment set, account controls, and booking presence',()=>{
  for(const field of ['accounting_date date','vendor_ref text','vendor_member_ref text','member_ref text','contract_id text','service_frequency text','source_attachment_count integer','source_attachment_ids uuid[]','source_attachment_evidence jsonb'])assert.match(upV2,new RegExp(field.replace(' ','\\s+').replace('[]','\\[\\]')));
  assert.match(upV2,/member_master mm[\s\S]+mm\.member_ref=l\.party_ref[\s\S]+mm\.member_type='VENDOR'[\s\S]+mm\.active/);
  assert.match(upV2,/signed_contract_id/);assert.match(upV2,/signed_service_frequency/);
  assert.match(upV2,/j\.status='POSTED'[\s\S]+THEN 'POSTED'[\s\S]+source_link[\s\S]+THEN 'DRAFT'[\s\S]+ELSE 'NOT_RECORDED'/);
  assert.match(upV2,/NULL::text/); // WBS Final-1 does not retain an independent source member; MEMBER rules remain fail-closed.
  assert.match(upV2,/jsonb_build_object\('attachment_id',a\.attachment_id,'content_hash',a\.content_hash,'finalization_status',a\.finalization_status,'scan_status',a\.scan_status,'storage_version',a\.storage_version\)/);
  assert.match(upV2,/refs_read_ai_account_master_bindings/);assert.match(upV2,/a\.account_code=ANY\(p_account_codes\)/);
  assert.match(repository,/readAiAccountMasterBindings/);assert.match(repository,/refs_read_ai_account_master_bindings\(\$1,\$2,\$3::text\[\]\)/);
});
