const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const ACTOR_ROLES=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);

export class ControlledTestBankWorkflowError extends Error{
  constructor(code,message){super(message);this.name='ControlledTestBankWorkflowError';this.code=code;}
}
const fail=(code,message)=>{throw new ControlledTestBankWorkflowError(code,message);};
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const date=value=>DATE.test(value||'')&&new Date(`${value}T00:00:00.000Z`).toISOString().slice(0,10)===value;
const money=value=>{
  const normalized=typeof value==='string'?value:Number(value).toFixed(4);
  return MONEY4.test(normalized)?normalized:null;
};
const reason=value=>`UNSIGNED TEST ONLY — ${value}`;

function assertConfiguration(scope){
  if(!scope||!UUID.test(scope.tenantId||'')||!UUID.test(scope.entityId||'')||scope.bankAccountRef!=='WBS_TEST_BANK'||scope.cashAccountCode!=='111000'||scope.offsetAccountCode!=='610000'){
    fail('CONTROLLED_TEST_BANK_CONFIG_INVALID','Controlled-test Bank scope or fixed accounts are invalid.');
  }
  if(!exactObject(scope.actors,ACTOR_ROLES)||ACTOR_ROLES.some(role=>typeof scope.actors[role]!=='string'||scope.actors[role].trim().length<3||scope.actors[role].trim().length>200)
    ||new Set(ACTOR_ROLES.map(role=>scope.actors[role].trim())).size!==ACTOR_ROLES.length){
    fail('CONTROLLED_TEST_BANK_CONFIG_INVALID','Controlled-test Bank workflow actors must be canonical and distinct.');
  }
}

function assertSelection(input,scope){
  if(input.tenantId!==scope.tenantId||input.entityId!==scope.entityId)fail('CONTROLLED_TEST_BANK_SCOPE_DENIED','Controlled-test Bank workflow is restricted to its fixed tenant and entity.');
  if(!UUID.test(input.periodId||'')||!UUID.test(input.reconciliationId||'')||typeof input.reason!=='string'||input.reason!==input.reason.trim()||input.reason.length<8||input.reason.length>1700
    ||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<8||input.idempotencyKey.length>120){
    fail('CONTROLLED_TEST_BANK_SELECTION_INVALID','Controlled-test Bank workflow requires one reconciliation, OPEN period, reason, and stable identity.');
  }
}

export function assertControlledTestBankWorkflowResult(value){
  const keys=['adjusted_count','cleared_count','idempotent','journal_entry_ids','matched_count','processed_count','provenance_mode','reconciliation_id','revision','snapshot_hash','snapshot_id','status','test_only'];
  if(!exactObject(value,keys)||value.status!=='CONTROLLED_TEST_BANK_WORKFLOW_REOPENED'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'
    ||!UUID.test(value.reconciliation_id||'')||!UUID.test(value.snapshot_id||'')||!SHA256.test(value.snapshot_hash||'')||typeof value.idempotent!=='boolean'
    ||!['adjusted_count','cleared_count','matched_count','processed_count','revision'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)
    ||value.processed_count!==value.adjusted_count+value.matched_count||value.cleared_count!==value.processed_count
    ||!Array.isArray(value.journal_entry_ids)||value.journal_entry_ids.length!==value.adjusted_count||value.journal_entry_ids.some(id=>!UUID.test(id||''))||new Set(value.journal_entry_ids).size!==value.journal_entry_ids.length){
    fail('CONTROLLED_TEST_BANK_RESULT_INVALID','Controlled-test Bank workflow result is incomplete or unsafe.');
  }
  return value;
}

export function assertControlledTestBankRangeWorkflowResult(value){
  const keys=['adjusted_count','cleared_count','idempotent','matched_count','processed_count','provenance_mode','results','scope_count','status','test_only'];
  if(!exactObject(value,keys)||value.status!=='CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'
    ||!Number.isSafeInteger(value.scope_count)||value.scope_count<1||value.scope_count>6||!Array.isArray(value.results)||value.results.length!==value.scope_count
    ||value.results.some(result=>{try{return !assertControlledTestBankWorkflowResult(result);}catch{return true;}})
    ||!['adjusted_count','cleared_count','matched_count','processed_count'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)
    ||value.processed_count!==value.results.reduce((sum,result)=>sum+result.processed_count,0)||value.matched_count!==value.results.reduce((sum,result)=>sum+result.matched_count,0)
    ||value.adjusted_count!==value.results.reduce((sum,result)=>sum+result.adjusted_count,0)||value.cleared_count!==value.results.reduce((sum,result)=>sum+result.cleared_count,0)){
    fail('CONTROLLED_TEST_BANK_RESULT_INVALID','Controlled-test Bank range workflow result is incomplete or unsafe.');
  }
  return value;
}

const workflowCounts=rows=>({
  adjusted_count:rows.filter(row=>UUID.test(row.adjustment_journal_entry_id||'')).length,
  matched_count:rows.filter(row=>UUID.test(row.bank_match_id||'')).length,
  cleared_count:rows.filter(row=>row.clearance_state==='CLEARED').length,
  journal_entry_ids:[...new Set(rows.map(row=>row.adjustment_journal_entry_id).filter(value=>UUID.test(value||'')))]
});

export function createControlledTestBankWorkflowService({kernelForActor,authorize,scope}={}){
  if(typeof kernelForActor!=='function'||typeof authorize!=='function')fail('CONTROLLED_TEST_BANK_CONFIG_INVALID','Controlled-test Bank dependencies are unavailable.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  const run=async({tenantId,entityId,periodId,reconciliationId,reason:reviewReason,idempotencyKey}={})=>{
      assertSelection({tenantId,entityId,periodId,reconciliationId,reason:reviewReason,idempotencyKey},scope);
      await authorize({tenantId,entityId});
      const kernels=Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
      const required={
        importer:['listReconciliationScopes','listReconciliationWorksheet','listBankMatchCandidates','createBankPaymentMatch','getSignedReconciliationSnapshot'],
        maker:['createReconciliationAdjustmentDraft','listVerifiedCleanAttachmentIds'],submitter:['transitionJournal'],reviewer:['transitionJournal','transitionReconciliation'],
        approver:['transitionJournal','transitionReconciliation'],poster:['postJournal','setReconciliationClearance','setReconciliationAdjustmentClearance','transitionReconciliation']
      };
      for(const role of ACTOR_ROLES)if(!kernels[role]||required[role].some(method=>typeof kernels[role][method]!=='function'))fail('CONTROLLED_TEST_BANK_CONFIG_INVALID',`Controlled-test Bank ${role} kernel is unavailable.`);
      const key=String(idempotencyKey),markedReason=reason(reviewReason);
      let scopes=await kernels.importer.listReconciliationScopes({tenantId,entityId,limit:200});
      let reconciliation=scopes.find(row=>row.reconciliation_id===reconciliationId&&row.bank_account_ref===scope.bankAccountRef);
      if(!reconciliation)fail('CONTROLLED_TEST_BANK_SCOPE_DENIED','The selected reconciliation is not the fixed WBS TEST_ONLY Bank scope.');

      const snapshotResult=async({revision,idempotent,rows=[]})=>{
        const snapshots=await kernels.importer.getSignedReconciliationSnapshot({tenantId,entityId,reconciliationId});
        const snapshot=snapshots[0];if(!snapshot||!UUID.test(snapshot.reconciliation_snapshot_id||'')||!SHA256.test(snapshot.snapshot_hash||''))fail('CONTROLLED_TEST_BANK_SNAPSHOT_INVALID','Controlled-test Bank signed snapshot is unavailable.');
        const counts=workflowCounts(rows.length?rows:(snapshot.snapshot_body?.items||[]));
        const processed=counts.adjusted_count+counts.matched_count;
        return Object.freeze(assertControlledTestBankWorkflowResult({status:'CONTROLLED_TEST_BANK_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent,
          reconciliation_id:reconciliationId,processed_count:processed,matched_count:counts.matched_count,adjusted_count:counts.adjusted_count,cleared_count:counts.cleared_count,
          journal_entry_ids:counts.journal_entry_ids,revision:Number(revision),snapshot_id:snapshot.reconciliation_snapshot_id,snapshot_hash:snapshot.snapshot_hash}));
      };

      if(reconciliation.status==='RECONCILED'){
        const reopened=await kernels.poster.transitionReconciliation({tenantId,entityId,reconciliationId,action:'REOPEN',expectedVersion:Number(reconciliation.version),reason:markedReason,idempotencyKey:`${key}:reopen`});
        return snapshotResult({revision:Number(reopened.revision),idempotent:reopened.idempotent===true});
      }
      let rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});
      if(reconciliation.status==='REOPENED'&&rows.length>0&&rows.every(row=>row.clearance_state==='CLEARED'))return snapshotResult({revision:Number(reconciliation.version),idempotent:true,rows});
      if(reconciliation.status==='IN_REVIEW'){
        const signed=await kernels.approver.transitionReconciliation({tenantId,entityId,reconciliationId,action:'SIGN_OFF',expectedVersion:Number(reconciliation.version),reason:markedReason,idempotencyKey:`${key}:signoff`});
        const reopened=await kernels.poster.transitionReconciliation({tenantId,entityId,reconciliationId,action:'REOPEN',expectedVersion:Number(signed.revision),reason:markedReason,idempotencyKey:`${key}:reopen`});
        return snapshotResult({revision:Number(reopened.revision),idempotent:false,rows});
      }

      const evidence=await kernels.maker.listVerifiedCleanAttachmentIds({tenantId,entityId,limit:1});
      if(!Array.isArray(evidence)||evidence.length!==1||!UUID.test(evidence[0]||''))fail('CONTROLLED_TEST_BANK_EVIDENCE_REQUIRED','One entity-owned verified-clean attachment is required for controlled adjustment Drafts.');
      const bankSourceIds=rows.map(row=>row.bank_source_id);
      for(const bankSourceId of bankSourceIds){
        rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});let row=rows.find(value=>value.bank_source_id===bankSourceId);
        if(!row)fail('CONTROLLED_TEST_BANK_ITEM_INVALID','Controlled-test Bank item disappeared from the exact reconciliation scope.');
        if(row.clearance_state==='CLEARED')continue;
        let currentVersion=Number(row.reconciliation_version);
        if(row.match_status!=='ACTIVE'&&!row.adjustment_journal_entry_id){
          const candidates=await kernels.importer.listBankMatchCandidates({tenantId,entityId,bankSourceId:row.bank_source_id});
          if(candidates.length){
            const candidate=candidates[0];
            await kernels.importer.createBankPaymentMatch({tenantId,entityId,bankSourceId:row.bank_source_id,paymentOccurrenceId:candidate.payment_occurrence_id,
              expectedBankVersion:Number(row.bank_version),expectedOccurrenceVersion:Number(candidate.occurrence_version),reason:markedReason,idempotencyKey:`${key}:${row.bank_source_id}:match`});
          }else{
            const amount=money(row.amount);if(!amount||amount==='0.0000'||!date(row.transaction_date))fail('CONTROLLED_TEST_BANK_ROW_INVALID','Controlled-test Bank row amount or date is invalid.');
            const negative=amount.startsWith('-'),absolute=negative?amount.slice(1):amount,zero='0.0000';
            const description='UNSIGNED TEST ONLY — WBS Bank reconciliation adjustment';
            const created=await kernels.maker.createReconciliationAdjustmentDraft({tenantId,entityId,reconciliationId,bankSourceId:row.bank_source_id,expectedReconciliationVersion:currentVersion,
              periodId,journalNumber:`WBS-TEST-BANK-${row.bank_source_id}`,journalDate:row.transaction_date,currency:row.currency,description,
              lines:[
                {line_no:1,account_code:scope.cashAccountCode,debit_amount:negative?zero:absolute,credit_amount:negative?absolute:zero,member_ref:scope.bankAccountRef,description,dimensions:{}},
                {line_no:2,account_code:scope.offsetAccountCode,debit_amount:negative?absolute:zero,credit_amount:negative?zero:absolute,member_ref:null,description,dimensions:{}}
              ],attachmentIds:evidence,reason:markedReason,idempotencyKey:`${key}:${row.bank_source_id}:draft`});
            currentVersion=Number(created.reconciliation_revision);
          }
          rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});row=rows.find(value=>value.bank_source_id===row.bank_source_id);
        }
        if(row.match_status==='ACTIVE'){
          await kernels.poster.setReconciliationClearance({tenantId,entityId,reconciliationId,bankSourceId:row.bank_source_id,expectedReconciliationVersion:Number(row.reconciliation_version),
            expectedBankVersion:Number(row.bank_version),clear:true,reason:markedReason,idempotencyKey:`${key}:${row.bank_source_id}:clear-match`});
          rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});continue;
        }
        const journalId=row.adjustment_journal_entry_id;if(!UUID.test(journalId||''))fail('CONTROLLED_TEST_BANK_ITEM_INVALID','Controlled-test Bank item has neither exact match nor adjustment Draft.');
        let status=row.adjustment_journal_status,revision=Number(row.adjustment_journal_version);
        if(status==='DRAFT'){const result=await kernels.submitter.transitionJournal({tenantId,entityId,journalEntryId:journalId,action:'SUBMIT',expectedRevision:revision,idempotencyKey:`${key}:${row.bank_source_id}:submit`});status=result.status;revision=Number(result.revision);}
        if(status==='PENDING_REVIEW'){const result=await kernels.reviewer.transitionJournal({tenantId,entityId,journalEntryId:journalId,action:'REVIEW',expectedRevision:revision,idempotencyKey:`${key}:${row.bank_source_id}:review-je`});status=result.status;revision=Number(result.revision);}
        if(status==='PENDING_APPROVAL'){const result=await kernels.approver.transitionJournal({tenantId,entityId,journalEntryId:journalId,action:'APPROVE',expectedRevision:revision,idempotencyKey:`${key}:${row.bank_source_id}:approve`});status=result.status;revision=Number(result.revision);}
        if(status==='APPROVED'){await kernels.poster.postJournal({tenantId,entityId,periodId,journalEntryId:journalId,expectedRevision:revision,idempotencyKey:`${key}:${row.bank_source_id}:post`});}
        rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});row=rows.find(value=>value.bank_source_id===row.bank_source_id);
        if(row?.adjustment_journal_status!=='POSTED'||row.adjustment_clearance_eligible!==true)fail('CONTROLLED_TEST_BANK_ADJUSTMENT_INVALID','Controlled-test Bank adjustment did not produce exact Posted evidence.');
        await kernels.poster.setReconciliationAdjustmentClearance({tenantId,entityId,reconciliationId,bankSourceId:row.bank_source_id,expectedReconciliationVersion:Number(row.reconciliation_version),
          expectedBankVersion:Number(row.bank_version),clear:true,reason:markedReason,idempotencyKey:`${key}:${row.bank_source_id}:clear-adjustment`});
        rows=await kernels.importer.listReconciliationWorksheet({tenantId,entityId,reconciliationId});
      }
      if(!rows.length||rows.some(row=>row.clearance_state!=='CLEARED'))fail('CONTROLLED_TEST_BANK_WORKFLOW_INCOMPLETE','Controlled-test Bank reconciliation still has uncleared items.');
      const currentVersion=Number(rows[0].reconciliation_version);
      const reviewed=await kernels.reviewer.transitionReconciliation({tenantId,entityId,reconciliationId,action:'REVIEW',expectedVersion:currentVersion,reason:markedReason,idempotencyKey:`${key}:review-reconciliation`});
      const signed=await kernels.approver.transitionReconciliation({tenantId,entityId,reconciliationId,action:'SIGN_OFF',expectedVersion:Number(reviewed.revision),reason:markedReason,idempotencyKey:`${key}:signoff`});
      const reopened=await kernels.poster.transitionReconciliation({tenantId,entityId,reconciliationId,action:'REOPEN',expectedVersion:Number(signed.revision),reason:markedReason,idempotencyKey:`${key}:reopen`});
      return snapshotResult({revision:Number(reopened.revision),idempotent:false,rows});
  };
  return Object.freeze({run,async runRange({tenantId,entityId,scopes,reason:reviewReason,idempotencyKey}={}){
    if(tenantId!==scope.tenantId||entityId!==scope.entityId)fail('CONTROLLED_TEST_BANK_SCOPE_DENIED','Controlled-test Bank range workflow is restricted to its fixed tenant and entity.');
    if(!Array.isArray(scopes)||scopes.length<1||scopes.length>6||scopes.some(value=>!exactObject(value,['periodId','reconciliationId'])||!UUID.test(value.periodId||'')||!UUID.test(value.reconciliationId||''))
      ||new Set(scopes.map(value=>value.reconciliationId)).size!==scopes.length||typeof reviewReason!=='string'||reviewReason!==reviewReason.trim()||reviewReason.length<8||reviewReason.length>1700
      ||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>110)fail('CONTROLLED_TEST_BANK_SELECTION_INVALID','Controlled-test Bank range requires one to six unique monthly period/reconciliation scopes, reason, and stable identity.');
    const results=[];for(const [index,item] of scopes.entries())results.push(await run({tenantId,entityId,...item,reason:reviewReason,idempotencyKey:`${idempotencyKey}:${index}`}));
    const sum=key=>results.reduce((total,result)=>total+result[key],0);
    return Object.freeze(assertControlledTestBankRangeWorkflowResult({status:'CONTROLLED_TEST_BANK_RANGE_WORKFLOW_REOPENED',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:results.every(result=>result.idempotent),scope_count:results.length,processed_count:sum('processed_count'),matched_count:sum('matched_count'),adjusted_count:sum('adjusted_count'),cleared_count:sum('cleared_count'),results:Object.freeze(results)}));
  }});
}
