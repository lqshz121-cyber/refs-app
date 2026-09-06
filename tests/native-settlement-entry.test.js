import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {nativeSettlementAccess,readNativeSettlementContext,readNativeSettlementBanks,validateNativeSettlementDraft,prepareNativeSettlement,sendNativeSettlement} from '../src/native-settlement-entry.js';
const entityId='11111111-1111-4111-8111-111111111111',periodId='22222222-2222-4222-8222-222222222222',businessDocumentId='33333333-3333-4333-8333-333333333333';
const config={baseUrl:'https://api.example',entityId,periodId,getAccessToken:async()=>'a'.repeat(48)};
const access={tenant_id:businessDocumentId,entity_id:entityId,actor_id:'oidc|maker',grant_set_version:1,permissions:['AP.PAYMENT.CREATE','ATTACHMENT.CREATE'],configured_permissions:['AP.PAYMENT.CREATE','ATTACHMENT.CREATE'],session_refresh_required:false};
const account={period_id:periodId,period_code:'2026-08',period_start:'2026-08-01',period_end:'2026-08-31',account_code:'100100',account_name:'Operating bank',active:true,requires_member:true,required_member_type:'BANK',currency:null,opening_balance:null,period_debit:null,period_credit:null,ending_balance:null,posted_ledger_line_count:'0'};
const context={schema_version:'SETTLEMENT_CONTEXT_V1',entity_id:entityId,settlement_kind:'AP_PAYMENT',payment_period:{period_id:periodId,starts_on:'2026-08-01',ends_on:'2026-08-31',status:'OPEN',revision:'0'},document:{business_document_id:businessDocumentId,document_kind:'AP_BILL',document_number:'B1',counterparty_ref:'V1',counterparty_name:'Vendor',currency:'USD',accounting_date:'2026-07-01',due_date:null,status:'OPEN',revision:'1',open_balance:'9007199254740993.1234'},pending_allocation_amount:'0.0000',available_amount:'9007199254740993.1234',can_create_draft:true};
const bank={member_ref:'BANK1',member_type:'BANK',display_name:'Operating bank'};
const draft={number:'P1',date:'2026-08-10',amount:'9007199254740993.1234',cashAccountCode:'100100',reason:'Supplier payment'};
const args={config,kind:'AP_PAYMENT',businessDocumentId,draft,bank,accounts:[account],context,attachmentId:periodId,expectedActorId:access.actor_id,cryptoApi:webcrypto};
const ok=(data,status=200)=>({ok:true,status,json:async()=>({ok:true,data})});
const receipt={payment_occurrence_id:entityId,business_allocation_id:periodId,business_document_id:businessDocumentId,journal_entry_id:entityId,status:'DRAFT',allocation_status:'PENDING',revision:0,idempotent:false};
const fixture=(command,currentAccess=access)=>async(url,options)=>{assert.equal(options.credentials,'include');assert.equal(options.cache,'no-store');assert.equal(options.headers.authorization,'Bearer '+'a'.repeat(48));if(url.endsWith('/access/self'))return ok(currentAccess);if(url.includes('/settlement-context?'))return ok(context);if(url.includes('/chart-of-accounts?'))return ok([account]);return command(url,options);};

test('settlement validation preserves exact amounts and rejects unavailable balance, wrong bank, date and identity',()=>{
  assert.equal(validateNativeSettlementDraft(args).body.amount,draft.amount);assert.equal(nativeSettlementAccess(config,'AP_PAYMENT',access),true);
  for(const patch of [{amount:'9007199254740993.1235'},{amount:'1e3'},{amount:1},{amount:'0'},{amount:'1.00001'},{date:'2026-08-32'},{date:'2026-07-31'},{number:' P1'},{reason:'short'}])assert.equal(validateNativeSettlementDraft({...args,draft:{...draft,...patch}}).ok,false);
  for(const patch of [{context:{...context,available_amount:'1.0000'}},{context:{...context,can_create_draft:false}},{bank:{...bank,member_type:'VENDOR'}},{accounts:[{...account,active:false}]},{accounts:[{...account,entity_id:periodId}]}])assert.equal(validateNativeSettlementDraft({...args,...patch}).ok,false);
  for(const a of [{...access,entity_id:periodId},{...access,permissions:['AP.PAYMENT.CREATE']},{...access,session_refresh_required:true}])assert.equal(nativeSettlementAccess(config,'AP_PAYMENT',a),false);
});
test('context and bank reads reject cross-company data, arithmetic corruption, cursor rewind and wrong types',async()=>{
  assert.equal((await readNativeSettlementContext({...args,fetcher:async()=>ok(context)})).ok,true);
  for(const patch of [{entity_id:periodId},{pending_allocation_amount:'1.0000'},{document:{...context.document,business_document_id:entityId}}])assert.equal((await readNativeSettlementContext({...args,fetcher:async()=>ok({...context,...patch})})).ok,false);
  const page={schema_version:'SETTLEMENT_BANK_MEMBERS_V1',entity_id:entityId,settlement_kind:'AP_PAYMENT',query:'50%_',after_ref:null,limit:1,rows:[bank],next_ref:bank.member_ref};
  const read=value=>readNativeSettlementBanks({...args,query:'50%_',limit:1,fetcher:async(url)=>{assert.equal(new URL(url).searchParams.get('query'),'50%_');return ok(value);}});
  assert.equal((await read(page)).ok,true);for(const patch of [{entity_id:periodId},{next_ref:'different'},{rows:[{...bank,member_type:'VENDOR'}]}])assert.equal((await read({...page,...patch})).ok,false);
});
test('prepared native payment retries identical intent after an unknown result without rereading changed capacity',async()=>{
  const prepared=await prepareNativeSettlement({...args,fetcher:fixture(()=>{throw Error('unexpected mutation');})});assert.equal(prepared.ok,true);
  const requests=[];const fetcher=fixture(async(url,options)=>{assert.match(url,/\/native-payments$/);requests.push(options);if(requests.length===1)throw Error('lost response');return ok({...receipt,idempotent:true});});
  const first=await sendNativeSettlement({config,command:prepared.command,fetcher});assert.equal(first.unconfirmed,true);
  const second=await sendNativeSettlement({config,command:prepared.command,fetcher});assert.equal(second.ok,true);assert.equal(requests[0].body,requests[1].body);assert.equal(requests[0].headers['idempotency-key'],requests[1].headers['idempotency-key']);
  const body=JSON.parse(requests[0].body);assert.equal(body.amount,draft.amount);assert.deepEqual(body.attachmentIds,[periodId]);assert.equal(body.actorId,undefined);
  const changed=await sendNativeSettlement({config,command:prepared.command,fetcher:fixture(()=>{throw Error('must not send');},{...access,actor_id:'other'})});assert.equal(changed.ok,false);assert.equal(changed.attempted,undefined);
});
test('native receipt rejects malformed success and keeps an unknown outcome recoverable',async()=>{
  const prepared=await prepareNativeSettlement({...args,fetcher:fixture(()=>{})});
  for(const patch of [{business_document_id:entityId},{status:'POSTED'},{allocation_status:'ACTIVE'},{revision:1},{idempotent:true},{extra:true}]){const result=await sendNativeSettlement({config,command:prepared.command,fetcher:fixture(()=>ok({...receipt,...patch},201))});assert.equal(result.ok,false);assert.equal(result.unconfirmed,true);}
});
