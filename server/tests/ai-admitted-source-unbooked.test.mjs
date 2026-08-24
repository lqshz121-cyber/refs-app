import assert from 'node:assert/strict';
import test from 'node:test';
import {createAiAdmittedSourceUnbookedService,hashAiAdmittedSourceBookingEvidence} from '../runtime/ai-admitted-source-unbooked.mjs';

const id=n=>`${String(n).padStart(8,'0')}-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=n=>`sha256:${String(n%10).repeat(64)}`;
const scope={tenantId:id(1),entityId:id(2),accountingPeriodId:id(3),sourceDocumentId:id(4)};
const source={schema_version:'ADMITTED_ACCOUNTING_SOURCE_V1',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,admission_id:id(6),admission_hash:hash(6),admission_status:'ADMITTED',source_document_id:scope.sourceDocumentId,source_document_line_id:id(5),source_payload_hash:hash(1),source_line_hash:hash(2),source_type:'PAYABLE',vendor_ref:'VENDOR-7',business_date:'2026-07-15',accounting_date:'2026-07-31',currency:'USD',amount:'500.0000'};
const lookup=(overrides={})=>{const explicitHash=overrides.lookup_evidence_hash,{lookup_evidence_hash:ignored,...fields}=overrides,payload={schema_version:'ACCOUNTING_BOOKING_LOOKUP_V1',tenant_id:scope.tenantId,entity_id:scope.entityId,company_code:'WBPA',accounting_period_id:scope.accountingPeriodId,source_document_id:scope.sourceDocumentId,source_document_line_id:id(5),source_line_hash:hash(2),lookup_status:'COMPLETE',queried_at:'2026-08-20T12:00:00.000Z',ap_match_count:0,journal_match_count:0,ledger_line_match_count:0,ap_document_ids:[],journal_entry_ids:[],ledger_line_ids:[],...fields};return {...payload,lookup_evidence_hash:explicitHash??hashAiAdmittedSourceBookingEvidence(payload)};};
const service=(sourceResult=source,lookupResult=lookup())=>createAiAdmittedSourceUnbookedService({admittedSourceReader:async()=>sourceResult,accountingLookupReader:async()=>lookupResult});

test('finds an admitted Payable only after exact AP, Journal, and ledger lookups all return zero',async()=>{
  const result=await service().analyze(scope);
  assert.equal(result.status,'FINDING');assert.equal(result.finding.finding_type,'ADMITTED_SOURCE_UNBOOKED');assert.equal(result.finding.amount,'500.0000');assert.equal(result.finding.confidence,1);assert.equal(result.finding.owner_role,'CONTROLLER_REVIEW');assert.equal(result.finding.due_basis,'BEFORE_PERIOD_CLOSE');assert.equal(result.finding.lookup_trace.ap_match_count,0);assert.equal(result.finding.suggested_journal,null);assert.deepEqual(result.action_flags,{can_create_draft:false,can_review:false,can_approve:false,can_post:false});
});

test('does not report unbooked when any authoritative accounting match exists',async()=>{
  for(const present of [lookup({ap_match_count:1,ap_document_ids:[id(20)]}),lookup({journal_match_count:1,journal_entry_ids:[id(21)]}),lookup({ledger_line_match_count:1,ledger_line_ids:[id(22)]})]){const result=await service(source,present).analyze(scope);assert.equal(result.status,'BOOKING_PRESENT');assert.equal(result.finding,null);}
});

test('lookup unavailable or ambiguous is BLOCKED and never converted into absence',async()=>{
  for(const lookup_status of ['UNAVAILABLE','AMBIGUOUS']){const result=await service(source,lookup({lookup_status,ap_match_count:null,journal_match_count:null,ledger_line_match_count:null})).analyze(scope);assert.equal(result.status,'BLOCKED');assert.equal(result.finding,null);assert.equal(result.suggested_journal,null);}
});

test('fails closed for caller-shaped source or lookup evidence, scope drift, and count drift',async()=>{
  await assert.rejects(()=>service({...source,authorization:'secret'}).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_SOURCE_INVALID');
  await assert.rejects(()=>service({...source,admission_status:'STAGING'}).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_SOURCE_INVALID');
  await assert.rejects(()=>service(source,lookup({entity_id:id(99)})).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_LOOKUP_INVALID');
  await assert.rejects(()=>service(source,lookup({ap_match_count:1})).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_LOOKUP_INVALID');
  await assert.rejects(()=>service(source,lookup({lookup_evidence_hash:hash(9)})).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_LOOKUP_INVALID');
  await assert.rejects(()=>service(source,lookup({raw_rows:[]})).analyze(scope),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_LOOKUP_INVALID');
});

test('the caller supplies only scope while readers receive the exact source-bound lookup request',async()=>{
  let sourceInput,lookupInput;const analyzer=createAiAdmittedSourceUnbookedService({admittedSourceReader:async input=>(sourceInput=input,source),accountingLookupReader:async input=>(lookupInput=input,lookup())});await analyzer.analyze(scope);
  assert.deepEqual(sourceInput,scope);assert.deepEqual(lookupInput,{tenantId:scope.tenantId,entityId:scope.entityId,accountingPeriodId:scope.accountingPeriodId,sourceDocumentId:source.source_document_id,sourceDocumentLineId:source.source_document_line_id,sourceLineHash:source.source_line_hash});
  await assert.rejects(()=>analyzer.analyze({...scope,absence:true}),error=>error.code==='AI_ADMITTED_SOURCE_UNBOOKED_SCOPE_INVALID');
});
