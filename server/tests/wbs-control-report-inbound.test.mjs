import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';
import {buildWbsControlReportEvidence,WbsControlReportInboundError} from '../runtime/wbs-control-report-inbound.mjs';
import {createHash} from 'node:crypto';

const hash=value=>createHash('sha256').update(canonicalRequestBody(value),'utf8').digest('hex');
const costRows=Array.from({length:14},(_,index)=>({metric_key:`COST_METRIC_${String(index+1).padStart(2,'0')}`,amount:String(index+1)}));
const envelope=(rows=costRows,scope={company:'COMPANY-A',currency:'USD',report_type:'COST_GENERAL_LEDGER',period:'2026-08'},source={report_formula_id:'cost-gl-v1',report_formula_version:'1'})=>({tool:'list_control_totals',contract_version:'1',environment:'production',captured_at:'2026-08-10T00:00:00.000Z',source,scope,rows,record_count:rows.length,content_sha256:hash(rows),cursor_next:null,etl_notice:null});
const receipt=body=>({hash:`sha256:${body.content_sha256}`,ref:'object://wbs/control/cost-1',version:'v1',signature_verified:true,manifest_hash:'sha256:'+'a'.repeat(64),key_id:'wbs-k1',algorithm:'Ed25519'});

test('verified Cost GL report metrics become evidence-only input for exact REFS control reconciliation',()=>{
  const source=envelope(),result=buildWbsControlReportEvidence({sourceType:'COST_GENERAL_LEDGER',envelope:source,receipt:receipt(source),tenantId:'tenant-a',entityId:'entity-a'});
  assert.equal(result.source_type,'COST_GENERAL_LEDGER');assert.equal(result.metrics.length,14);assert.equal(result.scope.period,'2026-08');assert.equal(result.provider_report.formula_id,'cost-gl-v1');
  assert.deepEqual({transaction:result.can_create_transaction,draft:result.can_create_draft,post:result.can_post},{transaction:false,draft:false,post:false});
});

test('report identity, receipt binding, metric cardinality, and Property scope fail closed',()=>{
  const source=envelope();
  assert.throws(()=>buildWbsControlReportEvidence({sourceType:'COST_GENERAL_LEDGER',envelope:{...source,source:{}},receipt:receipt(source),tenantId:'tenant-a',entityId:'entity-a'}),error=>error instanceof WbsControlReportInboundError&&error.code==='WBS_CONTROL_REPORT_IDENTITY_REQUIRED');
  assert.throws(()=>buildWbsControlReportEvidence({sourceType:'COST_GENERAL_LEDGER',envelope:source,receipt:{...receipt(source),hash:'sha256:'+'b'.repeat(64)},tenantId:'tenant-a',entityId:'entity-a'}),error=>error.code==='WBS_CONTROL_REPORT_RECEIPT_REQUIRED');
  assert.throws(()=>buildWbsControlReportEvidence({sourceType:'COST_GENERAL_LEDGER',envelope:envelope(costRows.slice(0,13)),receipt:receipt(envelope(costRows.slice(0,13))),tenantId:'tenant-a',entityId:'entity-a'}),error=>error.code==='WBS_COST_GL_METRIC_CARDINALITY_REQUIRED');
  const propertyRows=[{metric_key:'PROPERTY_VALUE',amount:'100.0000'}],propertyScope={company:'COMPANY-A',currency:'USD',report_type:'PROPERTY_COMPARISON',property_ref:'PROPERTY-A',period_start:'2026-08-01',period_end:'2026-08-31',bank_account_ref:'BANK-1'},property=envelope(propertyRows,propertyScope,{report_formula_id:'property-v1',report_formula_version:'3'});
  assert.equal(buildWbsControlReportEvidence({sourceType:'PROPERTY_COMPARISON',envelope:property,receipt:receipt(property),tenantId:'tenant-a',entityId:'entity-a'}).scope.property_ref,'PROPERTY-A');
  assert.throws(()=>buildWbsControlReportEvidence({sourceType:'PROPERTY_COMPARISON',envelope:{...property,scope:{...propertyScope,bank_account_ref:''}},receipt:receipt(property),tenantId:'tenant-a',entityId:'entity-a'}),error=>error.code==='WBS_CONTROL_REPORT_SCOPE_REQUIRED');
});
