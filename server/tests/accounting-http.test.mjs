import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';
import {createAccountingApi,createAccountingHttpServer} from '../api/accounting-http.mjs';

const tenantId=randomUUID(),entityId=randomUUID(),journalEntryId=randomUUID(),periodId=randomUUID();
const calls=[];const invoke=name=>async args=>{calls.push([name,args]);return {journal_entry_id:journalEntryId,status:'DRAFT',idempotent:false};};
const kernel={createManualJournal:invoke('createManualJournal'),createAutoJournal:invoke('createAutoJournal'),transitionJournal:invoke('transitionJournal'),postJournal:invoke('postJournal'),createJournalAdjustment:invoke('createJournalAdjustment'),createApBillVoid:invoke('createApBillVoid'),createApPayment:invoke('createApPayment'),createApPaymentReversal:invoke('createApPaymentReversal'),createArReceipt:invoke('createArReceipt'),createArReceiptReversal:invoke('createArReceiptReversal'),getArAging:invoke('getArAging'),getApAging:invoke('getApAging'),getArControlTotal:invoke('getArControlTotal'),getApControlTotal:invoke('getApControlTotal'),listBusinessDocuments:invoke('listBusinessDocuments'),listBusinessAdjustments:invoke('listBusinessAdjustments'),listJournalEntries:invoke('listJournalEntries'),getJournalWorkflowCapabilities:invoke('getJournalWorkflowCapabilities'),listBankTransactions:invoke('listBankTransactions'),listBankMatchCandidates:invoke('listBankMatchCandidates'),getReconciliationSummary:invoke('getReconciliationSummary'),listReconciliationScopes:invoke('listReconciliationScopes'),listAdmittedWbsBankStatementReceipts:invoke('listAdmittedWbsBankStatementReceipts'),getAdmittedWbsBankStatementReceipt:invoke('getAdmittedWbsBankStatementReceipt'),listReconciliationWorksheet:invoke('listReconciliationWorksheet'),getSignedReconciliationSnapshot:invoke('getSignedReconciliationSnapshot'),getFinancialStatements:invoke('getFinancialStatements'),getFinancialStatementSnapshot:invoke('getFinancialStatementSnapshot'),prepareFinancialStatementSnapshot:invoke('prepareFinancialStatementSnapshot'),approveFinancialStatementSnapshot:invoke('approveFinancialStatementSnapshot'),createBankPaymentMatch:invoke('createBankPaymentMatch'),unmatchBankPayment:invoke('unmatchBankPayment'),startReconciliation:invoke('startReconciliation'),startReconciliationFromAdmittedWbsStatement:invoke('startReconciliationFromAdmittedWbsStatement'),setReconciliationClearance:invoke('setReconciliationClearance'),setReconciliationAdjustmentClearance:invoke('setReconciliationAdjustmentClearance'),transitionReconciliation:invoke('transitionReconciliation'),createReconciliationAdjustmentDraft:invoke('createReconciliationAdjustmentDraft'),createArCreditMemo:invoke('createArCreditMemo'),applyArCreditMemo:invoke('applyArCreditMemo'),createArRefund:invoke('createArRefund'),createApVendorCredit:invoke('createApVendorCredit'),applyApVendorCredit:invoke('applyApVendorCredit'),recordWbsSnapshot:invoke('recordWbsSnapshot')};
const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
const command=(path,body={},headers={})=>api({method:'POST',url:path,body,headers:{'Idempotency-Key':'idem-key-0001',...headers}});

test('self-service Stage 1 activation derives only the signed-in principal and fixed entity scope',async()=>{
  const activationCalls=[];
  const selfService=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId,actorId:'oidc|reader'}),kernelFactory:async()=>kernel,
    stage1SelfGrantServiceFactory:async principal=>({grant:async input=>{activationCalls.push([principal,input]);return {idempotent:false,permissionCount:5};}})
  });
  const response=await selfService({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-read-grant/activate`,body:{},headers:{'Idempotency-Key':'reader-activation-0001'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(activationCalls,[[{trusted:true,tenantId,actorId:'oidc|reader'},{entityId,idempotencyKey:'reader-activation-0001'}]]);
  const disabled=await api({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-read-grant/activate`,body:{},headers:{'Idempotency-Key':'reader-activation-0001'}});
  assert.equal(disabled.status,404);
});

test('self-service WBS reader upgrade derives only the signed-in principal and carries no write input',async()=>{
  const upgradeCalls=[];
  const selfService=createAccountingApi({
    authenticate:async()=>({trusted:true,tenantId,actorId:'oidc|reader'}),kernelFactory:async()=>kernel,
    stage1SelfWbsReadUpgradeServiceFactory:async principal=>({upgrade:async input=>{upgradeCalls.push([principal,input]);return {idempotent:false,permissionCount:6};}})
  });
  const response=await selfService({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-wbs-read-grant/upgrade`,body:{},headers:{'Idempotency-Key':'wbs-upgrade-0001'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,{upgraded:true,idempotent:false,permission_count:6});
  assert.deepEqual(upgradeCalls,[[{trusted:true,tenantId,actorId:'oidc|reader'},{entityId,idempotencyKey:'wbs-upgrade-0001'}]]);
  const forbidden=await selfService({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-wbs-read-grant/upgrade`,body:{permission:'WBS.SNAPSHOT.IMPORT'},headers:{'Idempotency-Key':'wbs-upgrade-0002'}});
  assert.equal(forbidden.status,400);
});

test('self-service WBS operator upgrade adds the fixed exception-retain permission without request fields',async()=>{
  const upgradeCalls=[];
  const selfService=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'oidc|reader'}),kernelFactory:async()=>kernel,stage1SelfWbsOperatorUpgradeServiceFactory:async principal=>({upgrade:async input=>{upgradeCalls.push([principal,input]);return {idempotent:false,permissionCount:7};}})});
  const response=await selfService({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-wbs-operator-grant/upgrade`,body:{},headers:{'Idempotency-Key':'wbs-operator-upgrade-0001'}});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,{upgraded:true,idempotent:false,permission_count:7});
  assert.deepEqual(upgradeCalls,[[{trusted:true,tenantId,actorId:'oidc|reader'},{entityId,idempotencyKey:'wbs-operator-upgrade-0001'}]]);
  const replayApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'oidc|reader'}),kernelFactory:async()=>kernel,stage1SelfWbsOperatorUpgradeServiceFactory:async()=>({upgrade:async()=>({idempotent:true,permissionCount:7})})});
  const replay=await replayApi({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-wbs-operator-grant/upgrade`,body:{},headers:{'Idempotency-Key':'wbs-operator-upgrade-0001'}});
  assert.equal(replay.status,200);assert.deepEqual(replay.body.data,{upgraded:true,idempotent:true,permission_count:7});
  assert.equal((await selfService({method:'POST',url:`/api/v1/entities/${entityId}/access/self-service-wbs-operator-grant/upgrade`,body:{permission:'GL.JE.POST'},headers:{'Idempotency-Key':'wbs-operator-upgrade-0002'}})).status,400);
});

test('manual command derives tenant/entity/actor boundary from authenticated context',async()=>{
  calls.length=0;const body={periodId,journalNumber:'JE-1',journalDate:'2026-08-02',currency:'USD',attachmentIds:[],lines:[]};
  const response=await command(`/api/v1/entities/${entityId}/journal-entries/manual`,body);
  assert.equal(response.status,201);assert.equal(calls[0][0],'createManualJournal');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,idempotencyKey:'idem-key-0001'});
});

test('statement snapshot lifecycle routes derive scope, period and proposal only from the trusted boundary',async()=>{
  calls.length=0;
  const prepared=await command(`/api/v1/entities/${entityId}/reports/financial-statement-snapshot-proposals`,{periodId});
  assert.equal(prepared.status,201);assert.deepEqual(calls.at(-1),['prepareFinancialStatementSnapshot',{tenantId,entityId,periodId,idempotencyKey:'idem-key-0001'}]);
  const proposalId=randomUUID();
  const approved=await command(`/api/v1/entities/${entityId}/reports/financial-statement-snapshot-proposals/${proposalId}/approve`,{});
  assert.equal(approved.status,201);assert.deepEqual(calls.at(-1),['approveFinancialStatementSnapshot',{tenantId,entityId,proposalId,idempotencyKey:'idem-key-0001'}]);
  assert.equal((await command(`/api/v1/entities/${entityId}/reports/financial-statement-snapshot-proposals`,{periodId,actorId:'attacker'})).status,400);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/reports/financial-statement-snapshot-proposals/${proposalId}/approve`,body:{periodId},headers:{'Idempotency-Key':'snapshot-approve-invalid'}})).status,400);
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

test('admitted WBS statement start derives every statement fact from one immutable receipt',async()=>{
  calls.length=0;const statementReceiptId=randomUUID();
  const path=`/api/v1/entities/${entityId}/bank/reconciliations/from-admitted-statement`;
  const response=await command(path,{statementReceiptId,reason:'Start review from the admitted signed statement receipt'});
  assert.equal(response.status,201);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['startReconciliationFromAdmittedWbsStatement',{tenantId,entityId,statementReceiptId,reason:'Start review from the admitted signed statement receipt',idempotencyKey:'idem-key-0001'}]);
  assert.equal((await command(`${path}?unexpected=true`,{statementReceiptId,reason:'Start review from the admitted signed statement receipt'})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await command(path,{statementReceiptId,reason:'Start review from the admitted signed statement receipt'},{'If-Match':'"0"'})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await command(path,{statementReceiptId,bankAccountRef:'attacker-supplied',reason:'Start review from the admitted signed statement receipt'})).body.code,'UNEXPECTED_FIELD');
  assert.equal((await command(path,{statementReceiptId:'not-a-uuid',reason:'Start review from the admitted signed statement receipt'})).body.code,'INVALID_PATH_PARAMETER');
  assert.equal((await api({method:'POST',url:path,body:{statementReceiptId,reason:'Start review from the admitted signed statement receipt'},headers:{}})).body.code,'IDEMPOTENCY_KEY_REQUIRED');
});

test('admitted WBS statement reads are GET-only, bounded, scoped, and return one closed detail row',async()=>{
  calls.length=0;const statementReceiptId=randomUUID(),row={wbs_bank_statement_receipt_id:statementReceiptId,bank_account_ref:'BANK-1',statement_start_date:'2026-07-01',statement_end_date:'2026-07-31',selection_state:'AVAILABLE_FOR_SERVER_VALIDATION'};
  const readApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({...kernel,listAdmittedWbsBankStatementReceipts:async args=>{calls.push(['listAdmittedWbsBankStatementReceipts',args]);return [row];},getAdmittedWbsBankStatementReceipt:async args=>{calls.push(['getAdmittedWbsBankStatementReceipt',args]);return [row];}})});
  let response=await readApi({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements?bankAccountRef=BANK-1&limit=10`,headers:{},body:null});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,[row]);assert.match(response.body.data[0].statement_start_date,/^\d{4}-\d{2}-\d{2}$/);assert.match(response.body.data[0].statement_end_date,/^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(calls[0],['listAdmittedWbsBankStatementReceipts',{tenantId,entityId,bankAccountRef:'BANK-1',limit:10}]);
  response=await readApi({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements/${statementReceiptId}`,headers:{},body:null});
  assert.equal(response.status,200);assert.deepEqual(response.body.data,row);assert.deepEqual(calls[1],['getAdmittedWbsBankStatementReceipt',{tenantId,entityId,statementReceiptId}]);
  for(const request of [
    {method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements?bankAccountRef=BANK-1&limit=51`,headers:{},body:null},
    {method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements?bankAccountRef=BANK-1&unexpected=true`,headers:{},body:null},
    {method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements?bankAccountRef=BANK-1`,headers:{'Idempotency-Key':'forbidden'},body:null},
    {method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements/${statementReceiptId}`,headers:{'If-Match':'"0"'},body:null},
    {method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements/${statementReceiptId}`,headers:{},body:{}},
  ])assert.equal((await readApi(request)).status,400);
  const missingApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({...kernel,getAdmittedWbsBankStatementReceipt:async()=>[]})});
  response=await missingApi({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements/${randomUUID()}`,headers:{},body:null});
  assert.equal(response.status,404);assert.equal(response.body.code,'ADMITTED_STATEMENT_NOT_FOUND');
  const deniedApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({...kernel,getAdmittedWbsBankStatementReceipt:async()=>{const error=new Error('hidden scope');error.code='42501';throw error;}})});
  response=await deniedApi({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/admitted-statements/${statementReceiptId}`,headers:{},body:null});
  assert.equal(response.status,403);assert.equal(response.body.code,'42501');
});

test('reconciliation adjustment Draft route binds the current reconciliation and statement-source revisions and cannot create a posted journal',async()=>{
  calls.length=0;const reconciliationId=randomUUID(),bankSourceId=randomUUID();const body={bankSourceId,periodId,journalNumber:'RECON-ADJ-1',journalDate:'2026-07-31',currency:'USD',description:'Statement adjustment evidence',attachmentIds:[randomUUID()],lines:[
    {line_no:1,account_code:'100100',debit_amount:'25.0000',credit_amount:'0.0000',member_ref:'BANK-1'},
    {line_no:2,account_code:'610000',debit_amount:'0.0000',credit_amount:'25.0000',member_ref:null}
  ],reason:'Controller-supported statement difference adjustment'};
  const response=await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/adjustment-drafts`,body,{'If-Match':'"7"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'createReconciliationAdjustmentDraft');
  assert.deepEqual(calls[0][1],{...body,tenantId,entityId,reconciliationId,expectedReconciliationVersion:7,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/adjustment-drafts`,body)).status,428);
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/adjustment-drafts`,{...body,actorId:'attacker'},{'If-Match':'"7"'})).status,400);
});

test('posted reconciliation adjustment clearance derives the exact statement source and both concurrency revisions',async()=>{
  calls.length=0;const reconciliationId=randomUUID(),bankSourceId=randomUUID();
  const body={clear:true,expectedBankRevision:4,reason:'Clear the posted statement adjustment evidence'};
  const response=await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/adjustment-items/${bankSourceId}/clearance`,body,{'If-Match':'"8"'});
  assert.equal(response.status,201);assert.equal(calls[0][0],'setReconciliationAdjustmentClearance');
  assert.deepEqual(calls[0][1],{clear:true,reason:body.reason,tenantId,entityId,reconciliationId,bankSourceId,expectedReconciliationVersion:8,expectedBankVersion:4,idempotencyKey:'idem-key-0001'});
  assert.equal((await command(`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/adjustment-items/${bankSourceId}/clearance`,{...body,clear:'yes'},{'If-Match':'"8"'})).status,400);
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

test('admitted WBS payable ingestion derives identity from authentication and fails closed when unavailable',async()=>{
  const snapshot={schema_version:'WBS_READONLY_SNAPSHOT_V2'},observed=[];
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-importer'}),kernelFactory:async()=>kernel,wbsAdmittedPayableServiceFactory:async()=>({ingest:async request=>(observed.push(request),{status:'PERSISTED_PAYABLE_STAGING_REVIEW_REQUIRED',idempotent:false,can_write_wbs:false,can_create_draft:false,can_approve:false,can_post:false})})});
  const response=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/payables`,headers:{'idempotency-key':'wbs-payable-http-0001'},body:{snapshot}});
  assert.equal(response.status,201);assert.deepEqual(observed,[{tenantId,entityId,snapshot,idempotencyKey:'wbs-payable-http-0001'}]);assert.equal(response.body.data.can_create_draft,false);assert.equal(response.body.data.can_post,false);
  const forged=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/payables`,headers:{'idempotency-key':'wbs-payable-http-0002'},body:{snapshot,tenantId:'33333333-3333-4333-8333-333333333333'}});
  assert.equal(forged.status,400);assert.equal(forged.body.code,'IDENTITY_FIELD_FORBIDDEN');assert.equal(observed.length,1);
  const unavailable=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-importer'}),kernelFactory:async()=>kernel});
  const blocked=await unavailable({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/payables`,headers:{'idempotency-key':'wbs-payable-http-0003'},body:{snapshot}});
  assert.equal(blocked.status,503);assert.equal(blocked.body.code,'WBS_PAYABLE_ADMISSION_UNAVAILABLE');
});

test('WBS payable review binds immutable evidence, CAS, approved configuration and clean attachments without action authority',async()=>{
  const wbsInboundRowId=randomUUID(),settingSnapshotId=randomUUID(),mappingSnapshotId=randomUUID(),attachmentId=randomUUID(),observed=[];
  const reviewKernel={reviewWbsPayable:async request=>(observed.push(request),{wbs_payable_review_evidence_id:randomUUID(),wbs_inbound_row_id:wbsInboundRowId,source_document_id:randomUUID(),staging_item_id:randomUUID(),status:'READY_FOR_DRAFT_EVIDENCE_ONLY',revision:0,idempotent:false,can_create_draft:false,can_approve:false,can_post:false})};
  const reviewApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-reviewer'}),kernelFactory:async()=>reviewKernel});
  const body={periodId,expectedSourceVersion:'snapshot:exact-source-version',expectedReceiptHash:`sha256:${'a'.repeat(64)}`,expectedEvidenceHash:`sha256:${'b'.repeat(64)}`,settingSnapshotId,mappingSnapshotId,attachmentIds:[attachmentId],reason:'Independent review of signed payable evidence'};
  const path=`/api/v1/entities/${entityId}/wbs/inbound/payables/${wbsInboundRowId}/reviews`;
  const created=await reviewApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-review-http-0001','If-Match':'"0"'},body});
  assert.equal(created.status,201);assert.equal(created.headers.etag,'"0"');assert.deepEqual(observed,[{tenantId,entityId,wbsInboundRowId,periodId,expectedRevision:0,expectedSourceVersion:body.expectedSourceVersion,expectedReceiptHash:body.expectedReceiptHash,expectedEvidenceHash:body.expectedEvidenceHash,settingSnapshotId,mappingSnapshotId,attachmentIds:[attachmentId],reason:body.reason,idempotencyKey:'wbs-payable-review-http-0001'}]);
  assert.deepEqual({draft:created.body.data.can_create_draft,approve:created.body.data.can_approve,post:created.body.data.can_post},{draft:false,approve:false,post:false});
  assert.equal((await reviewApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-review-http-0002'},body})).status,428);
  assert.equal((await reviewApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-review-http-0003','If-Match':'"0"'},body:{...body,actorId:'forged'}})).body.code,'IDENTITY_FIELD_FORBIDDEN');
  assert.equal((await reviewApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-review-http-0004','If-Match':'"0"'},body:{...body,attachmentIds:[attachmentId,attachmentId]}})).body.code,'INVALID_ATTACHMENT_IDS');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-reviewer'}),kernelFactory:async()=>({reviewWbsPayable:async()=>({can_create_draft:true,can_approve:false,can_post:false})})});
  assert.equal((await unsafe({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-review-http-0005','If-Match':'"0"'},body})).body.code,'WBS_PAYABLE_REVIEW_RESULT_INVALID');
});

test('admitted WBS Payable review-candidate list and detail are closed no-store reads',async()=>{
  const wbsInboundRowId=randomUUID(),seen=[],row={wbs_inbound_row_id:wbsInboundRowId,source_version:'v1',receipt_hash:`sha256:${'a'.repeat(64)}`,evidence_hash:`sha256:${'b'.repeat(64)}`,revision:'0',period_id:periodId,document_number:'WBS-INV-001',invoice_date:'2026-07-01',due_date:'2026-07-31',accounting_date:'2026-07-02',currency:'USD',gross_amount:'10.0000',vendor_ref:'VENDOR-1',vendor_name:'Vendor One',offset_account_code:'610000',setting_snapshot_id:randomUUID(),mapping_snapshot_id:randomUUID(),attachment_choices:[],review_readiness:'VERIFIED_ATTACHMENT_REQUIRED',can_review:false};
  const readApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-reviewer'}),kernelFactory:async()=>({listWbsPayableReviewCandidates:async request=>(seen.push(['list',request]),[row]),getWbsPayableReviewCandidate:async request=>(seen.push(['detail',request]),[row])})});
  const listPath=`/api/v1/entities/${entityId}/wbs/inbound/payables/review-candidates?limit=7`,detailPath=`/api/v1/entities/${entityId}/wbs/inbound/payables/review-candidates/${wbsInboundRowId}`;
  const listed=await readApi({method:'GET',url:listPath,body:null,headers:{}}),detail=await readApi({method:'GET',url:detailPath,body:null,headers:{}});
  assert.equal(listed.status,200);assert.equal(detail.status,200);assert.equal(listed.headers['cache-control'],'no-store');assert.equal(detail.headers['cache-control'],'no-store');assert.deepEqual(seen,[['list',{tenantId,entityId,limit:7}],['detail',{tenantId,entityId,wbsInboundRowId}]]);assert.deepEqual(detail.body.data,row);
  assert.equal((await readApi({method:'GET',url:`${listPath}&providerId=secret`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await readApi({method:'GET',url:detailPath,body:null,headers:{'Idempotency-Key':'forbidden'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
});

test('row-bound WBS Payable attachment routes expose display status and server-derived evidence-only binding',async()=>{
  const wbsInboundRowId=randomUUID(),attachmentId=randomUUID(),seen=[];
  const state={entity_id:entityId,wbs_inbound_row_id:wbsInboundRowId,can_upload:false,can_bind:true,attachments:[{attachment_id:attachmentId,name:'invoice.pdf',media_type:'application/pdf',status:'VERIFIED_CLEAN',verified_at:'2026-08-12T00:00:00.000Z',can_bind:true}]};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'independent-binder'}),kernelFactory:async()=>({listWbsPayableAttachmentUploads:async request=>(seen.push(['read',request]),state),bindWbsPayableUploadedAttachment:async request=>(seen.push(['bind',request]),{wbs_payable_attachment_binding_id:randomUUID(),wbs_inbound_row_id:wbsInboundRowId,attachment_id:attachmentId,status:'BOUND_EVIDENCE_ONLY',revision:0,idempotent:false,can_review:false,can_create_draft:false,can_approve:false,can_post:false})})});
  const base=`/api/v1/entities/${entityId}/wbs/inbound/payables/${wbsInboundRowId}/attachments`;
  const read=await api({method:'GET',url:`${base}/uploads`,body:null,headers:{}});assert.equal(read.status,200);assert.deepEqual(read.body.data,state);
  const bound=await api({method:'POST',url:`${base}/bindings/from-upload`,headers:{'Idempotency-Key':'wbs-row-bind-http-1','If-Match':'"0"'},body:{attachmentId,reason:'Bind exact clean support evidence'}});
  assert.equal(bound.status,201);assert.deepEqual(seen,[['read',{tenantId,entityId,wbsInboundRowId}],['bind',{tenantId,entityId,wbsInboundRowId,attachmentId,expectedRevision:0,reason:'Bind exact clean support evidence',idempotencyKey:'wbs-row-bind-http-1'}]]);
  assert.equal((await api({method:'POST',url:`${base}/bindings/from-upload`,headers:{'Idempotency-Key':'wbs-row-bind-http-2','If-Match':'"0"'},body:{attachmentId,reason:'Bind exact clean support evidence',expectedProviderReceiptHash:`sha256:${'a'.repeat(64)}`}})).body.code,'UNEXPECTED_FIELD');
  assert.equal((await api({method:'GET',url:`${base}/uploads`,body:null,headers:{'If-Match':'"0"'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
});

test('reviewed WBS payable evidence list and detail are closed no-store reads',async()=>{
  const reviewEvidenceId=randomUUID(),wbsInboundRowId=randomUUID(),sourceDocumentId=randomUUID(),stagingItemId=randomUUID(),mappingSnapshotId=randomUUID(),attachmentId=randomUUID(),seen=[];
  const row={wbs_payable_review_evidence_id:reviewEvidenceId,wbs_inbound_row_id:wbsInboundRowId,source_document_id:sourceDocumentId,staging_item_id:stagingItemId,period_id:periodId,document_number:'WBS-INV-001',invoice_date:'2026-07-01',due_date:'2026-07-31',accounting_date:'2026-07-02',currency:'USD',gross_amount:'10.0000',vendor_ref:'VENDOR-1',vendor_name:'Reviewed vendor',offset_account_code:'610000',mapping_snapshot_id:mappingSnapshotId,attachment_ids:[attachmentId],evidence_hash:`sha256:${'a'.repeat(64)}`,review_reason:'Independent review',reviewed_by:'reviewer',reviewed_at:'2026-08-12T00:00:00.000Z',revision:'0',evidence_status:'READY_FOR_DRAFT_EVIDENCE_ONLY',draft_readiness:'READY_FOR_AP_DRAFT',can_create_draft:true,business_document_id:null,journal_entry_id:null};
  const readApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-maker'}),kernelFactory:async()=>({listWbsPayableReviewEvidence:async request=>(seen.push(['list',request]),[row]),getWbsPayableReviewEvidence:async request=>(seen.push(['detail',request]),[row])})});
  const listPath=`/api/v1/entities/${entityId}/wbs/inbound/payables/reviews?limit=7`,detailPath=`/api/v1/entities/${entityId}/wbs/inbound/payables/reviews/${reviewEvidenceId}`;
  const listed=await readApi({method:'GET',url:listPath,body:null,headers:{}}),detail=await readApi({method:'GET',url:detailPath,body:null,headers:{}});
  assert.equal(listed.status,200);assert.equal(detail.status,200);assert.equal(listed.headers['cache-control'],'no-store');assert.equal(detail.headers['cache-control'],'no-store');
  assert.deepEqual(seen,[['list',{tenantId,entityId,limit:7}],['detail',{tenantId,entityId,reviewEvidenceId}]]);assert.deepEqual(listed.body.data,[row]);assert.deepEqual(detail.body.data,row);
  assert.equal((await readApi({method:'GET',url:`${listPath}&providerId=secret`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await readApi({method:'GET',url:listPath,body:{limit:1},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await readApi({method:'GET',url:detailPath,body:null,headers:{'If-Match':'"0"'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
});

test('reviewed WBS payable Draft route accepts only frozen evidence selectors and stops at AUTO Draft',async()=>{
  const wbsInboundRowId=randomUUID(),reviewEvidenceId=randomUUID(),mappingSnapshotId=randomUUID(),attachmentId=randomUUID(),observed=[];
  const draftResult={business_document_id:randomUUID(),journal_entry_id:randomUUID(),journal_type:'AUTO',status:'DRAFT',revision:0,idempotent:false,can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false};
  const draftApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-maker'}),kernelFactory:async()=>({createWbsPayableApDraft:async request=>(observed.push(request),draftResult)})});
  const body={reviewEvidenceId,expectedEvidenceHash:`sha256:${'c'.repeat(64)}`,mappingSnapshotId,attachmentIds:[attachmentId],reason:'Create one Draft from independently reviewed evidence'};
  const path=`/api/v1/entities/${entityId}/wbs/inbound/payables/${wbsInboundRowId}/drafts`;
  const created=await draftApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-draft-http-0001','If-Match':'"0"'},body});
  assert.equal(created.status,201);assert.equal(created.headers.etag,'"0"');assert.deepEqual(observed,[{tenantId,entityId,wbsInboundRowId,reviewEvidenceId,expectedRevision:0,expectedEvidenceHash:body.expectedEvidenceHash,mappingSnapshotId,attachmentIds:[attachmentId],reason:body.reason,idempotencyKey:'wbs-payable-draft-http-0001'}]);
  assert.deepEqual({type:created.body.data.journal_type,status:created.body.data.status,submit:created.body.data.can_submit,review:created.body.data.can_review,approve:created.body.data.can_approve,post:created.body.data.can_post},{type:'AUTO',status:'DRAFT',submit:false,review:false,approve:false,post:false});
  assert.equal((await draftApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-draft-http-0002'},body})).status,428);
  assert.equal((await draftApi({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-draft-http-0003','If-Match':'"0"'},body:{...body,amount:'99.0000'}})).body.code,'UNEXPECTED_FIELD');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-payable-maker'}),kernelFactory:async()=>({createWbsPayableApDraft:async()=>({...draftResult,can_submit:true})})});
  assert.equal((await unsafe({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-payable-draft-http-0004','If-Match':'"0"'},body})).body.code,'WBS_PAYABLE_AP_DRAFT_RESULT_INVALID');
});

test('Cost-to-CWIP review binds signed evidence and cannot create a journal',async()=>{
  const wbsInboundRowId=randomUUID(),settingSnapshotId=randomUUID(),mappingSnapshotId=randomUUID(),observed=[];
  const result={wbs_cost_cwip_review_evidence_id:randomUUID(),wbs_inbound_row_id:wbsInboundRowId,source_document_id:randomUUID(),staging_item_id:randomUUID(),status:'READY_FOR_DRAFT',revision:0,idempotent:false,can_create_draft:false,can_approve:false,can_post:false};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'cwip-reviewer'}),kernelFactory:async()=>({reviewWbsCostCwip:async request=>(observed.push(request),result)})});
  const body={periodId,expectedSourceVersion:'signed-cost-source-v1',expectedReceiptHash:`sha256:${'a'.repeat(64)}`,expectedEvidenceHash:`sha256:${'b'.repeat(64)}`,settingSnapshotId,mappingSnapshotId,reason:'Independently review signed construction cost evidence'};
  const path=`/api/v1/entities/${entityId}/wbs/inbound/cost-cwip/${wbsInboundRowId}/reviews`;
  const response=await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-review-http-0001'},body});
  assert.equal(response.status,201);assert.deepEqual(observed,[{tenantId,entityId,wbsInboundRowId,...body,idempotencyKey:'wbs-cost-cwip-review-http-0001'}]);
  assert.equal(response.body.data.can_create_draft,false);assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-review-http-0002','If-Match':'"0"'},body})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-review-http-0003'},body:{...body,actorId:'forged'}})).body.code,'IDENTITY_FIELD_FORBIDDEN');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'cwip-reviewer'}),kernelFactory:async()=>({reviewWbsCostCwip:async()=>({...result,can_post:true})})});
  assert.equal((await unsafe({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-review-http-0004'},body})).body.code,'WBS_COST_CWIP_REVIEW_RESULT_INVALID');
});

test('Cost-to-CWIP Draft derives one AUTO Draft from frozen reviewed evidence only',async()=>{
  const reviewEvidenceId=randomUUID(),observed=[];
  const result={journal_entry_id:randomUUID(),journal_type:'AUTO',status:'DRAFT',revision:0,idempotent:false,can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'cwip-draft-maker'}),kernelFactory:async()=>({createWbsCostCwipDraft:async request=>(observed.push(request),result)})});
  const body={expectedEvidenceHash:`sha256:${'c'.repeat(64)}`,reason:'Create a standard Draft from independently reviewed cost evidence'};
  const path=`/api/v1/entities/${entityId}/wbs/inbound/cost-cwip/reviews/${reviewEvidenceId}/drafts`;
  const response=await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-draft-http-0001'},body});
  assert.equal(response.status,201);assert.deepEqual(observed,[{tenantId,entityId,reviewEvidenceId,...body,idempotencyKey:'wbs-cost-cwip-draft-http-0001'}]);
  assert.equal(response.body.data.status,'DRAFT');assert.equal((await api({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-draft-http-0002'},body:{...body,amount:'1.0000'}})).body.code,'UNEXPECTED_FIELD');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'cwip-draft-maker'}),kernelFactory:async()=>({createWbsCostCwipDraft:async()=>({...result,can_submit:true})})});
  assert.equal((await unsafe({method:'POST',url:path,headers:{'Idempotency-Key':'wbs-cost-cwip-draft-http-0003'},body})).body.code,'WBS_COST_CWIP_DRAFT_RESULT_INVALID');
});

test('AI payable proposal reads are bodyless and the human review route cannot advance a journal',async()=>{
  const proposalId=randomUUID(),observed=[];
  const proposal={ai_wbs_payable_draft_proposal_id:proposalId,decision:null,can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'ap-maker'}),kernelFactory:async()=>({
    listAiWbsPayableDraftProposals:async request=>(observed.push(['list',request]),[proposal]),
    reviewAiWbsPayableDraftProposal:async request=>(observed.push(['review',request]),{...proposal,decision:request.decision,ai_wbs_payable_draft_proposal_review_id:randomUUID()})
  })});
  const listPath=`/api/v1/entities/${entityId}/ai/wbs-payable-draft-proposals`;
  const listed=await api({method:'GET',url:`${listPath}?limit=1`,headers:{},body:null});
  assert.equal(listed.status,200);assert.deepEqual(observed[0],['list',{tenantId,entityId,limit:1}]);
  assert.equal((await api({method:'GET',url:listPath,headers:{'Idempotency-Key':'forbidden'},body:null})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
  assert.equal((await api({method:'GET',url:listPath,headers:{},body:{}})).body.code,'READ_BODY_FORBIDDEN');
  const reviewPath=`${listPath}/${proposalId}/reviews`;
  const reviewed=await api({method:'POST',url:reviewPath,headers:{'Idempotency-Key':'ai-wbs-payable-review-http-0001','If-Match':'"0"'},body:{decision:'ACCEPTED',reason:'The proposal agrees with reviewed payable evidence'}});
  assert.equal(reviewed.status,201);assert.deepEqual(observed[1][1],{tenantId,entityId,proposalId,decision:'ACCEPTED',reason:'The proposal agrees with reviewed payable evidence',idempotencyKey:'ai-wbs-payable-review-http-0001'});
  assert.equal(reviewed.body.data.can_post,false);
  assert.equal((await api({method:'POST',url:reviewPath,headers:{'Idempotency-Key':'ai-wbs-payable-review-http-0002','If-Match':'"0"'},body:{decision:'POSTED',reason:'The proposal agrees with reviewed payable evidence'}})).body.code,'AI_WBS_PAYABLE_PROPOSAL_REVIEW_RESULT_INVALID');
});

test('signed WBS bank admission binds authenticated scope, requires idempotency, and grants no action authority',async()=>{
  const observed=[];const kernel={admitWbsSignedBankStatement:async request=>(observed.push(request),{statement_receipt_id:'44444444-4444-4444-8444-444444444444',snapshot_id:'55555555-5555-4555-8555-555555555555',transaction_count:2,idempotent:false})};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-bank-importer'}),kernelFactory:async()=>kernel});
  const admission={schema_version:'WBS_SIGNED_BANK_ADMISSION_V1'};
  const created=await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/bank-statements`,headers:{'Idempotency-Key':'wbs-bank-http-0001'},body:{admission}});
  assert.equal(created.status,201);assert.deepEqual(observed,[{tenantId,entityId,admission,idempotencyKey:'wbs-bank-http-0001'}]);
  assert.deepEqual({match:created.body.data.can_match,reconcile:created.body.data.can_reconcile,draft:created.body.data.can_create_draft,post:created.body.data.can_post},{match:false,reconcile:false,draft:false,post:false});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/bank-statements?company=x`,headers:{'Idempotency-Key':'wbs-bank-http-0002'},body:{admission}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/bank-statements`,headers:{'Idempotency-Key':'wbs-bank-http-0003','If-Match':'"1"'},body:{admission}})).body.code,'IF_MATCH_NOT_ALLOWED');
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/inbound/bank-statements`,headers:{'Idempotency-Key':'wbs-bank-http-0004'},body:{admission,tenantId}})).body.code,'IDENTITY_FIELD_FORBIDDEN');
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

test('WBS AutoRec review candidates are a narrow authenticated read with no accounting command authority',async()=>{
  const seen=[];
  const reviewApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-reader'}),kernelFactory:async()=>kernel,wbsReadServiceFactory:async principal=>({readAutoRecReview:async input=>{
    seen.push([principal,input]);return {status:'READ_ONLY_PROJECTED',candidates:[],exceptions:[],controls:{candidate_count:0},can_dispatch:false,can_create_draft:false,can_post:false};
  }})});
  const path=`/api/v1/entities/${entityId}/wbs/auto-reconciliation/review-candidates?companyKey=COMPANY-A&sourceRecordId=bank-2&sourceRecordId=bank-1`;
  const response=await reviewApi({method:'GET',url:path,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(seen[0][1],{tenantId,entityId,companyKey:'COMPANY-A',sourceRecordIds:['bank-1','bank-2']});
  assert.equal((await reviewApi({method:'GET',url:path+'&sourceRecordId=bank-1',body:null,headers:{}})).status,400);
  assert.equal((await reviewApi({method:'GET',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/review-candidates?companyKey=COMPANY-A`,body:null,headers:{}})).body.code,'WBS_SOURCE_RECORD_ID_REQUIRED');
  assert.equal((await reviewApi({method:'GET',url:path,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
});

test('WBS AutoRec review refuses unavailable services and any result that could dispatch, draft, or post',async()=>{
  const path=`/api/v1/entities/${entityId}/wbs/auto-reconciliation/review-candidates?companyKey=COMPANY-A&sourceRecordId=bank-1`;
  assert.equal((await api({method:'GET',url:path,body:null,headers:{}})).body.code,'WBS_READ_SERVICE_UNAVAILABLE');
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-reader'}),kernelFactory:async()=>kernel,wbsReadServiceFactory:async()=>({readAutoRecReview:async()=>({can_dispatch:true,can_create_draft:false,can_post:false})})});
  const rejected=await unsafe({method:'GET',url:path,body:null,headers:{}});assert.equal(rejected.status,503);assert.equal(rejected.body.code,'WBS_READ_RESULT_INVALID');
});

test('a signed WBS transition contract is authenticated read-only evidence with no command headers',async()=>{
  const contract={schema_version:'WBS_AUTOREC_TRANSITION_CONTRACT_V1'},evidence={contract_id:randomUUID(),contract_hash:`sha256:${'c'.repeat(64)}`,signature_verified:true,can_transition_refs:false,can_release:false,can_incur:false,can_reverse:false,can_create_draft:false,can_post:false};let received;
  const transitionApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-reader'}),kernelFactory:async()=>({verifyWbsAutoRecTransitionContract:async input=>(received=input,evidence)})});
  const path=`/api/v1/entities/${entityId}/wbs/auto-reconciliation/transition-contracts/verify`,response=await transitionApi({method:'POST',url:path,body:{contract},headers:{}});
  assert.equal(response.status,200);assert.deepEqual(received,{tenantId,entityId,contract});assert.deepEqual(response.body.data,evidence);
  assert.equal((await transitionApi({method:'POST',url:path,body:{contract},headers:{'Idempotency-Key':'not-a-command'}})).status,400);
  const unsafe=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-reader'}),kernelFactory:async()=>({verifyWbsAutoRecTransitionContract:async()=>({...evidence,can_post:true})})});
  assert.equal((await unsafe({method:'POST',url:path,body:{contract},headers:{}})).status,422);
});

test('WBS Cost GL and Property controls are authenticated evidence-only reads with exact scopes',async()=>{
  const calls=[];const controlApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'wbs-reader'}),kernelFactory:async()=>kernel,wbsReadServiceFactory:async()=>({readControlReconciliation:async input=>{calls.push(input);return {status:'READ_ONLY_CONTROL_RECONCILED',reconciliation:{status:'RECONCILED'},can_create_transaction:false,can_allocate:false,can_create_draft:false,can_post:false};}})});
  const cost=`/api/v1/entities/${entityId}/wbs/control-reconciliation?sourceType=COST_GENERAL_LEDGER&companyKey=COMPANY-A&period=2026-08&currency=USD`;
  const property=`/api/v1/entities/${entityId}/wbs/control-reconciliation?sourceType=PROPERTY_COMPARISON&companyKey=COMPANY-A&propertyRef=PROPERTY-A&periodStart=2026-08-01&periodEnd=2026-08-31&currency=USD&bankAccountRef=BANK-1`;
  assert.equal((await controlApi({method:'GET',url:cost,body:null,headers:{}})).status,200);assert.deepEqual(calls[0],{tenantId,entityId,sourceType:'COST_GENERAL_LEDGER',scope:{company_key:'COMPANY-A',period:'2026-08',currency:'USD'}});
  assert.equal((await controlApi({method:'GET',url:property,body:null,headers:{}})).status,200);assert.equal(calls[1].scope.property_ref,'PROPERTY-A');
  assert.equal((await controlApi({method:'GET',url:cost+'&bankAccountRef=BANK-1',body:null,headers:{}})).status,400);
  assert.equal((await controlApi({method:'GET',url:cost.replace('currency=USD','currency=usd'),body:null,headers:{}})).status,400);
  assert.equal((await controlApi({method:'GET',url:property.replace('2026-08-31','2026-02-30'),body:null,headers:{}})).status,400);
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

test('AutoRec Bank Match review persists an independent exact decision and exposes a GET-only readback',async()=>{
  const observed=[];const reviewId=randomUUID(),bankMatchId=randomUUID(),reviewCandidateId='sha256:'+'1'.repeat(64),candidateHash='sha256:'+'2'.repeat(64);
  const evidence={wbs_autorec_match_review_id:reviewId,review_candidate_id:reviewCandidateId,candidate_hash:candidateHash,bank_match_id:bankMatchId,bank_match_revision:3,decision:'ACCEPTED',reviewed_by:'reviewer',reviewed_at:'2026-08-16T00:00:00.000Z',sod_verified:true,g11_linked:false,incurred:false};
  const reviewApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reviewer'}),kernelFactory:async()=>({
    reviewWbsAutoRecBankMatch:async input=>(observed.push(['review',input]),evidence),
    getWbsAutoRecBankMatchReview:async input=>(observed.push(['read',input]),evidence)
  })});
  const body={reviewCandidateId,candidateHash,bankMatchId,decision:'ACCEPTED',reason:'Independent controller accepted the exact Bank Match evidence'};
  const created=await reviewApi({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews`,body,headers:{'Idempotency-Key':'autorec-review-http-0001','If-Match':'"3"'}});
  assert.equal(created.status,201);assert.deepEqual(observed[0],['review',{tenantId,entityId,reviewCandidateId,candidateHash,bankMatchId,expectedMatchRevision:3,decision:'ACCEPTED',reason:body.reason,idempotencyKey:'autorec-review-http-0001'}]);
  const read=await reviewApi({method:'GET',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}`,body:null,headers:{}});
  assert.equal(read.status,200);assert.equal(read.headers['cache-control'],'no-store');assert.deepEqual(observed[1],['read',{tenantId,entityId,reviewId}]);assert.equal(read.body.data.g11_linked,false);assert.equal(read.body.data.incurred,false);
  assert.equal((await reviewApi({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews`,body:{...body,decision:'POSTED'},headers:{'Idempotency-Key':'autorec-review-http-0002','If-Match':'"3"'}})).body.code,'INVALID_REVIEW_DECISION');
  assert.equal((await reviewApi({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews`,body,headers:{'Idempotency-Key':'autorec-review-http-0003'}})).status,428);
  assert.equal((await reviewApi({method:'GET',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}`,body:null,headers:{'If-Match':'"3"'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
});

test('AutoRec G11 HTTP surface creates only fixed producers, independently finalizes, and exposes no-store raw evidence',async()=>{
  const observed=[],reviewId=randomUUID(),expectedEvidenceHash='sha256:'+'3'.repeat(64),draft={status:'DRAFT'},completion={g11_linked:true,incurred:true},evidence={g11_linked:true,incurred:true,lines:[]};
  const api=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'g11-actor'}),kernelFactory:async()=>({
    createWbsAutoRecPayableIncurDraft:async input=>(observed.push(['payable',input]),draft),
    createWbsAutoRecAutocDraft:async input=>(observed.push(['autoc',input]),draft),
    finalizeWbsAutoRecG11Incur:async input=>(observed.push(['incur',input]),completion),
    getWbsAutoRecG11Evidence:async input=>(observed.push(['read',input]),evidence)
  })});
  const draftBody={periodId,expectedEvidenceHash,reason:'Controller creates the exact mapped G11 Draft'};
  for(const leg of ['payable-incur','autoc'])assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-drafts/${leg}`,body:draftBody,headers:{'Idempotency-Key':`g11-${leg}-http-001`}})).status,201);
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-incur`,body:{expectedEvidenceHash,reason:'Independent finalizer verified exact posted G11 evidence'},headers:{'Idempotency-Key':'g11-incur-http-001'}})).status,201);
  const read=await api({method:'GET',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-evidence`,body:null,headers:{}});
  assert.equal(read.status,200);assert.equal(read.headers['cache-control'],'no-store');assert.equal(read.body.data.incurred,true);
  assert.deepEqual(observed.map(item=>item[0]),['payable','autoc','incur','read']);assert.deepEqual(observed[3][1],{tenantId,entityId,reviewId});
  assert.equal((await api({method:'POST',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-drafts/forged`,body:draftBody,headers:{'Idempotency-Key':'g11-forged-http-001'}})).status,404);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/wbs/auto-reconciliation/match-reviews/${reviewId}/g11-evidence`,body:null,headers:{'If-Match':'"1"'}})).body.code,'READ_COMMAND_HEADERS_FORBIDDEN');
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
    calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/control-totals?periodId=${periodId}`,body:null,headers:{}});
    assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.equal(calls[0][0],method);assert.deepEqual(calls[0][1],{tenantId,entityId,periodId});
    assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/control-totals`,body:null,headers:{}})).status,400);
    assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/control-totals?periodId=${periodId}&ignored=true`,body:null,headers:{}})).status,400);
    assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/${module}/control-totals?periodId=${periodId}`,body:null,headers:{'If-Match':'"0"'}})).status,400);
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

test('Journal workflow capabilities are a fixed current-actor read with no permission selector',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-workflow/capabilities`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(calls[0],['getJournalWorkflowCapabilities',{tenantId,entityId}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-workflow/capabilities?permission=GL.JE.POST`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-workflow/capabilities`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-workflow/capabilities`,body:null,headers:{'Idempotency-Key':'not-allowed'}})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/journal-workflow/capabilities`,body:null,headers:{'If-Match':'"1"'}})).body.code,'IF_MATCH_NOT_ALLOWED');
});

test('Bank transactions are a bounded authenticated entity and account scoped read',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&from=2026-07-01&through=2026-07-31&limit=25&offset=50`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listBankTransactions',{tenantId,entityId,bankAccountRef:'BANK-1',fromDate:'2026-07-01',throughDate:'2026-07-31',limit:25,offset:50}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&from=2026-08-01&through=2026-07-31`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&limit=201`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&limit=25&offset=-1`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:{tenantId},headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=%20BANK-1%20`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&unexpected=x`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1&bankAccountRef=BANK-2`,body:null,headers:{}})).body.code,'DUPLICATE_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions?bankAccountRef=BANK-1`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).status,400);
});

test('Bank Match candidates are an authenticated, bank-source scoped read with no body, query, or idempotency authority',async()=>{
  calls.length=0;const bankSourceId=randomUUID();
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/match-candidates`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listBankMatchCandidates',{tenantId,entityId,bankSourceId}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/match-candidates?unexpected=x`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/match-candidates`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions/${bankSourceId}/match-candidates`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/transactions/not-a-uuid/match-candidates`,body:null,headers:{}})).body.code,'INVALID_PATH_PARAMETER');
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

test('Reconciliation scope discovery is a bodyless no-store entity read',async()=>{
  calls.length=0;const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/scopes?limit=25`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listReconciliationScopes',{tenantId,entityId,limit:25}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/scopes?limit=201`,body:null,headers:{}})).status,400);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/scopes?unexpected=1`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/scopes`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/scopes`,body:null,headers:{'If-Match':'"0"'}})).body.code,'IF_MATCH_NOT_ALLOWED');
});

test('Reconciliation worksheet is an authenticated open-reconciliation scoped read',async()=>{
  calls.length=0;const reconciliationId=randomUUID();
  const response=await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/worksheet`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');
  assert.deepEqual(calls[0],['listReconciliationWorksheet',{tenantId,entityId,reconciliationId}]);
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/worksheet?unexpected=x`,body:null,headers:{}})).body.code,'UNEXPECTED_QUERY_PARAMETER');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/worksheet`,body:{},headers:{}})).body.code,'READ_BODY_FORBIDDEN');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/worksheet`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}})).body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  assert.equal((await api({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/not-a-uuid/worksheet`,body:null,headers:{}})).body.code,'INVALID_PATH_PARAMETER');
});

test('signed reconciliation snapshot is an authenticated immutable no-store read',async()=>{
  calls.length=0;const reconciliationId=randomUUID(),snapshot={reconciliation_id:reconciliationId,snapshot_hash:'sha256:'+'a'.repeat(64)};
  const readApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({...kernel,getSignedReconciliationSnapshot:async args=>{calls.push(['getSignedReconciliationSnapshot',args]);return [snapshot];}})});
  let response=await readApi({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/signed-snapshot`,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body.data,snapshot);assert.deepEqual(calls[0],['getSignedReconciliationSnapshot',{tenantId,entityId,reconciliationId}]);
  for(const request of [{url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/signed-snapshot?unexpected=x`,body:null,headers:{}},{url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/signed-snapshot`,body:{},headers:{}},{url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/signed-snapshot`,body:null,headers:{'Idempotency-Key':'read-not-allowed'}}])assert.equal((await readApi({method:'GET',...request})).status,400);
  const missing=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({...kernel,getSignedReconciliationSnapshot:async()=>[]})});
  response=await missing({method:'GET',url:`/api/v1/entities/${entityId}/bank/reconciliations/${reconciliationId}/signed-snapshot`,body:null,headers:{}});assert.equal(response.status,404);assert.equal(response.body.code,'SIGNED_RECONCILIATION_SNAPSHOT_NOT_FOUND');
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

test('real HTTP listener preserves an absent GET body and rejects an absent POST body',async()=>{
  const server=createAccountingHttpServer({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(`${base}/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}`);
    assert.equal(response.status,200);assert.equal((await response.json()).ok,true);
    response=await fetch(`${base}/api/v1/entities/${entityId}/journal-entries/manual`,{method:'POST',headers:{'idempotency-key':'idem-http-empty'}});
    assert.equal(response.status,400);assert.equal((await response.json()).code,'JSON_OBJECT_REQUIRED');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('HTTP CORS permits only configured browser origins and preflights without authentication',async()=>{
  const origin='https://staging.refs.example';const server=createAccountingHttpServer({authenticate:async()=>({trusted:true,tenantId,actorId:'maker'}),kernelFactory:async()=>kernel,allowedOrigins:[origin]});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
    const base=`http://127.0.0.1:${server.address().port}`;
    let response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{method:'OPTIONS',headers:{origin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
    assert.equal(response.status,204);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('access-control-allow-credentials'),'true');assert.match(response.headers.get('access-control-allow-headers'),/(^|,\s*)authorization(,|$)/);assert.match(response.headers.get('access-control-allow-headers'),/idempotency-key/);assert.match(response.headers.get('access-control-allow-headers'),/(^|,\s*)cache-control(,|$)/);
    response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{headers:{origin}});assert.equal(response.status,200);assert.equal(response.headers.get('access-control-allow-origin'),origin);assert.equal(response.headers.get('vary'),'Origin');
    response=await fetch(`${base}/api/v1/entities/${entityId}/ap/bills`,{headers:{origin:'https://attacker.example'}});assert.equal(response.status,403);assert.equal(response.headers.get('access-control-allow-origin'),null);assert.equal((await response.json()).code,'CORS_ORIGIN_FORBIDDEN');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('liveness and readiness expose a non-secret release stamp while readiness fails closed',async()=>{
  let ready=false;const server=createAccountingHttpServer({authenticate:async()=>null,kernelFactory:async()=>kernel,healthCheck:async()=>ready,releaseSha:'abcdef1234567890abcdef1234567890abcdef12'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));try{
    const base=`http://127.0.0.1:${server.address().port}`,release='abcdef1234567890abcdef1234567890abcdef12';let response=await fetch(`${base}/health/live`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,status:'live',release});
    response=await fetch(`${base}/health/ready`);assert.equal(response.status,503);assert.deepEqual(await response.json(),{ok:false,status:'not_ready',release});ready=true;response=await fetch(`${base}/health/ready`);assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:true,status:'ready',release});
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test('authoritative scope read returns only persisted entity and exact period metadata',async()=>{
  const scope={entity_id:entityId,entity_name:'Wan Pacific Real Estate Development LLC',entity_code:'WBPA',base_currency:'USD',period_id:periodId,period_code:'2026-06',period_start:'2026-06-01',period_end:'2026-06-30',period_status:'OPEN'};
  const reads=[];const scopeApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'reader'}),kernelFactory:async()=>({readAuthoritativeScope:async input=>{reads.push(input);return scope;}})});
  const path=`/api/v1/entities/${entityId}/scope?periodId=${periodId}`;
  let response=await scopeApi({method:'GET',url:path,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:scope});assert.deepEqual(reads,[{tenantId,entityId,periodId}]);
  response=await scopeApi({method:'GET',url:`${path}&unused=1`,body:null,headers:{}});assert.equal(response.status,400);assert.equal(response.body.code,'UNEXPECTED_QUERY_PARAMETER');
  response=await scopeApi({method:'GET',url:path,body:null,headers:{'If-Match':'"0"'}});assert.equal(response.status,400);assert.equal(response.body.code,'IF_MATCH_NOT_ALLOWED');
});

test('current actor access read is self-only bodyless no-store diagnostics',async()=>{
  const access={tenant_id:tenantId,entity_id:entityId,actor_id:'auth0|current-user',grant_set_version:7,permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],configured_permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],session_refresh_required:false};
  const reads=[];const accessApi=createAccountingApi({authenticate:async()=>({trusted:true,tenantId,actorId:'auth0|current-user'}),kernelFactory:async()=>({readCurrentActorAccess:async input=>{reads.push(input);return access;}})});
  const path=`/api/v1/entities/${entityId}/access/self`;
  let response=await accessApi({method:'GET',url:path,body:null,headers:{}});
  assert.equal(response.status,200);assert.equal(response.headers['cache-control'],'no-store');assert.deepEqual(response.body,{ok:true,data:access});assert.deepEqual(reads,[{tenantId,entityId}]);
  response=await accessApi({method:'GET',url:`${path}?actorId=someone-else`,body:null,headers:{}});assert.equal(response.status,400);assert.equal(response.body.code,'UNEXPECTED_QUERY_PARAMETER');
  response=await accessApi({method:'GET',url:path,body:null,headers:{'Idempotency-Key':'not-allowed'}});assert.equal(response.status,400);assert.equal(response.body.code,'IDEMPOTENCY_KEY_NOT_ALLOWED');
  response=await accessApi({method:'GET',url:path,body:null,headers:{'If-Match':'\"0\"'}});assert.equal(response.status,400);assert.equal(response.body.code,'IF_MATCH_NOT_ALLOWED');
  response=await accessApi({method:'GET',url:path,body:{actorId:'someone-else'},headers:{}});assert.equal(response.status,400);assert.equal(response.body.code,'IDENTITY_FIELD_FORBIDDEN');
});
