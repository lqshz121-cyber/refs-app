import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {createNativeDocumentDraft,nativeDocumentEntryAccess,readNativeDocumentCounterparties,uploadNativeDocumentSupport,validateNativeDocumentDraft} from '../src/native-document-entry.js';
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',attachmentId='33333333-3333-4333-8333-333333333333';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const scope={entity_id:entityId,period_id:periodId,entity_name:'Test company',entity_code:'TEST',base_currency:'USD',period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',period_status:'OPEN'};
const access={tenant_id:attachmentId,entity_id:entityId,actor_id:'oidc|maker',grant_set_version:1,permissions:['AP.BILL.CREATE','AR.INVOICE.CREATE','ATTACHMENT.CREATE'],configured_permissions:['AP.BILL.CREATE','AR.INVOICE.CREATE','ATTACHMENT.CREATE'],session_refresh_required:false};
const account={period_id:periodId,period_code:scope.period_code,period_start:scope.period_start,period_end:scope.period_end,account_code:'610000',account_name:'Office expense',active:true,requires_member:false,required_member_type:null,currency:null,opening_balance:null,period_debit:null,period_credit:null,ending_balance:null,posted_ledger_line_count:'0'};
const draft={documentNumber:'B-1',accountingDate:'2026-08-12',dueDate:'2026-09-12',amount:'9007199254740993.1234',currency:'USD',offsetAccountCode:'610000',description:''};
const vendor={member_ref:'V-1',member_type:'VENDOR',display_name:'Vendor one'};
const args={config,kind:'AP_BILL',draft,counterparty:vendor,attachmentId,scope,accounts:[account],cryptoApi:webcrypto,expectedActorId:access.actor_id};
const ok=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});
function fetchContext({currentAccess=access,currentScope=scope,currentAccounts=[account],command}={}){return async(url,options)=>{
  assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));
  if(url.endsWith('/access/self'))return ok(currentAccess);
  if(url.includes('/scope?'))return ok(currentScope);
  if(url.includes('/chart-of-accounts?'))return ok(currentAccounts);
  assert.equal(options.method,'POST');return command(url,options);
};}
const receipt={business_document_id:entityId,journal_entry_id:periodId,document_kind:'AP_BILL',status:'DRAFT',revision:0,idempotent:false};

test('entry access requires exact company, current session and explicit create/upload permissions',()=>{
  assert.equal(nativeDocumentEntryAccess(config,'AP_BILL',access),true);
  for(const row of [{...access,actor_id:''},{...access,entity_id:periodId},{...access,session_refresh_required:true},{...access,permissions:['*']},{...access,permissions:['AP.BILL.CREATE']},{...access,permissions:['AR.INVOICE.CREATE','ATTACHMENT.CREATE']}])assert.equal(nativeDocumentEntryAccess(config,'AP_BILL',row),false);
});
test('validation preserves precision and rejects invalid dates, unscoped parties/accounts and unverified support',()=>{
  const result=validateNativeDocumentDraft(args);assert.equal(result.ok,true);assert.equal(result.document.amount,draft.amount);
  for(const patch of [{accountingDate:'2026-08-32'},{accountingDate:'2026-09-01'},{dueDate:'2026-08-01'},{amount:12.4},{amount:'0.0000'},{amount:'1e3'},{amount:'1.00001'},{amount:'10000000000000000'},{currency:'usd'},{documentNumber:' B-1'}])assert.equal(validateNativeDocumentDraft({...args,draft:{...draft,...patch}}).ok,false,JSON.stringify(patch));
  for(const patch of [{scope:{...scope,period_status:'SOFT_CLOSED'}},{scope:{...scope,entity_id:periodId}},{counterparty:{...vendor,member_type:'CUSTOMER'}},{attachmentId:null},{accounts:[{...account,active:false}]},{accounts:[{...account,requires_member:true}]},{accounts:[{...account,entity_id:periodId}]}])assert.equal(validateNativeDocumentDraft({...args,...patch}).ok,false);
});
test('counterparty search uses authenticated scoped GET, literal query and verified pagination',async()=>{
  const page={schema_version:'BUSINESS_DOCUMENT_COUNTERPARTIES_V1',entity_id:entityId,document_kind:'AP_BILL',query:'50%_',after_ref:null,limit:1,rows:[vendor],next_ref:'V-1'};
  const result=await readNativeDocumentCounterparties({config,kind:'AP_BILL',query:'50%_',limit:1,fetcher:async(url,options)=>{const parsed=new URL(url);assert.equal(parsed.searchParams.get('query'),'50%_');assert.equal(options.method,'GET');assert.equal(options.body,undefined);assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));return ok(page);}});
  assert.equal(result.ok,true);assert.equal(result.data.next_ref,'V-1');
  for(const patch of [{entity_id:periodId},{document_kind:'AR_INVOICE'},{query:'other'},{next_ref:'V-2'},{rows:[{...vendor,member_type:'CUSTOMER'}]},{rows:[{...vendor,unexpected:true}]},{rows:[vendor,vendor]}])assert.equal((await readNativeDocumentCounterparties({config,kind:'AP_BILL',query:'50%_',limit:1,fetcher:async()=>ok({...page,...patch})})).ok,false);
});
test('counterparty cursor cannot rewind, duplicate, or cross type; code-point C order is retained',async()=>{
  const page={schema_version:'BUSINESS_DOCUMENT_COUNTERPARTIES_V1',entity_id:entityId,document_kind:'AR_INVOICE',query:'',after_ref:'A',limit:2,rows:[{member_ref:'\uE000',display_name:'Private reference',member_type:'CUSTOMER'},{member_ref:'😀',display_name:'Emoji reference',member_type:'AFFILIATE'}],next_ref:null};
  const read=value=>readNativeDocumentCounterparties({config,kind:'AR_INVOICE',afterRef:'A',limit:2,fetcher:async()=>ok(value)});
  assert.equal((await read(page)).ok,true);assert.equal((await read({...page,rows:[...page.rows].reverse()})).ok,false);assert.equal((await read({...page,rows:[{...page.rows[0],member_ref:'A'}]})).ok,false);
});
test('create reads current access, period and COA before sending an exact decimal draft',async()=>{
  let calls=0;
  const result=await createNativeDocumentDraft({...args,fetcher:fetchContext({command:async(url,options)=>{calls++;assert.match(url,/\/ap\/bills$/);const body=JSON.parse(options.body);assert.equal(body.amount,draft.amount);assert.equal(body.periodId,periodId);assert.deepEqual(body.attachmentIds,[attachmentId]);assert.equal(body.actorId,undefined);assert.equal(body.status,undefined);assert.match(options.headers['idempotency-key'],/^native-document-[a-f0-9]{64}$/);return ok(receipt,201);}})});
  assert.equal(result.ok,true);assert.equal(result.attempted,true);assert.equal(calls,1);
});
test('lost create response reuses the same intent key and body after refresh',async()=>{
  const requests=[];
  const fetcher=fetchContext({command:async(url,options)=>{requests.push(options);if(requests.length===1)throw Error('response lost');return ok({...receipt,idempotent:true});}});
  const first=await createNativeDocumentDraft({...args,fetcher});assert.equal(first.ok,false);assert.equal(first.attempted,true);assert.equal(first.unconfirmed,true);
  const second=await createNativeDocumentDraft({...args,draft:{...draft},counterparty:{...vendor},fetcher});assert.equal(second.ok,true);assert.equal(second.idempotent,true);
  assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);assert.equal(requests[0].body,requests[1].body);
});
test('revoked permissions, changed identity, closed period or inactive category prevent all mutations',async()=>{
  for(const overrides of [{currentAccess:{...access,permissions:['ATTACHMENT.CREATE']}},{currentAccess:{...access,actor_id:'oidc|other'}},{currentScope:{...scope,period_status:'CLOSED'}},{currentAccounts:[{...account,active:false}]}]){
    let mutations=0;const result=await createNativeDocumentDraft({...args,fetcher:fetchContext({...overrides,command:()=>{mutations++;throw Error('must not send');}})});
    assert.equal(result.ok,false);assert.equal(result.attempted,undefined);assert.equal(mutations,0);
  }
});
test('malformed successful create receipt is unconfirmed and never auto retried',async()=>{
  let mutations=0;const result=await createNativeDocumentDraft({...args,fetcher:fetchContext({command:async()=>{mutations++;return ok({...receipt,status:'POSTED'},201);}})});
  assert.equal(result.ok,false);assert.equal(result.attempted,true);assert.equal(result.unconfirmed,true);assert.equal(mutations,1);
});
test('explicit HTTP rejection permits correction while a server error remains unconfirmed',async()=>{
  for(const status of [400,401,403,409,422,429,500,503]){
    const result=await createNativeDocumentDraft({...args,fetcher:fetchContext({command:async()=>({ok:false,status,headers:{get:()=>null},json:async()=>({ok:false,code:'REQUEST_REJECTED'})})})});
    assert.equal(result.ok,false);assert.equal(result.attempted,true);assert.equal(result.unconfirmed,status>=500);
  }
});
test('AR uses customer or affiliate selection and the invoice endpoint',async()=>{
  const result=await createNativeDocumentDraft({...args,kind:'AR_INVOICE',counterparty:{...vendor,member_type:'AFFILIATE'},fetcher:fetchContext({command:async(url)=>{assert.match(url,/\/ar\/invoices$/);return ok({...receipt,document_kind:'AR_INVOICE'},201);}})});assert.equal(result.ok,true);
});
test('verified support recovery is deterministic across retries and does not upload again',async()=>{
  const file={name:'bill.pdf',type:'application/pdf',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer},requests=[];
  const fetcher=fetchContext({command:async(url,options)=>{assert.match(url,/\/attachments\/reservations$/);requests.push(options);const body=JSON.parse(options.body);return ok({attachment_id:attachmentId,entity_id:entityId,name:body.name,media_type:body.mediaType,size_bytes:body.sizeBytes,content_hash:body.contentHash,status:'VERIFIED_CLEAN',idempotent:true});}});
  for(let i=0;i<2;i++)assert.equal((await uploadNativeDocumentSupport({config,kind:'AP_BILL',file,expectedActorId:access.actor_id,fetcher,cryptoApi:webcrypto})).ok,true);
  assert.equal(requests.length,2);assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);assert.equal(requests[0].body,requests[1].body);
});
test('upload checks fresh access and immutable file size before reservation',async()=>{
  let calls=0;const file={name:'bill.pdf',type:'application/pdf',size:3,arrayBuffer:async()=>new Uint8Array([1]).buffer};
  const result=await uploadNativeDocumentSupport({config,kind:'AP_BILL',file,expectedActorId:access.actor_id,fetcher:fetchContext({command:()=>{calls++;}}),cryptoApi:webcrypto});assert.equal(result.code,'ATTACHMENT_SIZE_MISMATCH');assert.equal(calls,0);
});
test('closed upload is not automatically retried; explicit replacement attempts have recoverable keys',async()=>{
  const file={name:'bill.pdf',type:'application/pdf',size:3,arrayBuffer:async()=>new Uint8Array([1,2,3]).buffer},keys=[];
  const fetcher=fetchContext({command:async(url,options)=>{keys.push(options.headers['idempotency-key']);return {ok:false,status:409,json:async()=>({code:'ATTACHMENT_RESERVATION_CLOSED'})};}});
  for(const uploadAttempt of [0,1,1]){
    const before=keys.length,result=await uploadNativeDocumentSupport({config,kind:'AP_BILL',file,uploadAttempt,fetcher,cryptoApi:webcrypto});
    assert.equal(result.code,'ATTACHMENT_RESERVATION_CLOSED');assert.equal(keys.length,before+1);
  }
  assert.notEqual(keys[0],keys[1]);assert.equal(keys[1],keys[2]);
});
