#!/usr/bin/env node
// O01: mapping review workpack for the WBS H1 Payable population.
//
// Pure function over two authenticated, read-only exports the operator makes:
//   settings: GET /entities/{id}/wbs/h1-accounting-settings-proposal?periodId=…   (one per period, or one representative)
//   payables: GET /entities/{id}/wbs/h1-payable-accounting-proposal?periodId=…&limit=200&offset=N  (all pages, all periods)
// It groups every EXCEPTION row by the decision a Controller must actually take, recomputes control totals in
// integer cents, and separates what can be *suggested* from what a human must *decide*.  It never approves,
// never writes, never posts; the output is a review queue plus the exact commands that would consume decisions.
//
//   node server/tools/wbs-h1-mapping-review-workpack.mjs --settings settings.json --payables payables-pages.json [--company-wide-project WBPA]
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

export const WBS_H1_MAPPING_REVIEW_WORKPACK_SCHEMA='WBS_H1_MAPPING_REVIEW_WORKPACK_V1';
const MONEY=/^-?(?:0|[1-9]\d{0,15})\.\d{4}$/;
const cents=value=>{if(typeof value!=='string'||!MONEY.test(value))return null;const neg=value.startsWith('-');const [w,f]=value.replace('-','').split('.');const n=BigInt(w)*10000n+BigInt(f);return neg?-n:n;};
const money=v=>{const neg=v<0n;const a=neg?-v:v;return `${neg?'-':''}${a/10000n}.${String(a%10000n).padStart(4,'0')}`;};

// Decision classes, from least to most human judgement:
//   SETTINGS_APPROVAL_PENDING   rule matched, account exists → the only missing step is the human Settings decision (suggestable)
//   COA_ACCOUNT_TO_CREATE       rule matched, WBS names an account REFS does not have → create/activate account (suggestable, Controller confirms)
//   RULE_SCOPE_COMPANY_WIDE     rule exists for the cost code but is scoped to the company code as its "project"; the matcher treats that as a literal project → semantic decision (must decide)
//   RULE_WITHOUT_ACCOUNT        WBS rule exists but carries no journal_code → Controller must map (must decide)
//   NO_RULE                     no WBS rule for the cost code at all (must decide)
//   CREDIT_RULE_MISSING         no Payable/Credit rule (AP control) matched (must decide once, company-wide)
//   VENDOR_MEMBER_MISSING       vendor master member absent (master data)
//   COST_CODE_MISSING           source row without cost code (data quality)
export function buildMappingReviewWorkpack({settings,payablePages,companyWideProject=null}={}){
  if(!settings||settings.schema_version!=='WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1'||!Array.isArray(settings.rules))throw new Error('settings must be a WBS_H1_ACCOUNTING_SETTINGS_PROPOSAL_V1 document');
  if(!Array.isArray(payablePages)||!payablePages.length)throw new Error('payablePages must be a non-empty array');
  const company=settings.company_code;
  const rows=[];const pageErrors=[];const periods=new Map();
  payablePages.forEach((page,index)=>{
    if(page?.schema_version!=='WBS_H1_PAYABLE_ACCOUNTING_PROPOSAL_V1'||page.company_code!==company){pageErrors.push({page:index,code:'PAGE_SCOPE_DRIFT'});return;}
    const p=periods.get(page.period_code)||{period_code:page.period_code,period_id:page.period_id,declared_source_record_count:page.source_record_count,declared_ready:page.ready_count,declared_exception:page.exception_count,settings_outcome:page.settings_outcome,settings_proposal_hash:page.settings_proposal_hash,rows:0};
    p.rows+=(page.rows||[]).length;periods.set(page.period_code,p);
    for(const row of page.rows||[])rows.push({...row,period_code:page.period_code});
  });
  const rulesByDetail=new Map();for(const rule of settings.rules){const list=rulesByDetail.get(rule.detail)||[];list.push(rule);rulesByDetail.set(rule.detail,list);}
  const wide=companyWideProject||company;
  const classify=row=>{
    const codes=new Set(row.exception_codes||[]);
    const classes=[];
    if(codes.has('COST_CODE_MISSING'))classes.push('COST_CODE_MISSING');
    if(codes.has('VENDOR_MEMBER_NOT_READY')||codes.has('VENDOR_MISSING'))classes.push('VENDOR_MEMBER_MISSING');
    if(codes.has('CREDIT_MAPPING_MISSING'))classes.push('CREDIT_RULE_MISSING');
    const rules=rulesByDetail.get(row.cost_code)||[];
    if(codes.has('DEBIT_ACCOUNT_NOT_READY'))classes.push('COA_ACCOUNT_TO_CREATE');
    else if(codes.has('DEBIT_MAPPING_MISSING')){
      if(!rules.length)classes.push('NO_RULE');
      else{
        const scoped=rules.filter(r=>Array.isArray(r.project_codes)&&r.project_codes.length===1&&r.project_codes[0]===wide);
        if(scoped.length){classes.push('RULE_SCOPE_COMPANY_WIDE');const r=scoped[0];if(r.decision==='ACCOUNT_NOT_READY')classes.push('COA_ACCOUNT_TO_CREATE');else if(r.decision==='MAPPING_MISSING')classes.push('RULE_WITHOUT_ACCOUNT');}
        else if(rules.every(r=>r.decision==='MAPPING_MISSING'))classes.push('RULE_WITHOUT_ACCOUNT');
        else classes.push('RULE_PROJECT_MISMATCH');
      }
    }
    if(codes.has('SETTINGS_NOT_APPROVED')&&!codes.has('DEBIT_MAPPING_MISSING')&&!codes.has('DEBIT_ACCOUNT_NOT_READY')&&!codes.has('CREDIT_MAPPING_MISSING'))classes.push('SETTINGS_APPROVAL_PENDING');
    if(!classes.length&&row.status==='EXCEPTION')classes.push('OTHER_EXCEPTION');
    return classes;
  };
  const items=new Map();const classTotals={};let sum=0n;
  const add=(key,row,extra)=>{const it=items.get(key)||{...extra,rows:0,amount:0n,periods:new Set(),projects:new Set(),exception_codes:new Set()};it.rows++;const c=cents(row.amount);if(c!==null)it.amount+=c;it.periods.add(row.period_code);it.projects.add(row.project_code);for(const e of row.exception_codes||[])it.exception_codes.add(e);items.set(key,it);};
  const accountsToCreate=new Map();
  for(const row of rows){
    const c=cents(row.amount);if(c!==null)sum+=c;
    if(row.status!=='EXCEPTION')continue;
    const classes=classify(row);
    for(const cls of classes){classTotals[cls]=classTotals[cls]||{rows:0,amount:0n};classTotals[cls].rows++;if(c!==null)classTotals[cls].amount+=c;}
    const rules=rulesByDetail.get(row.cost_code)||[];
    const rule=rules.find(r=>Array.isArray(r.project_codes)&&(r.project_codes.length===0||r.project_codes.includes(row.project_code)||(r.project_codes.length===1&&r.project_codes[0]===wide)))||rules[0]||null;
    const debitClass=classes.find(x=>['COA_ACCOUNT_TO_CREATE','RULE_WITHOUT_ACCOUNT','NO_RULE','RULE_PROJECT_MISMATCH','SETTINGS_APPROVAL_PENDING'].includes(x))||'NONE';
    add(`${row.cost_code||'(none)'}|${debitClass}`,row,{cost_code:row.cost_code||null,decision_class:debitClass,company_wide_rule:classes.includes('RULE_SCOPE_COMPANY_WIDE'),rule_decision:rule?.decision||null,rule_account_code:rule?.account_code||null,rule_account_name:rule?.account_name||null,auto_suggestable:['COA_ACCOUNT_TO_CREATE','SETTINGS_APPROVAL_PENDING'].includes(debitClass),must_decide:['RULE_WITHOUT_ACCOUNT','NO_RULE','RULE_PROJECT_MISMATCH'].includes(debitClass)});
    if(debitClass==='COA_ACCOUNT_TO_CREATE'&&rule?.account_code){const a=accountsToCreate.get(rule.account_code)||{account_code:rule.account_code,account_name:rule.account_name||null,rows:0,amount:0n,cost_codes:new Set()};a.rows++;if(c!==null)a.amount+=c;a.cost_codes.add(row.cost_code);accountsToCreate.set(rule.account_code,a);}
  }
  const queue=[...items.values()].map(it=>({...it,amount:money(it.amount),periods:[...it.periods].sort(),projects:it.projects.size,exception_codes:[...it.exception_codes].sort()})).sort((a,b)=>b.rows-a.rows);
  let cum=0;for(const q of queue){cum+=q.rows;q.cumulative_rows=cum;}
  const declared=[...periods.values()].reduce((a,p)=>a+p.declared_source_record_count,0);
  return Object.freeze({
    schema_version:WBS_H1_MAPPING_REVIEW_WORKPACK_SCHEMA,company_code:company,currency:settings.currency,company_wide_project_code:wide,
    settings:{proposal_hash:settings.proposal_hash,status:settings.status,rule_count:settings.rules.length,ready_rule_count:settings.ready_rule_count,blocked_rule_count:settings.blocked_rule_count,exception_count:settings.exception_count,rules_scoped_to_company_code:settings.rules.filter(r=>Array.isArray(r.project_codes)&&r.project_codes.length===1&&r.project_codes[0]===wide).length,rules_without_project_scope:settings.rules.filter(r=>Array.isArray(r.project_codes)&&r.project_codes.length===0).length,rule_decisions:settings.rules.reduce((a,r)=>{a[r.decision]=(a[r.decision]||0)+1;return a;},{})},
    periods:[...periods.values()].sort((a,b)=>a.period_code.localeCompare(b.period_code)),
    control:{rows_read:rows.length,declared_source_record_count:declared,complete:rows.length===declared&&pageErrors.length===0,source_amount:money(sum),page_errors:pageErrors},
    exception_rows:rows.filter(r=>r.status==='EXCEPTION').length,ready_rows:rows.filter(r=>r.status==='READY_FOR_CONTROLLER_REVIEW').length,
    class_totals:Object.fromEntries(Object.entries(classTotals).map(([k,v])=>[k,{rows:v.rows,amount:money(v.amount)}])),
    accounts_to_create:[...accountsToCreate.values()].map(a=>({...a,amount:money(a.amount),cost_codes:[...a.cost_codes].sort()})).sort((a,b)=>b.rows-a.rows),
    review_queue:queue,
    consuming_commands:{
      settings_decision:'POST /entities/{id}/wbs/h1-accounting-settings-decision?periodId=<period>&proposalHash=<settings.proposal_hash> {outcome:APPROVED|REJECTED, reason} (WBS.H1 settings decider; independent of importer)',
      coa_account:'accounting-settings workflow / account_master maintenance under the entity COA authority; never an ad-hoc INSERT',
      credit_rule:'WBS Payable/Credit default rule (detail "") must exist in wbs_h1_accounting_setting_stage — stage from WBS via tools/stage-wbs-h1-accounting-settings.mjs; REFS does not invent it',
      vendor_member:'member_master VENDOR rows via master-data workflow; INTERNAL TEST ONLY data in staging'
    },
    accounting_authority:'NONE',can_approve:false,can_post:false,auto_post:false
  });
}

async function main(){
  const args=process.argv.slice(2);const get=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:null;};
  const settingsFile=get('--settings'),payFile=get('--payables');if(!settingsFile||!payFile){process.stderr.write('usage: --settings settings.json --payables payable-pages.json [--company-wide-project CODE]\n');process.exitCode=2;return;}
  const settings=JSON.parse(readFileSync(settingsFile,'utf8'));const pages=JSON.parse(readFileSync(payFile,'utf8'));
  const pack=buildMappingReviewWorkpack({settings:settings.data||settings,payablePages:(Array.isArray(pages)?pages:[pages]).map(p=>p.data||p),companyWideProject:get('--company-wide-project')});
  process.stdout.write(`${JSON.stringify(pack)}\n`);process.exitCode=pack.control.complete?0:3;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${error.message}\n`);process.exitCode=1;});
