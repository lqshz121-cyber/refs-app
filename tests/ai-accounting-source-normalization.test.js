import assert from 'node:assert/strict';
import {AI_SOURCE_TYPES,classifyAccountingEvent,makeFinding,normalizeAccountingSource,reviewBand} from '../src/ai-accounting.js';

const expected=['BANK_STATEMENT','PAYABLE_REPORT','COST_GL','PROPERTY_COMPARISON_REPORT','CONSTRUCTION_LOAN_DATA','LOAN_DRAW_SCHEDULE','VENDOR_INVOICE','WORK_ORDER','PURCHASE_ORDER','PROPERTY_MANAGEMENT_OPERATION_REPORT','RENT_ROLL','RESIDENT_ACTIVITY','CLOSING_STATEMENT','TITLE_SETTLEMENT_STATEMENT','INSURANCE_DOCUMENT','PROPERTY_TAX_STATEMENT','GL_TRANSACTION_DETAIL','TRIAL_BALANCE','CHART_OF_ACCOUNTS','ENTITY_MASTER','PROJECT_MASTER','PROPERTY_MASTER','VENDOR_MASTER','CUSTOMER_TENANT_MASTER','INTERCOMPANY_MAPPING','EXISTING_JE_HISTORY','BUDGET_PROFORMA','WBS_SOURCE_DATA'];
assert.deepEqual(AI_SOURCE_TYPES,expected);
const complete={source_id:0,source_type:'BANK_TRANSACTION',entity_id:'E1',entity:'E1',project:'P1',property:'PROP1',vendor:'V1',uploaded_by:'wbs-reader',uploaded_at:'2026-09-14T01:02:03.000Z',date:'2026-09-14',amount:'10.1234',source_payload_hash:'a'.repeat(64),source_version:'v1',captured_at:'2026-09-14T01:02:03.000Z',dimensions:{company_code:'WBPA'},confidence_score:.9,matched_status:'UNMATCHED',accounting_treatment_status:'UNCLASSIFIED',audit_trace_id:'audit-1',audit_trail:'audit-1'};
const normalized=normalizeAccountingSource(complete);
assert.equal(normalized.source_id,0);
assert.equal(normalized.source_type,'BANK_STATEMENT');
assert.equal(normalized.amount,10.1234);
assert.equal(normalized.ingestion_status,'READY');
assert.equal(normalized.source_payload_hash,'sha256:'+'a'.repeat(64));
for(const field of ['uploaded_by','uploaded_at','entity','project','property','vendor','audit_trail']){
  const row=normalizeAccountingSource({...complete,[field]:null});
  assert.ok(row.missing_fields.includes(field));
  assert.equal(row.ingestion_status,'INCOMPLETE');
}
const aliases=normalizeAccountingSource({source_id:0,source_type:'BANK_TRANSACTION',entity_id:'E1',entity:'E2',project:'P2',property:'PROP2',vendor:'V2',uploader:'uploader-1',upload_time:'2026-09-14T01:02:03.000Z',date:'2026-09-14',amount:'10.1234',source_payload_hash:'a'.repeat(64),source_version:'v1',captured_at:'2026-09-14T01:02:03.000Z',dimensions:{company_code:'WBPA'},confidence_score:.9,matched_status:'UNMATCHED',accounting_treatment_status:'UNCLASSIFIED',audit_trace_id:'trace-2'});
assert.equal(aliases.uploaded_by,'uploader-1');
assert.equal(aliases.uploaded_at,'2026-09-14T01:02:03.000Z');
assert.equal(aliases.audit_trail,'trace-2');
assert.equal(aliases.ingestion_status,'READY');
for(const rawAmount of ['10.12345','1e3','NaN','',null]){
  const row=normalizeAccountingSource({...complete,amount:rawAmount});
  assert.ok(row.missing_fields.includes('amount'));
  assert.equal(row.ingestion_status,'INCOMPLETE');
}
const invalidStatuses=normalizeAccountingSource({...complete,matched_status:'POSTED',accounting_treatment_status:'AUTO_POSTED'});
assert.equal(invalidStatuses.matched_status,null);
assert.equal(invalidStatuses.accounting_treatment_status,null);
for(const value of [Infinity,-Infinity,NaN]){
  assert.equal(reviewBand(value).status,'EXCEPTION_QUEUE');
  const finding=makeFinding({skill:'AUDIT_REVIEW',rule:'MANUAL_JE_RISK',objectType:'JE',objectRef:'J1',reason:'invalid confidence test',action:'review',confidence:value});
  assert.equal(finding.confidence,0);
  assert.equal(finding.review_status,'EXCEPTION_QUEUE');
}
const classified=classifyAccountingEvent(complete);
assert.equal(classified.can_post,false);
assert.equal(classified.requires_human_review,true);
console.log('ai-accounting-source-normalization: all assertions passed');