import {assertWbsLivePilotResult} from './wbs-live-pilot-read-service.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const ACTOR_ROLES=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);
export const WBS_TEST_IMPORT_GRANT_BUNDLES=Object.freeze({
  importer:Object.freeze(['WBS.TEST.IMPORT']),
  maker:Object.freeze(['WBS.TEST.IMPORT','AP.BILL.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),
  reviewer:Object.freeze(['GL.JE.REVIEW']),
  approver:Object.freeze(['GL.JE.APPROVE']),
  poster:Object.freeze(['GL.JE.POST'])
});

export class WbsTestImportError extends Error{
  constructor(code,message){super(message);this.name='WbsTestImportError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsTestImportError(code,message);};
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};

function assertConfiguration({tenantId,entityId,companyCode,actors}={}){
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!/^[A-Z0-9][A-Z0-9_:-]{0,63}$/.test(companyCode||''))fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import scope is incomplete.');
  if(!exactObject(actors,ACTOR_ROLES)||ACTOR_ROLES.some(role=>typeof actors[role]!=='string'||actors[role].trim().length<3||actors[role].trim().length>200)||new Set(ACTOR_ROLES.map(role=>actors[role].trim())).size!==ACTOR_ROLES.length)fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import actors must be six distinct configured identities.');
}

function assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit}={},scope){
  if(tenantId!==scope.tenantId||entityId!==scope.entityId)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Test import is restricted to its configured tenant and entity.');
  if(!UUID.test(periodId||'')||companyCode!==scope.companyCode||!date(dateFrom)||!date(dateTo)||dateFrom>dateTo||!Number.isSafeInteger(limit)||limit<1||limit>10)fail('WBS_TEST_IMPORT_SELECTION_INVALID','Test import requires its configured company, one period, an ordered date range, and a limit from 1 to 10.');
}

function assertRow(row){
  if(!exactObject(row,['source_record_hash','currency','accounting_date','amount','status'])||!SHA256.test(row.source_record_hash||'')||row.currency!=='USD'||!date(row.accounting_date)||!MONEY4.test(row.amount||'')||row.amount==='0.0000'||row.amount==='-0.0000'||typeof row.status!=='string'||row.status.length<1||row.status.length>64)fail('WBS_TEST_IMPORT_ROW_INVALID','Sanitized WBS Payable row is incomplete or unsafe for the test-import path.');
}

function assertDraft(result){
  if(!result||result.status!=='DRAFT'||result.revision!==0||result.test_only!==true||result.provenance_mode!=='UNSIGNED_TEST_ONLY'||!UUID.test(result.business_document_id||'')||!UUID.test(result.journal_entry_id||'')||!UUID.test(result.source_document_id||'')||!UUID.test(result.attachment_id||''))fail('WBS_TEST_IMPORT_DRAFT_INVALID','Test-import persistence returned an unsafe Draft result.');
}
function assertPost(result,journalEntryId){
  const keys=Object.keys(result||{}).sort().join('\0'),closed=[['idempotent','journal_entry_id','posting_batch_id'],['idempotent','journal_entry_id','posting_batch_id','revision']].map(value=>value.sort().join('\0'));
  if(!result||!closed.includes(keys)||result.journal_entry_id!==journalEntryId||!UUID.test(result.posting_batch_id||'')||typeof result.idempotent!=='boolean'||(Object.hasOwn(result,'revision')&&result.revision!==4))fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Post returned an unsafe posting receipt.');
}

export function assertWbsTestImportResult(value){
  const keys=['failed_count','imported_count','posted_count','replayed_count','status','test_only'];
  if(!exactObject(value,keys)||value.status!=='WBS_TEST_PAYABLE_IMPORT_COMPLETE'||value.test_only!==true||!['failed_count','imported_count','posted_count','replayed_count'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||value.failed_count!==0||value.posted_count!==value.imported_count+value.replayed_count)fail('WBS_TEST_IMPORT_RESULT_INVALID','Test-import result is incomplete or unsafe.');
  return value;
}

export async function reconcileWbsTestImportActorGrants({grantSync,scope}={}){
  if(typeof grantSync?.reconcile!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import grant sync is unavailable.');
  assertConfiguration(scope);
  const results={};
  for(const role of ACTOR_ROLES){
    const permissions=[...WBS_TEST_IMPORT_GRANT_BUNDLES[role]];
    const result=await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId:scope.actors[role].trim(),permissions,expectedVersion:0,idempotencyKey:`wbs-test-import-${role}-grant-v1`});
    const returned=[...(result?.permissions||[])].sort(),expected=[...permissions].sort();
    if(returned.length!==expected.length||returned.some((value,index)=>value!==expected[index]))fail('WBS_TEST_IMPORT_GRANT_INVALID',`Test-import ${role} grant does not match its frozen permission bundle.`);
    results[role]=Object.freeze({version:result.version,idempotent:result.idempotent===true,permission_count:returned.length});
  }
  return Object.freeze(results);
}

export function createWbsTestImportService({pilotService,kernelForActor,scope}={}){
  if(!pilotService||typeof pilotService.readObservation!=='function'||typeof kernelForActor!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import dependencies are unavailable.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  return Object.freeze({
    async importPayables({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit,idempotencyKey}={}){
      assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit},scope);
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>160)fail('WBS_TEST_IMPORT_IDEMPOTENCY_REQUIRED','A bounded test-import idempotency key is required.');
      const observation=await pilotService.readObservation({tenantId,entityId,tool:'list_payables',limit,company_code:companyCode,date_from:dateFrom,date_to:dateTo});
      assertWbsLivePilotResult(observation,{entityId,tool:'list_payables',limit});
      if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider observation did not retain the configured test-import scope.');
      if(observation.rows.length===0)fail('WBS_TEST_IMPORT_EMPTY','The bounded WBS Payables observation contains no rows to import.');
      const hashes=new Set();for(const row of observation.rows){assertRow(row);if(hashes.has(row.source_record_hash))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider observation contains a duplicate sanitized Payable identity.');hashes.add(row.source_record_hash);}
      const kernels=Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
      const requiredMethods={importer:['finalizeWbsTestImportSource'],maker:['createWbsTestPayableDraft'],submitter:['transitionJournal'],reviewer:['transitionJournal'],approver:['transitionJournal'],poster:['postJournal']};
      for(const role of ACTOR_ROLES)if(!kernels[role]||requiredMethods[role].some(method=>typeof kernels[role][method]!=='function'))fail('WBS_TEST_IMPORT_CONFIG_INVALID',`Test-import ${role} kernel is unavailable.`);
      let imported=0,replayed=0,posted=0;
      for(const [rowIndex,row] of observation.rows.entries()){
        const key=`${idempotencyKey}:${rowIndex}`;
        const draft=await kernels.maker.createWbsTestPayableDraft({tenantId,entityId,periodId,observation,row,rowIndex,idempotencyKey:`${key}:draft`});assertDraft(draft);
        if(draft.idempotent===true)replayed++;else imported++;
        const submitted=await kernels.submitter.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`${key}:submit`});
        if(submitted?.status!=='PENDING_REVIEW')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Submit returned an unsafe state.');
        const reviewed=await kernels.reviewer.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`${key}:review`});
        if(reviewed?.status!=='PENDING_APPROVAL')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Review returned an unsafe state.');
        const approved=await kernels.approver.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`${key}:approve`});
        if(approved?.status!=='APPROVED')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Approve returned an unsafe state.');
        const post=await kernels.poster.postJournal({tenantId,entityId,periodId,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:`${key}:post`});
        assertPost(post,draft.journal_entry_id);
        const finalized=await kernels.importer.finalizeWbsTestImportSource({tenantId,entityId,sourceDocumentId:draft.source_document_id,businessDocumentId:draft.business_document_id,journalEntryId:draft.journal_entry_id,idempotencyKey:`${key}:finalize`});
        if(finalized?.status!=='POSTED'||finalized?.test_only!==true)fail('WBS_TEST_IMPORT_FINALIZE_INVALID','Test-import source finalization returned an unsafe result.');
        posted++;
      }
      return Object.freeze(assertWbsTestImportResult({status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:imported,replayed_count:replayed,posted_count:posted,failed_count:0,test_only:true}));
    }
  });
}
