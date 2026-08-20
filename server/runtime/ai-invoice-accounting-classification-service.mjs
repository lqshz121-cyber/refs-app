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

const treatmentEvidence=(result,input)=>{
  const observed=Array.isArray(input?.posted_debit_account_classes)?[...new Set(input.posted_debit_account_classes)].sort():[];
  if(input?.accounting_status!=='POSTED')return Object.freeze({status:'NOT_APPLICABLE',expected_debit_account_class:null,observed_posted_debit_account_classes:Object.freeze(observed),reason:'No Posted journal treatment is retained for comparison.'});
  if(result.classification==='BLOCKED')return Object.freeze({status:'MISMATCH',expected_debit_account_class:null,observed_posted_debit_account_classes:Object.freeze(observed),reason:'The invoice was Posted even though retained evidence blocks accounting classification.'});
  const expected=result.classification==='EXPENSE'?'EXPENSE':['PREPAID_AMORTIZATION','CAPITALIZATION_REVIEW'].includes(result.classification)?'ASSET':null;
  if(expected===null)return Object.freeze({status:'NOT_APPLICABLE',expected_debit_account_class:null,observed_posted_debit_account_classes:Object.freeze(observed),reason:'This classification has no direct Posted debit-class comparison.'});
  if(observed.length===0)return Object.freeze({status:'MISMATCH',expected_debit_account_class:expected,observed_posted_debit_account_classes:Object.freeze(observed),reason:'A Posted source link exists but no Posted debit account class is retained.'});
  const exactMatch=observed.length===1&&observed[0]===expected;
  return Object.freeze({status:exactMatch?'CONSISTENT':'MISMATCH',expected_debit_account_class:expected,observed_posted_debit_account_classes:Object.freeze(observed),reason:exactMatch?'Posted debit account class is consistent with the deterministic treatment.':`Expected only Posted ${expected} debits, but retained Posted debits use ${observed.join(', ')}.`});
};

export function createAiInvoiceAccountingClassificationService({classificationInputReader=null,sourceReader=null,detailReader=null,evidenceReader=null,duplicateFindingReader,capitalizationPolicyReader,materializeWriter=null}={}){
  if((typeof classificationInputReader!=='function'&&(typeof sourceReader!=='function'||typeof detailReader!=='function'||typeof evidenceReader!=='function'))||typeof duplicateFindingReader!=='function'||typeof capitalizationPolicyReader!=='function')throw new Error('AI invoice classification requires authoritative period input or source/detail/signed evidence, duplicate finding, and approved capitalization policy readers');
  const analyze=async({tenantId,entityId,accountingPeriodId,limit=100,includeControllerEvidence=false})=>{
      if(!UUID.test(tenantId||'')||!UUID.test(entityId||'')||!UUID.test(accountingPeriodId||'')||!Number.isInteger(limit)||limit<1||limit>500){
        const error=new Error('AI invoice classification requires tenant, entity, accounting period, and a limit from 1 to 500');error.code='AI_INVOICE_CLASSIFICATION_SCOPE_INVALID';throw error;
      }
      const [periodInputs,duplicateFindings,capitalizationPolicy]=await Promise.all([typeof classificationInputReader==='function'?classificationInputReader({tenantId,entityId,accountingPeriodId,limit}):null,duplicateFindingReader({tenantId,entityId,accountingPeriodId,limit:500}),capitalizationPolicyReader({tenantId,entityId,accountingPeriodId})]);
      const duplicates=new Set((Array.isArray(duplicateFindings)?duplicateFindings:[]).flatMap(row=>[row.source_document_id,row.candidate_source_document_id]).filter(Boolean));
      if(typeof classificationInputReader==='function'){
        const rows=Array.isArray(periodInputs)?periodInputs:[];
        const inputs=rows.map(row=>({...row,member_ref:row.member_ref??null,amount:money4(row.amount),duplicate_status:duplicates.has(row.source_document_id)?'POSSIBLE':'NONE',project_status:'NONE',cost_class:'UNKNOWN',asset_useful_life_months:null,capitalization_threshold:null}));
        const batch=classifyRetainedInvoiceBatch(inputs,{capitalizationPolicy});
        const controllerEvidence=includeControllerEvidence?Object.freeze(batch.results.map((result,index)=>treatmentEvidence(result,inputs[index]))):undefined;
        return Object.freeze({...batch,scope:Object.freeze({tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId}),scanned_document_count:new Set(inputs.map(row=>row.source_document_id)).size,eligible_invoice_line_count:inputs.length,...(controllerEvidence?{controller_evidence:controllerEvidence}:{}),action_flags:ACTIONS});
      }
      const documents=await sourceReader({tenantId,entityId,accountingPeriodId});
      // Do not truncate before authoritative period evidence is checked. Old
      // documents must never crowd current-period invoices out of the scan.
      const candidates=(Array.isArray(documents)?documents:[]).filter(row=>row.source_system==='WBS'),inputs=[];
      let scannedDocumentCount=0;
      for(const document of candidates){
        const details=await detailReader({tenantId,entityId,sourceDocumentId:document.source_document_id}),detail=Array.isArray(details)?details[0]:details,lines=payableLines(detail);
        if(lines.length===0)continue;
        let evidence;try{evidence=await evidenceReader({tenantId,entityId,sourceDocumentId:document.source_document_id});}catch(error){
          if(error?.code==='WBS_PROVIDER_SIGNED_SOURCE_EVIDENCE_NOT_AVAILABLE')continue;
          throw error;
        }
        if(evidence?.accounting_period_id!==accountingPeriodId||evidence?.signature_verified!==true||evidence?.admission_status!=='ADMITTED')continue;
        scannedDocumentCount+=1;
        for(const line of lines.slice(0,Math.max(0,limit-inputs.length))){const trace=line.provider_trace;inputs.push({
          source_document_id:detail.source_document_id,source_document_line_id:line.source_document_line_id,source_payload_hash:detail.payload_hash,source_line_hash:evidence.source_row_hash,
          entity_id:entityId,accounting_period_id:accountingPeriodId,accounting_date:document.accounting_date??trace.invoice_date,vendor_ref:line.party_ref,vendor_name:line.party_ref,invoice_no:trace.invoice_no,invoice_date:trace.invoice_date,
          currency:String(detail.currency||''),amount:money4(line.amount??detail.gross_amount),service_period_start:trace.accrual?.service_period_start??null,
          service_period_end:trace.accrual?.service_period_end??null,description:trace.invoice_description??line.description??null,project_ref:line.project_ref??null,property_ref:line.property_ref??null,member_ref:line.member_ref??null,
          charge_code:trace.accrual?.charge_code??null,contract_id:trace.accrual?.contract_id??null,service_frequency:trace.accrual?.service_frequency??null,
          duplicate_status:duplicates.has(detail.source_document_id)?'POSSIBLE':'NONE',accounting_status:Array.isArray(detail.posted_journal_entry_ids)&&detail.posted_journal_entry_ids.length>0?'POSTED':'NOT_RECORDED',
          // A project reference does not prove construction status or
          // capitalization eligibility. Those policy facts must arrive as
          // separately retained evidence before CAPITALIZATION_REVIEW can be
          // returned by the classifier.
          project_status:'NONE',cost_class:'UNKNOWN',asset_useful_life_months:null,capitalization_threshold:null
        });}
        if(inputs.length>=limit)break;
      }
      const batch=classifyRetainedInvoiceBatch(inputs,{capitalizationPolicy});
      return Object.freeze({...batch,scope:Object.freeze({tenant_id:tenantId,entity_id:entityId,accounting_period_id:accountingPeriodId}),scanned_document_count:scannedDocumentCount,eligible_invoice_line_count:inputs.length,action_flags:ACTIONS});
  };
  return Object.freeze({
    analyze,
    async analyzeAndMaterialize({tenantId,entityId,accountingPeriodId,limit=100,idempotencyKey}){
      if(typeof materializeWriter!=='function')throw Object.assign(new Error('AI invoice classification evidence persistence is unavailable'),{code:'AI_INVOICE_CLASSIFICATION_PERSISTENCE_UNAVAILABLE'});
      if(typeof idempotencyKey!=='string'||idempotencyKey.length<8||idempotencyKey.length>200)throw Object.assign(new Error('AI invoice classification requires a stable idempotency key'),{code:'AI_INVOICE_CLASSIFICATION_IDEMPOTENCY_INVALID'});
      const batch=await analyze({tenantId,entityId,accountingPeriodId,limit});
      return materializeWriter({tenantId,entityId,accountingPeriodId,batch,idempotencyKey});
    }
  });
}
