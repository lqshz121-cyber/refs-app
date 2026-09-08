import test from 'node:test';import assert from 'node:assert/strict';
import {createAccountingApi} from '../api/accounting-http.mjs';
import {validCounterpartyChangesPage} from '../runtime/counterparty-maintenance-reads.mjs';
const tenantId='11111111-1111-4111-8111-111111111111',entityId='22222222-2222-4222-8222-222222222222',changeId='33333333-3333-4333-8333-333333333333';
const base=`/api/v1/entities/${entityId}`;
const detail={schema_version:'COUNTERPARTY_DETAIL_V1',entity_id:entityId,kind:'VENDOR',member_ref:'V-1',display_name:'Vendor',active:false,revision:3};
const row={counterparty_change_id:changeId,member_ref:'V-1',kind:'VENDOR',change_type:'UPDATE',expected_member_revision:2,before_state:{display_name:'Vendor',active:true,revision:2},desired_state:{display_name:'Vendor',active:false},reason:'Deactivate old vendor',proposed_by:'maker',created_at:'2026-09-08T10:00:00.123456+00:00',status:'PENDING',revision:0,reviewed_by:null,review_reason:null,reviewed_at:null};
const selection={entityId,kind:'VENDOR',status:'PENDING',memberRef:null,afterId:null,limit:25};
const page={schema_version:'COUNTERPARTY_CHANGES_V1',entity_id:entityId,kind:'VENDOR',status:'PENDING',member_ref:null,after_id:null,limit:25,rows:[row],next_change_id:null};
const apiFor=kernel=>createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>kernel});
test('counterparty detail and history HTTP bind trusted scope and reject command inputs',async()=>{
 const calls=[],api=apiFor({readCounterpartyDetail:async args=>(calls.push(args),detail),readCounterpartyChanges:async args=>(calls.push(args),page)});
 const request=url=>api({method:'GET',url,headers:{},body:null});
 const result=await request(base+'/counterparties/detail?kind=VENDOR&memberRef=V-1');assert.equal(result.status,200);assert.equal(result.headers['cache-control'],'no-store');assert.deepEqual(result.body.data,detail);
 assert.equal((await request(base+'/counterparty-changes?kind=VENDOR')).status,200);
 assert.deepEqual(calls,[{tenantId,entityId,kind:'VENDOR',memberRef:'V-1'},{tenantId,entityId,kind:'VENDOR',memberRef:null,status:'PENDING',afterId:null,limit:25}]);
 for(const suffix of ['/counterparties/detail?kind=VENDOR','/counterparties/detail?kind=VENDOR&memberRef=V-1&tenantId=spoof',
  '/counterparty-changes?kind=VENDOR&kind=CUSTOMER','/counterparty-changes?kind=BANK','/counterparty-changes?kind=VENDOR&limit=01',
  '/counterparty-changes?kind=VENDOR&limit=101','/counterparty-changes?kind=VENDOR&afterId=bad','/counterparty-changes?kind=VENDOR&status=ACTIVE'])assert.equal((await request(base+suffix)).status,400,suffix);
 for(const patch of [{body:{}},{headers:{'if-match':'"0"'}},{headers:{'idempotency-key':'read-only'}}])assert.equal((await api({method:'GET',url:base+'/counterparty-changes?kind=VENDOR',body:null,headers:{},...patch})).status,400);
 assert.equal(calls.length,2);
 const wrong=apiFor({readCounterpartyDetail:async()=>({...detail,entity_id:tenantId})});
 assert.equal((await wrong({method:'GET',url:base+'/counterparties/detail?kind=VENDOR&memberRef=V-1',headers:{},body:null})).status,500);
});
test('counterparty history rejects contradictory review evidence, revisions and cursor receipts',()=>{
 assert.equal(validCounterpartyChangesPage(page,selection),true);
 for(const patch of [{kind:'CUSTOMER'},{before_state:{...row.before_state,revision:1}},{change_type:'CREATE'},{revision:1},
  {reviewed_by:'reviewer'},{status:'APPROVED'},{desired_state:{...row.desired_state,revision:3}},{created_at:'not a timestamp'}])assert.equal(validCounterpartyChangesPage({...page,rows:[{...row,...patch}]},selection),false,JSON.stringify(patch));
 assert.equal(validCounterpartyChangesPage({...page,rows:[row,row]},selection),false);
 assert.equal(validCounterpartyChangesPage({...page,next_change_id:changeId},selection),false);
 const approved={...row,status:'APPROVED',revision:1,reviewed_by:'approver',review_reason:'Checked vendor data',reviewed_at:'2026-09-08T11:00:00+00:00'};
 assert.equal(validCounterpartyChangesPage({...page,status:'ALL',rows:[approved]},{...selection,status:'ALL'}),true);
 assert.equal(validCounterpartyChangesPage({...page,status:'ALL',rows:[{...approved,reviewed_by:'maker'}]},{...selection,status:'ALL'}),false);
});
