const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^-?(?:0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const ids=value=>Array.isArray(value)&&value.length<=500&&value.every(id=>UUID.test(id||''))&&new Set(value).size===value.length;
const units=value=>BigInt(value.replace('.',''));

function valid(row,periodId){
  return row&&row.evidence_status==='SIGNED_STATEMENT_AND_POSTED_GL'&&row.period_id===periodId&&
    UUID.test(row.reconciliation_id||'')&&UUID.test(row.wbs_bank_statement_receipt_id||'')&&
    typeof row.bank_account_ref==='string'&&row.bank_account_ref.trim()===row.bank_account_ref&&row.bank_account_ref.length>0&&row.bank_account_ref.length<=128&&
    /^\d{4}-\d{2}-\d{2}$/.test(row.statement_start_date||'')&&/^\d{4}-\d{2}-\d{2}$/.test(row.statement_ending_date||'')&&
    /^[A-Z]{3}$/.test(row.currency||'')&&['statement_opening_balance','statement_ending_balance','book_ending_balance','difference'].every(key=>MONEY.test(row[key]||''))&&
    HASH.test(row.statement_payload_hash||'')&&HASH.test(row.admission_hash||'')&&row.signature_algorithm==='Ed25519'&&row.signature_verified===true&&row.admission_status==='ADMITTED'&&
    ['DRAFT','IN_REVIEW','REOPENED','RECONCILED'].includes(row.reconciliation_status)&&Number.isSafeInteger(row.reconciliation_version)&&row.reconciliation_version>=0&&
    ids(row.journal_entry_ids)&&ids(row.journal_line_ids)&&ids(row.ledger_line_ids);
}

export function detectBankGlBalanceReconciliationReviews(rows,{entityId,accountingPeriodId,limit=500}={}){
  if(!Array.isArray(rows)||rows.length>5000||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500||rows.some(row=>!valid(row,accountingPeriodId)))throw Object.assign(new Error('Bank-to-GL review requires one signed admitted statement and exact Posted GL lineage.'),{code:'AI_BANK_GL_RECONCILIATION_EVIDENCE_INVALID'});
  const seen=new Set(),findings=[];
  for(const row of rows){
    if(seen.has(row.reconciliation_id))throw Object.assign(new Error('Bank reconciliation evidence is duplicated.'),{code:'AI_BANK_GL_RECONCILIATION_DUPLICATE'});seen.add(row.reconciliation_id);
    const difference=units(row.difference),calculated=units(row.statement_ending_balance)-units(row.book_ending_balance);
    if(difference!==calculated)throw Object.assign(new Error('Stored reconciliation difference does not equal statement less Posted GL.'),{code:'AI_BANK_GL_RECONCILIATION_DIFFERENCE_INVALID'});
    if(difference===0n&&row.reconciliation_status==='RECONCILED')continue;
    findings.push(Object.freeze({
      schema_version:'AI_BANK_GL_BALANCE_RECONCILIATION_V1',finding_type:'BANK_STATEMENT_GL_BALANCE_MISMATCH',risk_level:difference===0n?'MEDIUM':'HIGH',rule_id:'AI_BANK_GL_BALANCE_RECONCILIATION_V1',
      entity_id:entityId,accounting_period_id:accountingPeriodId,...row,
      reason:difference===0n?`Bank account ${row.bank_account_ref} balances agree, but reconciliation status is ${row.reconciliation_status} and remains incomplete.`:`Signed bank statement ending balance ${row.statement_ending_balance} differs from source-bound Posted GL cash balance ${row.book_ending_balance} by ${row.difference} ${row.currency}.`,
      suggested_action:'Review unmatched statement activity, source-bound Posted cash lines, cutoff, and approved reconciliation adjustments; do not create or post an entry from this finding alone.',
      required_human_fields:Object.freeze(['statement_activity_review','posted_gl_cash_line_review','cutoff_review','unmatched_item_disposition','controller_sign_off']),action_flags:ACTIONS
    }));
    if(findings.length===limit)break;
  }
  return Object.freeze({schema_version:'AI_BANK_GL_BALANCE_RECONCILIATION_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_reconciliation_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
