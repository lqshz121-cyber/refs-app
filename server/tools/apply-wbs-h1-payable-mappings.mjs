#!/usr/bin/env node
import {createPool} from '../runtime/db.mjs';
import {pathToFileURL} from 'node:url';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {StagingWbsH1SettingsKernel,assertSettingsDatabaseEndpoints} from './decide-wbs-h1-accounting-settings.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACCOUNT=/^[A-Z0-9][A-Z0-9._-]{0,63}$/i;
const ACTORS=['maker','submitter','reviewer','approver','poster'];

const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be between ${min} and ${max}`);return parsed;};
const text=value=>typeof value==='string'?value.trim():'';
const projectList=value=>text(value)===''?[]:text(value).split(',').map(item=>item.trim()).filter(Boolean);

export function wbsH1MappingPeriod(value){
  if(value===undefined||value===null)return null;
  if(typeof value!=='string'||!/^2026-0[1-6]$/.test(value.trim()))throw new Error('REFS_WBS_H1_MAPPING_PERIOD must be one 2026 H1 period');
  return value.trim();
}

export function resolveWbsH1PayableMapping(row){
  if(!row||!UUID.test(row.entity_id||'')||!UUID.test(row.period_id||'')||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.source_document_id||'')||!UUID.test(row.attachment_id||'')||!SHA.test(row.source_record_hash||'')||!COMPANY.test(row.company_code||''))throw new Error('WBS H1 mapping candidate identity is invalid');
  const matchCount=Number(row.mapping_match_count),accountCode=text(row.mapped_account_code),accountName=text(row.mapped_account_name),supplementary=text(row.mapped_supplementary),projectCode=text(row.project_code),allowedProjects=projectList(row.mapped_project_codes);
  if(!Number.isSafeInteger(matchCount)||matchCount<0)throw new Error('WBS H1 mapping match count is invalid');
  if(matchCount!==1)return Object.freeze({status:matchCount===0?'MAPPING_MISSING':'MAPPING_AMBIGUOUS',reason:`${matchCount} effective WBS Payable mappings`,row});
  if(!ACCOUNT.test(accountCode)||!accountName||accountName.length>255)return Object.freeze({status:'MAPPING_INVALID',reason:'The unique WBS mapping has no valid account identity.',row});
  if(!['','Vendor','Project'].includes(supplementary))return Object.freeze({status:'MAPPING_UNSUPPORTED_MEMBER',reason:`The mapped supplementary dimension ${supplementary} is not safely available in the sanitized test source.`,row});
  if(supplementary==='Project'&&!projectCode)return Object.freeze({status:'MAPPING_SCOPE_MISMATCH',reason:'The WBS Project mapping requires an authoritative retained project code.',row});
  if(allowedProjects.length&&(!projectCode||!allowedProjects.includes(projectCode)))return Object.freeze({status:'MAPPING_SCOPE_MISMATCH',reason:'The unique WBS mapping does not cover the retained project.',row});
  // Even a retained 610000 debit can require the formal synthetic-to-real
  // vendor adjustment. Account equality is not proof of completed mapping.
  return Object.freeze({status:'READY',accountCode,accountName,requiresVendor:supplementary==='Vendor',requiresProject:supplementary==='Project',settingId:text(row.wbs_setting_id),row});
}

export async function applyWbsH1PayableMappings({rows,prepare,complete,onProgress=()=>{}}={}){
  if(!Array.isArray(rows)||typeof prepare!=='function'||typeof complete!=='function'||typeof onProgress!=='function')throw new Error('WBS H1 mapping runner configuration is invalid');
  const summary={row_count:rows.length,ready_count:0,posted_count:0,replayed_count:0,already_mapped_count:0,exception_count:0,exceptions:{}};
  for(let offset=0;offset<rows.length;offset+=4){
    const prepared=[];
    for(const row of rows.slice(offset,offset+4)){
      const decision=resolveWbsH1PayableMapping(row);
      if(decision.status==='ALREADY_MAPPED'){summary.already_mapped_count++;onProgress({status:'WBS_H1_MAPPING_ALREADY_APPLIED',company_code:row.company_code,source_record_hash:row.source_record_hash});continue;}
      if(decision.status!=='READY'){summary.exception_count++;summary.exceptions[decision.status]=(summary.exceptions[decision.status]||0)+1;onProgress({status:decision.status,company_code:row.company_code,source_record_hash:row.source_record_hash});continue;}
      summary.ready_count++;prepared.push(await prepare(decision));
    }
    const settled=await Promise.allSettled(prepared.map(item=>complete(item)));
    const failed=settled.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    for(const result of settled){summary.posted_count++;if(result.value?.idempotent===true)summary.replayed_count++;onProgress(result.value);}
  }
  return Object.freeze({...summary,status:summary.exception_count?'WBS_H1_PAYABLE_MAPPING_PARTIAL':'WBS_H1_PAYABLE_MAPPING_COMPLETE',exceptions:Object.freeze({...summary.exceptions})});
}

export const CANDIDATE_SQL=`WITH source_rows AS (
  SELECT d.tenant_id::text,d.entity_id::text,e.entity_code AS company_code,d.period_id::text,
    d.source_record_hash,d.source_document_id::text,d.attachment_id::text,d.journal_entry_id::text,
    sd.accounting_date::text,sd.gross_amount::text AS amount,b.project_code,coalesce(c.cost_code,b.cost_code) AS cost_code,
    jl.member_ref
  FROM wbs_test_import_draft d
  JOIN entity e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id
  JOIN source_document sd ON sd.tenant_id=d.tenant_id AND sd.entity_id=d.entity_id AND sd.source_document_id=d.source_document_id
  JOIN journal_line jl ON jl.tenant_id=d.tenant_id AND jl.entity_id=d.entity_id AND jl.journal_entry_id=d.journal_entry_id AND jl.account_code='291001' AND jl.credit_amount=sd.gross_amount
  JOIN wbs_h1_payable_mapping_source_stage b ON b.tenant_id=d.tenant_id AND b.entity_id=d.entity_id
    AND b.company_code=e.entity_code AND b.source_record_hash=d.source_record_hash
    AND b.accounting_date=sd.accounting_date AND b.amount=sd.gross_amount
  LEFT JOIN wbs_h1_payable_cost_code_stage c ON c.tenant_id=b.tenant_id AND c.entity_id=b.entity_id AND c.source_record_hash=b.source_record_hash
  WHERE d.tenant_id=$1 AND ($2::text IS NULL OR e.entity_code=$2)
    AND ($5::text IS NULL OR (b.period_code=$5
      AND sd.accounting_date>=($5||'-01')::date AND sd.accounting_date<(($5||'-01')::date+interval '1 month')
      AND d.period_id IN (SELECT p.period_id FROM accounting_period p WHERE p.tenant_id=d.tenant_id AND p.entity_id=d.entity_id AND p.ledger_code='PRIMARY' AND p.period_code=$5)))
), planned AS (
  SELECT s.*,m.mapping_match_count,m.wbs_setting_id,m.mapped_account_code,m.mapped_account_name,
    m.mapped_supplementary,m.mapped_project_codes
  FROM source_rows s
  LEFT JOIN LATERAL (
    SELECT count(*)::int AS mapping_match_count,min(r.setting_id)::text AS wbs_setting_id,
      min(r.journal_code) AS mapped_account_code,min(r.account_name) AS mapped_account_name,
      min(r.supplementary) AS mapped_supplementary,min(r.project_codes) AS mapped_project_codes
    FROM wbs_h1_accounting_setting_stage r
    WHERE r.tenant_id=s.tenant_id::uuid AND r.company_code=s.company_code
      AND r.business_type=4 AND r.category='Payable' AND r.setting_type='Debit'
      AND r.detail=coalesce(s.cost_code,'')
      AND (r.project_codes='' OR s.project_code=ANY(regexp_split_to_array(r.project_codes,'\\s*,\\s*')))
      AND s.accounting_date::date BETWEEN r.effective_from AND r.effective_to
  ) m ON true
)
SELECT * FROM planned WHERE source_record_hash>$3 ORDER BY source_record_hash LIMIT $4`;

// Never synthesize account master or lineage in the CLI. The authoritative
// command checks approved Settings, exact source evidence and maker/controller
// separation and creates Draft + source link + audit + outbox atomically.
export async function prepareAuthoritativeWbsH1Mapping({decision,kernel,reason}){
  const row=decision.row;
  const scope={tenantId:row.tenant_id,entityId:row.entity_id,periodId:row.period_id};
  let proposalRow=null;
  for(let offset=0;;offset+=200){
    const page=await kernel.readWbsH1PayableAccountingProposal({...scope,limit:200,offset});
    if(page.settings_outcome!=='APPROVED'||!SHA.test(page.settings_decision_hash||''))throw new Error('WBS H1 mapping requires approved Settings');
    if(!Number.isSafeInteger(page.source_record_count)||page.source_record_count<0||!Array.isArray(page.rows))throw new Error('Invalid authoritative WBS H1 proposal page');
    proposalRow=page.rows.find(item=>item.source_record_hash===row.source_record_hash);
    if(proposalRow||offset+200>=page.source_record_count)break;
    if(page.rows.length!==200)throw new Error('Incomplete authoritative WBS H1 proposal page');
  }
  if(!proposalRow||proposalRow.status!=='READY_FOR_CONTROLLER_REVIEW'||!SHA.test(proposalRow.proposal_hash||''))throw new Error('WBS H1 mapping proposal is absent or exceptional');
  const idempotency=`wbs-h1-formal-map:${row.source_record_hash.slice(7)}`;
  const draft=await kernel.createWbsH1PayableReclassDraft({...scope,sourceRecordHash:row.source_record_hash,proposalHash:proposalRow.proposal_hash,reason,idempotencyKey:`${idempotency}:draft`});
  return {decision,draft,idempotency};
}

async function main(){
  const required=['REFS_WBS_TEST_IMPORT_TENANT_ID',...ACTORS.map(role=>`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`)];for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,companyCode=process.env.REFS_WBS_H1_MAPPING_COMPANY?.trim().toUpperCase()||null,startAfter=process.env.REFS_WBS_H1_MAPPING_START_AFTER||'sha256:'+'0'.repeat(64),limit=integer(process.env.REFS_WBS_H1_MAPPING_LIMIT||100,'REFS_WBS_H1_MAPPING_LIMIT',{min:1,max:500});
  if(!UUID.test(tenantId)||companyCode!==null&&!COMPANY.test(companyCode)||!SHA.test(startAfter))throw new Error('WBS H1 mapping selection is invalid');
  const periodCode=wbsH1MappingPeriod(process.env.REFS_WBS_H1_MAPPING_PERIOD);
  if(!companyCode||!periodCode)throw new Error('Mapping pilot requires an explicit company and single H1 period; expansion is not authorized');
  const reason=text(process.env.REFS_WBS_H1_MAPPING_REASON);
  if(reason.length<8||reason.length>2000)throw new Error('REFS_WBS_H1_MAPPING_REASON must document the authorized pilot (8..2000 characters)');
  const actorIds=Object.fromEntries(ACTORS.map(role=>[role,process.env[`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`]]));
  if(new Set(Object.values(actorIds)).size!==ACTORS.length)throw new Error('Mapping workflow actors must be distinct');
  const config=runtimeConfig(process.env),admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-mapping-admin',max:2}),runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-mapping-runtime',max:4}),issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-mapping-issuer',max:2});
  let guardPool;
  const target={installationId:process.env.REFS_EXPECTED_INSTALLATION_ID||null,expectedDatabase:process.env.REFS_EXPECTED_DATABASE_NAME||null};
  const kernelFor=role=>new StagingWbsH1SettingsKernel(runtime,{sessionProvider:()=>new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId:actorIds[role]})}).issue({tenantId})},target,{query:(...args)=>guardPool.query(...args)});
  const maker=kernelFor('maker'),submitter=kernelFor('submitter'),reviewer=kernelFor('reviewer'),approver=kernelFor('approver'),poster=kernelFor('poster');
  try{
    assertSettingsDatabaseEndpoints(config);
    guardPool=await createPool({databaseUrl:config.grantSyncDatabaseUrl,applicationName:'refs-wbs-h1-mapping-guard',max:1});
    const modern=(await admin.query(`SELECT count(*)::int AS receipt_count FROM wbs_test_payable_source_receipt r
      JOIN entity e ON e.tenant_id=r.tenant_id AND e.entity_id=r.entity_id
      JOIN accounting_period p ON p.tenant_id=r.tenant_id AND p.entity_id=r.entity_id AND p.period_id=r.period_id
      WHERE r.tenant_id=$1 AND e.entity_code=$2 AND p.ledger_code='PRIMARY' AND p.period_code=$3`,[tenantId,companyCode,periodCode])).rows[0];
    if(modern.receipt_count>0)throw new Error('Modern retained-source reclassification is not yet validated; refusing to omit these receipts or claim mapping completion');
    const rows=(await admin.query(CANDIDATE_SQL,[tenantId,companyCode,startAfter,limit,periodCode])).rows;
    if(process.env.REFS_WBS_H1_MAPPING_DRY_RUN==='1'){
      const counts={};for(const row of rows){const status=resolveWbsH1PayableMapping(row).status;counts[status]=(counts[status]||0)+1;}
      process.stdout.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_PLAN',company_code:companyCode,period_code:periodCode,row_count:rows.length,counts,next_start_after:rows.at(-1)?.source_record_hash??startAfter})}\n`);return;
    }
    const prepare=decision=>prepareAuthoritativeWbsH1Mapping({decision,kernel:maker,reason});
    const complete=async item=>{
      const {decision,draft,idempotency}=item,row=decision.row,journalId=draft.journal_entry_id;
      let state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];
      if(state.status==='DRAFT')await submitter.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'SUBMIT',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:submit`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='PENDING_REVIEW')await reviewer.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'REVIEW',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:review`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='PENDING_APPROVAL')await approver.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'APPROVE',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:approve`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='APPROVED')await poster.postJournal({tenantId,entityId:row.entity_id,periodId:row.period_id,journalEntryId:journalId,expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:post`});
      state=(await admin.query('SELECT status::text FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];
      if(state?.status!=='POSTED')throw new Error('WBS H1 formal mapping did not reach POSTED');
      return {status:'WBS_H1_MAPPING_POSTED',company_code:row.company_code,source_record_hash:row.source_record_hash,journal_entry_id:journalId,mapped_account_code:decision.accountCode,idempotent:draft.idempotent===true};
    };
    const summary=await applyWbsH1PayableMappings({rows,prepare,complete,onProgress:row=>process.stdout.write(`${JSON.stringify(row)}\n`)});process.stdout.write(`${JSON.stringify({...summary,next_start_after:rows.at(-1)?.source_record_hash??startAfter})}\n`);
  }finally{await Promise.allSettled([admin.end(),runtime.end(),issuerPool.end(),guardPool?.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
