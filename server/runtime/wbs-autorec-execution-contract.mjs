// This module defines the REFS-side execution seam for a receipt-backed WBS
// AutoRec candidate. It does not call WBS, persist state, reserve capacity, or
// post journals. An authoritative kernel must perform those effects after
// accepting the returned transition intent.
import {validateWbsAutoRecG11PostedTrace} from './wbs-inbound-data-adapter.mjs';

const text=value=>value==null?'':String(value).trim();
const freeze=value=>Object.freeze(value);
const hash=value=>/^sha256:[0-9a-f]{64}$/.test(text(value));
const amount=value=>{const candidate=typeof value==='number'?String(value):text(value);return /^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(candidate)&&Number.isFinite(Number(candidate))?Number(candidate):null;};
const fail=(code,message)=>{const error=new WbsAutoRecExecutionContractError(code,message);throw error;};

export class WbsAutoRecExecutionContractError extends Error {
  constructor(code,message){super(message);this.name='WbsAutoRecExecutionContractError';this.code=code;}
}

export const WBS_AUTOREC_REFS_EXECUTION_STATES=freeze([
  'REVIEW_REQUIRED','RESERVED','RELEASED','INCURRED','REVERSE_DRAFT_REQUIRED','REVERSED'
]);

const reviewScope=review=>{
  const trace=review?.trace;
  if(!review||text(review.request_type)!=='AUTOREC_REVIEW_REQUEST'||text(review.status)!=='REVIEW_REQUIRED'||!text(review.review_candidate_id)||!text(review.company_key)||!text(review.currency)||!text(review.bank_account_ref)||amount(review.allocated_amount)===null||amount(review.allocated_amount)<=0||!trace||!hash(trace.bank_receipt_hash)||!hash(trace.business_receipt_hash)||!text(trace.bank_source_record_id)||!text(trace.bank_source_version)||!text(trace.business_source_record_id)||!text(trace.business_source_version))fail('WBS_AUTOREC_EXECUTION_REVIEW_REQUIRED','A complete immutable receipt-backed AutoRec review candidate is required.');
  return freeze({review_candidate_id:text(review.review_candidate_id),company_key:text(review.company_key),currency:text(review.currency),bank_account_ref:text(review.bank_account_ref),allocated_amount:amount(review.allocated_amount),trace:freeze({bank_source_record_id:text(trace.bank_source_record_id),bank_source_version:text(trace.bank_source_version),business_source_record_id:text(trace.business_source_record_id),business_source_version:text(trace.business_source_version),bank_receipt_hash:text(trace.bank_receipt_hash),business_receipt_hash:text(trace.business_receipt_hash),review_plan_id:text(trace.review_plan_id)||null,allocation_edge_id:text(trace.allocation_edge_id)||null})});
};

const reservation=receipt=>{
  if(!receipt||!text(receipt.reservation_id)||!hash(receipt.request_hash)||!hash(receipt.control_hash)||!text(receipt.version))fail('WBS_AUTOREC_EXECUTION_RESERVATION_REQUIRED','Release requires an immutable authoritative source-reservation receipt.');
  return freeze({reservation_id:text(receipt.reservation_id),request_hash:text(receipt.request_hash),control_hash:text(receipt.control_hash),version:text(receipt.version)});
};
const reverseEvidence=(original,reversals)=>{
  if(!Array.isArray(original)||original.length!==2||!Array.isArray(reversals)||reversals.length!==2)fail('WBS_AUTOREC_EXECUTION_REVERSE_EVIDENCE_REQUIRED','Reverse completion requires two original and two posted reversal journal legs.');
  const originalIds=new Set(original.map(row=>text(row?.journal_entry_id)));
  if(originalIds.size!==2||[...originalIds].some(value=>!value)||reversals.some(row=>text(row?.status)!=='POSTED'||!text(row?.journal_entry_id)||!text(row?.reverses_journal_entry_id)||!originalIds.has(text(row.reverses_journal_entry_id))))fail('WBS_AUTOREC_EXECUTION_REVERSE_EVIDENCE_REQUIRED','Each reversal leg must be posted and reference one distinct original AutoRec journal.');
  if(new Set(reversals.map(row=>text(row.reverses_journal_entry_id))).size!==2||new Set(reversals.map(row=>text(row.journal_entry_id))).size!==2)fail('WBS_AUTOREC_EXECUTION_REVERSE_EVIDENCE_REQUIRED','Reversal journal identities must be distinct and cover both original legs.');
  return freeze(reversals.map(row=>freeze({journal_entry_id:text(row.journal_entry_id),reverses_journal_entry_id:text(row.reverses_journal_entry_id),status:'POSTED'})));
};

// Returns a non-dispatchable intent. The kernel owns CAS, source locks,
// reservation totals, SoD, accounting periods, journal creation and posting.
export function buildWbsAutoRecExecutionIntent({command,currentState,reviewCandidate,reservationReceipt,postedJournals,reason,postedReversalJournals}={}){
  const requested=text(command).toUpperCase(),state=text(currentState).toUpperCase();
  if(!WBS_AUTOREC_REFS_EXECUTION_STATES.includes(state))fail('WBS_AUTOREC_EXECUTION_STATE_INVALID','The current REFS AutoRec state is invalid.');
  const review=reviewScope(reviewCandidate);
  const base={request_type:'WBS_AUTOREC_EXECUTION_INTENT',command:requested,current_state:state,review_candidate:review,can_dispatch:false,can_create_draft:false,can_post:false};
  if(requested==='RESERVE'){
    if(state!=='REVIEW_REQUIRED')fail('WBS_AUTOREC_EXECUTION_TRANSITION_INVALID','Only REVIEW_REQUIRED may reserve source capacity.');
    return freeze({...base,next_state:'RESERVED',required_kernel_controls:freeze(['global source reservation under locks','idempotency/CAS','allocation conservation','audit receipt'])});
  }
  if(requested==='RELEASE'){
    if(state!=='RESERVED')fail('WBS_AUTOREC_EXECUTION_TRANSITION_INVALID','Only RESERVED may release an AutoRec allocation.');
    return freeze({...base,next_state:'RELEASED',reservation_receipt:reservation(reservationReceipt),required_kernel_controls:freeze(['revalidate source reservation','freeze dependent allocations','audit receipt'])});
  }
  if(requested==='INCUR'){
    if(state!=='RELEASED')fail('WBS_AUTOREC_EXECUTION_TRANSITION_INVALID','Only RELEASED may enter the REFS incur workflow.');
    let g11;try{g11=validateWbsAutoRecG11PostedTrace({reviewRequest:reviewCandidate,postedJournals});}catch(error){fail(error?.code||'WBS_AUTOREC_EXECUTION_G11_REQUIRED',error?.message||'Incur requires posted G11 evidence.');}
    return freeze({...base,next_state:'INCURRED',g11,required_kernel_controls:freeze(['two posted standard JE legs','per-member 291001 net zero','immutable ledger/audit trace'])});
  }
  if(requested==='REQUEST_REVERSE'){
    if(state!=='INCURRED'||!text(reason))fail('WBS_AUTOREC_EXECUTION_TRANSITION_INVALID','Only INCURRED may request a reasoned standard Draft reversal.');
    return freeze({...base,next_state:'REVERSE_DRAFT_REQUIRED',reason:text(reason),required_kernel_controls:freeze(['standard Draft reversal for PAYABLE_INCUR','standard Draft reversal for AUTOC','review/approval before posting'])});
  }
  if(requested==='COMPLETE_REVERSE'){
    if(state!=='REVERSE_DRAFT_REQUIRED')fail('WBS_AUTOREC_EXECUTION_TRANSITION_INVALID','Only a pending reversal draft workflow may complete reversal.');
    const originals=Array.isArray(postedJournals)?postedJournals:[];
    return freeze({...base,next_state:'REVERSED',posted_reversals:reverseEvidence(originals,postedReversalJournals),required_kernel_controls:freeze(['both reversal legs posted','immutable original ledger','audit receipt'])});
  }
  fail('WBS_AUTOREC_EXECUTION_COMMAND_INVALID','Unsupported REFS AutoRec execution command.');
}
