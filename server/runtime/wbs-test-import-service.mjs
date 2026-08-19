import {assertWbsLivePilotResult} from './wbs-live-pilot-read-service.mjs';
import {createHash} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const WBS_TEST_MONTH_MAX_ROWS=10000;
const WBS_TEST_MONTH_MAX_PAGES=1000;
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
  if(!exactObject(value,keys)||!/^WBS_TEST_BANK(?:_2026_0[1-6])?$/.test(value.bank_account_ref||'')||!UUID.test(value.wbs_controlled_test_bank_import_id||'')||!UUID.test(value.reconciliation_id||'')||!date(value.statement_ending_date)||value.status!=='DRAFT'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!Number.isSafeInteger(value.transaction_count)||value.transaction_count<1||value.transaction_count>WBS_TEST_MONTH_MAX_ROWS||!Array.isArray(value.bank_source_ids)||value.bank_source_ids.length!==value.transaction_count||value.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(value.bank_source_ids).size!==value.bank_source_ids.length)fail('WBS_TEST_BANK_RESULT_INVALID','Controlled test Bank result is incomplete or unsafe.');
  return value;
}

export function assertWbsTestRangeImportResult(value){
  const top=['bank','date_from','date_to','page_size','payables','period_code','status','test_only'];
  const payableKeys=['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'];
  const bankKeys=['bank_source_ids','provider_page_count','reconciliation','record_count'];
  if(!exactObject(value,top)||value.status!=='WBS_TEST_MONTH_IMPORT_COMPLETE'||value.test_only!==true||!/^2026-0[1-6]$/.test(value.period_code||'')||value.date_from!==`${value.period_code}-01`||value.date_to!==new Date(Date.UTC(2026,Number(value.period_code.slice(5,7)),0)).toISOString().slice(0,10)||value.page_size!==10||!exactObject(value.payables,payableKeys)||!exactObject(value.bank,bankKeys))fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import result is incomplete or unsafe.');
  const payable=value.payables;
  if(!['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'].every(key=>Number.isSafeInteger(payable[key])&&payable[key]>=0)||payable.provider_page_count>WBS_TEST_MONTH_MAX_PAGES||payable.h1_record_count>WBS_TEST_MONTH_MAX_ROWS||payable.record_count>payable.h1_record_count||payable.posted_count!==payable.imported_count+payable.replayed_count||payable.posted_count!==payable.record_count)fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import Payables totals are invalid.');
  const bank=value.bank,reconciliation=bank.reconciliation;
  if(!Number.isSafeInteger(bank.provider_page_count)||bank.provider_page_count<0||bank.provider_page_count>WBS_TEST_MONTH_MAX_PAGES||!Number.isSafeInteger(bank.record_count)||bank.record_count<0||bank.record_count>WBS_TEST_MONTH_MAX_ROWS||!Array.isArray(bank.bank_source_ids)||bank.bank_source_ids.length!==bank.record_count||bank.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(bank.bank_source_ids).size!==bank.bank_source_ids.length||(bank.record_count===0?reconciliation!==null:!exactObject(reconciliation,['bank_account_ref','period_code','period_id','reconciliation_id','transaction_count'])||reconciliation.period_code!==value.period_code||reconciliation.bank_account_ref!==`WBS_TEST_BANK_${value.period_code.replace('-','_')}`||!UUID.test(reconciliation.period_id||'')||!UUID.test(reconciliation.reconciliation_id||'')||reconciliation.transaction_count!==bank.record_count))fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import Bank totals are invalid.');
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
  const PAYABLE_CONCURRENCY=4;
  const importPayableObservation=async({tenantId,entityId,periodId,periodIdForDate=null,observation,rowIndexes=null,idempotencyKey,kernelSet})=>{
    const jobs=observation.rows.map((row,rowIndex)=>({row,rowIndex})).filter(({rowIndex})=>rowIndexes===null||rowIndexes.has(rowIndex));
    const prepareRow=async({row,rowIndex})=>{
      const key=`${idempotencyKey}:${row.source_record_hash.slice(7,31)}`;
      const rowPeriodId=periodIdForDate?periodIdForDate(row.accounting_date):periodId;
      if(!UUID.test(rowPeriodId||''))fail('WBS_TEST_IMPORT_SELECTION_INVALID','No exact OPEN test period exists for a Payable source date.');
      const draft=await kernelSet.maker.createWbsTestPayableDraft({tenantId,entityId,periodId:rowPeriodId,observation,row,rowIndex,idempotencyKey:`${key}:draft`});assertDraft(draft);
      return {draft,key,rowPeriodId,imported:draft.idempotent===true?0:1,replayed:draft.idempotent===true?1:0};
    };
    const completeRow=async({draft,key,rowPeriodId})=>{
      const submitted=await kernelSet.submitter.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'SUBMIT',expectedRevision:0,idempotencyKey:`${key}:submit`});
      if(submitted?.status!=='PENDING_REVIEW')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Submit returned an unsafe state.');
      const reviewed=await kernelSet.reviewer.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'REVIEW',expectedRevision:1,idempotencyKey:`${key}:review`});
      if(reviewed?.status!=='PENDING_APPROVAL')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Review returned an unsafe state.');
      const approved=await kernelSet.approver.transitionJournal({tenantId,entityId,journalEntryId:draft.journal_entry_id,action:'APPROVE',expectedRevision:2,idempotencyKey:`${key}:approve`});
      if(approved?.status!=='APPROVED')fail('WBS_TEST_IMPORT_WORKFLOW_INVALID','Test-import Approve returned an unsafe state.');
      const post=await kernelSet.poster.postJournal({tenantId,entityId,periodId:rowPeriodId,journalEntryId:draft.journal_entry_id,expectedRevision:3,idempotencyKey:`${key}:post`});assertPost(post,draft.journal_entry_id);
      const finalized=await kernelSet.importer.finalizeWbsTestImportSource({tenantId,entityId,sourceDocumentId:draft.source_document_id,businessDocumentId:draft.business_document_id,journalEntryId:draft.journal_entry_id,idempotencyKey:`${key}:finalize`});
      if(finalized?.status!=='POSTED'||finalized?.test_only!==true)fail('WBS_TEST_IMPORT_FINALIZE_INVALID','Test-import source finalization returned an unsafe result.');
      return 1;
    };
    const completeRowWithRetry=async(row,slot)=>{
      for(let attempt=0;;attempt++){
        try{return await completeRow(row);}
        catch(error){
          if(error?.code!=='40001'||attempt>=3)throw error;
          // The same-period lifecycle shares SERIALIZABLE period reads.  Every
          // stage has a stable child receipt, so a bounded desynchronised retry
          // safely replays committed stages after the other workers advance.
          await new Promise(resolve=>setTimeout(resolve,50*2**attempt+slot*10));
        }
      }
    };
    // v168 touches shared vendor/account/period facts under SERIALIZABLE while
    // creating each Draft.  Keep that boundary ordered, then overlap only the
    // journal lifecycle, whose rows and idempotency keys are source-specific.
    const prepared=[];
    for(const job of jobs)prepared.push(await prepareRow(job));
    const totals={imported:prepared.reduce((sum,row)=>sum+row.imported,0),replayed:prepared.reduce((sum,row)=>sum+row.replayed,0),posted:0};
    for(let offset=0;offset<prepared.length;offset+=PAYABLE_CONCURRENCY){
      const settled=await Promise.allSettled(prepared.slice(offset,offset+PAYABLE_CONCURRENCY).map((row,slot)=>completeRowWithRetry(row,slot)));
      const failedIndex=settled.findIndex(result=>result.status==='rejected');
      if(failedIndex!==-1)throw settled[failedIndex].reason;
      for(const result of settled)totals.posted+=result.value;
    }
    return totals;
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
    async importRange({tenantId,entityId,companyCode,dateFrom,dateTo,pageSize=10,maxPages=WBS_TEST_MONTH_MAX_PAGES,idempotencyKey}={}){
      if(tenantId!==scope.tenantId||entityId!==scope.entityId)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Test import is restricted to its configured tenant and entity.');
      const periodCode=typeof dateFrom==='string'?dateFrom.slice(0,7):'',month=/^2026-0[1-6]$/.test(periodCode)?Number(periodCode.slice(5,7)):0,monthEnd=month?new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10):null;
      if(companyCode!==scope.companyCode||dateFrom!==`${periodCode}-01`||dateTo!==monthEnd||pageSize!==10)fail('WBS_TEST_IMPORT_SELECTION_INVALID','The month import requires one exact 2026 H1 calendar month and ten-row provider pages.');
      if(typeof pilotService.readObservationPage!=='function'||typeof authorizeBank!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Paged WBS test-import dependencies are unavailable.');
      if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>WBS_TEST_MONTH_MAX_PAGES||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>80)fail('WBS_TEST_IMPORT_SELECTION_INVALID','Paged month import requires bounded pages and one idempotency key.');
      await authorizeBank({tenantId,entityId});
      const readPages=async(tool,rowValidator,readFrom,readTo,includeRow=()=>true,aggregateBinding=null)=>{
        const pages=[],sourceHashes=new Set(),cursors=new Set();let cursor=null,snapshotToken=null,frozenIdentity=null;
        const normalize=()=>{
          if(!pages.length)return {pages:[],providerPageCount:0,providerRecordCount:0};
          // Provider cursors define traversal, not global stable-key ordering.
          // After every authenticated page has been exhausted and duplicate
          // identities rejected, make TEST_ONLY writes deterministic by the
          // sanitized source identity and re-page to the DB's ten-row bound.
          const rows=pages.flatMap(page=>page.rows).filter(includeRow).sort((left,right)=>left.source_record_hash<right.source_record_hash?-1:left.source_record_hash>right.source_record_hash?1:0),base=pages[0];
          const providerContentSha256=createHash('sha256').update(canonicalRequestBody({schema_version:base.schema_version,source_system:base.source_system,tool:base.tool,environment:base.environment,entity_id:base.entity_id,scope:base.scope,selection:aggregateBinding,rows}),'utf8').digest('hex');
          const capturedAt=`${dateTo}T23:59:59.000Z`,normalized=[];
          for(let offset=0;offset<rows.length;offset+=pageSize){
            const chunk=rows.slice(offset,offset+pageSize),core={...base,captured_at:capturedAt,provider_content_sha256:providerContentSha256,record_count:chunk.length,rows:chunk};delete core.observation_hash;
            const hashCore={...core};delete hashCore.captured_at;
            normalized.push(Object.freeze({...core,observation_hash:`sha256:${createHash('sha256').update(canonicalRequestBody(hashCore),'utf8').digest('hex')}`}));
          }
          return {pages:normalized,providerPageCount:pages.length,providerRecordCount:sourceHashes.size};
        };
        for(let pageIndex=0;pageIndex<maxPages;pageIndex++){
          const page=await pilotService.readObservationPage({tenantId,entityId,tool,limit:10,company_code:companyCode,date_from:readFrom,date_to:readTo,cursor,snapshot_token:snapshotToken});
          if(!exactObject(page,['cursor_next','observation','pagination'])||!exactObject(page.pagination,['captured_at','contract_version','environment','first_stable_key','last_stable_key','snapshot_token','source_hash']))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider page envelope is invalid.');
          // captured_at is per HTTP read in the Provider V2 keyset contract,
          // not a snapshot identity.  Freeze only the published source and
          // contract identity plus an optional provider token.  A token, when
          // present, must remain exact across every page.
          const identity={contract_version:page.pagination.contract_version,environment:page.pagination.environment,source_hash:page.pagination.source_hash,snapshot_token:page.pagination.snapshot_token};
          if(pageIndex===0){frozenIdentity=identity;snapshotToken=page.pagination.snapshot_token;}else if(!exactObject(identity,Object.keys(frozenIdentity))||Object.keys(frozenIdentity).some(key=>identity[key]!==frozenIdentity[key]))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider pagination snapshot identity changed during the range read.');
          const observation=assertWbsLivePilotResult(page.observation,{entityId,tool,limit:pageSize});
          if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==readFrom||observation.scope.date_range[1]!==readTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider page did not retain the configured test-import scope.');
          if(observation.rows.length===0&&page.cursor_next!==null)fail('WBS_TEST_IMPORT_ROW_INVALID','Provider returned an empty non-terminal WBS page.');
          for(const row of observation.rows){rowValidator(row);if(row.accounting_date<'2026-01-01'||row.accounting_date>'2026-06-30'||sourceHashes.has(row.source_record_hash))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider range contains an out-of-H1 or duplicate sanitized source identity.');sourceHashes.add(row.source_record_hash);if(sourceHashes.size>WBS_TEST_MONTH_MAX_ROWS)fail('WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED','WBS range exceeds the bounded 10,000-row import capacity.');}
          if(observation.rows.length)pages.push(observation);
          if(page.cursor_next===null)return normalize();
          if(cursors.has(page.cursor_next))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider repeated a WBS pagination cursor.');
          cursors.add(page.cursor_next);cursor=page.cursor_next;
        }
        fail('WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED','WBS month exceeds the configured 1,000-page import bound.');
      };
      const [payableRead,bankRead]=await Promise.all([readPages('list_payables',assertRow,'2026-01-01','2026-06-30',row=>row.accounting_date>=dateFrom&&row.accounting_date<=dateTo,{period_code:periodCode,date_from:dateFrom,date_to:dateTo}),readPages('list_bank_transactions',assertBankRow,dateFrom,dateTo)]),payablePages=payableRead.pages,bankPages=bankRead.pages;
      if(payablePages.length===0&&bankPages.length===0)fail('WBS_TEST_IMPORT_EMPTY','The selected WBS month contains no Payable or Bank rows.');
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
      const periodId=periodByCode.get(periodCode),payableRecordCount=payablePages.reduce((sum,page)=>sum+page.record_count,0);
      let imported=0,replayed=0,posted=0;
      for(const observation of payablePages){
        const totals=await importPayableObservation({tenantId,entityId,periodId,observation,idempotencyKey:`${idempotencyKey}:payables:${periodCode}`,kernelSet});imported+=totals.imported;replayed+=totals.replayed;posted+=totals.posted;
      }
      const bankRows=bankPages.flatMap(page=>page.rows),bankSourceIds=[];let reconciliation=null;
      if(bankRows.length){
        const first=bankPages[0],combinedProviderHash=createHash('sha256').update(canonicalRequestBody({schema_version:first.schema_version,source_system:first.source_system,tool:first.tool,environment:first.environment,entity_id:first.entity_id,scope:first.scope,period_code:periodCode,rows:bankRows}),'utf8').digest('hex');
        const core={...first,captured_at:`${dateTo}T23:59:59.000Z`,provider_content_sha256:combinedProviderHash,record_count:bankRows.length,rows:bankRows};delete core.observation_hash;
        const hashCore={...core};delete hashCore.captured_at;
        const observation=Object.freeze({...core,observation_hash:`sha256:${createHash('sha256').update(canonicalRequestBody(hashCore),'utf8').digest('hex')}`}),bankAccountRef=`WBS_TEST_BANK_${periodCode.replace('-','_')}`;
        const result=assertWbsControlledTestBankResult(await importer.createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef,idempotencyKey:`${idempotencyKey}:bank:${periodCode}`}));
        reconciliation={bank_account_ref:bankAccountRef,period_code:periodCode,period_id:periodId,reconciliation_id:result.reconciliation_id,transaction_count:result.transaction_count};bankSourceIds.push(...result.bank_source_ids);
      }
      return Object.freeze(assertWbsTestRangeImportResult({status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:periodCode,date_from:dateFrom,date_to:dateTo,page_size:pageSize,payables:{provider_page_count:payableRead.providerPageCount,h1_record_count:payableRead.providerRecordCount,record_count:payableRecordCount,imported_count:imported,replayed_count:replayed,posted_count:posted},bank:{provider_page_count:bankRead.providerPageCount,record_count:bankSourceIds.length,reconciliation,bank_source_ids:bankSourceIds},test_only:true}));
    }
  });
}
