import assert from 'node:assert/strict';
import {AI_SOURCE_TYPES,normalizeAccountingSource} from '../src/ai-accounting.js';
const expected=['BANK_STATEMENT','PAYABLE_REPORT','COST_GL','PROPERTY_COMPARISON_REPORT','CONSTRUCTION_LOAN_DATA','LOAN_DRAW_SCHEDULE','VENDOR_INVOICE','WORK_ORDER','PURCHASE_ORDER','PROPERTY_MANAGEMENT_OPERATION_REPORT','RENT_ROLL','RESIDENT_ACTIVITY','CLOSING_STATEMENT','TITLE_SETTLEMENT_STATEMENT','INSURANCE_DOCUMENT','PROPERTY_TAX_STATEMENT','GL_TRANSACTION_DETAIL','TRIAL_BALANCE','CHART_OF_ACCOUNTS','ENTITY_MASTER','PROJECT_MASTER','PROPERTY_MASTER','VENDOR_MASTER','CUSTOMER_TENANT_MASTER','INTERCOMPANY_MAPPING','EXISTING_JE_HISTORY','BUDGET_PROFORMA','WBS_SOURCE_DATA'];
assert.deepEqual(AI_SOURCE_TYPES,expected);
const complete={source_id:0,source_type:'BANK_TRANSACTION',entity_id:'E1',date:'2026-09-14',amount:'10.1234',source_payload_hash:'a'.repeat(64),source_version:'v1',captured_at:'2026-09-14T01:02:03.000Z',dimensions:{company_code:'WBPA'},confidence_score:.9,matched_status:'UNMATCHED',accounting_treatment_status:'UNCLASSIFIED',audit_trace_id:'audit-1'};
const normalized=normalizeAccountingSource(complete);
assert.equal(normalized.source_id,0);assert.equal(normalized.source_type,'BANK_STATEMENT');assert.equal(normalized.amount,10.1234);assert.equal(normalized.ingestion_status,'READY');
const missingMetadata=normalizeAccountingSource({...complete,source_payload_hash:null});assert.ok(missingMetadata.missing_fields.includes('source_payload_hash'));assert.equal(missingMetadata.ingestion_status,'INCOMPLETE');
const unknown=normalizeAccountingSource({...complete,source_type:'UNTRUSTED_SOURCE'});assert.ok(unknown.missing_fields.includes('source_type'));assert.equal(unknown.ingestion_status,'INCOMPLETE');
for(const rawAmount of ['10.12345','1e3','NaN','',null]){const row=normalizeAccountingSource({...complete,amount:rawAmount});assert.ok(row.missing_fields.includes('amount'),`expected invalid amount ${rawAmount}`);assert.equal(row.ingestion_status,'INCOMPLETE');}
console.log('ai-accounting-source-normalization: all assertions passed');
