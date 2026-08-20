import {detectVendorInvoiceNearDuplicates} from './ai-vendor-invoice-near-duplicate.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money4=value=>{const raw=String(value??'');if(!/^(0|[1-9]\d*)(\.\d{1,4})?$/.test(raw))return null;const [whole,fraction='']=raw.split('.');return `${whole}.${fraction.padEnd(4,'0')}`;};
const retainedPayableLines=detail=>(Array.isArray(detail?.lines)?detail.lines:[]).filter(line=>line?.provider_trace?.trace_version==='WBS_PROVIDER_SOURCE_TRACE_V1'&&line.provider_trace.domain==='PAYABLES'&&line.provider_trace.disposition==='RETAINED');

export function createAiVendorInvoiceNearDuplicateService({sourceReader,detailReader,evidenceReader,policyReader,materializeWriter=null}={}){
  if(typeof sourceReader!=='function'||typeof detailReader!=='function'||typeof evidenceReader!=='function'||typeof policyReader!=='function')throw new Error('Vendor near-duplicate service requires authoritative source, detail, signed evidence, and approved policy readers');
  const analyze=async({tenantId,entityId,currentAccountingPeriodId,limit=500})=>{
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(currentAccountingPeriodId||'')||!Number.isInteger(limit)||limit<1||limit>500)throw Object.assign(new Error('Vendor near-duplicate service scope is invalid'),{code:'AI_VENDOR_NEAR_DUPLICATE_SCOPE_INVALID'});
    const [documents,policy]=await Promise.all([sourceReader({tenantId,entityId,limit}),policyReader({tenantId,entityId,currentAccountingPeriodId})]),rows=[];
    for(const document of (Array.isArray(documents)?documents:[]).filter(row=>row.source_system==='WBS').slice(0,limit)){
      const details=await detailReader({tenantId,entityId,sourceDocumentId:document.source_document_id});let evidence;try{evidence=await evidenceReader({tenantId,entityId,sourceDocumentId:document.source_document_id});}catch(error){if(error?.code==='WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE')continue;throw error;}
      const detail=Array.isArray(details)?details[0]:details;
      if(evidence?.signature_verified!==true||evidence?.admission_status!=='ADMITTED'||!UUID.test(evidence?.accounting_period_id||''))continue;
      for(const line of retainedPayableLines(detail)){const trace=line.provider_trace,invoiceNumber=trace.invoice_no,invoiceDate=trace.invoice_date,amount=money4(line.amount??detail.gross_amount);if(typeof invoiceNumber!=='string'||!invoiceNumber.trim()||typeof invoiceDate!=='string')continue;rows.push({source_document_id:detail.source_document_id,source_document_line_id:line.source_document_line_id,source_payload_hash:detail.payload_hash,source_line_hash:evidence.source_row_hash,entity_id:entityId,accounting_period_id:evidence.accounting_period_id,vendor_ref:line.party_ref,vendor_name:line.party_ref,invoice_number:invoiceNumber,currency:String(detail.currency||''),amount,invoice_date:invoiceDate,project_ref:line.project_ref??null,property_ref:line.property_ref??null,source_admission_status:evidence.admission_status,signature_verified:evidence.signature_verified});}
    }
    return detectVendorInvoiceNearDuplicates(rows,{policy,currentAccountingPeriodId});
  };
  return Object.freeze({analyze,async analyzeAndMaterialize({tenantId,entityId,currentAccountingPeriodId,limit=500,idempotencyKey}){if(typeof materializeWriter!=='function')throw Object.assign(new Error('Vendor near-duplicate persistence is unavailable'),{code:'AI_VENDOR_NEAR_DUPLICATE_PERSISTENCE_UNAVAILABLE'});if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)throw Object.assign(new Error('Vendor near-duplicate materialization requires a stable idempotency key'),{code:'AI_VENDOR_NEAR_DUPLICATE_IDEMPOTENCY_INVALID'});const batch=await analyze({tenantId,entityId,currentAccountingPeriodId,limit});return materializeWriter({tenantId,entityId,accountingPeriodId:currentAccountingPeriodId,batch,idempotencyKey});}});
}
