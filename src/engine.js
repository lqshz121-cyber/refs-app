import { COA, MAPPINGS, PROJECTS, PROPERTIES } from './data.js';

const COA_MAP = Object.fromEntries(COA.map(a=>[a.account_code,a]));
export const acct = (code) => COA_MAP[code] || (WBS_COA_MAP[code] ? {account_code:code, account_name:WBS_COA_MAP[code].name, account_type: code[0]==='1'?'ASSET':code[0]==='2'?'LIABILITY':code[0]==='3'?'EQUITY':code[0]==='4'?'REVENUE':'EXPENSE', normal_balance:WBS_COA_MAP[code].nb} : {account_code:code, account_name:'?', account_type:'ASSET', normal_balance:'DEBIT'});
export const money = (n) => (n==null?'':(n<0?'(':'')+'$'+Math.abs(n).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+(n<0?')':''));
import { WBS_COA_MAP, subsidiaryOf, memberOf } from './coa-wbs.js';
import { PERIOD_CLOSED, PERIOD_NOT_CONFIGURED, PERIOD_STATUS_NOT_CONFIGURED } from './period-control.js';
export const sum = (arr,f)=>arr.reduce((s,x)=>s+(f?f(x):x),0);
export const ENGINE_RULE_CATALOG=[
  {rule_code:'R-LOAN-01',trigger:'LOAN.DRAW'},
  {rule_code:'R-LOAN-03',trigger:'LOAN.INTEREST_ACCRUAL'},
  {rule_code:'R-LOAN-04',trigger:'LOAN.INTEREST_ACCRUAL'},
  {rule_code:'R-LOAN-05',trigger:'LOAN.INTEREST_PAYMENT'},
  {rule_code:'R-LOAN-08',trigger:'LOAN.REPAYMENT'},
  {rule_code:'R-PM-16',trigger:'PM.SECURITY_DEPOSIT'},
];
export function downloadCSV(filename, rows){ const csv=rows.map(r=>r.map(c=>{const s=String(c==null?'':c); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;}).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); URL.revokeObjectURL(a.href); }

// ---- JE helpers ----
export const jeTotals = (je) => ({
  debit: sum(je.lines, l=>l.debit_amount||0),
  credit: sum(je.lines, l=>l.credit_amount||0),
});
export const isBalanced = (je) => { const t=jeTotals(je); return Math.abs(t.debit-t.credit) < 0.005 && t.debit>0; };

// ---- Period control (fail closed) ----
// Returns null only when the supplied period control record affirmatively says
// OPEN. Anything else - no record, a record with no status, NOT_CONFIGURED,
// CLOSED, LOCKED - blocks, and names which of the two it is so the user is told
// the actual reason rather than a generic failure.
export function postingPeriodError(period, je) {
  const entityLabel = je?.entity_id ?? period?.entity_id ?? 'not set';
  const periodLabel = je?.period_code || period?.period_code || 'not set';
  if (!period || period.configured === false || !period.status || period.status === PERIOD_STATUS_NOT_CONFIGURED) {
    return {code:PERIOD_NOT_CONFIGURED, msg:`Period control missing: entity ${entityLabel} has no period record for ${periodLabel}. A missing period record is not an open period, so posting is blocked until period administration opens it.`};
  }
  if (period.status !== 'OPEN') {
    return {code:PERIOD_CLOSED, msg:`Period ${periodLabel} is ${period.status} for entity ${entityLabel}. Correct a closed period by reversal in an open period.`};
  }
  return null;
}

// ---- Validation catalog (subset, enforced) ----
export function validateJE(je, period) {
  const errs = [];
  je.lines.forEach((l,i)=>{ const st=subsidiaryOf(l.account_code);
    if (st && !memberOf(l)) errs.push({code:'4020', msg:`Line ${i+1}: ${l.account_code} requires a ${st} member.`}); });
  const t = jeTotals(je);
  if (t.debit <= 0) errs.push({code:'VAL-001', msg:'Journal amount is required.'});
  if (Math.abs(t.debit - t.credit) >= 0.005) errs.push({code:'4006', msg:`Journal is out of balance: debit ${money(t.debit)}, credit ${money(t.credit)}.`});
  je.lines.forEach((l,i)=>{
    const bothZero = (!l.debit_amount && !l.credit_amount);
    const both = (l.debit_amount>0 && l.credit_amount>0);
    if (bothZero) errs.push({code:'VAL-002', msg:`Line ${i+1}: enter either a debit or credit.`});
    if (both) errs.push({code:'VAL-003', msg:`Line ${i+1}: debit and credit cannot both have a value.`});
    if (!l.account_code) errs.push({code:'VAL-004', msg:`Line ${i+1}: account is required.`});
  });
  // Period control fails CLOSED. A period object that is absent, or that
  // carries no affirmative OPEN status, is not permission to post - it means
  // no period was opened. Callers that only want the arithmetic checks (see
  // src/bank-workflow.js) filter this catalog by code and are unaffected.
  const periodError = postingPeriodError(period, je);
  if (periodError) errs.push(periodError);
  if (je.je_type === 'MANUAL' && je.has_attachment === false) errs.push({code:'4010', msg:'Manual journal entries require an attachment before posting.'});
  return errs;
}

// ---- State machine for JE ----
export const JE_FLOW = {
  DRAFT:            {next:'PENDING_REVIEW',   action:'Submit for review', perm:'GL.JE.CREATE'},
  PENDING_REVIEW:   {next:'PENDING_APPROVAL', action:'Approve review', perm:'GL.JE.REVIEW', reject:'DRAFT'},
  PENDING_APPROVAL: {next:'APPROVED',         action:'Approve journal', perm:'GL.JE.APPROVE', reject:'DRAFT'},
  APPROVED:         {next:'POSTED',           action:'Post journal', perm:'GL.JE.POST'},
  POSTED:           {next:null,               action:null},
  REVERSED:         {next:null,               action:null},
};

// ---- Rule engine: generate draft JE from a source transaction ----
// Capitalization decision driven by construction_status (spec R-LOAN-03/04)
export function loanRule(txn) {
  const cap = txn.construction_status === 'UNDER_CONSTRUCTION';
  switch (txn.txn_type) {
    case 'DRAW':
      // Blueprint 7.3: Draw = loan cash-in, NOT cost. Dr Cash / Cr Loan Payable
      return {rule_code:'R-LOAN-01', lines:[
        {account_code:'111000', debit_amount:txn.amount, credit_amount:0, loan_id:txn.loan_id},
        {account_code:'270100', debit_amount:0, credit_amount:txn.amount, loan_id:txn.loan_id}]};
    case 'INTEREST_ACCRUAL':
      return {rule_code: cap?'R-LOAN-03':'R-LOAN-04', capitalize:cap, lines:[
        {account_code: cap?'164500':'795000', debit_amount:txn.amount, credit_amount:0, loan_id:txn.loan_id},
        {account_code:'220410', debit_amount:0, credit_amount:txn.amount, loan_id:txn.loan_id}]};
    case 'INTEREST_PAYMENT':
      return {rule_code:'R-LOAN-05', lines:[
        {account_code:'220410', debit_amount:txn.amount, credit_amount:0, loan_id:txn.loan_id},
        {account_code:'111000', debit_amount:0, credit_amount:txn.amount, loan_id:txn.loan_id}]};
    case 'REPAYMENT':
      return {rule_code:'R-LOAN-08', lines:[
        {account_code:'270100', debit_amount:txn.amount, credit_amount:0, loan_id:txn.loan_id},
        {account_code:'111000', debit_amount:0, credit_amount:txn.amount, loan_id:txn.loan_id}]};
    default: return null;
  }
}

// PM pickup rule: map charge_code -> GL; returns null if unmapped (=> exception)
export function pmRule(row) {
  const m = MAPPINGS.find(x => x.mapping_type==='PM' && x.source_code===row.charge_code && x.is_current);
  if (!m) return {unmapped:true, charge_code:row.charge_code};
  const prop = PROPERTIES.find(p=>p.property_code===row.property_code);
  const isRev = m.rev_exp_flag==='REVENUE';
  const isLia = m.rev_exp_flag==='LIABILITY'; // security deposit -> liability, not income
  let lines;
  if (isRev) lines = [
    {account_code: row.cash_accrual==='CASH'?'111000':'120200', debit_amount:row.amount, credit_amount:0, property_id:prop&&prop.property_id},
    {account_code: m.owner_gl_account_code, debit_amount:0, credit_amount:row.amount, property_id:prop&&prop.property_id}];
  else if (isLia) lines = [
    {account_code:'111000', debit_amount:row.amount, credit_amount:0, property_id:prop&&prop.property_id},
    {account_code: m.owner_gl_account_code, debit_amount:0, credit_amount:row.amount, property_id:prop&&prop.property_id}];
  else lines = [ // expense
    {account_code: m.owner_gl_account_code, debit_amount:row.amount, credit_amount:0, property_id:prop&&prop.property_id},
    {account_code:'220200', debit_amount:0, credit_amount:row.amount, property_id:prop&&prop.property_id}];
  return {rule_code:'R-PM-'+(isRev?'11':isLia?'16':'18'), mapped:true, gl:m.owner_gl_account_code, lines};
}

// ---- Trial balance from posted JEs ----
export function trialBalance(jes, entityId, fromP, toP) {
  const map = {};
  jes.filter(j=>j.posting_status==='POSTED' && (!entityId||j.entity_id===entityId)).forEach(j=>{
    j.lines.forEach(l=>{
      const k = l.account_code;
      if (!map[k]) map[k] = {account_code:k, name:acct(k).account_name, type:acct(k).account_type, debit:0, credit:0};
      map[k].debit += l.debit_amount||0;
      map[k].credit += l.credit_amount||0;
    });
  });
  const rows = Object.values(map).map(r=>({...r, balance:r.debit-r.credit})).sort((a,b)=>a.account_code.localeCompare(b.account_code));
  return {rows, totalDebit:sum(rows,r=>r.debit), totalCredit:sum(rows,r=>r.credit)};
}

// ---- Financial statement roll-ups ----
export function statements(jes, entityId, fromP, toP) {
  const tb = trialBalance(jes, entityId).rows;
  const by = (types)=>tb.filter(r=>types.includes(r.type));
  const balOf = (r)=> r.type==='ASSET'||r.type==='EXPENSE' ? r.balance : -r.balance;
  const assets = sum(by(['ASSET']), balOf);
  const liab = sum(by(['LIABILITY']), balOf);
  const equity = sum(by(['EQUITY']), balOf);
  const rev = sum(by(['REVENUE']), balOf);
  const exp = sum(by(['EXPENSE']), balOf);
  const ni = rev - exp;
  return {assets, liabilities:liab, equity, revenue:rev, expense:exp, netIncome:ni, tb};
}
