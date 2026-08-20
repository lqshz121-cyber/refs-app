const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256=/^sha256:[0-9a-f]{64}$/;
const MONEY=/^(0|[1-9][0-9]*)\.[0-9]{4}$/;
const CLASSIFICATIONS=new Set(['EXPENSE','PREPAID_AMORTIZATION','ACCRUAL_REVIEW','CAPITALIZATION_REVIEW']);
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});

const text=(value,max)=>typeof value==='string'&&value.trim()===value&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);

export function reviewInvoiceSourceSupport(rows,{entityId,accountingPeriodId}={}){
  if(!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Array.isArray(rows)||rows.length>1000)throw new Error('AI_INVOICE_SOURCE_SUPPORT_SCOPE_INVALID');
  const seen=new Set(),findings=[];
  for(const row of rows){
    if(!row||Object.getPrototypeOf(row)!==Object.prototype||!UUID.test(row.classification_evidence_id||'')||!UUID.test(row.entity_id||'')||!UUID.test(row.accounting_period_id||'')||row.entity_id!==entityId||row.accounting_period_id!==accountingPeriodId||!UUID.test(row.source_document_id||'')||!UUID.test(row.source_document_line_id||'')||!SHA256.test(row.source_payload_hash||'')||!SHA256.test(row.source_line_hash||'')||!SHA256.test(row.classification_hash||'')||!CLASSIFICATIONS.has(row.classification)||!text(row.vendor_ref,200)||!text(row.vendor_name,200)||!text(row.invoice_number,200)||!/^\d{4}-\d{2}-\d{2}$/.test(row.invoice_date||'')||!/^[A-Z]{3}$/.test(row.currency||'')||!MONEY.test(String(row.amount))||!Number.isSafeInteger(row.verified_attachment_count)||row.verified_attachment_count<0||row.verified_attachment_count>100)throw new Error('AI_INVOICE_SOURCE_SUPPORT_ROW_INVALID');
    if(seen.has(row.classification_evidence_id))throw new Error('AI_INVOICE_SOURCE_SUPPORT_DUPLICATE_EVIDENCE');
    seen.add(row.classification_evidence_id);
    if(row.verified_attachment_count!==0)continue;
    findings.push(Object.freeze({schema_version:'AI_INVOICE_SOURCE_SUPPORT_REVIEW_V1',finding_type:'INVOICE_SOURCE_SUPPORT_MISSING',risk_level:['PREPAID_AMORTIZATION','CAPITALIZATION_REVIEW'].includes(row.classification)?'HIGH':'MEDIUM',rule_id:'AI_INVOICE_SOURCE_SUPPORT_COMPLETENESS_V1',entity_id:row.entity_id,accounting_period_id:row.accounting_period_id,vendor_ref:row.vendor_ref,vendor_name:row.vendor_name,invoice_number:row.invoice_number,invoice_date:row.invoice_date,currency:row.currency,amount:String(row.amount),classification:row.classification,verified_attachment_count:0,source_trace:Object.freeze({classification_evidence_id:row.classification_evidence_id,classification_hash:row.classification_hash,source_document_id:row.source_document_id,source_document_line_id:row.source_document_line_id,source_payload_hash:row.source_payload_hash,source_line_hash:row.source_line_hash}),reason:`Invoice ${row.invoice_number} is classified as ${row.classification} but has no verified-clean source attachment bound to the retained source document.`,suggested_action:'Obtain and verify the invoice and any contract, coverage-period, service-period, approval, or capitalization support before accepting the accounting treatment or preparing a Journal Entry.',confidence:0.99,owner_role:'CONTROLLER_REVIEW',due_basis:'BEFORE_DRAFT_OR_PERIOD_CLOSE',required_human_fields:Object.freeze(['verified_invoice_attachment','business_substance','service_or_coverage_period','accounting_treatment_conclusion','approval_evidence','resolution_reason']),action_flags:ACTIONS}));
  }
  return Object.freeze({schema_version:'AI_INVOICE_SOURCE_SUPPORT_REVIEW_BATCH_V1',current_accounting_period_id:accountingPeriodId,scanned_classification_count:rows.length,finding_count:findings.length,findings:Object.freeze(findings),action_flags:ACTIONS});
}
