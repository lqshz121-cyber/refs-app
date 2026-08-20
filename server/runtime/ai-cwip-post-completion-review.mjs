const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const MONEY4=/^(0|[1-9]\d*)\.\d{4}$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.trim().length<=max;
const validDate=value=>typeof value==='string'&&DATE.test(value)&&!Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const validSource=value=>value&&typeof value==='object'&&!Array.isArray(value)&&UUID.test(value.source_document_id||'')&&UUID.test(value.source_document_line_id||'')&&SHA256.test(value.source_payload_hash||'')&&SHA256.test(value.source_line_hash||'');

function validRow(row){
  return row&&typeof row==='object'&&!Array.isArray(row)&&
    UUID.test(row.entity_id||'')&&UUID.test(row.accounting_period_id||'')&&
    UUID.test(row.journal_entry_id||'')&&UUID.test(row.journal_line_id||'')&&UUID.test(row.ledger_line_id||'')&&
    row.journal_status==='POSTED'&&text(row.project_ref,200)&&['IN_SERVICE','COMPLETED'].includes(row.project_status)&&
    validDate(row.completion_date)&&validDate(row.posting_date)&&text(row.cwip_account_code,64)&&
    /^[A-Z]{3}$/.test(row.currency||'')&&
    MONEY4.test(row.debit_amount||'')&&row.debit_amount!=='0.0000'&&row.credit_amount==='0.0000'&&
    SHA256.test(row.project_status_snapshot_hash||'')&&SHA256.test(row.account_mapping_snapshot_hash||'')&&validSource(row.source_trace);
}

export function detectCwipPostCompletionFindings(rows,{currentAccountingPeriodId}={}){
  if(!Array.isArray(rows)||rows.length>500||!UUID.test(currentAccountingPeriodId||''))throw Object.assign(new Error('Post-completion CWIP review requires one period and at most 500 posted ledger rows.'),{code:'AI_CWIP_POST_COMPLETION_SCOPE_INVALID'});
  if(rows.some(row=>!validRow(row)))throw Object.assign(new Error('Post-completion CWIP review accepts only complete posted CWIP, project lifecycle, mapping, and source evidence.'),{code:'AI_CWIP_POST_COMPLETION_SOURCE_INVALID'});
  if(new Set(rows.map(row=>row.ledger_line_id)).size!==rows.length)throw Object.assign(new Error('Post-completion CWIP review requires a unique retained ledger-line population.'),{code:'AI_CWIP_POST_COMPLETION_SOURCE_DUPLICATE'});
  const findings=[];
  for(const row of rows){
    if(row.accounting_period_id!==currentAccountingPeriodId||row.posting_date<=row.completion_date)continue;
    findings.push(Object.freeze({
      schema_version:'AI_CWIP_POST_COMPLETION_FINDING_V1',finding_type:'CWIP_POST_COMPLETION_CUTOFF',risk_level:'HIGH',rule_id:'AI_CWIP_POST_COMPLETION_CUTOFF_V1',
      entity_id:row.entity_id,accounting_period_id:row.accounting_period_id,project_ref:row.project_ref,project_status:row.project_status,completion_date:row.completion_date,
      journal_entry_id:row.journal_entry_id,journal_line_id:row.journal_line_id,ledger_line_id:row.ledger_line_id,posting_date:row.posting_date,cwip_account_code:row.cwip_account_code,currency:row.currency,debit_amount:row.debit_amount,
      project_status_snapshot_hash:row.project_status_snapshot_hash,account_mapping_snapshot_hash:row.account_mapping_snapshot_hash,source_trace:Object.freeze({...row.source_trace}),
      reason:'A posted debit increased an approved CWIP account after the retained project completion or in-service date.',
      suggested_action:'Independently verify cutoff, punch-list support, placed-in-service evidence, capitalization policy, and whether a separately reviewed reclassification is required.',
      confidence:0.99,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PERIOD_CLOSE',
      required_human_fields:Object.freeze(['cutoff_conclusion','placed_in_service_support','capitalization_policy_conclusion','source_document_review','reclassification_decision','resolution_reason']),
      action_flags:ACTIONS
    }));
  }
  return Object.freeze({schema_version:'AI_CWIP_POST_COMPLETION_BATCH_V1',current_accounting_period_id:currentAccountingPeriodId,scanned_posted_cwip_line_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
