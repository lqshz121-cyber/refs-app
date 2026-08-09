import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAccountingApi,createAccountingHttpServer} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),journalEntryId=randomUUID(),periodId=randomUUID();
const calls=[];const invoke=name=>async args=>{calls.push([name,args]);return {journal_entry_id:journalEntryId,status:'DRAFT',idempotent:false};};
const kernel={createManualJournal:invoke('createManualJournal'),createAutoJournal:invoke('createAutoJournal'),transitionJournal:invoke('transitionJournal'),postJournal:invoke('postJournal'),createJournalAdjustment:invoke('createJournalAdjustment'),createApBillVoid:invoke('createApBillVoid'),createApPayment:invoke('createApPayment'),createApPaymentReversal:invoke('createApPaymentReversal'),createArReceipt:invoke('createArReceipt'),createArReceiptReversal:invoke('createArReceiptReversal'),getArAging:invoke('getArAging'),getApAging:invoke('getApAging'),getArControlTotal:invoke('getArControlTotal'),getApControlTotal:invoke('getApControlTotal'),listBusinessDocuments:invoke('listBusinessDocuments'),listBusinessAdjustments:invoke('listBusinessAdjustments'),listJournalEntries:invoke('listJournalEntries'),listBankTransactions:invoke('listBankTransactions'),getReconciliationSummary:invoke('getReconciliationSummary'),getFinancialStatements:invoke('getFinancialStatements'),createBankPaymentMatch:invoke('createBankPaymentMatch'),unmatchBankPayment:invoke('unmatchBankPayment'),startReconciliation:invoke('startReconciliation'),setReconciliationClearance:invoke('setReconciliationClearance'),transitionReconciliation:invoke('transitionReconciliation'),createArCreditMemo:invoke('createArCreditMemo'),applyArCreditMemo:invoke('applyArCreditMemo'),createArRefund:invoke('createArRefund'),createApVendorCredit:invoke('createApVendorCredit'),applyApVendorCredit:invoke('applyApVendorCredit'),recordWbsSnapshot:invoke('recordWbsSnapshot')};
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
  response=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/transitions/review`,{reason:'reviewed'},{'If-Match':'3'});
  assert.equal(response.status,400);assert.equal(response.body.code,'INVALID_IF_MATCH');
});

test('successful mutations return a strong ETag only for an authoritative revision',async()=>{
  const revisedApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({...kernel,transitionJournal:async()=>({journal_entry_id:journalEntryId,revision:4,idempotent:false})})});
  const response=await revisedApi({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/transitions/review`,body:{reason:'reviewed'},headers:{'Idempotency-Key':'etag-test-0001','If-Match':'"3"'}});
  assert.equal(response.status,201);assert.equal(response.headers.etag,'"4"');
  const ordinary=await command(`/api/v1/entities/${entityId}/journal-entries/${journalEntryId}/post`,{periodId},{'If-Match':'"3"'});
  assert.equal(ordinary.headers.etag,undefined);
});

test('reconciliation lifecycle routes derive identity and require idempotency plus strong revisions',async()=>{
  calls.length=0;const reconciliationId=randomUUID(),bankSourceId=randomUUID();
  let response=await command(`/api/v1/entities/${entityId}/bank/reconciliations`,{
    bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'100.0000',statementEndingBalance:'125.0000',reason:'Monthly statement start'
  });
  assert.equal(response.status,201);assert.deepEqual(calls[0],['startReconciliation',{tenantId,entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31',statementOpeningBalance:'100.0000',statementEndingBalance:'125.0000',reason:'Monthly statement start',idempotencyKey:'idem-key-0001'}]);
  calls.length=0;response=await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/items/${bankSourceId}/clearance`,{clear:true,expectedBankRevision:2,reason:'Cleared to exact active match'},{'If-Match':'"3"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'setReconciliationClearance');assert.equal(calls[0][1].expectedReconciliationVersion,3);assert.equal(calls[0][1].expectedBankVersion,2);
  calls.length=0;response=await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/transitions/sign_off`,{reason:'Independent controller sign off'},{'If-Match':'"4"'});
  assert.equal(response.status,201);assert.deepEqual(calls[0],['transitionReconciliation',{tenantId,entityId,reconciliationId,action:'SIGN_OFF',expectedVersion:4,reason:'Independent controller sign off',idempotencyKey:'idem-key-0001'}]);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/transitions/review`,{reason:'Review complete'})).status,428);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/items/${bankSourceId}/clearance`,{clear:'yes',expectedBankRevision:2,reason:'Invalid state'},{'If-Match':'"3"'})).status,400);
});

test('AP Bill Void route derives tenant entity bill id and revision from trusted boundaries',async()=>{
  calls.length=0;const billId=randomUUID();const body={periodId,journalNumber:'APVOID-1',journalDate:'2026-08-02',reason:'Duplicate vendor bill'};
  const response=await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,body,{'If-Match':'"4"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApBillVoid');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessDocumentId:billId,expectedVersion:4,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,{...body,actorId:'attacker'},{'If-Match':'"4"'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/voids`,body)).status,428);
});

test('WBS snapshot route derives the immutable observation scope solely from authentication',async()=>{
  calls.length=0;const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:randomUUID(),views:[]};
  const response=await command(`/api/v1/entities/${entityId}/wbs/snapshots`,{snapshot});
  assert.equal(response.status,201);assert.deepEqual(calls[0],['recordWbsSnapshot',{tenantId,entityId,snapshot,idempotencyKey:'idem-key-0001'}]);
  assert.equal((await command(`/api/v1/entities/${entityId}/wbs/snapshots`,{snapshot,actorId:'attacker'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/wbs/snapshots`,{snapshot,sourceEntityId:'attacker'})).status,400);
});

test('WBS production snapshot signature failures are fail-closed and do not leak verifier internals',async()=>{
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V1',snapshot_id:randomUUID(),views:[]};
  const unavailable=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'snapshot-importer'}),kernelFactory:async()=>({...kernel,recordWbsSnapshot:async()=>{const error=new Error('missing public key from secure config');error.code='WBS_SNAPSHOT_SIGNATURE_REQUIRED';throw error;}})});
  const required=await unavailable({method:'POST',url:`/api/v1/entities/${entityId}/wbs/snapshots`,body:{snapshot},headers:{'Idempotency-Key':'snapshot-signature-001'}});
  assert.equal(required.status,503);assert.equal(required.body.code,'WBS_SNAPSHOT_SIGNATURE_REQUIRED');assert.equal(required.body.message,'Internal server error');assert.equal(required.headers['retry-after'],'1');
  const invalid=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'snapshot-importer'}),kernelFactory:async()=>({...kernel,recordWbsSnapshot:async()=>{const error=new Error('Detached signature is invalid');error.code='WBS_SNAPSHOT_SIGNATURE_INVALID';throw error;}})});
  const rejected=await invalid({method:'POST',url:`/api/v1/entities/${entityId}/wbs/snapshots`,body:{snapshot},headers:{'Idempotency-Key':'snapshot-signature-002'}});
  assert.equal(rejected.status,422);assert.equal(rejected.body.code,'WBS_SNAPSHOT_SIGNATURE_INVALID');
});

test('AP Payment route creates only Draft occurrence and pending allocation from trusted scope',async()=>{
  calls.length=0;const billId=randomUUID();const body={periodId,paymentNumber:'APPAY-1',paymentDate:'2026-08-02',cashAccountCode:'100100',bankMemberRef:'BANK-1',amount:40,reason:'Pay vendor bill'};
  const response=await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createApPayment');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,businessDocumentId:billId,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,{...body,actorId:'attacker'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/ap/bills/${billId}/payments`,{...body,periodId:'not-uuid'})).status,400);
});

test('Bank match command derives scope and requires revisions, idempotency, and a posted occurrence reference',async()=>{
  calls.length=0;const bankSourceId=randomUUID(),paymentOccurrenceId=randomUUID();
  const body={paymentOccurrenceId,expectedOccurrenceRevision:2,reason:'Controller reviewed exact posted payment evidence'};
  const response=await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches`,body,{'If-Match':'"3"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createBankPaymentMatch');
  assert.deepEqual(calls[0][1],{tenantId,entityId,bankSourceId,paymentOccurrenceId,expectedBankVersion:3,expectedOccurrenceVersion:2,reason:body.reason,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches`,body)).status,428);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches`,{...body,expectedOccurrenceRevision:-1},{'If-Match':'"3"'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches`,{...body,actorId:'attacker'},{'If-Match':'"3"'})).status,400);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches`,{...body,reason:'x'.repeat(2001)},{'If-Match':'"3"'})).body.code,'INVALID_REASON');
});

test('Bank unmatch command retains scope and requires the active match revision and canonical review reason',async()=>{
  calls.length=0;const bankSourceId=randomUUID(),bankMatchId=randomUUID();const body={reason:'Controller approved evidence-preserving unmatch'};
  const response=await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches/${bankMatchId}/unmatch`,body,{'If-Match':'"0"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'unmatchBankPayment');
  assert.deepEqual(calls[0][1],{tenantId,entityId,bankSourceId,bankMatchId,expectedMatchVersion:0,reason:body.reason,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches/${bankMatchId}/unmatch`,body)).status,428);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/matches/${bankMatchId}/unmatch`,{reason:' short '},{'If-Match':'"0"'})).body.code,'INVALID_REASON');
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

test('AR aging is an authenticated read scoped to entity and a strict as-of date',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ar/aging?asOf=2026-08-31`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][0],'getArAging');
  assert.deepEqual(calls[0][1],{tenantId,entityId,asOfDate:'2026-08-31'});
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/ar/aging?asOf=2026-02-30`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/ar/aging?asOf=2026-08-31`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/ar/aging?asOf=2026-08-31`,body:{actorId:'attacker'},headers:{}})).status,400);
});

test('AP aging is an authenticated read scoped to entity and a strict as-of date',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/ap/aging?asOf=2026-08-31`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(calls[0][0],'getApAging');
  assert.deepEqual(calls[0][1],{tenantId,entityId,asOfDate:'2026-08-31'});
});

test('AP and AR control totals are authenticated entity-scoped reads',async()=>{
  for(const [module,method] of [['ap','getApControlTotal'],['ar','getArControlTotal']]){
    calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/control-totals`,body:null,headers:{}});
    assert.equal(response.status,200);assert.equal(calls[0][0],method);assert.deepEqual(calls[0][1],{tenantId,entityId});
  }
});

test('AP Bills and AR Invoices refresh from authenticated entity-scoped business document reads',async()=>{
  for(const [module,collection,kind] of [['ap','bills','AP_BILL'],['ar','invoices','AR_INVOICE']]){
    calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/${collection}`,body:null,headers:{}});
    assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(calls[0],['listBusinessDocuments',{tenantId,entityId,documentKind:kind}]);
    assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/${collection}`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
  }
});

test('AP and AR adjustments refresh only through authenticated entity-scoped reads',async()=>{
  for(const [module,expected] of [['ap','AP'],['ar','AR']]){
    calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/adjustments`,body:null,headers:{}});
    assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
    assert.deepEqual(calls[0],['listBusinessAdjustments',{tenantId,entityId,module:expected}]);
    assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/adjustments`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
  }
});

test('Journal Entries refresh only through an authenticated entity-scoped read',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-entries`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listJournalEntries',{tenantId,entityId}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-entries`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-entries`,body:{unexpected:true},headers:{}})).status,400);
});

test('Bank transactions are a bounded authenticated entity and account scoped read',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&from=2026-07-01&through=2026-07-31&limit=25`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listBankTransactions',{tenantId,entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:25}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&from=2026-08-01&through=2026-07-31`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&limit=201`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:{tenantId},headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=%20BANK-1%20`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&unexpected=x`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&bankAccountRef=BANK-2`,body:null,headers:{}})).body.code,'DUPLICATE_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
});

test('Reconciliation summary is an authenticated entity, account and statement scoped read',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['getReconciliationSummary',{tenantId,entityId,bankAccountRef:'BANK-1',statementEndingDate:'2026-07-31'}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-02-30`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31&extra=1`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliation?bankAccountRef=BANK-1&statementEndingDate=2026-07-31&statementEndingDate=2026-08-31`,body:null,headers:{}})).body.code,'DUPLICATE_QUERY_PARAMETER');
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
  const stale=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{const error=new Error('Revision conflict');error.code='40001';throw error;}})});
  const staleResponse=await stale({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0004'},body:{}});assert.equal(staleResponse.status,412);assert.equal(staleResponse.body.code,'PRECONDITION_FAILED');
  const serialization=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>({createManualJournal:async()=>{const error=new Error('serialization detail must not leak');error.code='40001';throw error;}})});
  const retry=await serialization({method:'POST',url:`/api/v1/entities/${entityId}/journal-entries/manual`,headers:{'Idempotency-Key':'idem-key-0005'},body:{}});assert.equal(retry.status,503);assert.equal(retry.body.code,'SERIALIZATION_RETRY_EXHAUSTED');assert.equal(retry.body.message,'Internal server error');assert.equal(retry.headers['retry-after'],'1');
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

test('HTTP CORS permits only configured browser origins and preflights without authentication',async()=>{
  const origin='https://staging.refs.example';const server=createAccountingHttpServer({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel,allowedOrigins:[origin]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
    assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.match(response.headers.get('access-control-allow-headers'),/(^|,\s*)authorization(,|$)/);assert.match(response.headers.get('access-control-allow-headers'),/idempotency-key/);
    response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{headers:{origin}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('vary'),'Origin');
    response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{headers:{origin:'https://attacker.example'}});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal((await response.json()).code,'CORS_ORIGIN_FORBIDDEN');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('liveness is process-local while readiness fails closed and reflects dependency checks',async()=>{
  let ready=false;const server=createAccountingHttpServer({authenticate:async()=>null,kernelFactory:async()=>kernel,healthCheck:async()=>ready});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
    const base=`http://127.0.0.1:${server.address().port}`;let response=await fetch(`${base}/health/live`);assert.equal(response.status,200);
    response=await fetch(`${base}/health/ready`);assert.equal(response.status,503);ready=true;response=await fetch(`${base}/health/ready`);assert.equal(response.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
