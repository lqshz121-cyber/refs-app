// R08 step A/B: controlled Chart of Accounts seeding for WBS companies.
//
// The WBS accounting Settings (wbs_h1_accounting_setting_stage) carry the account code and name that
// each Payable debit/credit rule posts to; REFS entities provisioned from the template carry only the
// seed accounts. Every such rule therefore stops at ACCOUNT_NOT_READY. This module
//   A. proposes (read-only) the missing accounts per company, deduplicated, with every inferred
//      attribute labelled, and hashes the proposal;
//   B. applies a human decision on that exact proposal: approved rows are inserted, nothing else.
// It never activates or edits an existing account, never guesses between conflicting names, never
// touches Settings, members, drafts or postings, and refuses a decision whose proposal has drifted.
import {createHash} from 'node:crypto';

export const COA_SEED_PROPOSAL_SCHEMA='WBS_COA_SEED_PROPOSAL_V1';
export const COA_SEED_DECISION_SCHEMA='WBS_COA_SEED_DECISION_V1';
export const COA_SEED_RECEIPT_SCHEMA='WBS_COA_SEED_APPLY_RECEIPT_V1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const MEMBER_TYPES=new Set(['VENDOR','CUSTOMER_OR_AFFILIATE','BANK']);

const canonical=value=>{
  if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;
  if(value&&typeof value==='object')return `{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
export const hashCanonical=value=>`sha256:${createHash('sha256').update(canonical(value)).digest('hex')}`;

// Member requirement is inferred from the code family only, and always marked inferred so the
// approver sees it. 291xxx is Accounts Payable (vendor sub-ledger), 120200 Accounts Receivable
// (customer/affiliate), 111xxx cash (bank). Everything else is a plain ledger account.
export function inferMemberRequirement(code){
  if(/^291/.test(code))return {requires_member:true,required_member_type:'VENDOR',inference_rule:'CODE_291_AP_VENDOR'};
  if(code==='120200')return {requires_member:true,required_member_type:'CUSTOMER_OR_AFFILIATE',inference_rule:'CODE_120200_AR'};
  if(/^111/.test(code))return {requires_member:true,required_member_type:'BANK',inference_rule:'CODE_111_CASH_BANK'};
  return {requires_member:false,required_member_type:null,inference_rule:'DEFAULT_NO_MEMBER'};
}

const PROPOSAL_SQL=`
  WITH refs AS (
    SELECT s.company_code,s.journal_code account_code,btrim(s.account_name) account_name,upper(s.setting_type) side,count(*)::int settings
    FROM wbs_h1_accounting_setting_stage s
    WHERE s.tenant_id=$1 AND s.business_type=4 AND s.category='Payable' AND s.journal_code<>''
      AND ($2::text[] IS NULL OR s.company_code=ANY($2::text[]))
    GROUP BY 1,2,3,4)
  SELECT r.company_code,e.entity_id,
    (SELECT count(*)::int FROM account_master x WHERE x.tenant_id=$1 AND x.entity_id=e.entity_id) existing_account_count,
    r.account_code,a.account_code IS NOT NULL present,coalesce(a.active,false) active,
    array_agg(DISTINCT r.account_name ORDER BY r.account_name) FILTER (WHERE r.account_name<>'') names,
    array_agg(DISTINCT r.side ORDER BY r.side) sides,sum(r.settings)::int setting_count
  FROM refs r
  LEFT JOIN entity e ON e.tenant_id=$1 AND e.source_system='WBS' AND e.source_entity_id=r.company_code AND e.active
  LEFT JOIN account_master a ON a.tenant_id=$1 AND a.entity_id=e.entity_id AND a.account_code=r.account_code
  GROUP BY r.company_code,e.entity_id,r.account_code,a.account_code,a.active
  ORDER BY r.company_code,r.account_code`;

export async function buildCoaSeedProposal(client,{tenantId,companyCodes=null}={}){
  if(!UUID.test(tenantId||''))throw new Error('tenantId must be a UUID');
  const rows=(await client.query(PROPOSAL_SQL,[tenantId,companyCodes])).rows;
  const companies=new Map();
  const unmapped=new Set();
  for(const row of rows){
    if(!row.entity_id){unmapped.add(row.company_code);continue;}
    if(row.present&&row.active)continue; // already ready: nothing to propose
    let company=companies.get(row.company_code);
    if(!company){company={company_code:row.company_code,entity_id:row.entity_id,existing_account_count:row.existing_account_count,items:[]};companies.set(row.company_code,company);}
    const names=row.names||[];
    const status=row.present?'EXISTS_INACTIVE':names.length===1?'PROPOSED':names.length===0?'NAME_MISSING':'NAME_CONFLICT';
    company.items.push({account_code:row.account_code,status,account_name:status==='PROPOSED'?names[0]:null,name_candidates:names,
      ...inferMemberRequirement(row.account_code),inferred:true,referenced_by:{sides:row.sides,setting_count:row.setting_count}});
  }
  const body={schema_version:COA_SEED_PROPOSAL_SCHEMA,tenant_id:tenantId,source:'wbs_h1_accounting_setting_stage business_type=4 Payable',
    company_scope:companyCodes?[...companyCodes].sort():null,unmapped_company_codes:[...unmapped].sort(),
    companies:[...companies.values()],
    totals:{companies:companies.size,items:[...companies.values()].reduce((s,c)=>s+c.items.length,0),
      proposed:[...companies.values()].reduce((s,c)=>s+c.items.filter(i=>i.status==='PROPOSED').length,0),
      name_conflicts:[...companies.values()].reduce((s,c)=>s+c.items.filter(i=>i.status==='NAME_CONFLICT').length,0),
      exists_inactive:[...companies.values()].reduce((s,c)=>s+c.items.filter(i=>i.status==='EXISTS_INACTIVE').length,0)},
    accounting_authority:'PROPOSAL_ONLY'};
  return {...body,proposal_hash:hashCanonical(body)};
}

// Shape of a decision: the approver signs the exact proposal hash and lists what to create.
export function assertCoaSeedDecision(decision){
  const errors=[];
  if(decision?.schema_version!==COA_SEED_DECISION_SCHEMA)errors.push('schema_version');
  if(!/^sha256:[0-9a-f]{64}$/.test(decision?.proposal_hash||''))errors.push('proposal_hash');
  if(typeof decision?.approved_by!=='string'||!/^[^\s][^\n]{2,299}$/.test(decision.approved_by))errors.push('approved_by');
  if(Number.isNaN(Date.parse(decision?.approved_at||'')))errors.push('approved_at');
  if(typeof decision?.reason!=='string'||decision.reason.trim().length<8)errors.push('reason');
  if(!Array.isArray(decision?.decisions)||!decision.decisions.length)errors.push('decisions');
  const seen=new Set();
  for(const [i,d] of (decision?.decisions||[]).entries()){
    const key=`${d?.company_code}|${d?.account_code}`;
    if(seen.has(key))errors.push(`decisions[${i}] duplicate`);seen.add(key);
    if(!['APPROVE','REJECT'].includes(d?.decision))errors.push(`decisions[${i}].decision`);
    if(!CODE.test(d?.account_code||''))errors.push(`decisions[${i}].account_code`);
    if(d?.decision==='APPROVE'){
      if(typeof d.account_name!=='string'||!d.account_name.trim()||d.account_name.length>255||/[\u0000-\u001f]/.test(d.account_name))errors.push(`decisions[${i}].account_name`);
      if(typeof d.requires_member!=='boolean')errors.push(`decisions[${i}].requires_member`);
      if(d.requires_member?!MEMBER_TYPES.has(d.required_member_type):d.required_member_type!==null)errors.push(`decisions[${i}].required_member_type`);
    }
  }
  if(errors.length){const e=new Error(`Invalid COA seed decision: ${errors.join(', ')}`);e.code='COA_SEED_DECISION_INVALID';throw e;}
  return decision;
}

// B. Applies a decision in one transaction. The proposal is rebuilt inside the transaction (with the
// account rows locked) and must hash to the signed value, so the approver's view is exactly what is
// written. Re-running the same decision is a no-op that returns the first receipt's shape.
export async function applyCoaSeedDecision(client,{tenantId,decision}){
  assertCoaSeedDecision(decision);
  const decisionHash=hashCanonical(decision);
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  try{
    await client.query("SELECT set_config('statement_timeout','0',true)");
    const previous=(await client.query("SELECT entity_id,metadata FROM audit_event WHERE tenant_id=$1 AND event_type='WBS_COA_SEED_APPLIED' AND idempotency_key=$2 ORDER BY entity_id",[tenantId,decisionHash])).rows;
    if(previous.length){await client.query('ROLLBACK');return {schema_version:COA_SEED_RECEIPT_SCHEMA,status:'ALREADY_APPLIED',decision_hash:decisionHash,companies:previous.map(r=>({entity_id:r.entity_id,inserted:r.metadata.inserted}))};}
    const scope=[...new Set(decision.decisions.map(d=>d.company_code))].sort();
    const proposal=await buildCoaSeedProposal(client,{tenantId,companyCodes:decision.company_scope??null});
    if(proposal.proposal_hash!==decision.proposal_hash){const e=new Error('The COA seed proposal changed since it was approved; rebuild and approve again');e.code='COA_SEED_PROPOSAL_DRIFT';throw e;}
    const byKey=new Map(proposal.companies.flatMap(c=>c.items.map(i=>[`${c.company_code}|${i.account_code}`,{company:c,item:i}])));
    const perCompany=new Map();
    for(const d of decision.decisions){
      const hit=byKey.get(`${d.company_code}|${d.account_code}`);
      if(!hit){const e=new Error(`${d.company_code} ${d.account_code} is not in the approved proposal`);e.code='COA_SEED_ITEM_UNKNOWN';throw e;}
      if(d.decision==='REJECT')continue;
      if(hit.item.status==='EXISTS_INACTIVE'){const e=new Error(`${d.company_code} ${d.account_code} exists inactive; reactivation is not a seed decision`);e.code='COA_SEED_ITEM_NOT_SEEDABLE';throw e;}
      if(hit.item.status==='NAME_MISSING'&&!d.account_name?.trim()){const e=new Error(`${d.company_code} ${d.account_code} needs an explicit name`);e.code='COA_SEED_ITEM_NOT_SEEDABLE';throw e;}
      if(hit.item.status==='NAME_CONFLICT'&&!hit.item.name_candidates.includes(d.account_name)&&d.name_override!==true){const e=new Error(`${d.company_code} ${d.account_code}: choose one of the WBS names or set name_override`);e.code='COA_SEED_NAME_UNRESOLVED';throw e;}
      const list=perCompany.get(hit.company.entity_id)??{company_code:d.company_code,rows:[]};list.rows.push(d);perCompany.set(hit.company.entity_id,list);
    }
    const companies=[];
    for(const [entityId,{company_code,rows}] of perCompany){
      const inserted=[];
      for(const d of rows){
        const r=await client.query(`INSERT INTO account_master(tenant_id,entity_id,account_code,account_name,requires_member,required_member_type,active)
          VALUES($1,$2,$3,$4,$5,$6,true) ON CONFLICT(tenant_id,entity_id,account_code) DO NOTHING RETURNING account_code`,
          [tenantId,entityId,d.account_code,d.account_name.trim(),d.requires_member,d.required_member_type]);
        if(r.rowCount)inserted.push(d.account_code);
      }
      const metadata={schema_version:COA_SEED_RECEIPT_SCHEMA,company_code,proposal_hash:decision.proposal_hash,decision_hash:decisionHash,approved_at:decision.approved_at,inserted,inserted_count:inserted.length};
      await client.query(`INSERT INTO audit_event(tenant_id,entity_id,event_type,object_type,object_id,action,actor_id,actor_type,permission_used,request_id,correlation_id,idempotency_key,after_hash,reason,metadata)
        VALUES($1,$2,'WBS_COA_SEED_APPLIED','ENTITY_CHART_OF_ACCOUNTS',$2,'SEED',$3,'USER',NULL,$4,$4,$4,$5,$6,$7)`,
        [tenantId,entityId,decision.approved_by,decisionHash,hashCanonical(metadata),decision.reason.trim(),metadata]);
      companies.push({company_code,entity_id:entityId,inserted});
    }
    await client.query('COMMIT');
    return {schema_version:COA_SEED_RECEIPT_SCHEMA,status:'APPLIED',decision_hash:decisionHash,proposal_hash:decision.proposal_hash,scope,
      companies,inserted_total:companies.reduce((s,c)=>s+c.inserted.length,0),rejected:decision.decisions.filter(d=>d.decision==='REJECT').length};
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}
}
