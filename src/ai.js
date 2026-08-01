// AI Accounting Judge — 每笔 source 进入时判断分录 (规格九: 只建议, 不过账)
import { loadSetting } from './settings.js';
import { acct } from './engine.js';
export function aiJudge(source, en){
  // source: {category, type, detail, amount, direction, payee, cost_code, status, description}
  const s = loadSetting(en);
  const R = (dr,cr,rule,conf,reason,risk)=>({
    suggested:{dr, cr, dr_name:acct(dr).account_name, cr_name:acct(cr).account_name},
    confidence:conf, reason, rule_used:rule, setting_used:`${en.entity_code}·2026·${source.category||'Bank Transaction'}`,
    risk, need_human: conf<0.9 || risk!=='LOW',
    evidence: source.description||source.detail||'',
  });
  const find=(rows,f)=>rows.find(f);
  // 1. bank detail exact match
  const bankRow = find(s.account_setting, r=>r.type==='Bank' && r.detail===source.detail);
  if (source.type==='Bank' || bankRow){
    const cash = (bankRow||{}).account||'111000';
    if (source.direction==='CREDIT') return R(cash,'142000','SET-BANK-IN',0.72,'银行进账无匹配业务对象,建议暂挂 Suspense 待识别','MEDIUM');
    return R('142000',cash,'SET-BANK-OUT',0.72,'银行出账未识别,暂挂','MEDIUM');
  }
  // 2. construction loan details
  const clRow = find(s.account_setting, r=>r.type==='Contruction Loan' && r.detail===source.detail);
  if (clRow){
    if (source.detail==='Draw') return R('111000', clRow.account, 'SET-CL-DRAW', 0.97, 'Draw=贷款资金流入: Dr Cash / Cr Loan Payable(公司配置)', 'LOW');
    if (source.detail==='Repayment') return R(clRow.account,'111000','SET-CL-REPAY',0.96,'还本: 按公司配置借记 '+clRow.account,'LOW');
    if (source.detail==='Interest payment') return R(clRow.account,'111000','SET-CL-INT',0.93,'付息按该公司配置挂 '+clRow.account+'(Due to/from 模式)','LOW');
    return R(clRow.account,'111000','SET-CL-'+source.detail,0.9,'按 Account Setting 行匹配','LOW');
  }
  // 3. cost by cost_code prefix + status
  if (source.cost_code){
    const p = source.cost_code.slice(0,3);
    if (['0LD'].includes(p)) return R('164100','220300','SET-COST-0LD',0.95,'Land Dev 成本码→CWIP-Land','LOW');
    if (['2HD'].includes(p)) return source.status==='COMPLETED'
      ? R('510000','220300','SET-COST-2HD-DONE',0.92,'Hard cost+完工→COGS(状态驱动)','LOW')
      : R('164400','220300','SET-COST-2HD',0.95,'Hard cost+在建→CWIP','LOW');
    if (['24E','21E'].includes(p)) return R(p==='24E'?'705002':'705001','291001','SET-PAY-'+p,0.94,'公司费用码→'+(p==='24E'?'Outsourcing':'R&D')+' / Cr Due to/from_'+(source.payee||''),'LOW');
    if (['9AM'].includes(p)) return R('792000','291001','SET-COST-9AM',0.9,'资管费码','LOW');
  }
  // 4. dividend / sales
  if (source.type==='Dividend') return R('291000','111000','SET-DIV',0.94,'业主分红: Dr Due to/from_业主 / Cr Cash(+220204 代扣)','LOW');
  if (source.type==='Sales income') return R('111000','491800','SET-SALE',0.93,'售房回款: Confirmed→491800, Title Withholding→220205','LOW');
  return R('142000','142000','AI-UNKNOWN',0.4,'无匹配 Setting: 转 Exception, 需人工分类','HIGH');
}
