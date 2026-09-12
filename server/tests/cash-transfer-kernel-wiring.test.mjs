import assert from 'node:assert/strict';
import test from 'node:test';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const hash=`sha256:${'a'.repeat(64)}`;
function setup(){
 const calls=[];
 const kernel=new PostgresAccountingKernel({}, {sessionProvider:async()=>({trusted:true,contextToken:'x'.repeat(32)})});
 kernel.inSession=async work=>work({query:async(text,args=[])=>{
   calls.push({text:String(text),args});
   return {rowCount:1,rows:[String(text).includes('_hash(')?{request_hash:hash}:{result:{ok:true}}]};
 }});
 return {kernel,calls};
}
const scope={tenantId:id(1),entityId:id(2)};
const key='cash-transfer-command-001';

async function assertCommand({method,input,hashFunction,commandFunction}){
 const {kernel,calls}=setup();
 assert.deepEqual(await kernel[method](input),{ok:true});
 assert.equal(calls.length,2,`${method} must issue exactly hash then command`);
 assert.match(calls[0].text,new RegExp(hashFunction));
 assert.match(calls[1].text,new RegExp(commandFunction));
 assert.deepEqual(calls[1].args,[...calls[0].args,input.idempotencyKey,hash]);
}

test('Cash Transfer commands obtain only database canonical hashes before the matching command',async()=>{
 const control={...scope,bankMemberRef:'BANK-OPERATING',cashAccountCode:'110100',currency:'USD',effectiveFrom:'2026-09-01',effectiveTo:null,idempotencyKey:key};
 await assertCommand({method:'createCashTransferBankAccountControl',input:control,hashFunction:'refs_cash_transfer_control_create_hash',commandFunction:'refs_create_cash_transfer_bank_account_control'});
 const lifecycle={...scope,controlId:id(3),expectedVersion:4,idempotencyKey:key};
 await assertCommand({method:'approveCashTransferBankAccountControl',input:lifecycle,hashFunction:'refs_cash_transfer_control_approve_hash',commandFunction:'refs_approve_cash_transfer_bank_account_control'});
 await assertCommand({method:'retireCashTransferBankAccountControl',input:lifecycle,hashFunction:'refs_cash_transfer_control_retire_hash',commandFunction:'refs_retire_cash_transfer_bank_account_control'});
 const create={...scope,periodId:id(4),transferDate:'2026-09-13',currency:'USD',fromAccountCode:'110100',fromBankMemberRef:'BANK-OPERATING',toAccountCode:'110200',toBankMemberRef:'BANK-RESERVE',amount:'12.3456',journalNumber:'XFER-1',attachmentIds:[id(5)],reason:'Move controlled cash between approved bank accounts.',idempotencyKey:key};
 {const {kernel,calls}=setup();assert.deepEqual(await kernel.createCashTransfer(create),{ok:true});assert.equal(calls.length,1);assert.match(calls[0].text,/refs_create_cash_transfer_from_public_dto/);assert.doesNotMatch(calls[0].text,/attachmentSnapshotHash|refs_create_cash_transfer_hash/);}
 const state={...scope,cashTransferId:id(6),expectedRevision:4,expectedJournalRevision:7,idempotencyKey:key};
 await assertCommand({method:'transitionCashTransfer',input:{...state,action:'SUBMIT',reason:'Submit controlled transfer for independent review.'},hashFunction:'refs_cash_transfer_transition_hash',commandFunction:'refs_transition_cash_transfer'});
 await assertCommand({method:'postCashTransfer',input:state,hashFunction:'refs_post_cash_transfer_hash',commandFunction:'refs_post_cash_transfer'});
 await assertCommand({method:'cancelCashTransfer',input:{...state,reason:'Cancel controlled transfer before final approval.'},hashFunction:'refs_cancel_cash_transfer_hash',commandFunction:'refs_cancel_cash_transfer'});
 await assertCommand({method:'linkCashTransferBankLeg',input:{...scope,cashTransferId:id(6),leg:'SOURCE',bankSourceId:id(7),expectedTransferRevision:8,idempotencyKey:key},hashFunction:'refs_cash_transfer_bank_link_hash',commandFunction:'refs_link_cash_transfer_bank_leg'});
});

test('Cash Transfer reads bind scope to security-definer SQL and never query aggregate tables',async()=>{
 const {kernel,calls}=setup();
 await kernel.readCashTransferRegister({...scope,periodId:id(4),limit:25,afterDate:'2026-09-13',afterTransferId:id(6)});
 await kernel.readCashTransferDetail({...scope,cashTransferId:id(6)});
 await kernel.readCashTransferCreateOptions({...scope,periodId:id(4),transferDate:'2026-09-13'});
 await kernel.readCashTransferAttachmentCandidates({...scope});
 await kernel.readCashTransferBankLegCandidates({...scope,cashTransferId:id(6),leg:'SOURCE',limit:25,afterExternalBankLineId:'line-001',afterBankSourceId:id(7)});
 await kernel.readCashTransferBankAccountControls({...scope,asOfDate:'2026-09-13'});
 assert.deepEqual(calls.map(call=>call.args),[
  [scope.tenantId,scope.entityId,id(4),25,'2026-09-13',id(6)],
  [scope.tenantId,scope.entityId,id(6)],
  [scope.tenantId,scope.entityId,id(4),'2026-09-13'],
  [scope.tenantId,scope.entityId,100,null,null],
  [scope.tenantId,scope.entityId,id(6),'SOURCE',25,'line-001',id(7)],
  [scope.tenantId,scope.entityId,'2026-09-13']
 ]);
 for(const call of calls){
  assert.match(call.text,/refs_read_cash_transfer_/);
  assert.doesNotMatch(call.text,/\bFROM\s+(cash_transfer|cash_transfer_bank_link|cash_transfer_bank_account_control)\b/i);
 }
});

test('Cash Transfer adapter casts calendar, money, UUID arrays, and CAS revisions in SQL',async()=>{
 const {kernel,calls}=setup();
 await kernel.createCashTransfer({...scope,periodId:id(4),transferDate:'2026-09-13',currency:'USD',fromAccountCode:'110100',fromBankMemberRef:'BANK-OPERATING',toAccountCode:'110200',toBankMemberRef:'BANK-RESERVE',amount:'12.3456',journalNumber:'XFER-1',attachmentIds:[id(5)],reason:'Move controlled cash between approved bank accounts.',idempotencyKey:key});
 await kernel.transitionCashTransfer({...scope,cashTransferId:id(6),action:'SUBMIT',expectedRevision:4,expectedJournalRevision:7,reason:'Submit controlled transfer for independent review.',idempotencyKey:key});
 const query=calls.map(call=>call.text).join('\n');
 for(const cast of ['::date','::char(3)','::numeric','::uuid[]','::uuid','::bigint'])assert.match(query,new RegExp(cast.replaceAll(/[()[\]{}.?*+^$|\\]/g,'\\$&')));
});
