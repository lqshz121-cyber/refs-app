import {detectNewVendorMaterialInvoices} from './ai-new-vendor-material-invoice-review.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money4=value=>{const raw=String(value??'');if(!/^(0|[1-9]\d*)(\.\d{1,4})?$/.test(raw))return null;const [whole,fraction='']=raw.split('.');return `${whole}.${fraction.padEnd(4,'0')}`;};
const retainedPayableLines=detail=>(Array.isArray(detail?.lines)?detail.lines:[]).filter(line=>line?.provider_trace?.trace_version==='WBS_PROVIDER_SOURCE_TRACE_V1'&&line.provider_trace.domain==='PAYABLES'&&line.provider_trace.disposition==='RETAINED');
export function createAiNewVendorMaterialInvoiceReviewService({sourceReader,detailReader,evidenceReader,policyReader}={}){
  if(typeof sourceReader!=='function'||typeof detailReader!=='function'||typeof evidenceReader!=='function'||typeof policyReader!=='function')throw new TypeError('New-vendor material invoice service requires authoritative source, detail, signed evidence, and approved policy readers.');
  return Object.freeze({async analyze({tenantId,entityId,accountingPeriodId,limit=2000}={}){
    if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isSafeInteger(limit)||limit<1||limit>2000)throw Object.assign(new Error('New-vendor material invoice service scope is invalid.'),{code:'AI_NEW_VENDOR_MATERIAL_SCOPE_INVALID'});
    const [documents,policy]=await Promise.all([sourceReader({tenantId,entityId,limit}),policyReader({tenantId,entityId,accountingPeriodId})]),rows=[];
    for(const document of (Array.isArray(documents)?documents:[]).filter(row=>row.source_system==='WBS').slice(0,limit)){
      const details=await detailReader({tenantId,entityId,sourceDocumentId:document.source_document_id});let evidence;try{evidence=await evidenceReader({tenantId,entityId,sourceDocumentId:document.source_document_id});}catch(error){if(error?.code==='WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE')continue;throw error;}
      const detail=Array.isArray(details)?details[0]:details;if(evidence?.signature_verified!==true||evidence?.admission_status!=='ADMITTED'||!UUID.test(evidence?.accounting_period_id||''))continue;
      for(const line of retainedPayableLines(detail)){const trace=line.provider_trace,vendorRef=line.party_ref;rows.push({source_document_id:detail.source_document_id,source_document_line_id:line.source_document_line_id,source_payload_hash:detail.payload_hash,source_line_hash:evidence.source_row_hash,entity_id:entityId,accounting_period_id:evidence.accounting_period_id,vendor_ref:vendorRef,vendor_name:vendorRef,currency:String(detail.currency||''),amount:money4(line.amount??detail.gross_amount),invoice_date:trace.invoice_date,is_current_period:evidence.accounting_period_id===accountingPeriodId,source_admission_status:evidence.admission_status,signature_verified:evidence.signature_verified});}
    }
    return detectNewVendorMaterialInvoices(rows,{policy,currentAccountingPeriodId:accountingPeriodId});
  }});
}
