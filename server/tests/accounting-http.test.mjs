import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAccountingApi,createAccountingHttpServer} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),journalEntryId=randomUUID(),periodId=randomUUID();
const calls=[];const invoke=name=>async args=>{calls.push([name,args]);return {journal_entry_id:journalEntryId,status:'DRAFT',idempotent:false};};
const kernel={createManualJournal:invoke('createManualJournal'),createAutoJournal:invoke('createAutoJournal'),transitionJournal:invoke('transitionJournal'),postJournal:invoke('postJournal'),createJournalAdjustment:invoke('createJournalAdjustment'),createApBillVoid:invoke('createApBillVoid'),createApPayment:invoke('createApPayment'),createApPaymentReversal:invoke('createApPaymentReversal'),createArReceipt:invoke('createArReceipt'),createArReceiptReversal:invoke('createArReceiptReversal'),createArCreditMemo:invoke('createArCreditMemo'),applyArCreditMemo:invoke('applyArCreditMemo'),createArRefund:invoke('createArRefund'),createApVendorCredit:invoke('createApVendorCredit'),applyApVendorCredit:invoke('applyApVendorCredit')};
const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const command=(path,body={},headers={})=>api({method:'POST',url:path,body,headers:{'Idempotency-Key':'idem-key-0001',...headers}});

test('manual command derives tenant/entity/actor boundary from authenticated context',async()=>{
  calls.length=0;const body={periodId,journalNumber:'JE-1',journalDate:'2026-08-02',currency:'USD',attachmentIds:[],lines:[]};
  const response=await command(`/api/v1/entities/${entityId}/journal-entries/manual`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createManualJournal');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,idempotencyKey:'idem-key-0001'});
});

test('transition and post require optimistic concurrency and route authoritative ids',async()=>{
  calls.length=0;let response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/transitions/review`,{reason:'reviewed'},{'If-Match':'"3"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'transitionJournal');assert.equal(calls[0][1].expectedRevision,3);assert.equal(calls[0][1].action,'REVIEW');
  response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/post`,{periodId});assert.equal(response.status,428);
  response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/transitions/review`,{reason:'reviewed'},{'If-Match':'W/"3"'});
  assert.equal(response.status,412);assert.equal(response.body.code,'WEAK_IF_MATCH_REJECTED');
});

test('AP Bill Void route derives tenant entity bill id and revision from trusted boundaries',async()=>{
  calls.length=0;const billId=randomUUID();const body={periodId,journalNumber:'APVOID-1',journalDate:'2026-08-02',reason:'Duplicate vendor bill'};
  const response=await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,body,{'If-Match':'"4"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApBillVoid');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessDocumentId:billId,expectedVersion:4,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,{...body,actorId:'attacker'},{'If-Match':'"4"'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,body)).status,428);
});

test('AP Payment route creates only Draft occurrence and pending allocation from trusted scope',async()=>{
  calls.length=0;const billId=randomUUID();const body={periodId,paymentNumber:'APPAY-1',paymentDate:'2026-08-02',cashAccountCode:'100100',bankMemberRef:'BANK-1',amount:40,reason:'Pay vendor bill'};
  const response=await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApPayment');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessDocumentId:billId,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,{...body,actorId:'attacker'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,{...body,periodId:'not-uuid'})).status,400);
});

test('AR Receipt route creates only Draft occurrence and pending allocation from trusted scope',async()=>{
  calls.length=0;const invoiceId=randomUUID();const body={periodId,receiptNumber:'ARRCPT-1',receiptDate:'2026-08-02',cashAccountCode:'100100',bankMemberRef:'BANK-1',amount:75,reason:'Receive customer payment'};
  const response=await command(`/api/v1/entities/${entityId}/ar/invoices/${invoiceId}/receipts`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createArReceipt');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessDocumentId:invoiceId,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ar/invoices/${invoiceId}/receipts`,{...body,actorId:'attacker'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ar/invoices/${invoiceId}/receipts`,{...body,periodId:'not-uuid'})).status,400);
});

test('AR Receipt reversal route creates only a Draft adjustment from trusted scope',async()=>{
  calls.length=0;const response=await command('/api/v1/entities/'+entityId+'/ar/receipts/'+journalEntryId+'/reversals',{periodId,journalNumber:'AR-REV-1',journalDate:'2026-07-20',reason:'Customer receipt reversal'},{'Idempotency-Key':'ar-rev-0001'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createArReceiptReversal');assert.equal(calls[0][1].sourceOccurrenceId,journalEntryId);assert.equal(calls[0][1].tenantId,tenantId);
});

test('AR Credit Memo route creates only a Draft adjustment from trusted scope',async()=>{
  calls.length=0;const response=await command('/api/v1/entities/'+entityId+'/ar/credit-memos',{periodId,memoNumber:'CM-1',memoDate:'2026-07-20',customerRef:'CUSTOMER-1',customerName:'Customer',amount:10,lines:[{line_no:1,account_code:'400000',amount:10}],reason:'Approved customer credit memo'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createArCreditMemo');assert.equal(calls[0][1].tenantId,tenantId);assert.equal(calls[0][1].amount,10);
});

test('AP Vendor Credit route creates only a Draft command from trusted tenant entity scope',async()=>{
  calls.length=0;const body={periodId,creditNumber:'VC-1',creditDate:'2026-08-02',vendorRef:'V-100',vendorName:'Vendor',amount:125.25,lines:[{line_no:1,account_code:'610000',amount:125.25,dimensions:{property:'P1'}}],reason:'Vendor price adjustment'};
  const response=await command(`/api/v1/entities/${entityId}/ap/vendor-credits`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApVendorCredit');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/vendor-credits`,{...body,tenantId:randomUUID()})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/vendor-credits`,{...body,unexpected:true})).status,400);
});

test('AP Vendor Credit allocation route creates only a pending reservation from trusted scope',async()=>{
  calls.length=0;const creditId=randomUUID(),billId=randomUUID();const body={businessDocumentId:billId,amount:50,reason:'Apply vendor credit to bill'};
  const response=await command(`/api/v1/entities/${entityId}/ap/vendor-credits/${creditId}/allocations`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'applyApVendorCredit');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessAdjustmentId:creditId,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/vendor-credits/${creditId}/allocations`,{...body,actor:'attacker'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/vendor-credits/${creditId}/allocations`,{...body,businessDocumentId:'not-uuid'})).status,400);
});
test('AR Credit Memo allocation route creates only a pending reservation from trusted scope',async()=>{
  calls.length=0;const creditId=randomUUID(),invoiceId=randomUUID();const body={businessDocumentId:invoiceId,amount:50,reason:'Apply credit memo to invoice'};
  const response=await command(`/api/v1/entities/${entityId}/ar/credit-memos/${creditId}/allocations`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'applyArCreditMemo');assert.equal(calls[0][1].businessAdjustmentId,creditId);
});
test('AR Refund route creates only a Draft from a posted credit source',async()=>{
  calls.length=0;const sourceAdjustmentId=randomUUID();const response=await command(`/api/v1/entities/${entityId}/ar/refunds`,{periodId,sourceAdjustmentId,refundNumber:'RF-1',refundDate:'2026-08-02',cashAccountCode:'100100',amount:50,reason:'Return customer overpayment'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createArRefund');assert.equal(calls[0][1].sourceAdjustmentId,sourceAdjustmentId);
});
test('AP Payment reversal route creates only a Draft inverse',async()=>{
  calls.length=0;const sourceOccurrenceId=randomUUID();const response=await command(`/api/v1/entities/${entityId}/ap/payments/${sourceOccurrenceId}/reversals`,{periodId,journalNumber:'REV-1',journalDate:'2026-08-02',reason:'Reverse duplicate payment'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApPaymentReversal');assert.equal(calls[0][1].sourceOccurrenceId,sourceOccurrenceId);
});

test('attachment routes derive scope from authentication and never accept caller storage evidence',async()=>{
  const attachmentId=randomUUID(),attachmentCalls=[];
  const attachmentApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'uploader'}),kernelFactory:async()=>kernel,
    attachmentServiceFactory:async()=>({reserve:async(principal,args)=>{attachmentCalls.push(['reserve',principal,args]);return {attachment_id:attachmentId,status:'PENDING',idempotent:false};},finalize:async(principal,args)=>{attachmentCalls.push(['finalize',principal,args]);return {attachment_id:attachmentId,status:'VERIFIED_CLEAN',idempotent:false};}})});
  const reserve=await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/reservations`,headers:{'idempotency-key':'attach-reserve-1'},body:{name:'invoice.pdf',mediaType:'application/pdf',sizeBytes:12,contentHash:`sha256:${'a'.repeat(64)}`}});
  assert.equal(reserve.status,201);assert.equal(attachmentCalls[0][2].tenantId,tenantId);assert.equal(attachmentCalls[0][2].entityId,entityId);
  const finalize=await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/${attachmentId}/finalize`,headers:{'idempotency-key':'attach-final-1'},body:{}});
  assert.equal(finalize.status,201);assert.deepEqual(attachmentCalls[1][2],{tenantId,entityId,attachmentId,idempotencyKey:'attach-final-1'});
  assert.equal((await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/${attachmentId}/finalize`,headers:{'idempotency-key':'attach-final-2'},body:{storageRef:'s3://attacker/object'}})).status,400);
});

test('attachment replay is HTTP 200 and missing or unauthorized scope is a non-disclosing 404',async()=>{
  const attachmentId=randomUUID();let replay=true;
  const attachmentApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'uploader'}),kernelFactory:async()=>kernel,attachmentServiceFactory:async()=>({reserve:async()=>({attachment_id:attachmentId,status:'PENDING',idempotent:replay}),finalize:async()=>{const error=new Error('hidden');error.code=replay?'ATTACHMENT_NOT_FOUND':'42501';throw error;}})});
  assert.equal((await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/reservations`,headers:{'idempotency-key':'attach-replay-1'},body:{name:'a.pdf',mediaType:'application/pdf',sizeBytes:1,contentHash:`sha256:${'a'.repeat(64)}`}})).status,200);
  assert.equal((await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/${attachmentId}/finalize`,headers:{'idempotency-key':'attach-missing-1'},body:{}})).status,404);
  replay=false;assert.equal((await attachmentApi({method:'POST',url:`/api/v1/entities/${entityId}/attachments/${attachmentId}/finalize`,headers:{'idempotency-key':'attach-hidden-1'},body:{}})).status,404);
});

test('identity spoofing, missing idempotency, unauthenticated and malformed paths fail closed',async()=>{
  assert.equal((await command(`/api/v1/entities/${entityId}/journal-entries/manual`,{actorId:'attacker'})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{},body:{}})).status,400);
  const denied=createAccountingApi({authenticate:async()=>null,kernelFactory:async()=>kernel});assert.equal((await denied({method:'POST',url:'/',body:{}})).status,401);
  assert.equal((await command('/api/v1/entities/not-a-uuid/journal-entries/manual',{})).status,400);
});

test('database errors map to stable HTTP classes without leaking internal failures',async()=>{
  const failing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{const error=new Error('secret SQL');error.code='42501';throw error;}})});
  const denied=await failing({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0002'},body:{}});assert.equal(denied.status,403);
  const broken=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{throw new Error('database password leaked');}})});
  const internal=await broken({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0003'},body:{}});assert.equal(internal.status,500);assert.equal(internal.body.message,'Internal server error');
});

test('real HTTP listener parses JSON, enforces size limits and emits no-store problem responses',async()=>{
  const server=createAccountingHttpServer({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel,maxBodyBytes:64});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(`${base}/api/v1/entities/${entityId}/journal-entries/manual`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'idem-http-0001'},body:'{' });
    assert.equal(response.status,400);assert.equal(response.headers.get('cache-control'),'no-store');assert.equal((await response.json()).code,'INVALID_JSON');
    response=await fetch(`${base}/api/v1/entities/${entityId}/journal-entries/manual`,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'idem-http-0002'},body:JSON.stringify({description:'x'.repeat(100)})});
    assert.equal(response.status,413);assert.equal((await response.json()).code,'BODY_TOO_LARGE');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('liveness is process-local while readiness fails closed and reflects dependency checks',async()=>{
  let ready=false;const server=createAccountingHttpServer({authenticate:async()=>null,kernelFactory:async()=>kernel,healthCheck:async()=>ready});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
    const base=`http://127.0.0.1:${server.address().port}`;let response=await fetch(`${base}/health/live`);assert.equal(response.status,200);
    response=await fetch(`${base}/health/ready`);assert.equal(response.status,503);ready=true;response=await fetch(`${base}/health/ready`);assert.equal(response.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
