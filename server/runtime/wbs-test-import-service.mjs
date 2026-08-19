import {assertWbsLivePilotResult} from './wbs-live-pilot-read-service.mjs';
import {createHash} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const ACTOR_ROLES=Object.freeze(['importer','maker','submitter','reviewer','approver','poster']);
const WBS_TEST_IMPORTER_V1_PERMISSIONS=Object.freeze(['WBS.TEST.IMPORT']);
const WBS_TEST_IMPORT_LEGACY_GRANT_BUNDLES=Object.freeze({
  importer:Object.freeze(['WBS.TEST.IMPORT','BANK.RECONCILIATION.START']),
  maker:Object.freeze(['WBS.TEST.IMPORT','AP.BILL.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),reviewer:Object.freeze(['GL.JE.REVIEW']),approver:Object.freeze(['GL.JE.APPROVE']),poster:Object.freeze(['GL.JE.POST'])
});
export const WBS_TEST_IMPORT_GRANT_BUNDLES=Object.freeze({
  importer:Object.freeze(['WBS.TEST.IMPORT','BANK.RECONCILIATION.START','BANK.VIEW','BANK.MATCH.CREATE']),
  maker:Object.freeze(['WBS.TEST.IMPORT','AP.BILL.CREATE','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),
  reviewer:Object.freeze(['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW']),
  approver:Object.freeze(['GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF']),
  poster:Object.freeze(['GL.JE.POST','BANK.RECONCILIATION.CLEAR','BANK.RECONCILIATION.REOPEN'])
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

function assertBankRow(row){
  if(!exactObject(row,['source_record_hash','currency','accounting_date','amount','direction','status'])||!SHA256.test(row.source_record_hash||'')||row.currency!=='USD'||!date(row.accounting_date)||!MONEY4.test(row.amount||'')||row.amount==='0.0000'||row.amount==='-0.0000'||!['DEBIT','CREDIT'].includes(row.direction)||typeof row.status!=='string'||row.status.length<1||row.status.length>64)fail('WBS_TEST_BANK_ROW_INVALID','Sanitized WBS Bank row is incomplete or unsafe for the controlled test bridge.');
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


export function assertWbsControlledTestBankResult(value){
  const keys=['bank_account_ref','bank_source_ids','idempotent','provenance_mode','reconciliation_id','statement_ending_date','status','test_only','transaction_count','wbs_controlled_test_bank_import_id'];
  if(!exactObject(value,keys)||!/^WBS_TEST_BANK(?:_2026_0[1-6])?$/.test(value.bank_account_ref||'')||!UUID.test(value.wbs_controlled_test_bank_import_id||'')||!UUID.test(value.reconciliation_id||'')||!date(value.statement_ending_date)||value.status!=='DRAFT'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!Number.isSafeInteger(value.transaction_count)||value.transaction_count<1||value.transaction_count>500||!Array.isArray(value.bank_source_ids)||value.bank_source_ids.length!==value.transaction_count||value.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(value.bank_source_ids).size!==value.bank_source_ids.length)fail('WBS_TEST_BANK_RESULT_INVALID','Controlled test Bank result is incomplete or unsafe.');
  return value;
}

export function assertWbsTestRangeImportResult(value){
  const top=['bank','date_from','date_to','page_size','payables','status','test_only'];
  const payableKeys=['imported_count','page_count','posted_count','record_count','replayed_count'];
  const bankKeys=['bank_source_ids','provider_page_count','reconciliations','record_count'];
  if(!exactObject(value,top)||value.status!=='WBS_TEST_RANGE_IMPORT_COMPLETE'||value.test_only!==true||!date(value.date_from)||!date(value.date_to)||value.date_from>value.date_to||value.page_size!==10||!exactObject(value.payables,payableKeys)||!exactObject(value.bank,bankKeys))fail('WBS_TEST_RANGE_RESULT_INVALID','Test range-import result is incomplete or unsafe.');
  if(!['imported_count','page_count','posted_count','record_count','replayed_count'].every(key=>Number.isSafeInteger(value.payables[key])&&value.payables[key]>=0)||value.payables.posted_count!==value.payables.imported_count+value.payables.replayed_count)fail('WBS_TEST_RANGE_RESULT_INVALID','Test range-import Payables totals are invalid.');
  if(!Number.isSafeInteger(value.bank.provider_page_count)||value.bank.provider_page_count<0||value.bank.provider_page_count>50||!Number.isSafeInteger(value.bank.record_count)||value.bank.record_count<0||value.bank.record_count>500||!Array.isArray(value.bank.reconciliations)||value.bank.reconciliations.length>6||value.bank.reconciliations.some(row=>!exactObject(row,['bank_account_ref','period_code','period_id','reconciliation_id','transaction_count'])||!/^2026-0[1-6]$/.test(row.period_code||'')||row.bank_account_ref!==`WBS_TEST_BANK_${row.period_code.replace('-','_')}`||!UUID.test(row.period_id||'')||!UUID.test(row.reconciliation_id||'')||!Number.isSafeInteger(row.transaction_count)||row.transaction_count<1||row.transaction_count>500)||new Set(value.bank.reconciliations.map(row=>row.period_code)).size!==value.bank.reconciliations.length||value.bank.reconciliations.reduce((sum,row)=>sum+row.transaction_count,0)!==value.bank.record_count||!Array.isArray(value.bank.bank_source_ids)||value.bank.bank_source_ids.length!==value.bank.record_count||value.bank.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(value.bank.bank_source_ids).size!==value.bank.bank_source_ids.length)fail('WBS_TEST_RANGE_RESULT_INVALID','Test range-import Bank totals are invalid.');
  return value;
}

export async function reconcileWbsTestImportActorGrants({grantSync,scope}={}){
  if(typeof grantSync?.reconcile!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import grant sync is unavailable.');
  assertConfiguration(scope);
  const results={};
  for(const role of ACTOR_ROLES){
    const permissions=[...WBS_TEST_IMPORT_GRANT_BUNDLES[role]];
    const actorId=scope.actors[role].trim();
    if(role==='importer'){
      const bootstrap=await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions:[...WBS_TEST_IMPORTER_V1_PERMISSIONS],expectedVersion:0,idempotencyKey:'wbs-test-import-importer-grant-v1'});
      const returned=[...(bootstrap?.permissions||[])].sort(),expected=[...WBS_TEST_IMPORTER_V1_PERMISSIONS].sort();
      if(returned.length!==expected.length||returned.some((value,index)=>value!==expected[index]))fail('WBS_TEST_IMPORT_GRANT_INVALID','Test-import importer v1 bootstrap grant is not exact.');
    }
    const legacyVersion=role==='importer'?2:1,legacyPermissions=[...WBS_TEST_IMPORT_LEGACY_GRANT_BUNDLES[role]];
    const legacy=await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions:legacyPermissions,expectedVersion:legacyVersion-1,idempotencyKey:`wbs-test-import-${role}-grant-v${legacyVersion}`});
    const legacyReturned=[...(legacy?.permissions||[])].sort(),legacyExpected=[...legacyPermissions].sort();
    if(legacyReturned.length!==legacyExpected.length||legacyReturned.some((value,index)=>value!==legacyExpected[index]))fail('WBS_TEST_IMPORT_GRANT_INVALID',`Test-import ${role} legacy grant does not match its frozen permission bundle.`);
    const version=legacyVersion+1;
    const result=await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions,expectedVersion:legacyVersion,idempotencyKey:`wbs-test-import-${role}-grant-v${version}`});
    const returned=[...(result?.permissions||[])].sort(),expected=[...permissions].sort();
    if(returned.length!==expected.length||returned.some((value,index)=>value!==expected[index]))fail('WBS_TEST_IMPORT_GRANT_INVALID',`Test-import ${role} grant does not match its frozen permission bundle.`);
    results[role]=Object.freeze({version:result.version,idempotent:result.idempotent===true,permission_count:returned.length});
  }
  return Object.freeze(results);
}

export function createWbsTestImportService({pilotService,kernelForActor,authorizeBank,scope}={}){
  if(!pilotService||typeof pilotService.readObservation!=='function'||typeof kernelForActor!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import dependencies are unavailable.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  const kernels=()=>Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
  const assertPayableKernels=value=>{
    const required={importer:['finalizeWbsTestImportSource'],maker:['createWbsTestPayableDraft'],submitter:['transitionJournal'],reviewer:['transitionJournal'],approver:['transitionJournal'],poster:['postJournal']};
    for(const role of ACTOR_ROLES)if(!value[role]||required[role].some(method=>typeof value[role][method]!=='function'))fail('WBS_TEST_IMPORT_CONFIG_INVALID',`Test-import ${role} kernel is unavailable.`);
  };
  const importPayableObservation=async({tenantId,entityId,periodId,periodIdForDate=null,observation,idempotencyKey,kernelSet})=>{
    let imported=0,replayed=0,posted=0;
    for(const [rowIndex,row] of observation.rows.entries()){
      const key=`${idempotencyKey}:${row.source_record_hash.slice(7,31)}`;
      const rowPeriodId=periodIdForDate?periodIdForDate(row.accounting_date):periodId;
      if(!UUID.test(rowPeriodId||''))fail('WBS_TEST_IMPORT_SELECTION_INVALID','No exact OPEN test period exists for a Payable source date.');
      const draft=await kernelSet.maker.createWbsTestPayableDraft({tenantId,entityId,periodId:rowPeriodId,observation,row,rowIndex,idempotencyKey:`${key}:draft`});assertDraft(draft);
      if(draft.idempotent===true)replayed++;else imported++;
      const submitted=await kernelSet.submitter.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`${key}:submit`});
      if(submitted?.status!=='PENDING_REVIEW')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Submit returned an unsafe state.');
      const reviewed=await kernelSet.reviewer.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`${key}:review`});
      if(reviewed?.status!=='PENDING_APPROVAL')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Review returned an unsafe state.');
      const approved=await kernelSet.approver.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`${key}:approve`});
      if(approved?.status!=='APPROVED')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Approve returned an unsafe state.');
      const post=await kernelSet.poster.postJournal({tenantId,entityId,periodId:rowPeriodId,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:`${key}:post`});assertPost(post,draft.journal_entry_id);
      const finalized=await kernelSet.importer.finalizeWbsTestImportSource({tenantId,entityId,sourceDocumentId:draft.source_document_id,businessDocumentId:draft.business_document_id,journalEntryId:draft.journal_entry_id,idempotencyKey:`${key}:finalize`});
      if(finalized?.status!=='POSTED'||finalized?.test_only!==true)fail('WBS_TEST_IMPORT_FINALIZE_INVALID','Test-import source finalization returned an unsafe result.');
      posted++;
    }
    return {imported,replayed,posted};
  };
  return Object.freeze({
    async importPayables({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit,idempotencyKey}={}){
      assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit},scope);
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>160)fail('WBS_TEST_IMPORT_IDEMPOTENCY_REQUIRED','A bounded test-import idempotency key is required.');
      const observation=await pilotService.readObservation({tenantId,entityId,tool:'list_payables',limit,company_code:companyCode,date_from:dateFrom,date_to:dateTo});
      assertWbsLivePilotResult(observation,{entityId,tool:'list_payables',limit});
      if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider observation did not retain the configured test-import scope.');
      if(observation.rows.length===0)fail('WBS_TEST_IMPORT_EMPTY','The bounded WBS Payables observation contains no rows to import.');
      const hashes=new Set();for(const row of observation.rows){assertRow(row);if(hashes.has(row.source_record_hash))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider observation contains a duplicate sanitized Payable identity.');hashes.add(row.source_record_hash);}
      const kernelSet=kernels();assertPayableKernels(kernelSet);
      const {imported,replayed,posted}=await importPayableObservation({tenantId,entityId,periodId,observation,idempotencyKey,kernelSet});
      return Object.freeze(assertWbsTestImportResult({status:'WBS_TEST_PAYABLE_IMPORT_COMPLETE',imported_count:imported,replayed_count:replayed,posted_count:posted,failed_count:0,test_only:true}));
    },
    async importBankTransactions({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit,idempotencyKey}={}){
      assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit},scope);
      if(typeof authorizeBank!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Controlled test Bank caller authorization is unavailable.');
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>160)fail('WBS_TEST_IMPORT_IDEMPOTENCY_REQUIRED','A bounded test-import idempotency key is required.');
      await authorizeBank({tenantId,entityId});
      const observation=await pilotService.readObservation({tenantId,entityId,tool:'list_bank_transactions',limit,company_code:companyCode,date_from:dateFrom,date_to:dateTo});
      assertWbsLivePilotResult(observation,{entityId,tool:'list_bank_transactions',limit});
      if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider Bank observation did not retain the configured test-import scope.');
      if(observation.rows.length===0)fail('WBS_TEST_IMPORT_EMPTY','The bounded WBS Bank observation contains no rows to import.');
      const hashes=new Set();for(const row of observation.rows){assertBankRow(row);if(hashes.has(row.source_record_hash))fail('WBS_TEST_BANK_ROW_INVALID','Provider observation contains a duplicate sanitized Bank identity.');hashes.add(row.source_record_hash);}
      const importer=kernelForActor(actors.importer);
      if(!importer||typeof importer.createWbsControlledTestBankScope!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Controlled test Bank importer kernel is unavailable.');
      const result=await importer.createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef:'WBS_TEST_BANK',idempotencyKey});
      return Object.freeze(assertWbsControlledTestBankResult(result));
    },
    async importRange({tenantId,entityId,companyCode,dateFrom,dateTo,pageSize=10,maxPages=50,idempotencyKey}={}){
      if(tenantId!==scope.tenantId||entityId!==scope.entityId)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Test import is restricted to its configured tenant and entity.');
      if(companyCode!==scope.companyCode||dateFrom!=='2026-01-01'||dateTo!=='2026-06-30'||pageSize!==10)fail('WBS_TEST_IMPORT_SELECTION_INVALID','The range import is restricted to the exact 2026 H1 test window and ten-row provider pages.');
      if(typeof pilotService.readObservationPage!=='function'||typeof authorizeBank!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Paged WBS test-import dependencies are unavailable.');
      if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>50||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>80)fail('WBS_TEST_IMPORT_SELECTION_INVALID','Paged test import requires maxPages from 1 to 50 and one bounded idempotency key.');
      await authorizeBank({tenantId,entityId});
      const readPages=async(tool,rowValidator)=>{
        const pages=[],sourceHashes=new Set(),cursors=new Set();let cursor=null,snapshotToken=null,frozenIdentity=null,lastStableKey=null;
        for(let pageIndex=0;pageIndex<maxPages;pageIndex++){
          const page=await pilotService.readObservationPage({tenantId,entityId,tool,limit:10,company_code:companyCode,date_from:dateFrom,date_to:dateTo,cursor,snapshot_token:snapshotToken});
          if(!exactObject(page,['cursor_next','observation','pagination'])||!exactObject(page.pagination,['captured_at','contract_version','environment','first_stable_key','last_stable_key','snapshot_token','source_hash']))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider page envelope is invalid.');
          // captured_at is per HTTP read in the Provider V2 keyset contract,
          // not a snapshot identity.  Freeze only the published source and
          // contract identity plus an optional provider token.  A token, when
          // present, must remain exact across every page.
          const identity={contract_version:page.pagination.contract_version,environment:page.pagination.environment,source_hash:page.pagination.source_hash,snapshot_token:page.pagination.snapshot_token};
          if(pageIndex===0){frozenIdentity=identity;snapshotToken=page.pagination.snapshot_token;}else if(!exactObject(identity,Object.keys(frozenIdentity))||Object.keys(frozenIdentity).some(key=>identity[key]!==frozenIdentity[key]))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider pagination snapshot identity changed during the range read.');
          if(page.pagination.first_stable_key!==null&&lastStableKey!==null&&!(lastStableKey<page.pagination.first_stable_key))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider pagination stable keys are duplicated or out of order.');
          if(page.pagination.last_stable_key!==null)lastStableKey=page.pagination.last_stable_key;
          const observation=assertWbsLivePilotResult(page.observation,{entityId,tool,limit:pageSize});
          if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider page did not retain the configured test-import scope.');
          if(observation.rows.length===0&&page.cursor_next!==null)fail('WBS_TEST_IMPORT_ROW_INVALID','Provider returned an empty non-terminal WBS page.');
          for(const row of observation.rows){rowValidator(row);if(row.accounting_date<dateFrom||row.accounting_date>dateTo||sourceHashes.has(row.source_record_hash))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider range contains an out-of-range or duplicate sanitized source identity.');sourceHashes.add(row.source_record_hash);}
          if(observation.rows.length)pages.push(observation);
          if(page.cursor_next===null)return pages;
          if(cursors.has(page.cursor_next))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider repeated a WBS pagination cursor.');
          cursors.add(page.cursor_next);cursor=page.cursor_next;
        }
        fail('WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED','WBS range exceeds the configured 500-row test import bound.');
      };
      const [payablePages,bankPages]=await Promise.all([readPages('list_payables',assertRow),readPages('list_bank_transactions',assertBankRow)]);
      if(payablePages.length===0&&bankPages.length===0)fail('WBS_TEST_IMPORT_EMPTY','The selected WBS range contains no Payable or Bank rows.');
      const kernelSet=kernels();assertPayableKernels(kernelSet);
      const importer=kernelSet.importer;
      if(typeof importer?.ensureWbsTestH12026Periods!=='function'||typeof importer?.createWbsControlledTestBankScope!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','H1 period and controlled Bank importer kernels are unavailable.');
      const periodResult=await importer.ensureWbsTestH12026Periods({tenantId,entityId});
      if(!exactObject(periodResult,['periods','status','test_only'])||periodResult.status!=='WBS_TEST_H1_PERIODS_READY'||periodResult.test_only!==true||!Array.isArray(periodResult.periods)||periodResult.periods.length!==6)fail('WBS_TEST_H1_PERIODS_INVALID','H1 test periods were not prepared exactly.');
      const periodByCode=new Map();
      for(let month=1;month<=6;month++){
        const code=`2026-${String(month).padStart(2,'0')}`,last=new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10),row=periodResult.periods[month-1];
        if(!exactObject(row,['ends_on','period_code','period_id','starts_on'])||row.period_code!==code||row.starts_on!==`${code}-01`||row.ends_on!==last||!UUID.test(row.period_id||'')||periodByCode.has(code))fail('WBS_TEST_H1_PERIODS_INVALID','H1 test periods were not prepared exactly.');
        periodByCode.set(code,row.period_id);
      }
      const periodIdForDate=value=>periodByCode.get(value.slice(0,7));
      let imported=0,replayed=0,posted=0;
      for(const [pageIndex,observation] of payablePages.entries()){const totals=await importPayableObservation({tenantId,entityId,periodIdForDate,observation,idempotencyKey:`${idempotencyKey}:p${pageIndex}`,kernelSet});imported+=totals.imported;replayed+=totals.replayed;posted+=totals.posted;}
      const bankRows=bankPages.flatMap(page=>page.rows),reconciliations=[],bankSourceIds=[];
      for(const [periodCode,periodId] of periodByCode){
        const rows=bankRows.filter(row=>row.accounting_date.startsWith(periodCode));if(!rows.length)continue;
        const relevantPages=bankPages.filter(page=>page.rows.some(row=>row.accounting_date.startsWith(periodCode)));
        const pageTrace=relevantPages.map(page=>({observation_hash:page.observation_hash,provider_content_sha256:page.provider_content_sha256,record_count:page.record_count}));
        const combinedProviderHash=createHash('sha256').update(canonicalRequestBody(pageTrace),'utf8').digest('hex');
        const first=relevantPages[0],core={...first,captured_at:relevantPages.at(-1).captured_at,provider_content_sha256:combinedProviderHash,record_count:rows.length,rows};delete core.observation_hash;
        const hashCore={...core};delete hashCore.captured_at;
        const observation=Object.freeze({...core,observation_hash:`sha256:${createHash('sha256').update(canonicalRequestBody(hashCore),'utf8').digest('hex')}`});
        const bankAccountRef=`WBS_TEST_BANK_${periodCode.replace('-','_')}`;
        const result=assertWbsControlledTestBankResult(await importer.createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef,idempotencyKey:`${idempotencyKey}:bank:${periodCode}`}));
        reconciliations.push({bank_account_ref:bankAccountRef,period_code:periodCode,period_id:periodId,reconciliation_id:result.reconciliation_id,transaction_count:result.transaction_count});bankSourceIds.push(...result.bank_source_ids);
      }
      return Object.freeze(assertWbsTestRangeImportResult({status:'WBS_TEST_RANGE_IMPORT_COMPLETE',date_from:dateFrom,date_to:dateTo,page_size:pageSize,payables:{page_count:payablePages.length,record_count:payablePages.reduce((sum,page)=>sum+page.record_count,0),imported_count:imported,replayed_count:replayed,posted_count:posted},bank:{provider_page_count:bankPages.length,record_count:bankSourceIds.length,reconciliations,bank_source_ids:bankSourceIds},test_only:true}));
    }
  });
}
