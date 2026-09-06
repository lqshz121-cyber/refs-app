import test from 'node:test';import assert from 'node:assert/strict';import {webcrypto} from 'node:crypto';
import {nativeCreditAllocationAccess,validateNativeCreditAllocation,prepareNativeCreditAllocation,sendNativeCreditAllocation} from '../src/native-credit-allocation.js';
import {recoverNativeCreditAllocation,retainNativeCreditAllocation,releaseNativeCreditAllocation} from '../src/native-credit-allocation-recovery.js';
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',sourceAdjustmentId='33333333-3333-4333-8333-333333333333',targetId='44444444-4444-4444-8444-444444444444';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const ok=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});
for(const kind of ['AP_VENDOR_CREDIT','AR_CREDIT_MEMO']){
  const permission=kind==='AP_VENDOR_CREDIT'?'AP.VENDOR_CREDIT.APPLY':'AR.CREDIT_MEMO.APPLY';
  const access={tenant_id:sourceAdjustmentId,entity_id:entityId,actor_id:'oidc|maker',grant_set_version:1,permissions:[permission],configured_permissions:[permission],session_refresh_required:false};
  const context={schema_version:'CREDIT_USAGE_CONTEXT_V1',entity_id:entityId,action:kind==='AP_VENDOR_CREDIT'?'AP_CREDIT_APPLY':'AR_CREDIT_APPLY',period:{period_id:periodId,starts_on:'2026-08-01',ends_on:'2026-08-31',status:'OPEN',revision:'0'},credit:{business_adjustment_id:sourceAdjustmentId,adjustment_kind:kind,journal_entry_id:entityId,number:'CR-1',counterparty_ref:'PARTY-1',currency:'USD',amount:'100.0000',revision:'4'},allocated_amount:'30.0000',refund_amount:'0.0000',available_amount:'70.0000'};
  const target={business_document_id:targetId,document_number:'DOC-1',counterparty_ref:'PARTY-1',currency:'USD',accounting_date:'2026-07-01',due_date:null,gross_amount:'100.0000',open_balance:'90.0000',pending_amount:'20.0000',available_amount:'70.0000',revision:'2',status:'PARTIALLY_PAID',period_id:entityId,journal_entry_id:targetId};
  const page={schema_version:'CREDIT_ALLOCATION_TARGETS_V1',context,query:'',after_id:null,limit:50,rows:[target],next_id:null};
  const args={config,kind,sourceAdjustmentId,page,targetId,amount:'1.2345',reason:'Apply retained credit to invoice',expectedActorId:access.actor_id,cryptoApi:webcrypto,intentId:periodId};
  const fixture=(post,currentAccess=access,currentPage=page)=>async(url,options)=>{assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');if(url.endsWith('/access/self'))return ok(currentAccess);if(url.includes('/allocation-targets?'))return ok(currentPage);return post(url,options);};
  test(kind+' allocation validates exact balances and one stable intent before sending',async()=>{
    assert.equal(nativeCreditAllocationAccess(config,kind,access),true);assert.equal(nativeCreditAllocationAccess(config,kind,{...access,permissions:[]}),false);
    assert.equal(validateNativeCreditAllocation(args).body.amount,'1.2345');
    for(const patch of [{amount:'70.0001'},{amount:'1.23456'},{amount:'1e1'},{amount:1},{amount:'-0.0001'},{targetId:entityId},{reason:'short'},{page:{...page,context:{...context,period:{...context.period,status:'CLOSED'}}}}])assert.equal(validateNativeCreditAllocation({...args,...patch}).ok,false);
    const fetcher=fixture(()=>{throw Error('unexpected mutation');});
    const a=await prepareNativeCreditAllocation({...args,fetcher}),b=await prepareNativeCreditAllocation({...args,fetcher});assert.equal(a.ok,true);assert.deepEqual(a.command,b.command);
    const separate=await prepareNativeCreditAllocation({...args,intentId:targetId,fetcher});assert.notEqual(separate.command.idempotencyKey,a.command.idempotencyKey,'another intentional allocation can reuse amount/reason');
    assert.equal((await prepareNativeCreditAllocation({...args,fetcher:fixture(()=>{},access,{...page,rows:[]})})).ok,false);
  });
  test(kind+' lost responses retry identical requests without repeating capacity reads',async()=>{
    const prepared=await prepareNativeCreditAllocation({...args,fetcher:fixture(()=>{})});const commands=[];
    const receipt={business_allocation_id:periodId,business_adjustment_id:sourceAdjustmentId,business_document_id:targetId,amount:1.2345,status:'ACTIVE',idempotent:true};
    const fetcher=async(url,options)=>{if(url.endsWith('/access/self'))return ok(access);assert.equal(options.method,'POST');commands.push(options);if(commands.length===1)throw Error('lost response');return ok(receipt);};
    const first=await sendNativeCreditAllocation({config,command:prepared.command,fetcher});assert.equal(first.unconfirmed,true);
    const replay=await sendNativeCreditAllocation({config,command:prepared.command,fetcher});assert.equal(replay.ok,true);assert.equal(commands.length,2);assert.equal(commands[0].body,commands[1].body);assert.equal(commands[0].headers['idempotency-key'],commands[1].headers['idempotency-key']);
    const changed=await sendNativeCreditAllocation({config,command:prepared.command,fetcher:fixture(()=>{throw Error('must not send');},{...access,actor_id:'other'})});assert.equal(changed.code,'CREDIT_ACCESS_CHANGED');
    const moved=await sendNativeCreditAllocation({config:{...config,baseUrl:'https://other.example'},command:prepared.command,fetcher:()=>{throw Error('must not send');}});assert.equal(moved.code,'CREDIT_SCOPE_CHANGED');
    const malformed=await sendNativeCreditAllocation({config,command:prepared.command,fetcher:fixture(()=>ok({...receipt,business_document_id:entityId}))});assert.equal(malformed.unconfirmed,true);
    const scope={config,kind,sourceAdjustmentId,actorId:access.actor_id};retainNativeCreditAllocation(scope,prepared.command,{uncertain:true});
    assert.deepEqual(recoverNativeCreditAllocation(scope).command,prepared.command);assert.equal(recoverNativeCreditAllocation({...scope,actorId:'other'}),null);
    const cloned=recoverNativeCreditAllocation(scope);cloned.command.body.amount='99';assert.equal(recoverNativeCreditAllocation(scope).command.body.amount,'1.2345');
    releaseNativeCreditAllocation(scope,prepared.command);assert.equal(recoverNativeCreditAllocation(scope),null);
  });
}
