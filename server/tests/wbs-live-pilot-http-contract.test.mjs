import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID();
const path=(query='tool=list_payables&limit=1')=>`/api/v1/entities/${entityId}/wbs/live-pilot?${query}`;
const principal=Object.freeze({trusted:true,tenantId,actorId:'oidc|wbs-pilot-reader'});
const approvedTools=Object.freeze([
  'list_payables',
  'list_bank_transactions',
  'list_autorec_details',
  'list_autorec_banks',
  'list_journal_entries',
]);

const safeObservation=(overrides={})=>Object.freeze({
  schema_version:'WBS_LIVE_PILOT_OBSERVATION_V1',
  status:'NOT_ADMITTED',
  observation_mode:'UNSIGNED_PILOT',
  signature_verified:false,
  source_system:'WBS',
  environment:'PRODUCTION',
  entity_id:entityId,
  tool:'list_payables',
  captured_at:'2026-08-12T04:00:00.000Z',
  provider_content_sha256:'a'.repeat(64),
  observation_hash:`sha256:${'b'.repeat(64)}`,
  scope:Object.freeze({company_codes:Object.freeze([]),date_range:Object.freeze([null,null])}),
  record_count:0,
  rows:Object.freeze([]),
  can_import:false,
  can_create_transaction:false,
  can_match:false,
  can_allocate:false,
  can_create_draft:false,
  can_approve:false,
  can_post:false,
  can_reverse:false,
  ...overrides,
});

const dangerousKernel=()=>{
  const calls=[];
  const forbidden=name=>async input=>{calls.push([name,input]);throw new Error(`${name} must never be called by the WBS live pilot`);};
  return {
    calls,
    value:Object.freeze({
      recordWbsSnapshot:forbidden('recordWbsSnapshot'),
      persistWbsInboundRows:forbidden('persistWbsInboundRows'),
      persistWbsInboundSnapshotRows:forbidden('persistWbsInboundSnapshotRows'),
      persistWbsTraceRelationEvidence:forbidden('persistWbsTraceRelationEvidence'),
      executeWbsAutoRecIntent:forbidden('executeWbsAutoRecIntent'),
      createAutoJournal:forbidden('createAutoJournal'),
      transitionJournal:forbidden('transitionJournal'),
      postJournal:forbidden('postJournal'),
    }),
  };
};

test('WBS live pilot is an authenticated, entity-scoped GET with zero import, persistence, AutoRec, or JE authority',async()=>{
  const kernel=dangerousKernel(),seen=[];
  const api=createAccountingApi({
    authenticate:async()=>principal,
    kernelFactory:async()=>kernel.value,
    wbsLivePilotServiceFactory:async receivedPrincipal=>({
      readObservation:async input=>{seen.push([receivedPrincipal,input]);return safeObservation();},
    }),
  });

  const response=await api({method:'GET',url:path(),body:null,headers:{}});
  assert.equal(response.status,200);
  assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(seen,[[principal,{tenantId,entityId,tool:'list_payables',limit:1}]]);
  assert.equal(response.body.data.status,'NOT_ADMITTED');
  assert.equal(response.body.data.observation_mode,'UNSIGNED_PILOT');
  assert.equal(response.body.data.signature_verified,false);
  for(const flag of ['can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse'])assert.equal(response.body.data[flag],false,flag);
  assert.deepEqual(kernel.calls,[],'live pilot must not call any kernel import, persistence, AutoRec, or JE method');
});

test('WBS live pilot rejects unauthenticated and unauthorized callers before returning an observation',async()=>{
  let serviceCalls=0,kernelCalls=0;
  const anonymous=createAccountingApi({
    authenticate:async()=>null,
    kernelFactory:async()=>{kernelCalls++;return dangerousKernel().value;},
    wbsLivePilotServiceFactory:async()=>({readObservation:async()=>{serviceCalls++;return safeObservation();}}),
  });
  const unauthenticated=await anonymous({method:'GET',url:path(),body:null,headers:{}});
  assert.equal(unauthenticated.status,401);
  assert.equal(unauthenticated.body.code,'AUTHENTICATION_REQUIRED');
  assert.equal(serviceCalls,0);assert.equal(kernelCalls,0);

  const denied=createAccountingApi({
    authenticate:async()=>principal,
    kernelFactory:async()=>{kernelCalls++;return dangerousKernel().value;},
    wbsLivePilotServiceFactory:async()=>({readObservation:async()=>{serviceCalls++;const error=new Error('WBS evidence read denied');error.code='42501';throw error;}}),
  });
  const unauthorized=await denied({method:'GET',url:path(),body:null,headers:{}});
  assert.equal(unauthorized.status,403);
  assert.equal(serviceCalls,1);assert.equal(kernelCalls,0);
});

test('WBS live pilot accepts only one approved list tool and one integer limit from 1 through 10',async()=>{
  const seen=[];
  const api=createAccountingApi({
    authenticate:async()=>principal,
    kernelFactory:async()=>dangerousKernel().value,
    wbsLivePilotServiceFactory:async()=>({readObservation:async input=>{seen.push(input);return safeObservation({tool:input.tool,record_count:0});}}),
  });

  for(const tool of approvedTools){
    const response=await api({method:'GET',url:path(`tool=${tool}&limit=10`),body:null,headers:{}});
    assert.equal(response.status,200,tool);
    assert.equal(response.body.data.tool,tool);
  }
  assert.deepEqual(seen.map(item=>item.tool),approvedTools);

  for(const query of [
    'limit=1',
    'tool=list_payables',
    'tool=list_payables&limit=',
    'tool=list_payables&tool=list_journal_entries&limit=1',
    'tool=list_payables&limit=1&limit=2',
    'tool=get_meta&limit=1',
    'tool=trace_by_key&limit=1',
    'tool=LIST_PAYABLES&limit=1',
    'tool=list_payables&limit=0',
    'tool=list_payables&limit=11',
    'tool=list_payables&limit=1.5',
    'tool=list_payables&limit=01',
    'tool=list_payables&limit=1&companyKey=COMPANY-A',
  ]){
    const response=await api({method:'GET',url:path(query),body:null,headers:{}});
    assert.equal(response.status,400,query);
  }
});

test('WBS live pilot is bodyless and refuses command or concurrency headers',async()=>{
  let reads=0;
  const api=createAccountingApi({
    authenticate:async()=>principal,
    kernelFactory:async()=>dangerousKernel().value,
    wbsLivePilotServiceFactory:async()=>({readObservation:async()=>{reads++;return safeObservation();}}),
  });

  for(const request of [
    {method:'GET',url:path(),body:{},headers:{}},
    {method:'GET',url:path(),body:null,headers:{'Idempotency-Key':'pilot-command-forbidden'}},
    {method:'GET',url:path(),body:null,headers:{'If-Match':'"1"'}},
    {method:'POST',url:path(),body:{},headers:{}},
  ]){
    const response=await api(request);
    assert.ok([400,404,405].includes(response.status),`${request.method} ${JSON.stringify(request.headers)} returned ${response.status}`);
  }
  assert.equal(reads,0);
});

test('WBS live pilot rejects any result that is admitted, signature-verified, or grants an action',async()=>{
  const flags=['can_import','can_create_transaction','can_match','can_allocate','can_create_draft','can_approve','can_post','can_reverse'];
  const without=(value,key)=>{const copy={...value};delete copy[key];return copy;};
  const unsafeResults=[
    safeObservation({status:'ADMITTED'}),
    safeObservation({observation_mode:'SIGNED_PROVIDER_EVIDENCE'}),
    safeObservation({signature_verified:true}),
    without(safeObservation(),'status'),
    without(safeObservation(),'observation_mode'),
    without(safeObservation(),'signature_verified'),
    ...flags.map(flag=>safeObservation({[flag]:true})),
    ...flags.map(flag=>without(safeObservation(),flag)),
  ];

  for(const result of unsafeResults){
    const kernel=dangerousKernel();
    const api=createAccountingApi({
      authenticate:async()=>principal,
      kernelFactory:async()=>kernel.value,
      wbsLivePilotServiceFactory:async()=>({readObservation:async()=>result}),
    });
    const response=await api({method:'GET',url:path(),body:null,headers:{}});
    assert.equal(response.status,500,JSON.stringify(result));
    assert.equal(response.body.code,'WBS_LIVE_PILOT_RESULT_INVALID');
    assert.deepEqual(kernel.calls,[]);
  }
});
