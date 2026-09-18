// P06 HTTP contract: close-out read is bodyless/no-store; the COGS release command has a closed payload,
// needs an Idempotency-Key, rejects If-Match, and maps kernel codes (422 for every accounting refusal).
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';
const tenantId=randomUUID(),entityId=randomUUID(),unitId=randomUUID(),periodId=randomUUID(),journalEntryId=randomUUID(),bindingId=randomUUID(),attachmentId=randomUUID();
const H={'idempotency-key':'p06-http-key-1','content-type':'application/json'};
const closeout={schema_version:'UNIT_SALE_CLOSEOUT_V1',accounting_authority:'NONE',can_release:false,can_post:false,project_ref:'PRJ-1',project_id:randomUUID(),project_status:'APPROVED',period_id:null,period_code:null,as_of:null,
  units:[{unit_ref:'U-101',unit_id:unitId,unit_status:'APPROVED',allocation_basis:'SPECIFIC_IDENTIFICATION',capitalized_cost:0,cogs_released:600,revenue_recognized:900,gross_margin:300,state:'CLOSED_OUT',exception_code:null,unclassified_line_count:0,journal_entry_count:3,last_journal_date:'2026-07-20'}],
  totals:{unit_count:1,exception_count:0,capitalized_cost:0,cogs_released:600,revenue_recognized:900,gross_margin:300,closed_out_count:1}};
const receipt={schema_version:'UNIT_COGS_RELEASE_DRAFT_V1',journal_entry_id:journalEntryId,unit_cogs_release_binding_id:bindingId,unit_id:unitId,project_ref:'PRJ-1',unit_ref:'U-101',
  cwip_account_code:'150100',cogs_account_code:'500100',amount:'500.0000',available_before:'800.0000',status:'DRAFT',revision:0,idempotent:false};
const api=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'releaser'}),kernelFactory:async()=>kernel});
const failing=code=>async()=>{const e=new Error('kernel');e.code=code;throw e;};
const body={periodId,journalNumber:'P06-REL-1',journalDate:'2026-07-20',cwipAccountCode:'150100',cogsAccountCode:'500100',amount:'500.0000',attachmentIds:[attachmentId],reason:'release unit cost on closing'};
const base=`/api/v1/entities/${entityId}`;

test('P06 close-out read: bodyless no-store, optional periodId, scope 403, foreign period 400, protocol 502',async()=>{
  const observed=[];let answer=closeout;
  const a=api({readUnitSaleCloseout:async args=>(observed.push(args),answer)});
  let r=await a({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout`,body:null,headers:{}});
  assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,closeout);assert.deepEqual(observed[0],{tenantId,entityId,projectRef:'PRJ-1',periodId:null});
  r=await a({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout?periodId=${periodId}`,body:null,headers:{}});assert.equal(r.status,200);assert.equal(observed[1].periodId,periodId);
  for(const req of [{url:`${base}/projects/PRJ-1/unit-sale-closeout`,body:{}},{url:`${base}/projects/PRJ-1/unit-sale-closeout?x=1`,body:null},{url:`${base}/projects/PRJ-1/unit-sale-closeout?periodId=nope`,body:null},{url:`${base}/projects/${encodeURIComponent('bad ref')}/unit-sale-closeout`,body:null}])
    assert.equal((await a({method:'GET',url:req.url,body:req.body,headers:{}})).status,400,req.url);
  assert.equal((await a({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout`,body:null,headers:{'if-match':'"0"'}})).status,400);
  answer={...closeout,can_release:true};assert.equal((await a({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout`,body:null,headers:{}})).status,502);
  assert.equal((await api({readUnitSaleCloseout:failing('42501')})({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout`,body:null,headers:{}})).status,403);
  assert.equal((await api({readUnitSaleCloseout:failing('22023')})({method:'GET',url:`${base}/projects/PRJ-1/unit-sale-closeout?periodId=${periodId}`,body:null,headers:{}})).status,400);
});

test('P06 release command: closed payload, Idempotency-Key, no If-Match, accounting refusals are 422, protocol 502',async()=>{
  const observed=[];
  const a=api({createUnitCogsReleaseDraft:async args=>(observed.push(args),receipt)});
  const url=`${base}/project-units/${unitId}/cogs-releases`;
  let r=await a({method:'POST',url,body,headers:H});
  assert.equal(r.status,201);assert.equal(r.headers.etag,'"0"');assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body.data,receipt);
  assert.deepEqual(observed[0],{tenantId,entityId,unitId,periodId,journalNumber:'P06-REL-1',journalDate:'2026-07-20',cwipAccountCode:'150100',cogsAccountCode:'500100',amount:'500.0000',reason:'release unit cost on closing',attachmentIds:[attachmentId],idempotencyKey:'p06-http-key-1'});
  const replay=api({createUnitCogsReleaseDraft:async()=>({...receipt,idempotent:true})});
  assert.equal((await replay({method:'POST',url,body,headers:H})).status,200);
  assert.equal((await a({method:'POST',url,body,headers:{'content-type':'application/json'}})).status,400,'Idempotency-Key required');
  assert.equal((await a({method:'POST',url,body,headers:{...H,'if-match':'"0"'}})).status,400);
  for(const bad of [{...body,extra:1},{...body,amount:'500'},{...body,amount:'0.0000'},{...body,cogsAccountCode:'150100'},{...body,attachmentIds:[]},{...body,reason:'short'},{...body,journalDate:'20-07-2026'},{...body,periodId:'nope'}])
    assert.equal((await a({method:'POST',url,body:bad,headers:H})).status,400,JSON.stringify(bad).slice(0,60));
  const missing={...body};delete missing.cwipAccountCode;
  assert.equal((await a({method:'POST',url,body:missing,headers:H})).status,400);
  assert.equal((await a({method:'POST',url:`${base}/project-units/nope/cogs-releases`,body,headers:H})).status,400);
  // every accounting refusal in 430 raises 23514 → 422; scope 42501 → 403; missing unit P0002 → 404; closed period 55000 → 423
  for(const [code,status] of [['23514',422],['42501',403],['P0002',404],['23505',409],['55000',423],['22023',422]])
    assert.equal((await api({createUnitCogsReleaseDraft:failing(code)})({method:'POST',url,body,headers:H})).status,status,code);
  assert.equal((await api({createUnitCogsReleaseDraft:async()=>({...receipt,status:'POSTED'})})({method:'POST',url,body,headers:H})).status,502,'a receipt that claims POSTED is a protocol breach');
  assert.equal((await api({createUnitCogsReleaseDraft:async()=>({...receipt,amount:'123.0000'})})({method:'POST',url,body,headers:H})).status,502,'amount must echo the request');
  assert.equal((await api({})({method:'POST',url,body,headers:H})).status,503);
});
