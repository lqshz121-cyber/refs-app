import {createHash} from 'node:crypto';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const ACTOR_ROLES=Object.freeze(['importer','reconciliationStarter','maker','paymentMaker','matchMaker','submitter','reviewer','approver','poster','clearer','reopener']);

export class ControlledTestBankMatchError extends Error{
  constructor(code,message){super(message);this.name='ControlledTestBankMatchError';this.code=code;}
}
const fail=(code,message)=>{throw new ControlledTestBankMatchError(code,message);};
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const safeRevision=value=>{const number=Number(value);return Number.isSafeInteger(number)&&number>=0?number:null;};
const exactId=value=>UUID.test(value||'');
const paymentNumber=idempotencyKey=>`WBS-MATCH-${createHash('sha256').update(idempotencyKey,'utf8').digest('hex').slice(0,32)}`;

export function assertControlledTestBankMatchResult(value){
  const keys=['bank_account_ref','bank_match_id','bank_source_id','business_document_id','currency','idempotent','journal_entry_id','journal_line_id','ledger_line_id','payment_amount','payment_occurrence_id','period_id','provenance_mode','revision','status','test_only'];
  if(!exactObject(value,keys)||value.status!=='CONTROLLED_TEST_BANK_MATCH_ACTIVE'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'
    ||value.bank_account_ref!=='WBS_TEST_BANK'||value.currency!=='USD'||!MONEY4.test(value.payment_amount||'')||value.payment_amount==='0.0000'
    ||!['period_id','bank_source_id','business_document_id','payment_occurrence_id','journal_entry_id','journal_line_id','ledger_line_id','bank_match_id'].every(key=>exactId(value[key]))
    ||value.revision!==0||typeof value.idempotent!=='boolean')fail('CONTROLLED_TEST_BANK_MATCH_RESULT_INVALID','Controlled test Bank Match result is incomplete or unsafe.');
  return value;
}

function assertConfiguration(scope){
  if(!scope||!exactId(scope.tenantId)||!exactId(scope.entityId)||scope.bankAccountRef!=='WBS_TEST_BANK'||scope.cashAccountCode!=='111000'
    ||!exactObject(scope.actors,ACTOR_ROLES)||ACTOR_ROLES.some(role=>typeof scope.actors[role]!=='string'||scope.actors[role].trim().length<3||scope.actors[role].trim().length>200)
    ||new Set(ACTOR_ROLES.map(role=>scope.actors[role].trim())).size!==ACTOR_ROLES.length)fail('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID','Controlled test Bank Match scope and actors are invalid.');
}

function assertFixture(row){
  const bankRevision=safeRevision(row?.bank_version),matchRevision=row?.active_match_revision==null?null:safeRevision(row.active_match_revision);
  if(!row||!exactId(row.period_id)||!exactId(row.bank_source_id)||bankRevision===null||row.bank_account_ref!=='WBS_TEST_BANK'
    ||!/^\d{4}-\d{2}-\d{2}$/.test(row.transaction_date||'')||row.currency!=='USD'||!MONEY4.test(String(row.payment_amount||''))||row.payment_amount==='0.0000'
    ||!exactId(row.business_document_id)||!/^WBS-TEST-[A-Z0-9]+$/.test(row.document_number||'')
    ||![row.active_bank_match_id,row.active_payment_occurrence_id,row.active_journal_entry_id,row.active_journal_line_id,row.active_ledger_line_id].every(value=>value===null||exactId(value))
    ||[row.active_payment_occurrence_id,row.active_journal_entry_id,row.active_journal_line_id,row.active_ledger_line_id].some(value=>(row.active_bank_match_id===null)!==(value===null))
    ||(row.active_bank_match_id===null)!==(matchRevision===null))fail('CONTROLLED_TEST_BANK_MATCH_FIXTURE_INVALID','The isolated WBS test Bank Match fixture is incomplete or unsafe.');
  return Object.freeze({...row,bank_version:bankRevision,active_match_revision:matchRevision,payment_amount:String(row.payment_amount)});
}

export function createControlledTestBankMatchService({kernelForActor,authorize,scope}={}){
  if(typeof kernelForActor!=='function'||typeof authorize!=='function')fail('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID','Controlled test Bank Match dependencies are unavailable.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  return Object.freeze({async run({tenantId,entityId,reason,idempotencyKey}={}){
    if(tenantId!==scope.tenantId||entityId!==scope.entityId||typeof reason!=='string'||reason!==reason.trim()||reason.length<8||reason.length>1700
      ||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>160)fail('CONTROLLED_TEST_BANK_MATCH_SELECTION_INVALID','Controlled test Bank Match requires its fixed entity, a review reason, and a stable request identity.');
    await authorize({tenantId,entityId});
    const kernels=Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
    const required={paymentMaker:['createApPayment','bindWbsTestBankMatchPaymentSource'],matchMaker:['resolveWbsTestBankMatchFixture','listBankMatchCandidates','createBankPaymentMatch','proposeWbsTestBankMatchConfig'],submitter:['transitionJournal'],reviewer:['approveWbsTestBankMatchConfig','transitionJournal'],approver:['transitionJournal'],poster:['postJournal']};
    for(const [role,methods] of Object.entries(required))if(!kernels[role]||methods.some(method=>typeof kernels[role][method]!=='function'))fail('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID',`Controlled test Bank Match ${role} kernel is unavailable.`);
    const fixture=assertFixture(await kernels.matchMaker.resolveWbsTestBankMatchFixture({tenantId,entityId}));
    const commandKey=`wbs-test-bank-match:${fixture.bank_source_id}`;
    const markedReason=`TEST_ONLY ${reason}`;
    const proposed=await kernels.matchMaker.proposeWbsTestBankMatchConfig({tenantId,entityId});
    if(!proposed||!exactId(proposed.setting_snapshot_id)||!exactId(proposed.mapping_snapshot_id)||!['DRAFT','APPROVED'].includes(proposed.status)||typeof proposed.idempotent!=='boolean')fail('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID','Controlled test Bank Match configuration proposal is incomplete or unsafe.');
    const config=await kernels.reviewer.approveWbsTestBankMatchConfig({tenantId,entityId,settingSnapshotId:proposed.setting_snapshot_id,mappingSnapshotId:proposed.mapping_snapshot_id});
    if(!config||config.setting_snapshot_id!==proposed.setting_snapshot_id||config.mapping_snapshot_id!==proposed.mapping_snapshot_id||config.status!=='APPROVED'||typeof config.idempotent!=='boolean')fail('CONTROLLED_TEST_BANK_MATCH_CONFIG_INVALID','Controlled test Bank Match configuration approval is incomplete or unsafe.');
    const payment=await kernels.paymentMaker.createApPayment({tenantId,entityId,businessDocumentId:fixture.business_document_id,periodId:fixture.period_id,
      paymentNumber:paymentNumber(commandKey),paymentDate:fixture.transaction_date,cashAccountCode:scope.cashAccountCode,bankMemberRef:fixture.bank_account_ref,
      amount:fixture.payment_amount,reason:markedReason,idempotencyKey:`${commandKey}:payment`});
    if(!payment||!exactId(payment.payment_occurrence_id)||!exactId(payment.journal_entry_id)||payment.business_document_id!==fixture.business_document_id)fail('CONTROLLED_TEST_BANK_MATCH_PAYMENT_INVALID','Controlled test AP payment did not retain exact fixture lineage.');
    const sourceBinding=await kernels.paymentMaker.bindWbsTestBankMatchPaymentSource({tenantId,entityId,businessDocumentId:fixture.business_document_id,
      paymentOccurrenceId:payment.payment_occurrence_id,journalEntryId:payment.journal_entry_id});
    if(!sourceBinding||!exactId(sourceBinding.staging_item_id)||!exactId(sourceBinding.source_link_id)||typeof sourceBinding.idempotent!=='boolean')fail('CONTROLLED_TEST_BANK_MATCH_PAYMENT_INVALID','Controlled test AP payment source linkage is incomplete or unsafe.');
    if(fixture.active_bank_match_id!==null){
      if(fixture.active_payment_occurrence_id!==payment.payment_occurrence_id||fixture.active_journal_entry_id!==payment.journal_entry_id||fixture.active_match_revision!==0)fail('CONTROLLED_TEST_BANK_MATCH_CONFLICT','The isolated WBS test Bank source already has a different active match.');
      return Object.freeze(assertControlledTestBankMatchResult({status:'CONTROLLED_TEST_BANK_MATCH_ACTIVE',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:true,
        period_id:fixture.period_id,bank_account_ref:fixture.bank_account_ref,bank_source_id:fixture.bank_source_id,business_document_id:fixture.business_document_id,
        payment_amount:fixture.payment_amount,currency:fixture.currency,payment_occurrence_id:payment.payment_occurrence_id,journal_entry_id:payment.journal_entry_id,
        journal_line_id:fixture.active_journal_line_id,ledger_line_id:fixture.active_ledger_line_id,bank_match_id:fixture.active_bank_match_id,revision:0}));
    }
    const submitted=await kernels.submitter.transitionJournal({tenantId,entityId,journalEntryId:payment.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`${commandKey}:submit`});
    if(submitted?.status!=='PENDING_REVIEW')fail('CONTROLLED_TEST_BANK_MATCH_WORKFLOW_INVALID','Controlled test AP payment Submit returned an unsafe state.');
    const reviewed=await kernels.reviewer.transitionJournal({tenantId,entityId,journalEntryId:payment.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`${commandKey}:review`});
    if(reviewed?.status!=='PENDING_APPROVAL')fail('CONTROLLED_TEST_BANK_MATCH_WORKFLOW_INVALID','Controlled test AP payment Review returned an unsafe state.');
    const approved=await kernels.approver.transitionJournal({tenantId,entityId,journalEntryId:payment.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`${commandKey}:approve`});
    if(approved?.status!=='APPROVED')fail('CONTROLLED_TEST_BANK_MATCH_WORKFLOW_INVALID','Controlled test AP payment Approve returned an unsafe state.');
    const posted=await kernels.poster.postJournal({tenantId,entityId,periodId:fixture.period_id,journalEntryId:payment.journal_entry_id,expectedRevision:3,idempotencyKey:`${commandKey}:post`});
    if(!posted||posted.journal_entry_id!==payment.journal_entry_id)fail('CONTROLLED_TEST_BANK_MATCH_WORKFLOW_INVALID','Controlled test AP payment Post returned an unsafe receipt.');
    const candidates=await kernels.matchMaker.listBankMatchCandidates({tenantId,entityId,bankSourceId:fixture.bank_source_id});
    const candidate=Array.isArray(candidates)&&candidates.length===1?candidates[0]:null;
    if(!candidate||candidate.payment_occurrence_id!==payment.payment_occurrence_id||candidate.journal_entry_id!==payment.journal_entry_id||safeRevision(candidate.occurrence_version)===null)fail('CONTROLLED_TEST_BANK_MATCH_CANDIDATE_INVALID','Exactly one posted payment candidate must match the isolated WBS Bank source.');
    const matched=await kernels.matchMaker.createBankPaymentMatch({tenantId,entityId,bankSourceId:fixture.bank_source_id,paymentOccurrenceId:payment.payment_occurrence_id,
      expectedBankVersion:fixture.bank_version,expectedOccurrenceVersion:safeRevision(candidate.occurrence_version),reason:markedReason,idempotencyKey:`${commandKey}:match`});
    return Object.freeze(assertControlledTestBankMatchResult({status:'CONTROLLED_TEST_BANK_MATCH_ACTIVE',test_only:true,provenance_mode:'CONTROLLED_TEST_UNSIGNED',idempotent:matched?.idempotent===true,
      period_id:fixture.period_id,bank_account_ref:fixture.bank_account_ref,bank_source_id:fixture.bank_source_id,business_document_id:fixture.business_document_id,
      payment_amount:fixture.payment_amount,currency:fixture.currency,payment_occurrence_id:payment.payment_occurrence_id,journal_entry_id:payment.journal_entry_id,
      journal_line_id:matched?.journal_line_id,ledger_line_id:matched?.ledger_line_id,bank_match_id:matched?.bank_match_id,revision:safeRevision(matched?.revision)}));
  }});
}
