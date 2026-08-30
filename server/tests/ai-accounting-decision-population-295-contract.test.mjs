import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';
import {createAiAccountingApprovedDecisionService} from '../runtime/ai-accounting-approved-decision-service.mjs';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const read=path=>readFile(new URL(path,import.meta.url),'utf8');
const id=n=>`${(n>>>0).toString(16).padStart(8,'0')}-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const hash=n=>`sha256:${n.toString(16).padStart(64,'0')}`;
const tenantId=id(1),entityId=id(2),periodId=id(3),actions={can_create_draft:false,can_review:false,can_approve:false,can_post:false};

test('295 adds deterministic keyset readers and raises only the atomic retention capacity',async()=>{
  const [up,down,repository]=await Promise.all([read('../db/migrations/295_ai_accounting_decision_population.sql'),read('../db/migrations/down/295_ai_accounting_decision_population.sql'),read('../runtime/kernel-repository.mjs')]);
  for(const token of ['refs_read_ai_invoice_decision_population_page','refs_read_ai_loan_decision_population_page','(d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id)>','ORDER BY d.accounting_date,d.source_document_id,l.line_no,l.source_document_line_id','p_page_size>500','row_count>10000','Decision population attestation drifted before retention','e.is_current','p_population_hash'])assert.ok(up.includes(token),`missing ${token}`);
  assert.match(repository,/readAiAccountingDecisionPopulation/);assert.match(repository,/pageSize=250,maxRows=10000/);assert.match(repository,/SELECT refs_jsonb_hash\(\$1::jsonb\) AS population_hash/);assert.match(repository,/population_validation_hash:canonicalRequestHash\(identities\)/);assert.match(repository,/population_complete:true/);
  assert.match(down,/refs_retain_ai_accounting_decision_batch_v256/);assert.match(down,/DROP FUNCTION refs_read_ai_invoice_decision_population_page/);
  assert.ok(MIGRATION_MANIFEST.some(item=>item.name==='295_ai_accounting_decision_population.sql'));
});

test('complete 501-row population produces exactly 501 suggested-only decisions',async()=>{
  const invoiceRows=Array.from({length:501},(_,index)=>({tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-08-01',source_document_id:id(1000+index),line_no:1,source_document_line_id:id(2000+index),source_payload_hash:hash(3000+index),source_line_hash:hash(4000+index),duplicate_status:'NONE',retained_outcome:'STAGING_REVIEW_REQUIRED',retained_exception_codes:[],source_status:'PENDING_REVIEW'}));
  const identities=invoiceRows.map(row=>({tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,source_kind:'INVOICE',accounting_date:row.accounting_date,source_document_id:row.source_document_id,line_no:row.line_no,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,retained_outcome:row.retained_outcome,retained_exception_codes:row.retained_exception_codes,source_status:row.source_status}));
  let built=0;
  const service=createAiAccountingApprovedDecisionService({
    populationReader:async()=>({schema_version:'AI_ACCOUNTING_DECISION_POPULATION_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},total_count:501,invoice_count:501,loan_count:0,population_complete:true,population_hash:hash(99),population_validation_hash:canonicalRequestHash(identities),invoice_rows:invoiceRows,loan_rows:[]}),
    classificationService:{analyze:async()=>{throw new Error('bounded reader must not run');},analyzeInputs:async()=>({results:invoiceRows.map(row=>({source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,classification:'EXPENSE'}))})},
    scheduleReader:async()=>[],
    settingsAdapter:{buildInvoice:async({retainedSource})=>{built+=1;return {schema_version:'AI_ACCOUNTING_DECISION_PACKET_V1',status:'READY_FOR_HUMAN_REVIEW',tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,source:{source_type:'INVOICE',source_document_id:retainedSource.source_document_id,source_document_line_id:retainedSource.source_document_line_id,source_payload_hash:retainedSource.source_payload_hash,source_line_hash:retainedSource.source_line_hash},proposed_journal:{status:'SUGGESTED_ONLY',lines:[{},{}]},expected_report_deltas:[{}],settings_snapshot_id:id(9),settings_snapshot_hash:hash(9),action_flags:actions};}}
  });
  const result=await service.analyze({tenantId,entityId,accountingPeriodId:periodId,limit:100});
  assert.equal(result.row_count,501);assert.equal(result.population.total_count,501);assert.equal(result.population.population_hash,hash(99));assert.equal(result.population.population_complete,true);assert.equal(built,501);assert.deepEqual(result.action_flags,actions);
});

test('population hash, count, scope or ordering drift fails before any decision build',async()=>{
  const row={tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,accounting_date:'2026-08-01',source_document_id:id(10),line_no:1,source_document_line_id:id(11),source_payload_hash:hash(10),source_line_hash:hash(11),duplicate_status:'NONE',retained_outcome:'STAGING_REVIEW_REQUIRED',retained_exception_codes:[],source_status:'PENDING_REVIEW'};let built=0;
  const service=createAiAccountingApprovedDecisionService({populationReader:async()=>({schema_version:'AI_ACCOUNTING_DECISION_POPULATION_V1',scope:{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId},total_count:2,invoice_count:1,loan_count:0,population_complete:true,population_hash:hash(99),population_validation_hash:canonicalRequestHash([{tenant_id:tenantId,entity_id:entityId,accounting_period_id:periodId,source_kind:'INVOICE',accounting_date:row.accounting_date,source_document_id:row.source_document_id,line_no:row.line_no,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash,retained_outcome:row.retained_outcome,retained_exception_codes:row.retained_exception_codes,source_status:row.source_status}]),invoice_rows:[row],loan_rows:[]}),classificationService:{analyze:async()=>({}),analyzeInputs:async()=>({results:[]})},scheduleReader:async()=>[],settingsAdapter:{buildInvoice:async()=>{built+=1;}}});
  await assert.rejects(service.analyze({tenantId,entityId,accountingPeriodId:periodId,limit:100}),error=>error.code==='AI_ACCOUNTING_DECISION_POPULATION_INCOMPLETE');assert.equal(built,0);
});
