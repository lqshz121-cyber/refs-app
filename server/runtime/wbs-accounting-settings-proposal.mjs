import {canonicalRequestHash} from './request-hash.mjs';

const ACCOUNT=/^[A-Z0-9][A-Z0-9._-]{0,63}$/i;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const ACTIONS=Object.freeze({can_create_draft:false,can_submit:false,can_review:false,can_approve:false,can_post:false});

const fail=(message)=>{const error=new Error(message);error.code='WBS_ACCOUNTING_SETTINGS_PROPOSAL_INVALID';throw error;};
const text=(value,max,{empty=false}={})=>{const out=value==null?'':String(value).trim();if((!empty&&!out)||out.length>max||CONTROL.test(out))fail('WBS accounting setting contains invalid text.');return out;};
const strictDate=value=>{const raw=typeof value==='string'?value.trim().slice(0,10):'';if(!DATE.test(raw))fail('WBS accounting setting has an invalid effective date.');const [y,m,d]=raw.split('-').map(Number),date=new Date(0);date.setUTCHours(0,0,0,0);date.setUTCFullYear(y,m-1,d);if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)fail('WBS accounting setting has an invalid calendar date.');return raw;};
const immutable=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;};
const overlaps=(a,b)=>a.effective_from<=(b.effective_to??'9999-12-31')&&b.effective_from<=(a.effective_to??'9999-12-31');

export function normalizeWbsAccountingSettingEvidence(row){
  const settingId=Number(row?.id??row?.setting_id),companyCode=text(row?.company_code,64),settingType=text(row?.type??row?.setting_type,64),category=text(row?.category,64),businessType=Number(row?.business_type),detail=text(row?.detail,128,{empty:true}),projectCodes=text(row?.pj_code??row?.project_codes,4000,{empty:true}),accountCode=text(row?.journal_code??row?.account_code,64,{empty:true}),accountName=text(row?.account??row?.account_name,255,{empty:true}),supplementary=text(row?.supplementary,64,{empty:true}),effectiveFrom=strictDate(row?.start_date??row?.effective_from),effectiveTo=strictDate(row?.end_date??row?.effective_to);
  if(!Number.isSafeInteger(settingId)||settingId<1||!COMPANY.test(companyCode)||!Number.isSafeInteger(businessType)||businessType<0||effectiveFrom>effectiveTo)fail('WBS accounting setting identity is invalid.');
  if(accountCode!==''&&!ACCOUNT.test(accountCode))fail('WBS accounting setting account code is invalid.');
  const core={wbs_setting_id:String(settingId),company_code:companyCode,setting_type:settingType,category,business_type:businessType,detail,project_codes:projectCodes===''?[]:projectCodes.split(',').map(value=>value.trim()).filter(Boolean),account_code:accountCode===''?null:accountCode,account_name:accountName===''?null:accountName,supplementary:supplementary===''?null:supplementary,effective_from:effectiveFrom,effective_to:effectiveTo};
  return immutable({...core,source_setting_hash:canonicalRequestHash(core)});
}

export function buildWbsAccountingSettingsProposal({rows,companyCode,periodStart,periodEnd,categories=null}={}){
  if(!Array.isArray(rows)||rows.length===0||rows.length>10000||!COMPANY.test(companyCode||''))fail('WBS accounting settings proposal scope is invalid.');
  const start=strictDate(periodStart),end=strictDate(periodEnd);if(start>end)fail('WBS accounting settings proposal period is invalid.');
  const normalized=rows.map(normalizeWbsAccountingSettingEvidence);if(normalized.some(row=>row.company_code!==companyCode))fail('WBS accounting settings proposal mixes companies.');
  if(categories!==null&&(!Array.isArray(categories)||categories.length===0||categories.some(value=>typeof value!=='string'||!value.trim())||new Set(categories).size!==categories.length))fail('WBS accounting settings proposal categories are invalid.');
  const includedCategories=categories===null?[...new Set(normalized.map(row=>row.category))].sort():[...categories].sort(),effective=normalized.filter(row=>includedCategories.includes(row.category)&&row.effective_from<=start&&row.effective_to>=end),exceptions=[];
  for(const row of effective)if((row.account_code===null||row.account_name===null)&&row.detail!=='')exceptions.push({code:'WBS_SETTING_ACCOUNT_UNMAPPED',wbs_setting_id:row.wbs_setting_id});
  const usable=effective.filter(row=>row.account_code!==null&&row.account_name!==null),selectionMode=row=>row.category==='Payable'&&row.setting_type==='Debit'&&row.detail!==''?'COST_CODE':row.category==='Bank Transaction'&&row.detail!==''?'TRANSACTION_DETAIL':'SOURCE_ACCOUNT_CONFIRMATION',byKey=new Map();
  for(const row of usable){
    const mode=selectionMode(row),key=[mode,row.category,row.setting_type,row.detail,mode==='TRANSACTION_DETAIL'?row.supplementary??'':row.project_codes.join('|')].join('::'),prior=byKey.get(key)??[];
    if(mode!=='SOURCE_ACCOUNT_CONFIRMATION')for(const other of prior)if(overlaps(row,other)&&(row.account_code!==other.account_code||row.supplementary!==other.supplementary))exceptions.push({code:'WBS_SETTING_EFFECTIVE_MAPPING_AMBIGUOUS',wbs_setting_id:row.wbs_setting_id,conflicting_wbs_setting_id:other.wbs_setting_id});
    prior.push(row);byKey.set(key,prior);
  }
  const mappedRules=usable.map(row=>({rule_id:`WBS-${row.wbs_setting_id}`,wbs_setting_id:row.wbs_setting_id,source_setting_hash:row.source_setting_hash,selection_mode:selectionMode(row),decision:'MAPPED',category:row.category,setting_type:row.setting_type,business_type:row.business_type,detail:row.detail,project_codes:[...row.project_codes],account_code:row.account_code,account_name:row.account_name,supplementary:row.supplementary,effective_from:row.effective_from,effective_to:row.effective_to}));
  const blockedRules=effective.filter(row=>row.account_code===null&&row.account_name===null&&row.detail==='').map(row=>({rule_id:`WBS-${row.wbs_setting_id}`,wbs_setting_id:row.wbs_setting_id,source_setting_hash:row.source_setting_hash,selection_mode:'BLOCKED_DEFAULT',decision:'BLOCKED',category:row.category,setting_type:row.setting_type,business_type:row.business_type,detail:row.detail,project_codes:[...row.project_codes],account_code:null,account_name:null,supplementary:row.supplementary,effective_from:row.effective_from,effective_to:row.effective_to}));
  const rules=[...mappedRules,...blockedRules].sort((a,b)=>Number(a.wbs_setting_id)-Number(b.wbs_setting_id));
  const uniqueExceptions=[...new Map(exceptions.map(row=>[canonicalRequestHash(row),row])).values()],status=uniqueExceptions.length?'EXCEPTION':'READY_FOR_HUMAN_REVIEW';
  const core={schema_version:'WBS_ACCOUNTING_SETTINGS_PROPOSAL_V1',status,company_code:companyCode,period_start:start,period_end:end,included_categories:includedCategories,source_row_count:normalized.length,effective_row_count:effective.length,rule_count:rules.length,rules,exceptions:uniqueExceptions,action_flags:ACTIONS};
  return immutable({...core,proposal_hash:canonicalRequestHash(core)});
}

export {ACTIONS as WBS_ACCOUNTING_SETTINGS_PROPOSAL_ACTIONS};
