// AI Accounting Judge: advises on a source entry; it does not post.
import { loadSetting } from './settings.js';
import { acct } from './engine.js';
import { repo } from './repo.js';
const AI_MODEL='rules-v2.3'; const PROMPT_V='settings-2026.08';
const digest=(o)=>{ const s=JSON.stringify(o); let h=0; for(let i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))|0;} return 'D'+Math.abs(h).toString(36); };
export const logAI=(entry)=>{ const log=repo.load('ai_log',[]); log.unshift({ts:new Date().toISOString().slice(0,19).replace('T',' '), model:AI_MODEL, prompt_version:PROMPT_V, ...entry}); repo.save('ai_log', log.slice(0,200)); };
export function aiJudge(source, en, opts){
  // source: {category, type, detail, amount, direction, payee, cost_code, status, description}
  const s = loadSetting(en);
  const R = (dr,cr,rule,conf,reason,risk)=>_wrap({
    suggested:{dr, cr, dr_name:acct(dr).account_name, cr_name:acct(cr).account_name},
    confidence:conf, reason, rule_used:rule, setting_used:`${en.entity_code}·2026·${source.category||'Bank Transaction'}`,
    risk, need_human: conf<0.9 || risk!=='LOW',
    evidence: source.description||source.detail||'',
  });
  const _wrap = (r)=>{ if(!opts||!opts.silent) logAI({input_digest:digest(source), input_summary:(source.category||'')+'/'+(source.type||'')+'/'+(source.detail||source.cost_code||'').slice(0,20), entity:en.entity_code, suggested:r.suggested, confidence:r.confidence, rule:r.rule_used, risk:r.risk}); return r; };
  const find=(rows,f)=>rows.find(f);
  // 1. bank detail exact match
  const bankRow = find(s.account_setting, r=>r.type==='Bank' && r.detail===source.detail);
  if (source.type==='Bank' || bankRow){
    const cash = (bankRow||{}).account||'111000';
    if (source.direction==='CREDIT') return R(cash,'142000','SET-BANK-IN',0.72,'Incoming bank transaction has no matched business object; hold in suspense for review.','MEDIUM');
    return R('142000',cash,'SET-BANK-OUT',0.72,'Outgoing bank transaction is unidentified; hold in suspense.','MEDIUM');
  }
  // 2. construction loan details
  const clRow = find(s.account_setting, r=>r.type==='Contruction Loan' && r.detail===source.detail);
  if (clRow){
    if (source.detail==='Draw') return R('111000', clRow.account, 'SET-CL-DRAW', 0.97, 'Loan draw: debit cash and credit the entity-configured loan payable account.', 'LOW');
    if (source.detail==='Repayment') return R(clRow.account,'111000','SET-CL-REPAY',0.96,'Principal repayment: debit the entity-configured account '+clRow.account+'.','LOW');
    if (source.detail==='Interest payment') return R(clRow.account,'111000','SET-CL-INT',0.93,'Interest payment is mapped to '+clRow.account+' under the due-to/from configuration.','LOW');
    return R(clRow.account,'111000','SET-CL-'+source.detail,0.9,'Matched against the Account Setting row.','LOW');
  }
  // 3. cost by cost_code prefix + status
  if (source.cost_code){
    const p = source.cost_code.slice(0,3);
    if (['0LD'].includes(p)) return R('164100','220300','SET-COST-0LD',0.95,'Land-development cost code maps to CWIP - Land.','LOW');
    if (['2HD'].includes(p)) return source.status==='COMPLETED'
      ? R('510000','220300','SET-COST-2HD-DONE',0.92,'Completed hard cost maps to COGS under the status-driven rule.','LOW')
      : R('164400','220300','SET-COST-2HD',0.95,'Construction-in-progress hard cost maps to CWIP.','LOW');
    if (['24E','21E'].includes(p)) return R(p==='24E'?'705002':'705001','291001','SET-PAY-'+p,0.94,'Entity expense code maps to '+(p==='24E'?'Outsourcing':'R&D')+'; credit due to/from '+(source.payee||'counterparty')+'.','LOW');
    if (['9AM'].includes(p)) return R('792000','291001','SET-COST-9AM',0.9,'Asset-management fee code.','LOW');
  }
  // 4. dividend / sales
  if (source.type==='Dividend') return R('291000','111000','SET-DIV',0.94,'Owner distribution: debit due to/from owner and credit cash plus any withholding tax.','LOW');
  if (source.type==='Sales income') return R('111000','491800','SET-SALE',0.93,'Sale proceeds: confirmed amount maps to 491800; title withholding maps to 220205.','LOW');
  return R('142000','142000','AI-UNKNOWN',0.4,'No matching setting: create an exception for manual classification.','HIGH');
}
