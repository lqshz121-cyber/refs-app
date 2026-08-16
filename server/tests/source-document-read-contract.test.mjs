import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

test('source-document SQL exposes entity-scoped immutable evidence only',async()=>{
  const up=await readFile(new URL('../db/migrations/084_source_document_read.sql',import.meta.url),'utf8');
  const down=await readFile(new URL('../db/migrations/down/084_source_document_read.sql',import.meta.url),'utf8');
  for(const token of ['refs_list_source_documents','refs_get_source_document_detail',"'GL.JE.VIEW'",'refs_assert_scope','source_document_line','source_link',"j.status='POSTED'",'payload_hash','REVOKE ALL','GRANT EXECUTE'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/\b(?:INSERT INTO|UPDATE|DELETE FROM|refs_post_journal|refs_create_|attachment_storage|storage_ref|raw_event\.payload)\b/i);
  assert.match(down,/DROP FUNCTION IF EXISTS refs_get_source_document_detail/);assert.match(down,/DROP FUNCTION IF EXISTS refs_list_source_documents/);
});

test('migration 165 adds only a closed nullable provider trace to authoritative source lines',async()=>{
  const [up,down]=await Promise.all([readFile(new URL('../db/migrations/165_source_document_provider_trace_read.sql',import.meta.url),'utf8'),readFile(new URL('../db/migrations/down/165_source_document_provider_trace_read.sql',import.meta.url),'utf8')]);
  for(const token of ['WBS_PROVIDER_SOURCE_TRACE_V1','wbs_final1_retained_source_row','wbs_insurance_pc_company_mapping_decision','source_payload_hash','mapping_decision_hash','company_mapping_hash','RESOLVED','MAPPING_REVIEW_REQUIRED','QUARANTINED','RETAINED','action_flags',"'can_propose_amortization',false","'can_create_draft',false","'can_review',false","'can_approve',false","'can_post',false",'refs_assert_scope'])assert.match(up,new RegExp(token));
  assert.doesNotMatch(up,/(?:payload_ref|storage_ref|receipt_storage_ref|access_token|credential)/i);
  assert.match(down,/refs_get_source_document_detail_v164/);
  const contract=JSON.parse(await readFile(new URL('../api/openapi-accounting.json',import.meta.url),'utf8')),trace=contract.components.schemas.WbsProviderSourceTrace,line=contract.components.schemas.SourceDocumentLineReadRow;
  assert.equal(trace.oneOf.length,2);for(const name of ['WbsProviderPayableSourceTrace','WbsProviderInsuranceSourceTrace']){const schema=contract.components.schemas[name];assert.equal(schema.additionalProperties,false);assert.deepEqual(schema.properties.trace_version,{const:'WBS_PROVIDER_SOURCE_TRACE_V1'});}
  assert.deepEqual(contract.components.schemas.WbsProviderPayableSourceTrace.required,['trace_version','domain','source_payload_hash','disposition','action_flags','invoice_no','invoice_date','business_id','accrual']);
  assert.deepEqual(contract.components.schemas.WbsProviderInsuranceSourceTrace.required,['trace_version','domain','source_payload_hash','action_flags','policy_id','source_id','pc_code','final_premium','mapping_decision_id','mapping_decision_hash','company_mapping_hash','resolved_company_code','match_count','disposition','coverage_start','coverage_end','coverage_disposition']);
  assert.deepEqual(contract.components.schemas.WbsProviderActionFlags.required,['can_propose_amortization','can_review','can_create_draft','can_approve','can_post']);assert.equal(contract.components.schemas.WbsProviderActionFlags.additionalProperties,false);assert.ok(line.required.includes('provider_trace'));assert.equal(line.properties.provider_trace.oneOf[0].type,'null');
});

test('repository and HTTP expose exact no-store source-document GET contracts',async()=>{
  const calls=[],kernel=Object.create(PostgresAccountingKernel.prototype);kernel.inSession=async work=>work({query:async(sql,args)=>{calls.push({sql,args});return {rows:[]};}});
  await kernel.listSourceDocuments({tenantId:'t',entityId:'e'});await kernel.getSourceDocumentDetail({tenantId:'t',entityId:'e',sourceDocumentId:'d'});
  assert.deepEqual(calls,[{sql:'SELECT * FROM refs_list_source_documents($1,$2)',args:['t','e']},{sql:'SELECT * FROM refs_get_source_document_detail($1,$2,$3)',args:['t','e','d']}]);
  const tenantId=randomUUID(),entityId=randomUUID(),sourceDocumentId=randomUUID(),scopes=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({listSourceDocuments:async scope=>{scopes.push(['list',scope]);return [];},getSourceDocumentDetail:async scope=>{scopes.push(['detail',scope]);return [];}})});
  const list=`/api/v1/entities/${entityId}/source-documents`,detail=`${list}/${sourceDocumentId}`;
  for(const url of [list,detail]){const response=await api({method:'GET',url,headers:{},body:null});assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');}
  assert.deepEqual(scopes,[['list',{tenantId,entityId}],['detail',{tenantId,entityId,sourceDocumentId}]]);
  assert.equal((await api({method:'GET',url:`${detail}?extra=1`,headers:{},body:null})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`${list}/not-a-uuid`,headers:{},body:null})).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await api({method:'GET',url:list,headers:{'idempotency-key':'not-allowed'},body:null})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:detail,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
});
