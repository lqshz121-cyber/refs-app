const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTOR_ROLES=Object.freeze(['sourceMaker','proposer','draftMaker','submitter','reviewer','approver','poster']);

export const CONTROLLED_TEST_AI_GRANT_BUNDLES=Object.freeze({
  sourceMaker:Object.freeze(['AI.TEST.WORKFLOW']),
  proposer:Object.freeze(['AI.AMORTIZATION.PROPOSE']),
  draftMaker:Object.freeze(['AI.AMORTIZATION.VIEW','AI.AMORTIZATION.DRAFT','GL.JE.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),
  reviewer:Object.freeze(['GL.JE.REVIEW']),
  approver:Object.freeze(['GL.JE.APPROVE']),
  poster:Object.freeze(['GL.JE.POST'])
});

export class ControlledTestAiWorkflowError extends Error{
  constructor(code,message){super(message);this.name='ControlledTestAiWorkflowError';this.code=code;}
}
const fail=(code,message)=>{throw new ControlledTestAiWorkflowError(code,message);};
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const isoDate=value=>value instanceof Date
  ?`${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`
  :String(value??'').slice(0,10);
const validDate=value=>{if(!DATE.test(value||''))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};
const lastOfMonth=value=>{const parsed=new Date(`${value}T00:00:00.000Z`);parsed.setUTCMonth(parsed.getUTCMonth()+1,0);return parsed.toISOString().slice(0,10);};

function assertConfiguration(scope){
  if(!scope||!UUID.test(scope.tenantId||'')||!UUID.test(scope.entityId||'')||scope.prepaidAccountCode!=='141500'||scope.expenseAccountCode!=='610000'){
    fail('CONTROLLED_TEST_AI_CONFIG_INVALID','Controlled-test AI scope or fixed accounts are invalid.');
  }
  if(typeof scope.callerActorId!=='string'||scope.callerActorId.trim().length<3||scope.callerActorId.trim().length>200
    ||!exactObject(scope.actors,ACTOR_ROLES)||ACTOR_ROLES.some(role=>typeof scope.actors[role]!=='string'||scope.actors[role].trim().length<3||scope.actors[role].trim().length>200)
    ||new Set([scope.callerActorId.trim(),...ACTOR_ROLES.map(role=>scope.actors[role].trim())]).size!==ACTOR_ROLES.length+1){
    fail('CONTROLLED_TEST_AI_CONFIG_INVALID','Controlled-test caller and workflow actors must be canonical and distinct.');
  }
}

function assertSelection(input,scope){
  if(input.tenantId!==scope.tenantId||input.entityId!==scope.entityId||input.initiatedBy!==scope.callerActorId){
    fail('CONTROLLED_TEST_AI_SCOPE_DENIED','Controlled-test AI workflow is restricted to its fixed tenant, entity, and caller.');
  }
  if(!UUID.test(input.periodId||'')||!UUID.test(input.parentSourceDocumentId||'')||!validDate(input.coverageStart)||!validDate(input.coverageEnd)
    ||!input.coverageStart.endsWith('-01')||input.coverageEnd!==lastOfMonth(input.coverageStart)
    ||typeof input.reason!=='string'||input.reason!==input.reason.trim()||input.reason.length<8||input.reason.length>1800
    ||typeof input.idempotencyKey!=='string'||input.idempotencyKey.length<8||input.idempotencyKey.length>120){
    fail('CONTROLLED_TEST_AI_SELECTION_INVALID','Controlled-test AI workflow requires one WBS test source, OPEN period, whole month, reason, and stable identity.');
  }
}

function assertDerived(value,parentSourceDocumentId){
  const keys=['attachment_id','controlled_test_ai_source_id','idempotent','parent_source_document_id','provenance_mode','source_document_id','source_document_line_id','source_payload_hash','status','test_only'];
  if(!exactObject(value,keys)||!UUID.test(value.controlled_test_ai_source_id||'')||value.parent_source_document_id!==parentSourceDocumentId
    ||!UUID.test(value.source_document_id||'')||!UUID.test(value.source_document_line_id||'')||!UUID.test(value.attachment_id||'')
    ||!SHA256.test(value.source_payload_hash||'')||value.status!=='READY_FOR_DRAFT'||value.test_only!==true
    ||value.provenance_mode!=='UNSIGNED_TEST_ONLY'||typeof value.idempotent!=='boolean'){
    fail('CONTROLLED_TEST_AI_DERIVATION_INVALID','Controlled-test AI source derivation returned an unsafe result.');
  }
  return value;
}

export function assertControlledTestAiWorkflowResult(value){
  const postedKeys=['ai_amortization_schedule_id','idempotent','journal_entry_id','parent_source_document_id','posting_batch_id','provenance_mode','source_document_id','status','test_only'];
  const partialKeys=['ai_amortization_schedule_id','completed_stage','idempotency_key','journal_entry_id','parent_source_document_id','posting_batch_id','provenance_mode','retryable','source_document_id','status','test_only'];
  const posted=exactObject(value,postedKeys)&&value.status==='CONTROLLED_TEST_AI_WORKFLOW_POSTED'&&typeof value.idempotent==='boolean'
    &&['ai_amortization_schedule_id','journal_entry_id','parent_source_document_id','posting_batch_id','source_document_id'].every(key=>UUID.test(value[key]||''));
  const partial=exactObject(value,partialKeys)&&value.status==='CONTROLLED_TEST_AI_WORKFLOW_PARTIAL'&&value.retryable===true
    &&['SOURCE_DERIVED','COVERAGE_RECORDED','PROPOSAL_RECORDED','DRAFT_CREATED','SUBMITTED','REVIEWED','APPROVED'].includes(value.completed_stage)
    &&typeof value.idempotency_key==='string'&&value.idempotency_key.length>=8&&value.idempotency_key.length<=120
    &&UUID.test(value.parent_source_document_id||'')
    &&['source_document_id','ai_amortization_schedule_id','journal_entry_id','posting_batch_id'].every(key=>value[key]===null||UUID.test(value[key]||''));
  if((!posted&&!partial)||value.test_only!==true||value.provenance_mode!=='UNSIGNED_TEST_ONLY'){
    fail('CONTROLLED_TEST_AI_RESULT_INVALID','Controlled-test AI workflow result is incomplete or unsafe.');
  }
  return value;
}

// Completed commands already persist their own database idempotency receipts.
// PARTIAL exposes the last durable boundary so replaying the exact top-level
// key can idempotently cross completed stages and continue at the first gap.
const partialResult=({completedStage,key,parentSourceDocumentId,source=null,proposal=null,draft=null})=>Object.freeze(assertControlledTestAiWorkflowResult({
  status:'CONTROLLED_TEST_AI_WORKFLOW_PARTIAL',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',retryable:true,
  completed_stage:completedStage,idempotency_key:key,parent_source_document_id:parentSourceDocumentId,
  source_document_id:source?.source_document_id??null,ai_amortization_schedule_id:proposal?.ai_amortization_schedule_id??null,
  journal_entry_id:draft?.journal_entry_id??null,posting_batch_id:null
}));

export async function reconcileControlledTestAiWorkflowActorGrants({grantSync,scope}={}){
  if(typeof grantSync?.reconcile!=='function')fail('CONTROLLED_TEST_AI_CONFIG_INVALID','Controlled-test grant sync is unavailable.');
  assertConfiguration(scope);const results={};
  for(const role of ACTOR_ROLES){
    const permissions=[...CONTROLLED_TEST_AI_GRANT_BUNDLES[role]];
    const result=await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId:scope.actors[role].trim(),permissions,expectedVersion:0,idempotencyKey:`controlled-test-ai-${role}-grant-v1`});
    const returned=[...(result?.permissions||[])].sort(),expected=[...permissions].sort();
    if(returned.length!==expected.length||returned.some((permission,index)=>permission!==expected[index]))fail('CONTROLLED_TEST_AI_GRANT_INVALID',`Controlled-test AI ${role} grant is not exact.`);
    results[role]=Object.freeze({version:result.version,idempotent:result.idempotent===true,permission_count:returned.length});
  }
  return Object.freeze(results);
}

export function createControlledTestAiWorkflowService({kernelForActor,scope}={}){
  if(typeof kernelForActor!=='function')fail('CONTROLLED_TEST_AI_CONFIG_INVALID','Controlled-test AI kernel factory is unavailable.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  return Object.freeze({
    async run({tenantId,entityId,periodId,parentSourceDocumentId,coverageStart,coverageEnd,reason,idempotencyKey,initiatedBy}={}){
      assertSelection({tenantId,entityId,periodId,parentSourceDocumentId,coverageStart,coverageEnd,reason,idempotencyKey,initiatedBy},scope);
      const kernels=Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
      const required={sourceMaker:['deriveControlledTestAiSource'],proposer:['recordAiAmortizationCoverageEvidence','proposeAiAmortizationSchedule'],draftMaker:['listAiAmortizationSchedules','createAiAmortizationDraft'],submitter:['transitionJournal'],reviewer:['transitionJournal'],approver:['transitionJournal'],poster:['postJournal']};
      for(const role of ACTOR_ROLES)if(!kernels[role]||required[role].some(method=>typeof kernels[role][method]!=='function'))fail('CONTROLLED_TEST_AI_CONFIG_INVALID',`Controlled-test AI ${role} kernel is unavailable.`);
      const key=String(idempotencyKey);let completedStage=null;let source=null;let proposal=null;let draft=null;
      source=assertDerived(await kernels.sourceMaker.deriveControlledTestAiSource({tenantId,entityId,parentSourceDocumentId,initiatedBy,idempotencyKey:`${key}:source`}),parentSourceDocumentId);
      completedStage='SOURCE_DERIVED';
      try{await kernels.proposer.recordAiAmortizationCoverageEvidence({tenantId,entityId,sourceDocumentId:source.source_document_id,sourcePayloadHash:source.source_payload_hash,
        coverageStart,coverageEnd,evidenceRef:`object://refs-test-only/${entityId}/ai-workflow/${source.controlled_test_ai_source_id}/coverage`,
        evidenceHash:source.source_payload_hash,extractionMethod:'HUMAN_VERIFIED_SOURCE_FIELD',idempotencyKey:`${key}:coverage`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source});}
      completedStage='COVERAGE_RECORDED';
      const markedReason=`UNSIGNED TEST ONLY — ${reason}`;
      try{proposal=await kernels.proposer.proposeAiAmortizationSchedule({tenantId,entityId,sourceDocumentId:source.source_document_id,sourcePayloadHash:source.source_payload_hash,
        coverageStart,coverageEnd,prepaidAccountCode:scope.prepaidAccountCode,expenseAccountCode:scope.expenseAccountCode,
        memberTrace:{project_ref:null,property_ref:null,allocation_basis:'ENTITY_ONLY'},confidence:1,reason:markedReason,idempotencyKey:`${key}:proposal`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source});}
      if(!proposal||!UUID.test(proposal.ai_amortization_schedule_id||''))fail('CONTROLLED_TEST_AI_PROPOSAL_INVALID','Controlled-test AI proposal returned an unsafe result.');
      const schedules=await kernels.draftMaker.listAiAmortizationSchedules({tenantId,entityId,limit:100});
      const schedule=schedules.find(row=>row.ai_amortization_schedule_id===proposal.ai_amortization_schedule_id&&row.source_document_id===source.source_document_id);
      if(!schedule||!SHA256.test(schedule.proposal_hash||'')
        ||(proposal.proposal_hash!==undefined&&proposal.proposal_hash!==schedule.proposal_hash)){
        fail('CONTROLLED_TEST_AI_PROPOSAL_INVALID','Controlled-test AI proposal does not match its authoritative schedule.');
      }
      // Migration 119 persists the canonical proposal hash but its immutable
      // command receipt predates that field. Reconcile the receipt only from
      // the permission-scoped authoritative schedule read before continuing.
      proposal=Object.freeze({...proposal,proposal_hash:schedule.proposal_hash});
      completedStage='PROPOSAL_RECORDED';
      const line=schedule?.schedule_lines?.find(row=>isoDate(row.amortization_month)===coverageStart);
      if(!schedule||!line||!UUID.test(line.ai_amortization_schedule_line_id||'')||!Array.isArray(schedule.eligible_source_attachment_ids)
        ||schedule.eligible_source_attachment_ids.length!==1||schedule.eligible_source_attachment_ids[0]!==source.attachment_id){
        fail('CONTROLLED_TEST_AI_PROPOSAL_INVALID','Controlled-test AI proposal line or source-bound attachment is unavailable.');
      }
      try{draft=await kernels.draftMaker.createAiAmortizationDraft({tenantId,entityId,aiAmortizationScheduleId:proposal.ai_amortization_schedule_id,
        aiAmortizationScheduleLineId:line.ai_amortization_schedule_line_id,periodId,expectedProposalHash:proposal.proposal_hash,attachmentIds:[source.attachment_id],
        reason:markedReason,idempotencyKey:`${key}:draft`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source,proposal});}
      if(!draft||draft.status!=='DRAFT'||draft.journal_type!=='MANUAL'||!UUID.test(draft.journal_entry_id||'')||draft.source_document_id!==source.source_document_id){
        fail('CONTROLLED_TEST_AI_DRAFT_INVALID','Controlled-test AI Draft returned an unsafe result.');
      }
      completedStage='DRAFT_CREATED';
      let submitted;try{submitted=await kernels.submitter.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`${key}:submit`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source,proposal,draft});}
      if(submitted?.status!=='PENDING_REVIEW')fail('CONTROLLED_TEST_AI_WORKFLOW_INVALID','Controlled-test AI Submit returned an unsafe state.');
      completedStage='SUBMITTED';
      let reviewed;try{reviewed=await kernels.reviewer.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`${key}:review`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source,proposal,draft});}
      if(reviewed?.status!=='PENDING_APPROVAL')fail('CONTROLLED_TEST_AI_WORKFLOW_INVALID','Controlled-test AI Review returned an unsafe state.');
      completedStage='REVIEWED';
      let approved;try{approved=await kernels.approver.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`${key}:approve`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source,proposal,draft});}
      if(approved?.status!=='APPROVED')fail('CONTROLLED_TEST_AI_WORKFLOW_INVALID','Controlled-test AI Approve returned an unsafe state.');
      completedStage='APPROVED';
      let posted;try{posted=await kernels.poster.postJournal({tenantId,entityId,periodId,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:`${key}:post`});}catch{return partialResult({completedStage,key,parentSourceDocumentId,source,proposal,draft});}
      if(!posted||posted.journal_entry_id!==draft.journal_entry_id||!UUID.test(posted.posting_batch_id||''))fail('CONTROLLED_TEST_AI_WORKFLOW_INVALID','Controlled-test AI Post returned an unsafe receipt.');
      return Object.freeze(assertControlledTestAiWorkflowResult({status:'CONTROLLED_TEST_AI_WORKFLOW_POSTED',test_only:true,provenance_mode:'UNSIGNED_TEST_ONLY',idempotent:posted.idempotent===true,
        parent_source_document_id:parentSourceDocumentId,source_document_id:source.source_document_id,ai_amortization_schedule_id:proposal.ai_amortization_schedule_id,
        journal_entry_id:draft.journal_entry_id,posting_batch_id:posted.posting_batch_id}));
    }
  });
}
