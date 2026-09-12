import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {createAccountingApi} from '../api/accounting-http.mjs';

const id=()=>randomUUID(),tenantId=id(),entityId=id(),periodId=id(),transferId=id(),journalId=id(),controlId=id(),bankSourceId=id();
const base='/api/v1/entities/'+entityId+'/cash-transfers';
const none={can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_cancel:false,can_post:false,can_reconcile:false};
const detail={schema_version:'CASH_TRANSFER_DETAIL_V1',cash_transfer_id:transferId,entity_id:entityId,period_id:periodId,status:'DRAFT',revision:0,journal:{journal_entry_id:journalId,status:'DRAFT',revision:0,lines:[],ledger_lines:[]},bank_links:[],action_flags:none};
const command=(url,body,headers={})=>({method:'POST',url,headers:{'idempotency-key':'cash-transfer-command-001',...headers},body});

function setup(overrides={}){
  const calls=[];
  const kernel={
    readCashTransferRegister:async args=>(calls.push(['register',args]),{schema_version:'CASH_TRANSFER_REGISTER_V1',entity_id:entityId,period_id:periodId,read_at:'2026-09-13T00:00:00.000Z',rows:[detail],limit:args.limit,has_more:false,next_cursor:null,action_flags:none}),
    readCashTransferCreateOptions:async args=>(calls.push(['options',args]),{schema_version:'CASH_TRANSFER_CREATE_OPTIONS_V1',entity_id:entityId,period_id:periodId,transfer_date:args.transferDate,controls:[],action_flags:none}),
    readCashTransferAttachmentCandidates:async args=>(calls.push(['attachment-candidates',args]),{schema_version:'CASH_TRANSFER_ATTACHMENT_CANDIDATES_V1',entity_id:entityId,attachments:[],limit:args.limit,has_more:false,next_cursor:null}),
    readCashTransferBankLegCandidates:async args=>(calls.push(['bank-leg-candidates',args]),{schema_version:'CASH_TRANSFER_BANK_LEG_CANDIDATES_V1',entity_id:entityId,cash_transfer_id:transferId,leg:args.leg,transfer_date:'2026-09-13',currency:'USD',amount:'-12.3456',rows:[],limit:args.limit,has_more:false,next_cursor:null}),
    readCashTransferDetail:async args=>(calls.push(['detail',args]),detail),
    createCashTransfer:async args=>(calls.push(['create',args]),{schema_version:'CASH_TRANSFER_DRAFT_RECEIPT_V1',cash_transfer_id:transferId,entity_id:entityId,period_id:periodId,journal_entry_id:journalId,status:'DRAFT',revision:0,evidence_hash:'sha256:'+'a'.repeat(64),idempotent:false}),
    transitionCashTransfer:async args=>(calls.push(['transition',args]),{cash_transfer_id:transferId,status:'PENDING_REVIEW',revision:1,idempotent:false}),
    postCashTransfer:async args=>(calls.push(['post',args]),{cash_transfer_id:transferId,status:'POSTED',revision:4,idempotent:false}),
    createCashTransferBankAccountControl:async args=>(calls.push(['control-create',args]),{control_id:controlId,status:'PENDING_APPROVAL',revision:0,idempotent:false}),
    approveCashTransferBankAccountControl:async args=>(calls.push(['control-approve',args]),{control_id:controlId,status:'APPROVED',revision:1,idempotent:false}),
    linkCashTransferBankLeg:async args=>(calls.push(['link',args]),{cash_transfer_bank_link_id:id(),cash_transfer_id:transferId,leg:args.leg,status:'ACTIVE',idempotent:false}),
    ...overrides,
  };
  return {calls,api:createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'cash-maker'}),kernelFactory:async()=>kernel})};
}

test('Cash Transfer read routes are tenant-bound, no-store, and reject command headers',async()=>{
  const {api,calls}=setup();
  let response=await api({method:'GET',url:base+'?periodId='+periodId+'&limit=25',headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['register',{tenantId,entityId,periodId,limit:25,afterDate:null,afterTransferId:null}]);
  response=await api({method:'GET',url:base+'/create-options?periodId='+periodId+'&transferDate=2026-09-13',headers:{},body:null});
  assert.equal(response.status,200);assert.deepEqual(calls[1],['options',{tenantId,entityId,periodId,transferDate:'2026-09-13'}]);
  response=await api({method:'GET',url:base+'/attachment-candidates',headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[2],['attachment-candidates',{tenantId,entityId,limit:100,beforeVerifiedAt:null,beforeAttachmentId:null}]);
  response=await api({method:'GET',url:base+'/'+transferId+'/bank-leg-candidates?leg=SOURCE&limit=25',headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[3],['bank-leg-candidates',{tenantId,entityId,cashTransferId:transferId,leg:'SOURCE',limit:25,afterExternalBankLineId:null,afterBankSourceId:null}]);
  response=await api({method:'GET',url:base+'/'+transferId,headers:{},body:null});
  assert.equal(response.status,200);assert.deepEqual(calls[4],['detail',{tenantId,entityId,cashTransferId:transferId}]);
  assert.equal((await api({method:'GET',url:base+'?periodId='+periodId,headers:{'idempotency-key':'forbidden'},body:null})).status,400);
  assert.equal((await api({method:'GET',url:base+'/attachment-candidates?beforeVerifiedAt=2026-09-13T00:00:00.000Z',headers:{},body:null})).status,400);
  assert.equal((await api({method:'GET',url:base+'/attachment-candidates',headers:{'if-match':'"0"'},body:null})).status,400);  assert.equal((await api({method:'GET',url:base+'/attachment-candidates?limit=25&beforeVerifiedAt=2026-09-13T00:00:00.000Z&beforeAttachmentId='+transferId,headers:{},body:null})).status,200);assert.deepEqual(calls[5],['attachment-candidates',{tenantId,entityId,limit:25,beforeVerifiedAt:'2026-09-13T00:00:00.000Z',beforeAttachmentId:transferId}]);
  assert.equal((await api({method:'GET',url:base+'/'+transferId+'/bank-leg-candidates?leg=SOURCE&afterExternalBankLineId=x',headers:{},body:null})).status,400);
});

test('Cash Transfer commands bind server tenant, idempotency, and strong CAS',async()=>{
  const {api,calls}=setup(),create={periodId,date:'2026-09-13',number:'CT-0001',currency:'USD',sourceCashAccountCode:'111000',sourceBankMemberRef:'BANK-OPERATING',destinationCashAccountCode:'112000',destinationBankMemberRef:'BANK-RESERVE',amount:'12.3456',attachmentIds:[id()],reason:'Move controlled operating cash into the reserve account.'};
  let response=await api(command(base,create));assert.equal(response.status,201);assert.deepEqual(calls[0],['create',{tenantId,entityId,...create,idempotencyKey:'cash-transfer-command-001'}]);
  const transition={action:'SUBMIT',expectedJournalRevision:0,reason:'Submit the exact controlled transfer for independent review.'};
  response=await api(command(base+'/'+transferId+'/transitions',transition,{'if-match':'"0"'}));assert.equal(response.status,200);assert.deepEqual(calls[1],['transition',{tenantId,entityId,cashTransferId:transferId,expectedRevision:0,...transition,idempotencyKey:'cash-transfer-command-001'}]);
  assert.equal((await api(command(base+'/'+transferId+'/post',{expectedJournalRevision:3}))).status,428);
  assert.equal((await api(command(base,{...create,tenantId}))).status,400);
});

test('Cash Transfer control/link commands preserve tenant binding and map stale evidence',async()=>{
  const {api,calls}=setup(),control={bankMemberRef:'BANK-OPERATING',cashAccountCode:'111000',currency:'USD',effectiveFrom:'2026-09-01',effectiveTo:null};
  let response=await api(command(base+'/bank-account-controls',control));assert.equal(response.status,201);assert.equal(calls[0][0],'control-create');
  response=await api(command(base+'/bank-account-controls/'+controlId+'/approve',{}, {'if-match':'"0"'}));assert.equal(response.status,200);assert.deepEqual(calls[1][1],{tenantId,entityId,controlId,expectedVersion:0,idempotencyKey:'cash-transfer-command-001'});
  response=await api(command(base+'/'+transferId+'/bank-links',{leg:'SOURCE',bankSourceId,expectedTransferRevision:4},{'if-match':'"4"'}));assert.equal(response.status,201);assert.deepEqual(calls[2][1],{tenantId,entityId,cashTransferId:transferId,leg:'SOURCE',bankSourceId,expectedTransferRevision:4,idempotencyKey:'cash-transfer-command-001'});
  const stale=Object.assign(new Error('Cash Transfer source evidence changed'),{code:'40001'}),failed=setup({linkCashTransferBankLeg:async()=>{throw stale;}}).api;
  response=await failed(command(base+'/'+transferId+'/bank-links',{leg:'SOURCE',bankSourceId,expectedTransferRevision:4},{'if-match':'"4"'}));assert.equal(response.status,412);assert.equal(response.body.code,'PRECONDITION_FAILED');
});
