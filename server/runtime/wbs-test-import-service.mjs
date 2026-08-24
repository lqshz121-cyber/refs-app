import {assertWbsLivePilotResult} from './wbs-live-pilot-read-service.mjs';
import {createHash} from 'node:crypto';
import {canonicalRequestBody} from './request-hash.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY4=/^-?(?:0|[1-9][0-9]{0,15})\.[0-9]{4}$/;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const WBS_TEST_MONTH_MAX_ROWS=10000;
const WBS_TEST_MONTH_MAX_PAGES=1000;
const ACTOR_ROLES=Object.freeze(['importer','reconciliationStarter','maker','paymentMaker','matchMaker','submitter','reviewer','approver','poster','clearer','reopener']);
const WBS_TEST_IMPORTER_V1_PERMISSIONS=Object.freeze(['WBS.TEST.IMPORT']);
const WBS_TEST_IMPORT_LEGACY_GRANT_BUNDLES=Object.freeze({
  importer:Object.freeze(['WBS.TEST.IMPORT','BANK.RECONCILIATION.START']),
  maker:Object.freeze(['WBS.TEST.IMPORT','AP.BILL.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),reviewer:Object.freeze(['GL.JE.REVIEW']),approver:Object.freeze(['GL.JE.APPROVE']),poster:Object.freeze(['GL.JE.POST'])
});
const WBS_TEST_IMPORT_V3_GRANT_BUNDLES=Object.freeze({
  importer:Object.freeze(['WBS.TEST.IMPORT']),
  reconciliationStarter:Object.freeze(['BANK.RECONCILIATION.START']),
  maker:Object.freeze(['AP.BILL.CREATE','BANK.RECONCILIATION.ADJUSTMENT_DRAFT','GL.JE.CREATE','BANK.VIEW']),
  paymentMaker:Object.freeze(['AP.PAYMENT.CREATE']),
  matchMaker:Object.freeze(['BANK.VIEW','AP.VIEW','BANK.MATCH.CREATE']),
  submitter:Object.freeze(['GL.JE.SUBMIT']),
  reviewer:Object.freeze(['GL.JE.REVIEW','BANK.RECONCILIATION.REVIEW']),
  approver:Object.freeze(['GL.JE.APPROVE','BANK.RECONCILIATION.SIGN_OFF']),
  poster:Object.freeze(['GL.JE.POST']),
  clearer:Object.freeze(['BANK.RECONCILIATION.CLEAR']),
  reopener:Object.freeze(['BANK.RECONCILIATION.REOPEN'])
});
export const WBS_TEST_IMPORT_GRANT_BUNDLES=Object.freeze({
  importer:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.importer,
  reconciliationStarter:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.reconciliationStarter,
  maker:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.maker,
  paymentMaker:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.paymentMaker,
  matchMaker:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.matchMaker,
  submitter:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.submitter,
  reviewer:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.reviewer,
  approver:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.approver,
  poster:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.poster,
  clearer:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.clearer,
  reopener:WBS_TEST_IMPORT_V3_GRANT_BUNDLES.reopener
});

export class WbsTestImportError extends Error{
  constructor(code,message){super(message);this.name='WbsTestImportError';this.code=code;}
}
const fail=(code,message)=>{throw new WbsTestImportError(code,message);};
const exactObject=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const date=value=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(value||''))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===value;};

function assertConfiguration({tenantId,entityId,companyCode,actors}={}){
  if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!/^[A-Z0-9][A-Z0-9_:-]{0,63}$/.test(companyCode||''))fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import scope is incomplete.');
  if(!exactObject(actors,ACTOR_ROLES)||ACTOR_ROLES.some(role=>typeof actors[role]!=='string'||actors[role].trim().length<3||actors[role].trim().length>200)||new Set(ACTOR_ROLES.map(role=>actors[role].trim())).size!==ACTOR_ROLES.length)fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import actors must be eleven distinct configured identities.');
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
  if(!result||result.status!=='DRAFT'||result.revision!==0||result.test_only!==true||result.provenance_mode!=='UNSIGNED_TEST_ONLY'||!UUID.test(result.business_document_id||'')||!UUID.test(result.journal_entry_id||'')||!UUID.test(result.wbs_test_payable_source_receipt_id||'')||!SHA256.test(result.receipt_hash||'')||!['can_submit','can_review','can_approve','can_post'].every(key=>result[key]===false))fail('WBS_TEST_IMPORT_DRAFT_INVALID','Test-import persistence returned an unsafe human Draft result.');
}
function assertRetainedSource(result){
  if(!result||result.status!=='RETAINED'||result.test_only!==true||result.provenance_mode!=='UNSIGNED_TEST_ONLY'||!UUID.test(result.wbs_test_payable_source_receipt_id||'')||!UUID.test(result.source_document_id||'')||!UUID.test(result.attachment_id||'')||!SHA256.test(result.receipt_hash||'')||!['can_create_draft','can_submit','can_review','can_approve','can_post'].every(key=>result[key]===false))fail('WBS_TEST_IMPORT_SOURCE_INVALID','Test-import persistence returned an unsafe retained source receipt.');
}

export function assertWbsTestImportResult(value){
  const keys=['failed_count','imported_count','posted_count','replayed_count','status','test_only'];
  if(!exactObject(value,keys)||value.status!=='WBS_TEST_PAYABLE_IMPORT_COMPLETE'||value.test_only!==true||!['failed_count','imported_count','posted_count','replayed_count'].every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||value.failed_count!==0||value.posted_count!==0)fail('WBS_TEST_IMPORT_RESULT_INVALID','Test-import result is incomplete or unsafe.');
  return value;
}


export function assertWbsControlledTestBankResult(value){
  const capabilities=['can_import','can_match','can_create_draft','can_post'];
  const partialKeys=['chunk_count',...capabilities,'idempotent','next_chunk_index','provenance_mode','stage_id','status','test_only','transaction_count'];
  if(value?.status==='WBS_TEST_BANK_IMPORT_PARTIAL'){
    if(!exactObject(value,partialKeys)||capabilities.some(key=>value[key]!==false)||!UUID.test(value.stage_id||'')||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!Number.isSafeInteger(value.transaction_count)||value.transaction_count<2001||value.transaction_count>WBS_TEST_MONTH_MAX_ROWS||!Number.isSafeInteger(value.chunk_count)||value.chunk_count!==Math.ceil(value.transaction_count/100)||!Number.isSafeInteger(value.next_chunk_index)||value.next_chunk_index<1||value.next_chunk_index>=value.chunk_count)fail('WBS_TEST_BANK_RESULT_INVALID','Controlled test Bank checkpoint is incomplete or unsafe.');
    return value;
  }
  const keys=['bank_account_ref','bank_source_ids',...capabilities,'idempotent','provenance_mode','receipt_hash','statement_ending_date','status','test_only','transaction_count','wbs_test_bank_import_receipt_id'];
  if(!exactObject(value,keys)||capabilities.some(key=>value[key]!==false)||!/^WBS_TEST_BANK(?:_2026_0[1-6])?$/.test(value.bank_account_ref||'')||!UUID.test(value.wbs_test_bank_import_receipt_id||'')||!SHA256.test(value.receipt_hash||'')||!date(value.statement_ending_date)||value.status!=='FINALIZED'||value.test_only!==true||value.provenance_mode!=='CONTROLLED_TEST_UNSIGNED'||typeof value.idempotent!=='boolean'||!Number.isSafeInteger(value.transaction_count)||value.transaction_count<1||value.transaction_count>WBS_TEST_MONTH_MAX_ROWS||!Array.isArray(value.bank_source_ids)||value.bank_source_ids.length!==value.transaction_count||value.bank_source_ids.some(id=>!UUID.test(id||''))||new Set(value.bank_source_ids).size!==value.bank_source_ids.length)fail('WBS_TEST_BANK_RESULT_INVALID','Controlled test Bank result is incomplete or unsafe.');
  return value;
}

export function assertWbsTestRangeImportResult(value){
  const top=['bank','date_from','date_to','page_size','payables','period_code','status','test_only'];
  const payableKeys=['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'];
  const bankKeys=['bank_source_count','provider_page_count','receipt','record_count'];
  if(!exactObject(value,top)||!['WBS_TEST_MONTH_IMPORT_COMPLETE','WBS_TEST_MONTH_IMPORT_PARTIAL'].includes(value.status)||value.test_only!==true||!/^2026-0[1-6]$/.test(value.period_code||'')||value.date_from!==`${value.period_code}-01`||value.date_to!==new Date(Date.UTC(2026,Number(value.period_code.slice(5,7)),0)).toISOString().slice(0,10)||value.page_size!==10||!exactObject(value.payables,payableKeys))fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import result is incomplete or unsafe.');
  const payable=value.payables;
  if(!['h1_record_count','imported_count','posted_count','provider_page_count','record_count','replayed_count'].every(key=>Number.isSafeInteger(payable[key])&&payable[key]>=0)||payable.provider_page_count>WBS_TEST_MONTH_MAX_PAGES||payable.h1_record_count>WBS_TEST_MONTH_MAX_ROWS||payable.record_count>payable.h1_record_count||payable.posted_count!==0||payable.imported_count+payable.replayed_count!==payable.record_count)fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import Payables totals are invalid.');
  const bank=value.bank,receipt=bank.receipt;
  if(value.status==='WBS_TEST_MONTH_IMPORT_PARTIAL'){
    const checkpoint=bank?.checkpoint;
    if(!exactObject(bank,[...bankKeys,'checkpoint'])||!Number.isSafeInteger(bank.provider_page_count)||bank.provider_page_count<0||bank.provider_page_count>WBS_TEST_MONTH_MAX_PAGES||!Number.isSafeInteger(bank.record_count)||bank.record_count<2001||bank.record_count>WBS_TEST_MONTH_MAX_ROWS||receipt!==null||bank.bank_source_count!==0||!exactObject(checkpoint,['chunk_count','next_chunk_index','stage_id','transaction_count'])||!UUID.test(checkpoint.stage_id||'')||checkpoint.transaction_count!==bank.record_count||checkpoint.chunk_count!==Math.ceil(bank.record_count/100)||!Number.isSafeInteger(checkpoint.next_chunk_index)||checkpoint.next_chunk_index<1||checkpoint.next_chunk_index>=checkpoint.chunk_count)fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import Bank checkpoint is invalid.');
    return value;
  }
  if(!Number.isSafeInteger(bank.provider_page_count)||bank.provider_page_count<0||bank.provider_page_count>WBS_TEST_MONTH_MAX_PAGES||!Number.isSafeInteger(bank.record_count)||bank.record_count<0||bank.record_count>WBS_TEST_MONTH_MAX_ROWS||bank.bank_source_count!==bank.record_count||(bank.record_count===0?receipt!==null:!exactObject(receipt,['bank_account_ref','period_code','period_id','receipt_hash','transaction_count','wbs_test_bank_import_receipt_id'])||receipt.period_code!==value.period_code||receipt.bank_account_ref!==`WBS_TEST_BANK_${value.period_code.replace('-','_')}`||!UUID.test(receipt.period_id||'')||!UUID.test(receipt.wbs_test_bank_import_receipt_id||'')||!SHA256.test(receipt.receipt_hash||'')||receipt.transaction_count!==bank.record_count))fail('WBS_TEST_RANGE_RESULT_INVALID','Test month-import Bank totals are invalid.');
  return value;
}

export async function reconcileWbsTestImportActorGrants({grantSync,scope}={}){
  if(typeof grantSync?.reconcile!=='function'||typeof grantSync?.currentVersion!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import grant sync is unavailable.');
  assertConfiguration(scope);
  const authority={importer:'SERVICE',reconciliationStarter:'DRAFT',maker:'DRAFT',paymentMaker:'PAYMENT',matchMaker:'DRAFT',submitter:'SUBMIT',reviewer:'REVIEW',approver:'APPROVE',poster:'POST',clearer:'DRAFT',reopener:'REOPEN'};
  const humanValidUntil=new Date(Date.now()+60*60*1000).toISOString();
  for(const role of ACTOR_ROLES){
    const actorId=scope.actors[role],validUntil=role==='importer'?null:humanValidUntil;
    let completed=false;
    for(let attempt=0;attempt<2&&!completed;attempt++){
      const expectedVersion=await grantSync.currentVersion({tenantId:scope.tenantId,entityId:scope.entityId,actorId});
      try{
        await grantSync.reconcile({tenantId:scope.tenantId,entityId:scope.entityId,actorId,permissions:WBS_TEST_IMPORT_GRANT_BUNDLES[role],authorityClass:authority[role],validUntil,expectedVersion,idempotencyKey:`wbs-test-import-${role}-grant-v278-${expectedVersion}`});
        completed=true;
      }catch(error){if(error?.code!=='40001'||attempt===1)throw error;}
    }
  }
}

export function createWbsTestImportService({pilotService,kernelForActor,authorizeBank,scope,resolveScope=null}={}){
  if(!pilotService||typeof pilotService.readObservation!=='function'||typeof kernelForActor!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import dependencies are unavailable.');
  if(resolveScope!==null&&typeof resolveScope!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Test-import scope resolver is invalid.');
  assertConfiguration(scope);
  const actors=Object.freeze(Object.fromEntries(ACTOR_ROLES.map(role=>[role,scope.actors[role].trim()])));
  const kernels=()=>Object.fromEntries(ACTOR_ROLES.map(role=>[role,kernelForActor(actors[role])]));
  const requestedScope=async({tenantId,entityId,companyCode})=>{
    const resolved=resolveScope===null?scope:await resolveScope({tenantId,entityId,companyCode});
    assertConfiguration({...resolved,actors});
    if(resolved.tenantId!==tenantId||resolved.entityId!==entityId||resolved.companyCode!==companyCode||resolved.tenantId!==scope.tenantId)fail('WBS_TEST_IMPORT_SCOPE_DENIED','The selected entity is not the authoritative WBS company scope.');
    return Object.freeze({...resolved,actors});
  };
  // A company month imports only the rows whose accounting_date belongs to
  // that month, but the Provider's authoritative Payables population is the
  // same complete 2026 H1 cursor traversal for all six calls.  Retain exactly
  // one bounded in-memory population for the current company so the sequential
  // all-company runner does not reread hundreds of identical Provider pages
  // six times.  Replacing (rather than accumulating) the entry bounds memory
  // to one company, and a rejected read is never cached.
  let h1PayablePopulationCache=null;
  const assertPayableKernels=value=>{
    const required={importer:['retainWbsTestPayableSource'],maker:['createWbsTestPayableDraft']};
    for(const [role,methods] of Object.entries(required))if(!value[role]||methods.some(method=>typeof value[role][method]!=='function'))fail('WBS_TEST_IMPORT_CONFIG_INVALID',`Test-import ${role} kernel is unavailable.`);
  };
  const importPayableObservation=async({tenantId,entityId,periodId,periodIdForDate=null,observation,rowIndexes=null,idempotencyKey,kernelSet})=>{
    const jobs=observation.rows.map((row,rowIndex)=>({row,rowIndex})).filter(({rowIndex})=>rowIndexes===null||rowIndexes.has(rowIndex));
    const prepareRow=async({row,rowIndex})=>{
      const key=`${idempotencyKey}:${row.source_record_hash.slice(7,31)}`;
      const rowPeriodId=periodIdForDate?periodIdForDate(row.accounting_date):periodId;
      if(!UUID.test(rowPeriodId||''))fail('WBS_TEST_IMPORT_SELECTION_INVALID','No exact OPEN test period exists for a Payable source date.');
      const retained=await kernelSet.importer.retainWbsTestPayableSource({tenantId,entityId,periodId:rowPeriodId,observation,row,rowIndex,idempotencyKey:`${key}:retain`});assertRetainedSource(retained);
      const draft=await kernelSet.maker.createWbsTestPayableDraft({tenantId,entityId,sourceReceiptId:retained.wbs_test_payable_source_receipt_id,expectedReceiptHash:retained.receipt_hash,idempotencyKey:`${key}:draft`});assertDraft(draft);
      if(draft.wbs_test_payable_source_receipt_id!==retained.wbs_test_payable_source_receipt_id||draft.receipt_hash!==retained.receipt_hash)fail('WBS_TEST_IMPORT_DRAFT_INVALID','Human Draft did not consume the exact retained source receipt.');
      return {imported:retained.idempotent===true?0:1,replayed:retained.idempotent===true?1:0};
    };
    // Retention and human Draft are deliberately serialized per source.  The
    // service boundary never advances any journal lifecycle action.
    const totals={imported:0,replayed:0,posted:0};
    for(const job of jobs){const row=await prepareRow(job);totals.imported+=row.imported;totals.replayed+=row.replayed;}
    return totals;
  };
  return Object.freeze({
    async importPayables({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit,idempotencyKey}={}){
      const selectedScope=await requestedScope({tenantId,entityId,companyCode});
      assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit},selectedScope);
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
      const selectedScope=await requestedScope({tenantId,entityId,companyCode});
      assertSelection({tenantId,entityId,periodId,companyCode,dateFrom,dateTo,limit},selectedScope);
      if(typeof authorizeBank!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Controlled test Bank caller authorization is unavailable.');
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>160)fail('WBS_TEST_IMPORT_IDEMPOTENCY_REQUIRED','A bounded test-import idempotency key is required.');
      await authorizeBank({tenantId,entityId});
      const observation=await pilotService.readObservation({tenantId,entityId,tool:'list_bank_transactions',limit,company_code:companyCode,date_from:dateFrom,date_to:dateTo});
      assertWbsLivePilotResult(observation,{entityId,tool:'list_bank_transactions',limit});
      if(observation.scope?.company_codes?.length!==1||observation.scope.company_codes[0]!==companyCode||observation.scope?.date_range?.[0]!==dateFrom||observation.scope.date_range[1]!==dateTo)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Provider Bank observation did not retain the configured test-import scope.');
      if(observation.rows.length===0)fail('WBS_TEST_IMPORT_EMPTY','The bounded WBS Bank observation contains no rows to import.');
      const hashes=new Set();for(const row of observation.rows){assertBankRow(row);if(hashes.has(row.source_record_hash))fail('WBS_TEST_BANK_ROW_INVALID','Provider observation contains a duplicate sanitized Bank identity.');hashes.add(row.source_record_hash);}
      const importer=kernelForActor(actors.importer);
      if(!importer||typeof importer.createWbsControlledTestBankScope!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Controlled test Bank import receipt kernel is unavailable.');
      const receipt=await importer.createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef:'WBS_TEST_BANK',idempotencyKey});
      return Object.freeze(assertWbsControlledTestBankResult(receipt));
    },
    async importRange({tenantId,entityId,companyCode,dateFrom,dateTo,pageSize=10,maxPages=WBS_TEST_MONTH_MAX_PAGES,idempotencyKey}={}){
      const selectedScope=await requestedScope({tenantId,entityId,companyCode});
      if(tenantId!==selectedScope.tenantId||entityId!==selectedScope.entityId)fail('WBS_TEST_IMPORT_SCOPE_DENIED','Test import is restricted to an authoritative WBS company entity.');
      const periodCode=typeof dateFrom==='string'?dateFrom.slice(0,7):'',month=/^2026-0[1-6]$/.test(periodCode)?Number(periodCode.slice(5,7)):0,monthEnd=month?new Date(Date.UTC(2026,month,0)).toISOString().slice(0,10):null;
      if(companyCode!==selectedScope.companyCode||dateFrom!==`${periodCode}-01`||dateTo!==monthEnd||pageSize!==10)fail('WBS_TEST_IMPORT_SELECTION_INVALID','The month import requires one exact WBS company, one 2026 H1 calendar month, and ten-row provider pages.');
      if(typeof pilotService.readObservationPage!=='function'||typeof authorizeBank!=='function')fail('WBS_TEST_IMPORT_CONFIG_INVALID','Paged WBS test-import dependencies are unavailable.');
      if(!Number.isSafeInteger(maxPages)||maxPages<1||maxPages>WBS_TEST_MONTH_MAX_PAGES||typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>80)fail('WBS_TEST_IMPORT_SELECTION_INVALID','Paged month import requires bounded pages and one idempotency key.');
      await authorizeBank({tenantId,entityId});
      const kernelSet=kernels();assertPayableKernels(kernelSet);
      const importer=kernelSet.importer;
      if(typeof importer?.readCompletedWbsTestMonthImport==='function'){
        const completed=await importer.readCompletedWbsTestMonthImport({tenantId,entityId,companyCode,periodCode});
        if(completed!==null)return Object.freeze(assertWbsTestRangeImportResult(completed));
      }
      const readPages=async(tool,rowValidator,readFrom,readTo,includeRow=()=>true,aggregateBinding=null,populationCacheKey=null)=>{
        const normalize=({pages,providerRecordCount})=>{
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
          return {pages:normalized,providerPageCount:pages.length,providerRecordCount};
        };
        const readPopulation=async()=>{
          const pages=[],sourceHashes=new Set(),cursors=new Set();let cursor=null,snapshotToken=null,frozenIdentity=null;
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
            if(page.cursor_next===null)return Object.freeze({pages:Object.freeze(pages),providerRecordCount:sourceHashes.size});
            if(cursors.has(page.cursor_next))fail('WBS_TEST_IMPORT_ROW_INVALID','Provider repeated a WBS pagination cursor.');
            cursors.add(page.cursor_next);cursor=page.cursor_next;
          }
          fail('WBS_TEST_IMPORT_PAGE_LIMIT_EXCEEDED','WBS month exceeds the configured 1,000-page import bound.');
        };
        let population;
        if(populationCacheKey===null)population=await readPopulation();
        else{
          if(h1PayablePopulationCache?.key!==populationCacheKey)h1PayablePopulationCache={key:populationCacheKey,promise:readPopulation()};
          try{population=await h1PayablePopulationCache.promise;}
          catch(error){if(h1PayablePopulationCache?.key===populationCacheKey)h1PayablePopulationCache=null;throw error;}
        }
        return normalize(population);
      };
      const payableCacheKey=`${tenantId}:${entityId}:${companyCode}:2026-H1:${pageSize}:${maxPages}`;
      const [payableRead,bankRead]=await Promise.all([readPages('list_payables',assertRow,'2026-01-01','2026-06-30',row=>row.accounting_date>=dateFrom&&row.accounting_date<=dateTo,{period_code:periodCode,date_from:dateFrom,date_to:dateTo},payableCacheKey),readPages('list_bank_transactions',assertBankRow,dateFrom,dateTo)]),payablePages=payableRead.pages,bankPages=bankRead.pages;
      if(payablePages.length===0&&bankPages.length===0)fail('WBS_TEST_IMPORT_EMPTY','The selected WBS month contains no Payable or Bank rows.');
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
      const bankRows=bankPages.flatMap(page=>page.rows),bankSourceIds=[];let receipt=null;
      if(bankRows.length){
        const first=bankPages[0],combinedProviderHash=createHash('sha256').update(canonicalRequestBody({schema_version:first.schema_version,source_system:first.source_system,tool:first.tool,environment:first.environment,entity_id:first.entity_id,scope:first.scope,period_code:periodCode,rows:bankRows}),'utf8').digest('hex');
        const core={...first,captured_at:`${dateTo}T23:59:59.000Z`,provider_content_sha256:combinedProviderHash,record_count:bankRows.length,rows:bankRows};delete core.observation_hash;
        const hashCore={...core};delete hashCore.captured_at;
        const observation=Object.freeze({...core,observation_hash:`sha256:${createHash('sha256').update(canonicalRequestBody(hashCore),'utf8').digest('hex')}`}),bankAccountRef=`WBS_TEST_BANK_${periodCode.replace('-','_')}`;
        const result=assertWbsControlledTestBankResult(await importer.createWbsControlledTestBankScope({tenantId,entityId,periodId,companyCode,observation,bankAccountRef,idempotencyKey:`${idempotencyKey}:bank:${periodCode}`}));
        if(result.status==='WBS_TEST_BANK_IMPORT_PARTIAL')return Object.freeze({status:'WBS_TEST_MONTH_IMPORT_PARTIAL',period_code:periodCode,date_from:dateFrom,date_to:dateTo,page_size:pageSize,payables:{provider_page_count:payableRead.providerPageCount,h1_record_count:payableRead.providerRecordCount,record_count:payableRecordCount,imported_count:imported,replayed_count:replayed,posted_count:posted},bank:{provider_page_count:bankRead.providerPageCount,record_count:bankRows.length,receipt:null,bank_source_count:0,checkpoint:{stage_id:result.stage_id,next_chunk_index:result.next_chunk_index,chunk_count:result.chunk_count,transaction_count:result.transaction_count}},test_only:true});
        receipt={bank_account_ref:bankAccountRef,period_code:periodCode,period_id:periodId,wbs_test_bank_import_receipt_id:result.wbs_test_bank_import_receipt_id,receipt_hash:result.receipt_hash,transaction_count:result.transaction_count};bankSourceIds.push(...result.bank_source_ids);
      }
      return Object.freeze(assertWbsTestRangeImportResult({status:'WBS_TEST_MONTH_IMPORT_COMPLETE',period_code:periodCode,date_from:dateFrom,date_to:dateTo,page_size:pageSize,payables:{provider_page_count:payableRead.providerPageCount,h1_record_count:payableRead.providerRecordCount,record_count:payableRecordCount,imported_count:imported,replayed_count:replayed,posted_count:posted},bank:{provider_page_count:bankRead.providerPageCount,record_count:bankSourceIds.length,receipt,bank_source_count:bankSourceIds.length},test_only:true}));
    }
  });
}
