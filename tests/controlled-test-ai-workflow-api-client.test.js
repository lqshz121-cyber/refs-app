import assert from 'node:assert/strict';
import {controlledTestAiWorkflowIdempotencyKey,refreshControlledTestAiSources,runControlledTestAiWorkflow} from '../src/accounting-api.js';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',parentSourceDocumentId='33333333-3333-4333-8333-333333333333';
const config={baseUrl:'https://api.example',entityId,periodId,deploymentEnvironment:'staging',controlledTestAiWorkflowMode:'ENABLED',getAccessToken:async()=> 'a'.repeat(48)};
const request={config,periodId,parentSourceDocumentId,coverageStart:'2026-01-01',coverageEnd:'2026-01-31',reason:'Run this posted WBS test payable through the complete AI flow.'};
const key=await controlledTestAiWorkflowIdempotencyKey(request);assert.match(key,/^controlled-ai:[0-9a-f]{64}$/);
assert.equal(await controlledTestAiWorkflowIdempotencyKey(request),key,'the exact selection must keep one stable command identity');
assert.equal(await controlledTestAiWorkflowIdempotencyKey({...request,config:{...config,deploymentEnvironment:'production'}}),null);

let seen;
const posted={status:'CONTROLLED_TEST_AI_WORKFLOW_POSTED',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',idempotent:false,parent_source_document_id:parentSourceDocumentId,source_document_id:'44444444-4444-4444-8444-444444444444',ai_amortization_schedule_id:'55555555-5555-4555-8555-555555555555',journal_entry_id:'66666666-6666-4666-8666-666666666666',posting_batch_id:'77777777-7777-4777-8777-777777777777'};
const response=(data,status=201)=>({ok:true,status,headers:{get:name=>name==='content-type'?'application/json':name==='cache-control'?'no-store':''},json:async()=>({ok:true,data})});
const sourceRow={source_document_id:parentSourceDocumentId,source_document_revision:1,raw_event_id:'99999999-9999-4999-8999-999999999999',source_system:'REFS_STAGE1',source_module:'payable',source_record_id:'test-payable:001',source_version:'test-v1',document_type:'WBS_TEST_PAYABLE',document_no:'WBS-001',business_date:'2026-01-15',accounting_date:'2026-01-15',currency:'USD',gross_amount:'100.0000',status:'POSTED',payload_hash:'sha256:'+'a'.repeat(64),source_line_count:1,posted_journal_entry_ids:['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'],created_at:'2026-01-15T00:00:00.000Z',updated_at:'2026-01-15T00:00:01.000Z'};
let sourceUrl;
const sources=await refreshControlledTestAiSources({config,fetcher:async url=>(sourceUrl=String(url),response([sourceRow],200))});
assert.equal(sources.ok,true);assert.deepEqual(sources.rows,[sourceRow]);assert.match(sourceUrl,/\/source-documents\/controlled-test-ai-eligible\?periodId=/);assert.match(sourceUrl,/limit=100/);
assert.equal((await refreshControlledTestAiSources({config,limit:101,fetcher:async()=>{throw new Error('must not call');}})).code,'ACCOUNTING_API_SCOPE_INVALID');
for(const cacheControl of ['', 'private, max-age=60']){
  const invalid=await refreshControlledTestAiSources({config,fetcher:async()=>({ok:true,status:200,headers:{get:name=>name==='content-type'?'application/json':cacheControl},json:async()=>({ok:true,data:[sourceRow]})})});
  assert.equal(invalid.code,'ACCOUNTING_API_PROTOCOL');
}
assert.equal((await refreshControlledTestAiSources({config,fetcher:async()=>response([{...sourceRow,posted_journal_entry_ids:[]}],200)})).code,'ACCOUNTING_API_PROTOCOL');
const result=await runControlledTestAiWorkflow({...request,idempotencyKey:key,fetcher:async(url,options)=>{seen={url,options};return response(posted);}});
assert.equal(result.ok,true);assert.equal(result.data.journal_entry_id,posted.journal_entry_id);assert.match(seen.url,/\/ai\/controlled-test-workflow\/run$/);assert.equal(seen.options.method,'POST');assert.equal(seen.options.cache,'no-store');assert.equal(seen.options.headers['idempotency-key'],key);assert.equal(seen.options.headers['if-match'],undefined);assert.deepEqual(JSON.parse(seen.options.body),{periodId,parentSourceDocumentId,coverageStart:'2026-01-01',coverageEnd:'2026-01-31',reason:request.reason});

const partial={status:'CONTROLLED_TEST_AI_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',retryable:true,completed_stage:'DRAFT_CREATED',idempotency_key:key,parent_source_document_id:parentSourceDocumentId,source_document_id:posted.source_document_id,ai_amortization_schedule_id:posted.ai_amortization_schedule_id,journal_entry_id:posted.journal_entry_id,posting_batch_id:null};
assert.equal((await runControlledTestAiWorkflow({...request,idempotencyKey:key,fetcher:async()=>response(partial)})).data.completed_stage,'DRAFT_CREATED');
assert.equal((await runControlledTestAiWorkflow({...request,idempotencyKey:key,fetcher:async()=>response({...partial,idempotency_key:'wrong-key'})})).code,'CONTROLLED_TEST_AI_PROTOCOL');
assert.equal((await runControlledTestAiWorkflow({...request,config:{...config,controlledTestAiWorkflowMode:'DISABLED'},idempotencyKey:key,fetcher:async()=>{throw new Error('must not call');}})).code,'CONTROLLED_TEST_AI_COMMAND_INVALID');
console.log('controlled TEST_ONLY AI client: stable replay identity and closed POSTED/PARTIAL receipts');
