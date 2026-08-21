const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^-?(0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const validDate=value=>typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const normalize=value=>value.normalize('NFKC').toUpperCase().replace(/[^A-Z0-9]/g,'');

function validSource(source){
  return source&&typeof source==='object'&&!Array.isArray(source)&&UUID.test(source.source_document_id||'')&&UUID.test(source.source_document_line_id||'')&&SHA256.test(source.source_payload_hash||'')&&SHA256.test(source.source_line_hash||'');
}

function validRow(row){
  return row&&typeof row==='object'&&!Array.isArray(row)&&UUID.test(row.bank_match_id||'')&&SHA256.test(row.bank_match_hash||'')&&row.match_status==='ACTIVE'&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.bank_account_ref,128)&&text(row.external_bank_line_id,256)&&validDate(row.transaction_date)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.amount.startsWith('-')&&text(row.bank_payee_name,300)&&text(row.vendor_ref,200)&&text(row.vendor_name,300)&&validSource(row.bank_source_trace)&&validSource(row.invoice_source_trace)&&row.bank_admission_status==='ADMITTED'&&row.invoice_admission_status==='ADMITTED'&&row.bank_signature_verified===true&&row.invoice_signature_verified===true;
}

function validPolicy(policy){
  if(!policy||policy.schema_version!=='AI_BANK_PAYEE_VENDOR_POLICY_V1'||!UUID.test(policy.setting_snapshot_id||'')||!SHA256.test(policy.setting_snapshot_hash||'')||!Number.isSafeInteger(policy.policy_version)||policy.policy_version<1||!policy.approved_aliases_by_vendor||typeof policy.approved_aliases_by_vendor!=='object'||Array.isArray(policy.approved_aliases_by_vendor))return false;
  return Object.entries(policy.approved_aliases_by_vendor).every(([vendor,aliases])=>text(vendor,200)&&Array.isArray(aliases)&&aliases.length>=1&&aliases.length<=50&&aliases.every(alias=>text(alias,300))&&new Set(aliases.map(normalize)).size===aliases.length);
}

export function detectBankPayeeVendorMismatches(rows,{policy,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Bank payee/vendor analysis requires one period and at most 500 active match rows.'),{code:'AI_BANK_PAYEE_VENDOR_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Bank payee/vendor analysis requires one approved alias policy.'),{code:'AI_BANK_PAYEE_VENDOR_POLICY_REQUIRED'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Bank payee/vendor analysis accepts only complete signed matched-payment evidence.'),{code:'AI_BANK_PAYEE_VENDOR_SOURCE_INVALID'});
  const findings=[];
  for(const row of rows){
    if(row.accounting_period_id!==currentAccountingPeriodId)continue;
    const aliases=policy.approved_aliases_by_vendor[row.vendor_ref];
    if(!aliases)throw Object.assign(new Error('The matched invoice vendor has no approved alias evidence.'),{code:'AI_BANK_PAYEE_VENDOR_ALIAS_MISSING'});
    const observed=normalize(row.bank_payee_name),approved=aliases.map(normalize);
    if(approved.includes(observed))continue;
    findings.push(Object.freeze({schema_version:'AI_BANK_PAYEE_VENDOR_MISMATCH_FINDING_V1',finding_type:'BANK_PAYEE_VENDOR_MISMATCH',risk_level:'HIGH',rule_id:'AI_BANK_PAYEE_VENDOR_APPROVED_ALIAS_V1',entity_id:row.entity_id,accounting_period_id:row.accounting_period_id,bank_match_id:row.bank_match_id,bank_match_hash:row.bank_match_hash,bank_account_ref:row.bank_account_ref,external_bank_line_id:row.external_bank_line_id,transaction_date:row.transaction_date,currency:row.currency,amount:row.amount,bank_payee_name:row.bank_payee_name,vendor_ref:row.vendor_ref,vendor_name:row.vendor_name,bank_source_trace:Object.freeze({...row.bank_source_trace}),invoice_source_trace:Object.freeze({...row.invoice_source_trace}),reason:'An active bank-to-invoice match names a payee that is not an exact normalized member of the approved alias set for the retained invoice vendor.',suggested_action:'Independently verify vendor identity, bank instructions, invoice authenticity, approval history, and the match before reconciliation close or payment release.',confidence:0.99,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PAYMENT_RELEASE_OR_BANK_RECONCILIATION_CLOSE',required_human_fields:Object.freeze(['vendor_identity','bank_instruction_evidence','invoice_authenticity','payment_approval','match_validity','fraud_escalation_decision','resolution_reason']),policy_evidence:Object.freeze({schema_version:policy.schema_version,setting_snapshot_id:policy.setting_snapshot_id,setting_snapshot_hash:policy.setting_snapshot_hash,policy_version:policy.policy_version,vendor_ref:row.vendor_ref,approved_alias_count:aliases.length}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_BANK_PAYEE_VENDOR_MISMATCH_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_match_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
