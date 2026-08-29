import {safeAiEvidenceTree} from './ai-secret-safety.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^-([1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const validDate=value=>{if(typeof value!=='string'||!DATE.test(value))return false;const parsed=new Date(`${value}T00:00:00.000Z`);return !Number.isNaN(parsed.valueOf())&&parsed.toISOString().slice(0,10)===value;};
const validRow=row=>row&&typeof row==='object'&&!Array.isArray(row)&&safeAiEvidenceTree(row,{maxArrayLength:100})&&UUID.test(row.bank_source_id||'')&&UUID.test(row.source_document_id||'')&&SHA256.test(row.source_payload_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.bank_account_ref,128)&&text(row.external_bank_line_id,256)&&validDate(row.transaction_date)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.source_admission_status==='ADMITTED'&&row.signature_verified===true;
const key=row=>[row.entity_id,row.bank_account_ref.trim().toUpperCase(),row.transaction_date,row.currency,row.amount].join('|');

export function detectDuplicateBankPayments(rows,{entityId,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Duplicate bank-payment analysis requires one entity, one accounting period, and at most 500 retained bank rows.'),{code:'AI_BANK_DUPLICATE_PAYMENT_SCOPE_INVALID'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Duplicate bank-payment analysis accepts only complete admitted signed payment evidence.'),{code:'AI_BANK_DUPLICATE_PAYMENT_SOURCE_INVALID'});
  if(rows.some(row=>row.entity_id!==entityId||row.accounting_period_id!==currentAccountingPeriodId))throw Object.assign(new Error('Duplicate bank-payment evidence is outside the selected authoritative entity and period.'),{code:'AI_BANK_DUPLICATE_PAYMENT_SCOPE_MISMATCH'});
  const groups=new Map();
  for(const row of rows){const identity=key(row);if(!groups.has(identity))groups.set(identity,[]);groups.get(identity).push(row);}
  const findings=[];
  for(const group of groups.values()){
    if(group.length<2)continue;
    const sourceTrace=group.map(row=>Object.freeze({bank_source_id:row.bank_source_id,source_document_id:row.source_document_id,source_payload_hash:row.source_payload_hash,external_bank_line_id:row.external_bank_line_id})).sort((a,b)=>a.bank_source_id.localeCompare(b.bank_source_id));
    if(new Set(sourceTrace.map(row=>row.bank_source_id)).size!==sourceTrace.length||new Set(sourceTrace.map(row=>row.external_bank_line_id)).size!==sourceTrace.length)throw Object.assign(new Error('Duplicate bank-payment analysis requires distinct retained source identities.'),{code:'AI_BANK_DUPLICATE_PAYMENT_SOURCE_INVALID'});
    const representative=group[0];
    findings.push(Object.freeze({schema_version:'AI_BANK_DUPLICATE_PAYMENT_FINDING_V1',finding_type:'SAME_DAY_SAME_AMOUNT_BANK_PAYMENT',risk_level:group.length>=3?'HIGH':'MEDIUM',rule_id:'AI_BANK_SAME_DAY_SAME_AMOUNT_PAYMENT_V1',entity_id:representative.entity_id,accounting_period_id:currentAccountingPeriodId,bank_account_ref:representative.bank_account_ref,transaction_date:representative.transaction_date,currency:representative.currency,amount:representative.amount,payment_count:group.length,source_trace:Object.freeze(sourceTrace),reason:`${group.length} retained bank payments have the same account, date, currency, and amount.`,suggested_action:'Compare every payment with invoice, approval, vendor, bank memo, and reversal evidence before matching or creating any accounting action.',confidence:group.length>=3?0.99:0.9,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_BANK_RECONCILIATION_CLOSE',required_human_fields:Object.freeze(['vendor_identity','invoice_support','payment_approval','bank_memo','duplicate_or_valid_conclusion','resolution_reason']),action_flags:ACTIONS}));
  }
  findings.sort((a,b)=>a.bank_account_ref.localeCompare(b.bank_account_ref)||a.transaction_date.localeCompare(b.transaction_date)||a.amount.localeCompare(b.amount));
  return Object.freeze({schema_version:'AI_BANK_DUPLICATE_PAYMENT_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_payment_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
