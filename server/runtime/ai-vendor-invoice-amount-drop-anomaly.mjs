const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const POLICY_FIELDS=['drop_ratio_threshold_basis_points','minimum_absolute_drop','minimum_history_periods','policy_version','schema_version','setting_snapshot_hash','setting_snapshot_id'];
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const nullableText=(value,max)=>value===null||text(value,max);
const validDate=value=>typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const units=value=>BigInt(value.replace('.',''));
const money=value=>`${value/10000n}.${String(value%10000n).padStart(4,'0')}`;
const median=values=>{const sorted=[...values].sort((a,b)=>a<b?-1:a>b?1:0),middle=Math.floor(sorted.length/2);return sorted.length%2?sorted[middle]:(sorted[middle-1]+sorted[middle])/2n;};
const contextKey=row=>[row.entity_id,row.vendor_ref.trim().toUpperCase(),row.currency,row.project_ref??'ENTITY_ONLY',row.property_ref??'ENTITY_ONLY',row.cost_category_ref??'UNCLASSIFIED'].join('|');
const validRow=row=>row&&typeof row==='object'&&!Array.isArray(row)&&UUID.test(row.source_document_id||'')&&UUID.test(row.source_document_line_id||'')&&SHA256.test(row.source_payload_hash||'')&&SHA256.test(row.source_line_hash||'')&&UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&text(row.vendor_ref,200)&&text(row.vendor_name,200)&&/^[A-Z]{3}$/.test(row.currency||'')&&MONEY4.test(row.amount||'')&&row.amount!=='0.0000'&&validDate(row.invoice_date)&&nullableText(row.project_ref,128)&&nullableText(row.property_ref,128)&&nullableText(row.cost_category_ref,128)&&row.source_admission_status==='ADMITTED'&&row.signature_verified===true;
const validPolicy=policy=>policy&&JSON.stringify(Object.keys(policy).sort())===JSON.stringify(POLICY_FIELDS)&&policy.schema_version==='AI_VENDOR_INVOICE_AMOUNT_DROP_POLICY_V1'&&UUID.test(policy.setting_snapshot_id||'')&&SHA256.test(policy.setting_snapshot_hash||'')&&Number.isInteger(policy.policy_version)&&policy.policy_version>=1&&Number.isInteger(policy.minimum_history_periods)&&policy.minimum_history_periods>=3&&policy.minimum_history_periods<=24&&Number.isInteger(policy.drop_ratio_threshold_basis_points)&&policy.drop_ratio_threshold_basis_points>=500&&policy.drop_ratio_threshold_basis_points<=7500&&MONEY4.test(policy.minimum_absolute_drop||'');

export function detectVendorInvoiceAmountDropAnomalies(rows,{policy,currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Vendor amount-drop analysis requires a current period and at most 500 retained invoice rows.'),{code:'AI_VENDOR_AMOUNT_DROP_SCOPE_INVALID'});
  if(!validPolicy(policy))throw Object.assign(new Error('Vendor amount-drop analysis requires exact approved threshold policy evidence.'),{code:'AI_VENDOR_AMOUNT_DROP_POLICY_REQUIRED'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Vendor amount-drop analysis accepts only complete admitted signed invoice evidence.'),{code:'AI_VENDOR_AMOUNT_DROP_SOURCE_INVALID'});
  const findings=[];
  for(const current of rows.filter(row=>row.accounting_period_id===currentAccountingPeriodId)){
    const history=rows.filter(row=>row.accounting_period_id!==currentAccountingPeriodId&&contextKey(row)===contextKey(current)),periods=new Set(history.map(row=>row.accounting_period_id));
    if(periods.size<policy.minimum_history_periods)continue;
    const baseline=median(history.map(row=>units(row.amount))),amount=units(current.amount),drop=baseline-amount;
    if(drop<=0n||drop<units(policy.minimum_absolute_drop)||amount*10000n>baseline*BigInt(policy.drop_ratio_threshold_basis_points))continue;
    const retainedRatioBasisPoints=Number(amount*10000n/baseline);
    findings.push(Object.freeze({schema_version:'AI_VENDOR_INVOICE_AMOUNT_DROP_FINDING_V1',finding_type:'VENDOR_INVOICE_AMOUNT_DROP',risk_level:retainedRatioBasisPoints<=2500?'HIGH':'MEDIUM',rule_id:'AI_VENDOR_HISTORICAL_AMOUNT_DROP_V1',source_document_id:current.source_document_id,source_document_line_id:current.source_document_line_id,source_payload_hash:current.source_payload_hash,source_line_hash:current.source_line_hash,entity_id:current.entity_id,accounting_period_id:current.accounting_period_id,vendor_ref:current.vendor_ref,vendor_name:current.vendor_name,currency:current.currency,current_amount:current.amount,baseline_median_amount:money(baseline),absolute_drop:money(drop),retained_ratio_basis_points:retainedRatioBasisPoints,history_period_count:periods.size,history_source_line_hashes:Object.freeze(history.map(row=>row.source_line_hash).sort()),project_ref:current.project_ref,property_ref:current.property_ref,cost_category_ref:current.cost_category_ref,reason:`The current invoice is only ${(retainedRatioBasisPoints/100).toFixed(2)}% of the retained historical median for the same vendor and accounting context.`,suggested_action:'Check for an incomplete invoice, missing invoice lines, cutoff error, service reduction, credit, or an additional accrual requirement before period close.',confidence:Math.min(0.98,0.78+periods.size*0.02),owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',required_human_fields:Object.freeze(['amount_drop_explanation','source_completeness','accrual_required','account_mapping','member_trace','reversing_entry_decision']),policy_evidence:Object.freeze({...policy}),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_VENDOR_INVOICE_AMOUNT_DROP_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_line_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
