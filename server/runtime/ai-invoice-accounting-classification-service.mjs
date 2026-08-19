import {classifyRetainedInvoiceBatch} from './ai-invoice-accounting-classifier.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=Object.freeze({can_create_draft:false,can_review:false,can_approve:false,can_post:false});

const money4=value=>{
  const raw=String(value??'');
  if(!/^-?(0|[1-9]\d*)(\.\d{1,4})?$/.test(raw))return null;
  const unsigned=raw.startsWith('-')?raw.slice(1):raw;
  const [whole,fraction='']=unsigned.split('.');
  return `${whole}.${fraction.padEnd(4,'0')}`;
};

const payableLines=detail=>(Array.isArray(detail?.lines)?detail.lines:[])
  .filter(line=>line?.provider_trace?.trace_version==='WBS_PROVIDER_SOURCE_TRACE_V1'&&line.provider_trace.domain==='PAYABLES'&&line.provider_trace.disposition==='RETAINED');

export function createAiInvoiceAccountingClassificationService({sourceReader,detailReader,evidenceReader,duplicateFindingReader}={}){
  if(typeof sourceReader!=='function'||typeof detailReader!=='function'||typeof evidenceReader!=='function'||typeof duplicateFindingReader!=='function')throw new Error('AI invoice classification requires authoritative source, detail, signed evidence, and duplicate finding readers');
  return Object.freeze({
    async analyze({tenantId,entityId,accountingPeriodId,limit=100}){
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isInteger(limit)||limit<1||limit>500){
        const error=new Error('AI invoice classification requires tenant, entity, accounting period, and a limit from 1 to 500');error.code='AI_INVOICE_CLASSIFICATION_SCOPE_INVALID';throw error;
      }
      const [documents,duplicateFindings]=await Promise.all([sourceReader({tenantId,entityId}),duplicateFindingReader({tenantId,entityId,limit:500})]);
      const duplicates=new Set((Array.isArray(duplicateFindings)?duplicateFindings:[]).flatMap(row=>[row.source_document_id,row.candidate_source_document_id]).filter(Boolean));
      const candidates=(Array.isArray(documents)?documents:[]).filter(row=>row.source_system==='WBS').slice(0,limit),inputs=[];
      for(const document of candidates){
        const details=await detailReader({tenantId,entityId,sourceDocumentId:document.source_document_id}),detail=Array.isArray(details)?details[0]:details,lines=payableLines(detail);
        if(lines.length===0)continue;
        let evidence;try{evidence=await evidenceReader({tenantId,entityId,sourceDocumentId:document.source_document_id});}catch(error){
          if(error?.code==='WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE')continue;
          throw error;
        }
        if(evidence?.accounting_period_id!==accountingPeriodId||evidence?.signature_verified!==true||evidence?.admission_status!=='ADMITTED')continue;
        for(const line of lines){const trace=line.provider_trace;inputs.push({
          source_document_id:detail.source_document_id,source_document_line_id:line.source_document_line_id,source_payload_hash:detail.payload_hash,source_line_hash:evidence.source_row_hash,
          entity_id:entityId,accounting_period_id:accountingPeriodId,vendor_name:line.party_ref,invoice_no:trace.invoice_no,invoice_date:trace.invoice_date,
          currency:String(detail.currency||''),amount:money4(line.amount??detail.gross_amount),service_period_start:trace.accrual?.service_period_start??null,
          service_period_end:trace.accrual?.service_period_end??null,description:null,project_ref:line.project_ref??null,property_ref:line.property_ref??null,
          duplicate_status:duplicates.has(detail.source_document_id)?'POSSIBLE':'NONE',accounting_status:Array.isArray(detail.posted_journal_entry_ids)&&detail.posted_journal_entry_ids.length>0?'POSTED':'NOT_RECORDED',
          // A project reference does not prove construction status or
          // capitalization eligibility. Those policy facts must arrive as
          // separately retained evidence before CAPITALIZATION_REVIEW can be
          // returned by the classifier.
          project_status:'NONE',cost_class:'UNKNOWN',asset_useful_life_months:null,capitalization_threshold:null
        });}
      }
      const batch=classifyRetainedInvoiceBatch(inputs);
      return Object.freeze({...batch,scope:Object.freeze({tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId}),scanned_document_count:candidates.length,eligible_invoice_line_count:inputs.length,action_flags:ACTIONS});
    }
  });
}
