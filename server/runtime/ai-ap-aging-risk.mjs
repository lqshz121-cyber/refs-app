const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const MONEY=/^-?(?:0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const units=value=>BigInt(value.replace('.',''));
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const calendarDate=value=>{if(!DATE.test(value||''))return false;const [year,month,day]=value.split('-').map(Number),date=new Date(Date.UTC(year,month-1,day));return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;};
const validPolicy=policy=>policy&&Object.keys(policy).sort().join('|')==='minimum_open_amount|policy_version|setting_snapshot_hash|setting_snapshot_id|stale_days'&&UUID.test(policy.setting_snapshot_id||'')&&SHA.test(policy.setting_snapshot_hash||'')&&Number.isSafeInteger(policy.policy_version)&&policy.policy_version>=1&&Number.isSafeInteger(policy.stale_days)&&policy.stale_days>=30&&policy.stale_days<=730&&MONEY.test(policy.minimum_open_amount||'')&&units(policy.minimum_open_amount)>0n;
const validRow=row=>row&&Object.keys(row).sort().join('|')==='aging_date|business_document_id|currency|document_number|entity_id|movement_kind|open_amount|posted_journal_entry_id|source_document_id|source_payload_hash|tenant_id|vendor_name|vendor_ref'&&[row.tenant_id,row.entity_id,row.business_document_id,row.posted_journal_entry_id].every(value=>UUID.test(value||''))&&((row.source_document_id===null&&row.source_payload_hash===null)||(UUID.test(row.source_document_id||'')&&SHA.test(row.source_payload_hash||'')))&&['AP_BILL','AP_VENDOR_CREDIT'].includes(row.movement_kind)&&text(row.document_number,128)&&text(row.vendor_ref,128)&&text(row.vendor_name,255)&&/^[A-Z]{3}$/.test(row.currency||'')&&calendarDate(row.aging_date)&&MONEY.test(row.open_amount||'')&&((row.movement_kind==='AP_BILL'&&units(row.open_amount)>0n)||(row.movement_kind==='AP_VENDOR_CREDIT'&&units(row.open_amount)<0n));
const daysBetween=(asOf,value)=>Math.floor((Date.parse(`${asOf}T00:00:00Z`)-Date.parse(`${value}T00:00:00Z`))/86400000);

export function detectApAgingRisks(rows,{asOfDate,policy,tenantId,entityId,limit=100}={}){
  if(!Array.isArray(rows)||rows.length>5000||!calendarDate(asOfDate)||!validPolicy(policy)||!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!Number.isSafeInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('AP aging review requires one date, exact tenant/entity scope, an approved policy, and bounded authoritative evidence.'),{code:'AI_AP_AGING_SCOPE_INVALID'});
  if(rows.some(row=>!validRow(row)||row.tenant_id!==tenantId||row.entity_id!==entityId||row.aging_date>asOfDate)||new Set(rows.map(row=>row.business_document_id)).size!==rows.length)throw Object.assign(new Error('AP aging review accepts only complete, unique, exact-scope posted AP evidence.'),{code:'AI_AP_AGING_EVIDENCE_INVALID'});
  const findings=[];
  for(const row of rows){
    const age=daysBetween(asOfDate,row.aging_date),amount=units(row.open_amount),magnitude=amount<0n?-amount:amount;
    if(magnitude<units(policy.minimum_open_amount))continue;
    let findingType,ruleId,riskLevel,reason,suggestedAction;
    if(row.movement_kind==='AP_VENDOR_CREDIT'){
      findingType='UNAPPLIED_VENDOR_CREDIT';ruleId='AI_AP_UNAPPLIED_VENDOR_CREDIT_V1';riskLevel=age>=policy.stale_days?'HIGH':'MEDIUM';reason=`An unapplied vendor credit of ${row.open_amount} ${row.currency} has remained open for ${age} days.`;suggestedAction='Review the vendor statement, original bill, refund status, and authorized credit application before period close.';
    }else if(age>=policy.stale_days){
      findingType='STALE_PAYABLE';ruleId='AI_AP_STALE_PAYABLE_V1';riskLevel=age>=policy.stale_days*2?'HIGH':'MEDIUM';reason=`Bill ${row.document_number} has an open balance of ${row.open_amount} ${row.currency} aged ${age} days.`;suggestedAction='Confirm the liability remains valid, inspect payment and vendor-statement evidence, and determine whether payment, dispute, reclassification, or a human-prepared adjustment is required.';
    }else continue;
    findings.push(Object.freeze({schema_version:'AI_AP_AGING_RISK_FINDING_V1',finding_type:findingType,risk_level:riskLevel,rule_id:ruleId,as_of_date:asOfDate,age_days:age,tenant_id:row.tenant_id,entity_id:row.entity_id,business_document_id:row.business_document_id,document_number:row.document_number,vendor_ref:row.vendor_ref,vendor_name:row.vendor_name,currency:row.currency,open_amount:row.open_amount,aging_date:row.aging_date,posted_journal_entry_id:row.posted_journal_entry_id,source_document_id:row.source_document_id,source_payload_hash:row.source_payload_hash,reason,suggested_action:suggestedAction,confidence:riskLevel==='HIGH'?0.99:0.95,owner_role:'AP_CONTROLLER_REVIEW',due_basis:'BEFORE_AP_CLOSE',required_human_fields:Object.freeze(['liability_validity','vendor_statement_review','payment_or_credit_status','source_completeness','accounting_treatment_decision']),policy_evidence:Object.freeze({...policy}),action_flags:ACTIONS}));
  }
  if(findings.length>limit)throw Object.assign(new Error('The complete AP aging finding population exceeds the bounded response.'),{code:'AI_AP_AGING_FINDING_POPULATION_INCOMPLETE'});
  return Object.freeze({schema_version:'AI_AP_AGING_RISK_BATCH_V1',as_of_date:asOfDate,scanned_movement_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
