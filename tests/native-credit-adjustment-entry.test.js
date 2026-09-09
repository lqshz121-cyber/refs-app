import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {createCreditAdjustmentDraft,nativeCreditAdjustmentAccess,readCreditAdjustmentCounterparties,uploadCreditAdjustmentSupport,validateCreditAdjustmentDraft} from '../src/native-credit-adjustment-entry.js';

const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',attachmentId='33333333-3333-4333-8333-333333333333';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const scope={entity_id:entityId,period_id:periodId,entity_name:'Test company',entity_code:'TEST',base_currency:'USD',period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',period_status:'OPEN'};
const access={tenant_id:attachmentId,entity_id:entityId,actor_id:'oidc|maker',grant_set_version:1,permissions:['AP.VIEW','AP.VENDOR_CREDIT.CREATE','AR.VIEW','AR.CREDIT_MEMO.CREATE','ATTACHMENT.CREATE'],configured_permissions:[],session_refresh_required:false};
const account={period_id:periodId,period_code:scope.period_code,period_start:scope.period_start,period_end:scope.period_end,account_code:'610000',account_name:'Office expense',active:true,requires_member:false,required_member_type:null,currency:null,opening_balance:null,period_debit:null,period_credit:null,ending_balance:null,posted_ledger_line_count:'0'};
const draft={number:'VC-1',date:'2026-08-12',amount:'9007199254740993.1234',offsetAccountCode:'610000',reason:'Approved vendor credit evidence'};
const vendor={member_ref:'V-1',member_type:'VENDOR',display_name:'Vendor one',active:true};
const args={config,kind:'AP_VENDOR_CREDIT',draft,counterparty:vendor,attachmentId,scope,accounts:[account],cryptoApi:webcrypto,expectedActorId:access.actor_id};
const ok=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});
function fetchContext({currentAccess=access,currentScope=scope,currentAccounts=[account],command}={}){return async(url,options)=>{
  assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));
  if(url.endsWith('/access/self'))return ok(currentAccess);
  if(url.includes('/scope?'))return ok(currentScope);
  if(url.includes('/chart-of-accounts?'))return ok(currentAccounts);
  assert.equal(options.method,'POST');return command(url,options);
};}
const receipt={business_adjustment_id:entityId,journal_entry_id:periodId,status:'DRAFT',revision:0,idempotent:false};

test('credit entry access requires exact company, current session and explicit view/create/upload permissions',()=>{
  assert.equal(nativeCreditAdjustmentAccess(config,'AP_VENDOR_CREDIT',access),true);
  assert.equal(nativeCreditAdjustmentAccess(config,'AR_CREDIT_MEMO',access),true);
  for(const row of [{...access,actor_id:''},{...access,entity_id:periodId},{...access,session_refresh_required:true},{...access,permissions:['*']},{...access,permissions:['AP.VIEW','AP.VENDOR_CREDIT.CREATE']},{...access,permissions:['AP.VENDOR_CREDIT.CREATE','ATTACHMENT.CREATE']}])assert.equal(nativeCreditAdjustmentAccess(config,'AP_VENDOR_CREDIT',row),false);
  assert.equal(nativeCreditAdjustmentAccess(config,'AR_REFUND',access),false);
});

test('validation preserves decimal precision and rejects invalid scope, party, category, reason, and evidence',()=>{
  const result=validateCreditAdjustmentDraft(args);assert.equal(result.ok,true);assert.equal(result.adjustment.amount,draft.amount);assert.deepEqual(result.adjustment.attachmentIds,[attachmentId]);
  for(const patch of [{date:'2026-08-32'},{date:'2026-09-01'},{amount:12.4},{amount:'0.0000'},{amount:'1e3'},{amount:'1.00001'},{amount:'10000000000000000'},{number:' VC-1'},{reason:'short'}])assert.equal(validateCreditAdjustmentDraft({...args,draft:{...draft,...patch}}).ok,false,JSON.stringify(patch));
  for(const patch of [{scope:{...scope,period_status:'SOFT_CLOSED'}},{scope:{...scope,entity_id:periodId}},{counterparty:{...vendor,member_type:'CUSTOMER'}},{counterparty:{...vendor,active:false}},{attachmentId:null},{accounts:[{...account,active:false}]},{accounts:[{...account,requires_member:true}]},{accounts:[{...account,entity_id:periodId}]},{accounts:[{...account,account_code:'291001'}]}])assert.equal(validateCreditAdjustmentDraft({...args,...patch}).ok,false);
});

test('counterparty search uses the PR579 exact active register contract and UTF-8 C ordering',async()=>{
  const page={schema_version:'COUNTERPARTY_REGISTER_V1',entity_id:entityId,kind:'VENDOR',status:'ACTIVE',query:'50%_',after_ref:null,limit:2,rows:[{...vendor,member_ref:'\uE000'},{...vendor,member_ref:'😀'}],next_ref:'😀'};
  const result=await readCreditAdjustmentCounterparties({config,kind:'AP_VENDOR_CREDIT',query:'50%_',limit:2,fetcher:async(url,options)=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('kind'),'VENDOR');assert.equal(parsed.searchParams.get('status'),'ACTIVE');assert.equal(parsed.searchParams.get('query'),'50%_');assert.equal(options.method,'GET');assert.equal(options.body,undefined);return ok(page);}});
  assert.equal(result.ok,true);assert.equal(result.data.next_ref,'😀');
  for(const patch of [{entity_id:periodId},{kind:'CUSTOMER'},{status:'ALL'},{query:'other'},{next_ref:'V-2'},{rows:[{...vendor,member_type:'CUSTOMER'}]},{rows:[{...vendor,active:false}]},{rows:[{...vendor,unexpected:true}]},{rows:[...page.rows].reverse()}])assert.equal((await readCreditAdjustmentCounterparties({config,kind:'AP_VENDOR_CREDIT',query:'50%_',limit:2,fetcher:async()=>ok({...page,...patch})})).ok,false,JSON.stringify(patch));
});

test('counterparty service 404 is visible as an integration gap',async()=>{
  const result=await readCreditAdjustmentCounterparties({config,kind:'AP_VENDOR_CREDIT',fetcher:async()=>({ok:false,status:404})});
  assert.equal(result.code,'CREDIT_COUNTERPARTY_SERVICE_NOT_INTEGRATED');assert.match(result.message,/not integrated/);
});

test('create re-reads access, period and COA and sends exact evidence-backed adjustment',async()=>{
  let calls=0;
  const result=await createCreditAdjustmentDraft({...args,fetcher:fetchContext({command:async(url,options)=>{calls++;assert.match(url,/\/ap\/vendor-credits$/);const body=JSON.parse(options.body);assert.equal(body.amount,draft.amount);assert.equal(body.periodId,periodId);assert.deepEqual(body.attachmentIds,[attachmentId]);assert.equal(body.actorId,undefined);assert.equal(body.status,undefined);assert.match(options.headers['idempotency-key'],/^credit-adjustment-[a-f0-9]{64}$/);return ok(receipt,201);}})});
  assert.equal(result.ok,true);assert.equal(result.attempted,true);assert.equal(calls,1);
});

test('lost create response reuses identical request key and body',async()=>{
  const requests=[];const fetcher=fetchContext({command:async(url,options)=>{requests.push(options);if(requests.length===1)throw Error('response lost');return ok({...receipt,idempotent:true});}});
  const first=await createCreditAdjustmentDraft({...args,fetcher});assert.equal(first.ok,false);assert.equal(first.unconfirmed,true);
  const second=await createCreditAdjustmentDraft({...args,draft:{...draft},counterparty:{...vendor},fetcher});assert.equal(second.ok,true);assert.equal(second.idempotent,true);
  assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);assert.equal(requests[0].body,requests[1].body);
});

test('revoked permissions, identity drift, closed period, or inactive category prevent mutation',async()=>{
  for(const overrides of [{currentAccess:{...access,permissions:['ATTACHMENT.CREATE']}},{currentAccess:{...access,actor_id:'oidc|other'}},{currentScope:{...scope,period_status:'CLOSED'}},{currentAccounts:[{...account,active:false}]}]){
    let mutations=0;const result=await createCreditAdjustmentDraft({...args,fetcher:fetchContext({...overrides,command:()=>{mutations++;throw Error('must not send');}})});
    assert.equal(result.ok,false);assert.equal(result.attempted,undefined);assert.equal(mutations,0);
  }
});

test('malformed success is unconfirmed; 4xx permits correction and 5xx remains unconfirmed',async()=>{
  let mutations=0;const malformed=await createCreditAdjustmentDraft({...args,fetcher:fetchContext({command:async()=>{mutations++;return ok({...receipt,status:'POSTED'},201);}})});
  assert.equal(malformed.ok,false);assert.equal(malformed.attempted,true);assert.equal(malformed.unconfirmed,true);assert.equal(mutations,1);
  for(const status of [400,401,403,409,422,429,500,503]){
    const result=await createCreditAdjustmentDraft({...args,fetcher:fetchContext({command:async()=>({ok:false,status,headers:{get:()=>null},json:async()=>({ok:false,code:'REQUEST_REJECTED'})})})});
    assert.equal(result.unconfirmed,status>=500);
  }
});

test('AR uses the customer directory and credit memo endpoint',async()=>{
  const customer={member_ref:'C-1',member_type:'CUSTOMER',display_name:'Customer one',active:true};
  const result=await createCreditAdjustmentDraft({...args,kind:'AR_CREDIT_MEMO',counterparty:customer,fetcher:fetchContext({command:async url=>{assert.match(url,/\/ar\/credit-memos$/);return ok(receipt,201);}})});
  assert.equal(result.ok,true);
});

test('verified support recovery is deterministic, checks size drift, and supports explicit closed-reservation recovery',async()=>{
  const file={name:'credit.pdf',type:'application/pdf',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer},keys=[];
  const success=fetchContext({command:async(url,options)=>{assert.match(url,/\/attachments\/reservations$/);keys.push(options.headers['idempotency-key']);const body=JSON.parse(options.body);return ok({attachment_id:attachmentId,entity_id:entityId,name:body.name,media_type:body.mediaType,size_bytes:body.sizeBytes,content_hash:body.contentHash,status:'VERIFIED_CLEAN',idempotent:true});}});
  for(let index=0;index<2;index++)assert.equal((await uploadCreditAdjustmentSupport({config,kind:'AP_VENDOR_CREDIT',file,expectedActorId:access.actor_id,fetcher:success,cryptoApi:webcrypto})).ok,true);
  assert.equal(keys[0],keys[1]);
  let calls=0;const drift=await uploadCreditAdjustmentSupport({config,kind:'AP_VENDOR_CREDIT',file:{...file,arrayBuffer:async()=>new Uint8Array([1]).buffer},expectedActorId:access.actor_id,fetcher:fetchContext({command:()=>{calls++;}}),cryptoApi:webcrypto});assert.equal(drift.code,'ATTACHMENT_SIZE_MISMATCH');assert.equal(calls,0);
  const closedKeys=[],closed=fetchContext({command:async(url,options)=>{closedKeys.push(options.headers['idempotency-key']);return {ok:false,status:409,json:async()=>({code:'ATTACHMENT_RESERVATION_CLOSED'})};}});
  for(const uploadAttempt of [0,1,1])assert.equal((await uploadCreditAdjustmentSupport({config,kind:'AP_VENDOR_CREDIT',file,uploadAttempt,fetcher:closed,cryptoApi:webcrypto})).code,'ATTACHMENT_RESERVATION_CLOSED');
  assert.notEqual(closedKeys[0],closedKeys[1]);assert.equal(closedKeys[1],closedKeys[2]);
});
