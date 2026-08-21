import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createAccountingApi} from '../api/accounting-http.mjs';
import contract from '../api/openapi-accounting.json' with {type:'json'};

const here=resolve(fileURLToPath(new URL('.',import.meta.url)));const up=await readFile(resolve(here,'../db/migrations/127_ai_accounting_analysis_summary.sql'),'utf8');
const tenantId='6fb25daf-0799-4805-bede-be54230da33c',entityId='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3',path=`/api/v1/entities/${entityId}/ai/analysis-summary`;
const row={category:'DUPLICATE_PAYABLE',total_findings:'3',high_findings:'3',medium_findings:'0',low_findings:'0',latest_materialized_at:'2026-08-15T00:00:00Z',can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('AI accounting summary is a server-side aggregate of retained open findings only',()=>{
  for(const table of ['ai_finding','ai_prepaid_coverage_finding','ai_duplicate_payable_finding','ai_unmatched_bank_payment_finding','ai_cost_dimension_finding','ai_loan_reference_finding'])assert.match(up,new RegExp(table));assert.match(up,/refs_assert_scope\(p_tenant,p_entity,'AI\.AMORTIZATION\.PROPOSE'\)/);for(const field of ['false,false,false,false'])assert.match(up,new RegExp(field));assert.doesNotMatch(up,/INSERT INTO journal_entry/i);
});
test('AI accounting summary GET is authenticated, no-store, and fails closed without a repository capability',async()=>{
  const seen=[];const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({readAiAccountingAnalysisSummary:async input=>(seen.push(input),[row])})});const response=await api({method:'GET',url:path,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:[row]});assert.deepEqual(seen,[{tenantId,entityId}]);for(const request of [{method:'GET',url:path,headers:{'idempotency-key':'no'},body:null},{method:'GET',url:`${path}?x=1`,headers:{},body:null},{method:'GET',url:path,headers:{},body:{}}])assert.equal((await api(request)).status,400);
  const missing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'controller-a'}),kernelFactory:async()=>({})});const unavailable=await missing({method:'GET',url:path,headers:{},body:null});assert.equal(unavailable.status,503);assert.equal(unavailable.body.code,'AI_ACCOUNTING_ANALYSIS_SUMMARY_UNAVAILABLE');
});
test('OpenAPI describes a retained no-action analysis summary',()=>{const operation=contract.paths['/entities/{entityId}/ai/analysis-summary'].get;assert.equal(operation.operationId,'readAiAccountingAnalysisSummary');assert.match(operation.description,/cannot create a Draft/i);const schema=contract.components.schemas.AiAccountingAnalysisSummaryRow;assert.equal(schema.additionalProperties,false);assert.ok(schema.properties.category.enum.includes('BANK_DUPLICATE_PAYMENT'));for(const field of ['can_create_draft','can_review','can_approve','can_post'])assert.equal(schema.properties[field].const,false);});
