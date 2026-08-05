// Rules-based accounting recommender. It proposes entries and never posts them.
import { loadSetting } from './settings.js';
import { acct } from './engine.js';
import { repo } from './repo.js';
const AI_MODEL='rules-v2.3'; const PROMPT_V='settings-2026.08';
const digest=o=>{const s=JSON.stringify(o);let h=0;for(let i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))|0;return 'D'+Math.abs(h).toString(36);};
export const logAI=entry=>{const log=repo.load('ai_log',[]);log.unshift({ts:new Date().toISOString().slice(0,19).replace('T',' '),model:AI_MODEL,prompt_version:PROMPT_V,...entry});repo.save('ai_log',log.slice(0,200));};
export function aiJudge(source,en,opts){
 const s=loadSetting(en); const wrap=r=>{if(!opts||!opts.silent)logAI({input_digest:digest(source),input_summary:(source.category||'')+'/'+(source.type||'')+'/'+(source.detail||source.cost_code||'').slice(0,20),entity:en.entity_code,suggested:r.suggested,confidence:r.confidence,rule:r.rule_used,risk:r.risk});return r;};
 const R=(dr,cr,rule,confidence,reason,risk)=>wrap({suggested:{dr,cr,dr_name:acct(dr).account_name,cr_name:acct(cr).account_name},confidence,reason,rule_used:rule,setting_used:`${en.entity_code}-2026-${source.category||'Bank Transaction'}`,risk,need_human:confidence<0.9||risk!=='LOW',evidence:source.description||source.detail||''});
 const find=(rows,f)=>rows.find(f); const bankRow=find(s.account_setting,r=>r.type==='Bank'&&r.detail===source.detail);
 if(source.type==='Bank'||bankRow){const cash=(bankRow||{}).account||'111000';return source.direction==='CREDIT'?R(cash,'142000','SET-BANK-IN',0.72,'Unmatched bank credit; hold in Suspense pending identification.','MEDIUM'):R('142000',cash,'SET-BANK-OUT',0.72,'Unidentified bank debit; hold in Suspense.','MEDIUM');}
 const clRow=find(s.account_setting,r=>r.type==='Contruction Loan'&&r.detail===source.detail);
 if(clRow){if(source.detail==='Draw')return R('111000',clRow.account,'SET-CL-DRAW',0.97,'Loan draw: Dr Cash / Cr Loan Payable, using the company setting.','LOW');if(source.detail==='Repayment')return R(clRow.account,'111000','SET-CL-REPAY',0.96,`Loan repayment: debit ${clRow.account} under the company setting.`,'LOW');if(source.detail==='Interest payment')return R(clRow.account,'111000','SET-CL-INT',0.93,`Interest payment: use ${clRow.account} under the company setting.`,'LOW');return R(clRow.account,'111000','SET-CL-'+source.detail,0.9,'Matched to the Account Setting row.','LOW');}
 if(source.cost_code){const p=source.cost_code.slice(0,3);if(p==='0LD')return R('164100','220300','SET-COST-0LD',0.95,'Land-development cost code to CWIP-Land.','LOW');if(p==='2HD')return source.status==='COMPLETED'?R('510000','220300','SET-COST-2HD-DONE',0.92,'Completed hard cost to COGS.','LOW'):R('164400','220300','SET-COST-2HD',0.95,'Construction hard cost to CWIP.','LOW');if(['24E','21E'].includes(p))return R(p==='24E'?'705002':'705001','291001','SET-PAY-'+p,0.94,`Company expense code to ${p==='24E'?'Outsourcing':'R&D'}; credit Due to/from ${source.payee||''}.`,'LOW');if(p==='9AM')return R('792000','291001','SET-COST-9AM',0.9,'Asset-management fee code.','LOW');}
 if(source.type==='Dividend')return R('291000','111000','SET-DIV',0.94,'Owner dividend: Dr Due to/from Owner / Cr Cash, with tax payable when applicable.','LOW');
 if(source.type==='Sales income')return R('111000','491800','SET-SALE',0.93,'Sales receipt: Confirmed amount to revenue; Title Withholding to the withholding liability.','LOW');
 return R('142000','142000','AI-UNKNOWN',0.4,'No controlled setting matched. Route to an exception for human classification.','HIGH');
}
