// Maps a Final-1 retained source row into the deterministic accrual rule's
// evidence shape.  This is intentionally a read boundary: it cannot persist a
// finding, change a source, call a model, or construct a journal.

import {AiAccrualCandidateError} from './ai-accrual-candidate-evaluator.mjs';

const text=value=>typeof value==='string'?value.trim():'';
const HASH=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PERIOD=/^\d{4}-\d{2}$/;
const DATE=/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z)?$/;
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const fail=(code,message)=>{throw new AiAccrualCandidateError(code,message);};
const REQUIRED_SIGNED_PAYABLE_KEYS=Object.freeze(['signed_invoice_no','signed_invoice_date','signed_business_id','signed_service_period_start','signed_service_period_end','signed_recurring_obligation_id','signed_contract_id','signed_charge_code','signed_service_frequency','signed_obligation_status']);
const ACCRUAL_DIMENSION_KEYS=Object.freeze(REQUIRED_SIGNED_PAYABLE_KEYS.slice(3));

const canonicalDate=value=>{
  const match=DATE.exec(text(value));
  if(!match)fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained service-period evidence must use an ISO source date or UTC timestamp.');
  return match[1];
};

// This verifies the immutable retained-line envelope before either analysis
// path classifies it.  The first three signed source values may lawfully be
// null (for example, an invoice-missing exception).  Their normalizer owns
// source-value format; this boundary owns immutable presence and authority.
export function assertRetainedWbsPayableForAiAccrual(row){
  if(!object(row))fail('ACCRUAL_RETAINED_SOURCE_INVALID','A retained source projection is required.');
  const dimensions=row.external_dimension_refs;
  if(!object(dimensions)||dimensions.schema_version!=='WBS_FINAL1_RETAINED_SOURCE_LINE_V1'||dimensions.domain!=='PAYABLES'||dimensions.accounting_period_resolution!=='EXACT_PRIMARY_PERIOD')fail('ACCRUAL_RETAINED_SOURCE_INVALID','Only exact Final-1 payable source-line evidence is eligible for accrual analysis.');
  if(!REQUIRED_SIGNED_PAYABLE_KEYS.every(key=>Object.hasOwn(dimensions,key)&&dimensions[key]!==undefined))fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence is missing one or more signed Payables fields.');
  if(text(row.source_system)!=='WBS'||text(row.source_module)!=='payable'||text(row.document_type)!=='WBS_FINAL1_PAYABLE'||text(row.source_status)!=='PENDING_REVIEW')fail('ACCRUAL_RETAINED_SOURCE_INVALID','Accrual analysis accepts only pending-review Final-1 WBS payable evidence.');
  if(!UUID.test(text(row.entity_id))||!UUID.test(text(row.source_document_id))||!UUID.test(text(row.source_document_line_id))||!UUID.test(text(row.accounting_period_id))||!PERIOD.test(text(row.period_code)))fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence has an invalid authoritative identity or period.');
  if(text(dimensions.accounting_period_id)!==text(row.accounting_period_id)||!HASH.test(text(row.payload_hash))||text(dimensions.raw_row_hash)!==text(row.payload_hash))fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence has a mismatched period or source hash.');
  if(!/^[A-Z]{3}$/.test(text(row.currency))||typeof row.amount!=='string'||!/^\d+(?:\.\d{1,4})?$/.test(row.amount)||Number(row.amount)<=0||!Number.isSafeInteger(row.period_ordinal)||row.period_ordinal<0||row.period_closed!==true)fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence has an invalid amount, period order, or closed period state.');
  return dimensions;
}

export function classifyRetainedWbsPayableForAiAccrual(row,{expectedEntityId,expectedCompanyCode}={}){
  const dimensions=assertRetainedWbsPayableForAiAccrual(row);
  if(expectedEntityId!==undefined&&text(row.entity_id)!==text(expectedEntityId))fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence is outside the requested entity scope.');
  if(expectedCompanyCode!==undefined&&text(row.source_entity_id)!==text(expectedCompanyCode))fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence is outside the requested company scope.');
  return ACCRUAL_DIMENSION_KEYS.every(key=>dimensions[key]===null)?'EXPLICIT_NON_ACCRUAL':'ELIGIBLE';
}

export function canonicalAiRecurringObligationId({recurringObligationId,contractId,vendorId,chargeCode}={}){
  const direct=text(recurringObligationId);
  if(direct)return direct;
  const contract=text(contractId),vendor=text(vendorId),charge=text(chargeCode);
  if(!contract||!vendor||!charge)fail('ACCRUAL_RECURRING_OBLIGATION_MISSING','A signed recurring obligation ID or exact contract, vendor, and charge key is required.');
  return `contract:${contract}|vendor:${vendor}|charge:${charge}`;
}

// Expected row is the explicit projection of source_document, source_document_line,
// accounting_period and wbs_final1_retained_source_row.  The query must not pass
// raw provider JSON into this boundary.
export function adaptRetainedWbsPayableForAiAccrual(row){
  const dimensions=assertRetainedWbsPayableForAiAccrual(row);
  const start=canonicalDate(dimensions.signed_service_period_start),end=canonicalDate(dimensions.signed_service_period_end),frequency=text(dimensions.signed_service_frequency),obligationStatus=text(dimensions.signed_obligation_status);
  if(start>end)fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual service period ends before it begins.');
  if(!frequency||!obligationStatus)fail('ACCRUAL_RETAINED_SOURCE_INVALID','Retained accrual evidence requires signed service frequency and obligation status.');
  return Object.freeze({
    service_period_start:start,service_period_end:end,
    recurring_obligation_id:canonicalAiRecurringObligationId({recurringObligationId:dimensions.signed_recurring_obligation_id,contractId:dimensions.signed_contract_id,vendorId:row.party_ref,chargeCode:dimensions.signed_charge_code}),
    service_frequency:frequency,obligation_status:obligationStatus,
    source_document_id:text(row.source_document_id),source_document_line_id:text(row.source_document_line_id),source_payload_hash:text(row.payload_hash),
    // Final-1 admits exactly one immutable provider row into this source line;
    // its raw-row hash is therefore the precise line evidence hash as well.
    source_line_hash:text(row.payload_hash),
    entity_id:text(row.entity_id),accounting_period_id:text(row.accounting_period_id),currency:text(row.currency),amount:row.amount,
    period_key:text(row.period_code),period_ordinal:row.period_ordinal,closed:true
  });
}
