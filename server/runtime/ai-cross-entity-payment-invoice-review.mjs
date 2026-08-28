const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(?:0|[1-9]\d*)\.\d{4}$/;
const DATE=/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});
const KEYS='accounting_period_id|allocated_amount|business_allocation_id|business_document_id|counterparty_entity_id|counterparty_invoice_identity_count|counterparty_period_id|counterparty_source_document_id|counterparty_source_document_line_id|counterparty_source_line_hash|counterparty_source_payload_hash|currency|current_invoice_identity_count|current_source_document_id|current_source_document_line_id|current_source_line_hash|current_source_payload_hash|entity_id|invoice_amount|invoice_date|invoice_number|payment_amount|payment_date|payment_evidence_hash|payment_journal_entry_id|payment_ledger_line_ids|payment_occurrence_id|signed_business_id';
const fail=(code,message)=>{throw Object.assign(new Error(message),{code});};
const calendar=value=>{if(!DATE.test(value||''))return false;const [y,m,d]=value.split('-').map(Number),date=new Date(Date.UTC(y,m-1,d));return date.getUTCFullYear()===y&&date.getUTCMonth()===m-1&&date.getUTCDate()===d;};
const text=(value,max)=>typeof value==='string'&&value===value.trim()&&value.length>0&&value.length<=max;
const ids=value=>Array.isArray(value)&&value.length===2&&value.every(item=>UUID.test(item||''))&&new Set(value).size===value.length;
const money4=value=>BigInt(value.replace('.',''));

export function detectCrossEntityPaymentInvoiceReviews(rows,{entityId,accountingPeriodId,counterpartyEntityId,counterpartyPeriodId,limit=500}={}){
  if(!Array.isArray(rows)||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!UUID.test(counterpartyEntityId||'')||!UUID.test(counterpartyPeriodId||'')||entityId===counterpartyEntityId||!Number.isSafeInteger(limit)||limit<1||limit>500)fail('AI_CROSS_ENTITY_PAYMENT_SCOPE_INVALID','Cross-entity payment review requires two distinct exact entity-period scopes and a bounded limit.');
  const coordinates=new Set();
  for(const row of rows){
    if(!row||typeof row!=='object'||Array.isArray(row)||Object.keys(row).sort().join('|')!==KEYS)fail('AI_CROSS_ENTITY_PAYMENT_EVIDENCE_INVALID','Cross-entity payment review accepts only closed authoritative evidence rows.');
    if(row.entity_id!==entityId||row.accounting_period_id!==accountingPeriodId||row.counterparty_entity_id!==counterpartyEntityId||row.counterparty_period_id!==counterpartyPeriodId)fail('AI_CROSS_ENTITY_PAYMENT_SCOPE_MISMATCH','Cross-entity payment evidence drifted outside the authorized entity-period pair.');
    if(![row.payment_occurrence_id,row.business_allocation_id,row.business_document_id,row.payment_journal_entry_id,row.current_source_document_id,row.current_source_document_line_id,row.counterparty_source_document_id,row.counterparty_source_document_line_id].every(value=>UUID.test(value||''))||!ids(row.payment_ledger_line_ids))fail('AI_CROSS_ENTITY_PAYMENT_EVIDENCE_INVALID','Cross-entity payment evidence lacks exact immutable accounting identifiers.');
    if(![row.payment_evidence_hash,row.current_source_payload_hash,row.current_source_line_hash,row.counterparty_source_payload_hash,row.counterparty_source_line_hash].every(value=>SHA.test(value||'')))fail('AI_CROSS_ENTITY_PAYMENT_EVIDENCE_INVALID','Cross-entity payment evidence lacks canonical source or posting hashes.');
    if(![row.payment_amount,row.allocated_amount,row.invoice_amount].every(value=>MONEY.test(value||''))||row.payment_amount!==row.allocated_amount||money4(row.payment_amount)<=0n||money4(row.payment_amount)>money4(row.invoice_amount)||!/^[A-Z]{3}$/.test(row.currency||''))fail('AI_CROSS_ENTITY_PAYMENT_EVIDENCE_INVALID','Cross-entity payment amounts or currency are not exact authoritative values.');
    if(!calendar(row.payment_date)||!calendar(row.invoice_date)||!text(row.signed_business_id,200)||!text(row.invoice_number,128)||row.current_invoice_identity_count!==1||row.counterparty_invoice_identity_count!==1)fail('AI_CROSS_ENTITY_PAYMENT_IDENTITY_AMBIGUOUS','Cross-entity payment review requires one exact signed invoice identity in each entity.');
    const coordinate=`${row.payment_occurrence_id}|${row.counterparty_source_document_line_id}`;
    if(coordinates.has(coordinate))fail('AI_CROSS_ENTITY_PAYMENT_POPULATION_DUPLICATE','Cross-entity payment review received duplicate authoritative evidence.');
    coordinates.add(coordinate);
  }
  if(rows.length>limit)fail('AI_CROSS_ENTITY_PAYMENT_POPULATION_INCOMPLETE','Cross-entity payment findings exceed the requested complete population bound.');
  const findings=rows.map(row=>Object.freeze({
    schema_version:'AI_CROSS_ENTITY_PAYMENT_INVOICE_REVIEW_V1',finding_type:'CROSS_ENTITY_PAYMENT_INVOICE_MISMATCH',risk_level:'HIGH',rule_id:'AI_CROSS_ENTITY_PAYMENT_INVOICE_IDENTITY_V1',
    entity_id:entityId,accounting_period_id:accountingPeriodId,counterparty_entity_id:counterpartyEntityId,counterparty_period_id:counterpartyPeriodId,
    payment_occurrence_id:row.payment_occurrence_id,business_allocation_id:row.business_allocation_id,business_document_id:row.business_document_id,payment_journal_entry_id:row.payment_journal_entry_id,payment_ledger_line_ids:Object.freeze([...row.payment_ledger_line_ids]),payment_evidence_hash:row.payment_evidence_hash,
    payment_amount:row.payment_amount,allocated_amount:row.allocated_amount,currency:row.currency,payment_date:row.payment_date,
    signed_business_id:row.signed_business_id,invoice_number:row.invoice_number,invoice_date:row.invoice_date,invoice_amount:row.invoice_amount,
    current_source_trace:Object.freeze({source_document_id:row.current_source_document_id,source_document_line_id:row.current_source_document_line_id,source_payload_hash:row.current_source_payload_hash,source_line_hash:row.current_source_line_hash}),
    counterparty_source_trace:Object.freeze({source_document_id:row.counterparty_source_document_id,source_document_line_id:row.counterparty_source_document_line_id,source_payload_hash:row.counterparty_source_payload_hash,source_line_hash:row.counterparty_source_line_hash}),
    reason:'A Posted AP payment in the current entity is allocated to the exact provider-signed invoice identity retained as a payable of the counterparty entity.',
    suggested_action:'Freeze further payment activity and require both entity Controllers to validate invoice ownership, bank instructions, intercompany treatment, reversal or reclassification, and close impact.',
    confidence:1,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_PAYMENT_RELEASE_OR_PERIOD_CLOSE',required_human_fields:Object.freeze(['invoice_ownership','payment_authorization','bank_instruction_evidence','intercompany_treatment','reversal_or_reclassification_decision','resolution_reason']),action_flags:ACTIONS
  }));
  return Object.freeze({schema_version:'AI_CROSS_ENTITY_PAYMENT_INVOICE_REVIEW_BATCH_V1',entity_id:entityId,accounting_period_id:accountingPeriodId,counterparty_entity_id:counterpartyEntityId,counterparty_period_id:counterpartyPeriodId,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
