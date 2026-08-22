#!/usr/bin/env node
import {createPool} from '../runtime/db.mjs';
import {pathToFileURL} from 'node:url';
import {runtimeConfig} from '../runtime/config.mjs';
import {PostgresContextIssuer} from '../runtime/context-issuer.mjs';
import {PostgresAccountingKernel} from '../runtime/kernel-repository.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const ACCOUNT=/^[A-Z0-9][A-Z0-9._-]{0,63}$/i;
const ACTORS=['maker','submitter','reviewer','approver','poster'];

const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be between ${min} and ${max}`);return parsed;};
const text=value=>typeof value==='string'?value.trim():'';
const projectList=value=>text(value)===''?[]:text(value).split(',').map(item=>item.trim()).filter(Boolean);

export function resolveWbsH1PayableMapping(row){
  if(!row||!UUID.test(row.entity_id||'')||!UUID.test(row.period_id||'')||!UUID.test(row.journal_entry_id||'')||!UUID.test(row.source_document_id||'')||!UUID.test(row.attachment_id||'')||!SHA.test(row.source_record_hash||'')||!COMPANY.test(row.company_code||''))throw new Error('WBS H1 mapping candidate identity is invalid');
  const matchCount=Number(row.mapping_match_count),accountCode=text(row.mapped_account_code),accountName=text(row.mapped_account_name),supplementary=text(row.mapped_supplementary),projectCode=text(row.project_code),allowedProjects=projectList(row.mapped_project_codes);
  if(!Number.isSafeInteger(matchCount)||matchCount<0)throw new Error('WBS H1 mapping match count is invalid');
  if(matchCount!==1)return Object.freeze({status:matchCount===0?'MAPPING_MISSING':'MAPPING_AMBIGUOUS',reason:`${matchCount} effective WBS Payable mappings`,row});
  if(!ACCOUNT.test(accountCode)||!accountName||accountName.length>255)return Object.freeze({status:'MAPPING_INVALID',reason:'The unique WBS mapping has no valid account identity.',row});
  if(!['','Vendor'].includes(supplementary))return Object.freeze({status:'MAPPING_UNSUPPORTED_MEMBER',reason:`The mapped supplementary dimension ${supplementary} is not safely available in the sanitized test source.`,row});
  if(allowedProjects.length&&(!projectCode||!allowedProjects.includes(projectCode)))return Object.freeze({status:'MAPPING_SCOPE_MISMATCH',reason:'The unique WBS mapping does not cover the retained project.',row});
  return Object.freeze({status:accountCode==='610000'?'ALREADY_MAPPED':'READY',accountCode,accountName,requiresVendor:supplementary==='Vendor',settingId:text(row.wbs_setting_id),row});
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

const CANDIDATE_SQL=`WITH source_rows AS (
  SELECT d.tenant_id::text,d.entity_id::text,e.entity_code AS company_code,d.period_id::text,
    d.source_record_hash,d.source_document_id::text,d.attachment_id::text,d.journal_entry_id::text,
    sd.accounting_date::text,sd.gross_amount::text AS amount,b.project_code,b.cost_code,
    jl.member_ref
  FROM wbs_test_import_draft d
  JOIN entity e ON e.tenant_id=d.tenant_id AND e.entity_id=d.entity_id
  JOIN source_document sd ON sd.tenant_id=d.tenant_id AND sd.entity_id=d.entity_id AND sd.source_document_id=d.source_document_id
  JOIN journal_line jl ON jl.tenant_id=d.tenant_id AND jl.entity_id=d.entity_id AND jl.journal_entry_id=d.journal_entry_id AND jl.account_code='291001' AND jl.credit_amount=sd.gross_amount
  JOIN wbs_h1_payable_mapping_source_stage b ON b.tenant_id=d.tenant_id AND b.entity_id=d.entity_id
    AND b.company_code=e.entity_code AND b.source_record_hash=d.source_record_hash
    AND b.accounting_date=sd.accounting_date AND b.amount=sd.gross_amount
  WHERE d.tenant_id=$1 AND ($2::text IS NULL OR e.entity_code=$2)
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

async function main(){
  const required=['REFS_WBS_TEST_IMPORT_TENANT_ID',...ACTORS.map(role=>`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`)];for(const key of required)if(!process.env[key])throw new Error(`${key} is required`);
  const tenantId=process.env.REFS_WBS_TEST_IMPORT_TENANT_ID,companyCode=process.env.REFS_WBS_H1_MAPPING_COMPANY?.trim().toUpperCase()||null,startAfter=process.env.REFS_WBS_H1_MAPPING_START_AFTER||'sha256:'+'0'.repeat(64),limit=integer(process.env.REFS_WBS_H1_MAPPING_LIMIT||100,'REFS_WBS_H1_MAPPING_LIMIT',{min:1,max:500});
  if(!UUID.test(tenantId)||companyCode!==null&&!COMPANY.test(companyCode)||!SHA.test(startAfter))throw new Error('WBS H1 mapping selection is invalid');
  const config=runtimeConfig(process.env),admin=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-mapping-admin',max:2}),runtime=await createPool({databaseUrl:config.databaseUrl,applicationName:'refs-wbs-h1-mapping-runtime',max:4}),issuerPool=await createPool({databaseUrl:config.contextIssuerDatabaseUrl,applicationName:'refs-wbs-h1-mapping-issuer',max:2});
  const actorIds=Object.fromEntries(ACTORS.map(role=>[role,process.env[`REFS_WBS_TEST_IMPORT_${role.toUpperCase()}_ACTOR_ID`]]));
  const kernelFor=role=>new PostgresAccountingKernel(runtime,{sessionProvider:()=>new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({trusted:true,tenantId,actorId:actorIds[role]})}).issue({tenantId})});
  const maker=kernelFor('maker'),submitter=kernelFor('submitter'),reviewer=kernelFor('reviewer'),approver=kernelFor('approver'),poster=kernelFor('poster');
  try{
    const rows=(await admin.query(CANDIDATE_SQL,[tenantId,companyCode,startAfter,limit])).rows;
    if(process.env.REFS_WBS_H1_MAPPING_DRY_RUN==='1'){
      const counts={};for(const row of rows){const status=resolveWbsH1PayableMapping(row).status;counts[status]=(counts[status]||0)+1;}
      process.stdout.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_PLAN',row_count:rows.length,counts,next_start_after:rows.at(-1)?.source_record_hash??startAfter})}\n`);return;
    }
    const prepare=async decision=>{
      const row=decision.row,memberType=decision.requiresVendor?'VENDOR':null;
      await admin.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active) VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT DO NOTHING`,[tenantId,row.entity_id,decision.accountCode,decision.accountName,decision.requiresVendor,memberType]);
      const account=(await admin.query(`SELECT requires_member,required_member_type,active FROM account_master WHERE tenant_id=$1 AND entity_id=$2 AND account_code=$3`,[tenantId,row.entity_id,decision.accountCode])).rows[0];
      if(!account?.active||account.requires_member!==decision.requiresVendor||account.required_member_type!==memberType)throw new Error(`REFS account master conflicts with WBS setting ${decision.settingId}`);
      const amount=row.amount,suffix=row.source_record_hash.slice(7,27).toUpperCase(),idempotency=`wbs-h1-map:${row.source_record_hash.slice(7,39)}`;
      const draft=await maker.createManualJournal({tenantId,entityId:row.entity_id,periodId:row.period_id,journalNumber:`WBS-MAP-${suffix}`,journalDate:row.accounting_date,currency:'USD',description:`Apply WBS Payable setting ${decision.settingId}`,attachmentIds:[row.attachment_id],idempotencyKey:`${idempotency}:draft`,lines:[{line_no:1,account_code:decision.accountCode,debit_amount:amount,credit_amount:'0.0000',member_ref:decision.requiresVendor?row.member_ref:null,description:`WBS setting ${decision.settingId}: ${decision.accountName}`,dimensions:{project_ref:row.project_code||null,cost_code_ref:row.cost_code||null}},{line_no:2,account_code:'610000',debit_amount:'0.0000',credit_amount:amount,member_ref:null,description:'Reverse controlled-import placeholder expense',dimensions:{project_ref:row.project_code||null,cost_code_ref:row.cost_code||null}}]});
      return {decision,draft,idempotency};
    };
    const complete=async item=>{
      const {decision,draft,idempotency}=item,row=decision.row,journalId=draft.journal_entry_id;
      let state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];
      if(state.status==='DRAFT')await submitter.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'SUBMIT',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:submit`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='PENDING_REVIEW')await reviewer.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'REVIEW',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:review`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='PENDING_APPROVAL')await approver.transitionJournal({tenantId,entityId:row.entity_id,journalEntryId:journalId,action:'APPROVE',expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:approve`});
      state=(await admin.query('SELECT status::text,revision FROM journal_entry WHERE tenant_id=$1 AND entity_id=$2 AND journal_entry_id=$3',[tenantId,row.entity_id,journalId])).rows[0];if(state.status==='APPROVED')await poster.postJournal({tenantId,entityId:row.entity_id,periodId:row.period_id,journalEntryId:journalId,expectedRevision:Number(state.revision),idempotencyKey:`${idempotency}:post`});
      await admin.query(`INSERT INTO source_link(tenant_id,entity_id,link_type,source_document_id,journal_entry_id,created_by) VALUES($1,$2,'SOURCE_TO_JE',$3,$4,$5) ON CONFLICT DO NOTHING`,[tenantId,row.entity_id,row.source_document_id,journalId,actorIds.maker]);
      return {status:'WBS_H1_MAPPING_POSTED',company_code:row.company_code,source_record_hash:row.source_record_hash,journal_entry_id:journalId,mapped_account_code:decision.accountCode,idempotent:draft.idempotent===true};
    };
    const summary=await applyWbsH1PayableMappings({rows,prepare,complete,onProgress:row=>process.stdout.write(`${JSON.stringify(row)}\n`)});process.stdout.write(`${JSON.stringify({...summary,next_start_after:rows.at(-1)?.source_record_hash??startAfter})}\n`);
  }finally{await Promise.allSettled([admin.end(),runtime.end(),issuerPool.end()]);}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_MAPPING_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
