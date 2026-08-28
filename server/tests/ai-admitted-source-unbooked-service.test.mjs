import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiAdmittedSourceUnbookedAnalysisService} from '../runtime/ai-admitted-source-unbooked-service.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n%10).repeat(64)}`;
const input={tenantId:id(1),entityId:id(2),currentAccountingPeriodId:id(3),limit:10};
const row=(n=1,overrides={})=>({tenant_id:input.tenantId,entity_id:input.entityId,company_code:'WBPA',accounting_period_id:input.currentAccountingPeriodId,admission_id:id(100+n),admission_hash:hash(1+n),source_document_id:id(200+n),source_document_line_id:id(300+n),source_payload_hash:hash(3+n),source_line_hash:hash(4+n),vendor_ref:`VENDOR-${n}`,business_date:'2026-01-15',accounting_date:'2026-01-31',currency:'USD',amount:'500.0000',retained_outcome:'STAGING_REVIEW_REQUIRED',exception_codes:[],source_status:'READY_FOR_DRAFT',queried_at:'2026-08-23T12:00:00.000Z',ap_document_ids:[],journal_entry_ids:[],ledger_line_ids:[],...overrides});

test('scans one complete server-read population and reports only exact zero-booking sources',async()=>{
  let received;const service=createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async scope=>(received=scope,[row(1),row(2,{journal_entry_ids:[id(900)]})])}),result=await service.analyze(input);
  assert.deepEqual(received,{tenantId:input.tenantId,entityId:input.entityId,accountingPeriodId:input.currentAccountingPeriodId,limit:10});
  assert.equal(result.scanned_source_count,2);assert.equal(result.finding_count,1);assert.equal(result.findings[0].source_trace.source_document_id,id(201));assert.equal(result.findings[0].suggested_journal,null);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('AP, Draft Journal, Posted Journal, or ledger evidence prevents an unbooked finding',async()=>{
  const rows=[row(1,{ap_document_ids:[id(801)]}),row(2,{journal_entry_ids:[id(802)]}),row(3,{journal_entry_ids:[id(803)],ledger_line_ids:[id(804)]})],service=createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>rows}),result=await service.analyze(input);
  assert.equal(result.finding_count,0);assert.equal(result.scanned_source_count,3);
});

test('keeps admitted sources with nonfatal or fatal exceptions visible as blocked human-review findings',async()=>{
  const nonfatal=row(1,{exception_codes:['WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_MAPPING_REVIEW_REQUIRED'],source_status:'PENDING_REVIEW'}),fatal=row(2,{retained_outcome:'EXCEPTION_REVIEW_REQUIRED',exception_codes:['WBS_PAYABLE_SOURCE_INVALID'],source_status:'QUARANTINED',vendor_ref:null,business_date:null});
  const result=await createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[nonfatal,fatal]}).analyze(input);
  assert.equal(result.scanned_source_count,2);assert.equal(result.finding_count,2);
  for(const finding of result.findings){assert.equal(finding.schema_version,'AI_ADMITTED_SOURCE_BLOCKED_FINDING_V1');assert.equal(finding.finding_type,'BLOCKED_SOURCE_INCOMPLETE');assert.equal(finding.suggested_journal,null);assert.deepEqual(finding.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});}
  assert.deepEqual(result.findings[0].source_trace.exception_codes,nonfatal.exception_codes);assert.equal(result.findings[0].source_trace.retained_outcome,'STAGING_REVIEW_REQUIRED');assert.equal(result.findings[1].vendor_ref,null);assert.equal(result.findings[1].business_date,null);
});

test('does not report a blocked source when authoritative booking evidence already exists',async()=>{
  const result=await createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[row(1,{exception_codes:['WBS_PAYABLE_ATTACHMENT_REQUIRED'],source_status:'PENDING_REVIEW',ap_document_ids:[id(801)]})]}).analyze(input);
  assert.equal(result.scanned_source_count,1);assert.equal(result.finding_count,0);
});

test('fails closed when the reader exceeds the bound or returns drifted and unsafe evidence',async()=>{
  await assert.rejects(()=>createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>Array.from({length:10},(_,index)=>row(index+1))}).analyze(input),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_POPULATION_INCOMPLETE');
  await assert.rejects(()=>createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[row(1,{entity_id:id(99)})]}).analyze(input),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID');
  await assert.rejects(()=>createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[row(1,{authorization:'Bearer secret'})]}).analyze(input),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID');
  await assert.rejects(()=>createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[row(1,{exception_codes:['WBS_PAYABLE_ATTACHMENT_REQUIRED','WBS_PAYABLE_ATTACHMENT_REQUIRED']})]}).analyze(input),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID');
  await assert.rejects(()=>createAiAdmittedSourceUnbookedAnalysisService({bookingEvidenceReader:async()=>[row(1,{exception_codes:['Bearer secret']})]}).analyze(input),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_EVIDENCE_INVALID');
});
