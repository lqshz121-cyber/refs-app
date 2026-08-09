import {canonicalRequestHash} from './request-hash.mjs';

const TRANSACTION_TYPES=new Set(['BANK_TRANSACTION','PAYABLE','AUTOREC_PAYMENT_DETAIL']);
const OBSERVED_DETAIL_KINDS=new Set(['NOT_MATCH_PAYMENT','RELEASED_PAYMENT','INCURRED_PAYMENT','COMPANY_ACCOUNT','JE_TRACE','ACCOUNTING_AUDIT_LOG','BS_CONTROL','IS_CONTROL']);
const OBSERVED_AUTOREC_STATE=Object.freeze({NOT_MATCH_PAYMENT:'NOT_MATCHED',RELEASED_PAYMENT:'RELEASED',INCURRED_PAYMENT:'INCURRED'});
const OBSERVED_WORKFLOW_STEPS=Object.freeze([
  Object.freeze({step:'COMPANY_SCREENING',wbs_label:'Company Screening',admission:'COMPANY_CONTROL_EVIDENCE_ONLY'}),
  Object.freeze({step:'DATA_PROCESSING_RELEASE',wbs_label:'Data Processing & Release',admission:'DETAIL_EVIDENCE_ONLY'}),
  Object.freeze({step:'INCUR',wbs_label:'Incur',admission:'ACTION_NOT_OBSERVED_AS_ROW'}),
  Object.freeze({step:'INCURRED_LIST',wbs_label:'Incurred List',admission:'MATCH_RELATION_EVIDENCE_ONLY'})
]);
const OBSERVED_WORKFLOW_STEP_BY_DETAIL_KIND=Object.freeze({NOT_MATCH_PAYMENT:'DATA_PROCESSING_RELEASE',RELEASED_PAYMENT:'DATA_PROCESSING_RELEASE',INCURRED_PAYMENT:'INCURRED_LIST'});
const text=value=>value==null?'':String(value).trim();
// Do not use Number(value) directly here: JavaScript maps empty strings and
// null to zero, which would turn an absent WBS control into apparently valid
// zero-value evidence. The inbound normalized form is a decimal, not a
// display value, so accept only a finite number or an explicit decimal token.
const decimal=value=>{
  const candidate=typeof value==='number'?(Number.isFinite(value)?String(value):''):typeof value==='string'?value.trim():'';
  if(!/^-?(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(candidate))return null;
  const parsed=Number(candidate),scaled=parsed*10000;
  return Number.isFinite(parsed)&&Number.isSafeInteger(Math.round(scaled))?Number(parsed.toFixed(4)):null;
};
const decimalText=value=>{const parsed=decimal(value);return parsed===null?null:parsed.toFixed(4);};
const validDate=value=>{const candidate=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(candidate))return false;const date=new Date(`${candidate}T00:00:00.000Z`);return !Number.isNaN(date.getTime())&&date.toISOString().slice(0,10)===candidate;};
const validInstant=value=>{const candidate=text(value);return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(candidate)&&!Number.isNaN(Date.parse(candidate));};
const freeze=value=>Object.freeze(value);
const statusCode=value=>{const candidate=text(value);return candidate===''||candidate.length>64||/[\u0000-\u001f\u007f]/.test(candidate)?null:candidate;};
const FORBIDDEN_WBS_OPERATIONS=freeze(['Add','Refresh','Delete','Create','Post','Post All','Cancel Post','Review','Download','Upload','Release','Batch Settings','Set Vendor','Set Project','Set Cost Code','Set User','Split Record']);
const period=value=>{const candidate=text(value);const match=/^(?:[MRC]\s*:\s*)?(0[1-9]|1[0-2])\/(\d{4})$/.exec(candidate);return match?`${match[2]}-${match[1]}`:null;};
const sensitiveInput=value=>{
  if(value==null)return false;
  if(typeof value==='string')return /(?:[?&]token=|authorization\s*:|bearer\s+)/i.test(value);
  if(Array.isArray(value))return value.some(sensitiveInput);
  if(typeof value==='object')return Object.entries(value).some(([key,item])=>/(token|authorization|cookie|password|secret)/i.test(key)||sensitiveInput(item));
  return false;
};
const externalRelationEvidence=row=>{
  const value=row?.external_trace;
  if(value==null)return {trace:null};
  if(typeof value!=='object'||Array.isArray(value)||sensitiveInput(value))return {error:exception(row,'WBS_AUTOREC_EXTERNAL_TRACE_INVALID','Persisted external relation evidence is malformed or contains a sensitive locator')};
  try{const trace=freeze(structuredClone(value)),traceHash=canonicalRequestHash(trace);if(text(row?.external_trace_hash)!==traceHash)return {error:exception(row,'WBS_AUTOREC_EXTERNAL_TRACE_MISMATCH','Persisted external relation evidence does not match its immutable inbound trace hash')};return {trace,trace_hash:traceHash};}catch{return {error:exception(row,'WBS_AUTOREC_EXTERNAL_TRACE_INVALID','Persisted external relation evidence cannot be retained safely')};}
};

export class WbsInboundProjectionError extends Error { constructor(code,message){super(message);this.name='WbsInboundProjectionError';this.code=code;} }
const exception=(row,code,message)=>freeze({stage:'EXCEPTION',code,message,company_key:text(row?.company_key)||null,source_record_id:text(row?.source_record_id)||null,bank_source_record_id:text(row?.bank_source_record_id)||null,raw_event_id:text(row?.raw_event_id)||null,staging_item_id:text(row?.staging_item_id)||null,can_dispatch:false,can_post:false});
const scopedException=(item,block_scope)=>freeze({...item,block_scope});

// WBS supplies page/action observations, not an authoritative REFS transition
// graph. In particular, an Incur action is not inferred from a later detail
// row and a WBS status can never release, incur, reverse, or post in REFS.
export function wbsAutoRecObservedWorkflowContract(){
  return freeze({
    contract:'WBS_AUTOREC_OBSERVED_WORKFLOW_V1',
    steps:OBSERVED_WORKFLOW_STEPS,
    detail_kind_to_step:OBSERVED_WORKFLOW_STEP_BY_DETAIL_KIND,
    canonical_wbs_transition_graph:'UNKNOWN',
    refs_transition_authority:'REFS_AUTHORITATIVE_WORKFLOW_ONLY',
    can_transition_refs:false,
    can_release:false,
    can_incur:false,
    can_create_draft:false,
    can_post:false
  });
}

function missingFields(row){
  const required=['receipt_id','receipt_ref','receipt_hash','raw_event_id','source_document_id','staging_item_id','source_record_id','source_version','entity_id','company_key','currency','amount','business_date','accounting_date','source_type'];
  const missing=required.filter(key=>key==='amount'?decimal(row?.amount)===null:text(row?.[key])==='');
  if(!/^[A-Z]{3}$/.test(text(row?.currency)))missing.push('currency');
  if(decimal(row?.amount)===0)missing.push('nonzero_amount');
  if(!validDate(row?.business_date)||!validDate(row?.accounting_date))missing.push('business_or_accounting_date');
  if(row?.source_type==='BANK_TRANSACTION'&&!text(row?.bank_account_ref))missing.push('bank_account_ref');
  return [...new Set(missing)];
}
function mappingFor(row,mappings){
  // Payable and AutoRec Detail rows do not get a bank-account identity from a
  // display relation such as cb_id.  The approved REFS mapping supplies that
  // scope; a bank row must additionally agree with its receipt field.
  // A mapping that was retired after the source accounting date remains the
  // immutable historical mapping for that source.  The reader returns both
  // APPROVED and RETIRED snapshots; the effective window below selects one
  // exact version for the source date.  A current-only lookup would make a
  // closed-period WBS receipt impossible to trace or reconcile.
  const scoped=(mappings||[]).filter(mapping=>['APPROVED','RETIRED'].includes(text(mapping?.status))&&text(mapping?.mapping_id)&&text(mapping?.version)&&text(mapping?.bank_account_ref)&&/^sha256:[0-9a-f]{64}$/.test(text(mapping?.snapshot_hash))&&text(mapping?.source_type)===text(row.source_type)&&text(mapping?.entity_id)===text(row.entity_id)&&text(mapping?.company_key)===text(row.company_key)&&text(mapping?.currency)===text(row.currency)&&(row.source_type!=='BANK_TRANSACTION'||text(mapping?.bank_account_ref)===text(row.bank_account_ref)));
  const accountingAt=Date.parse(`${text(row?.accounting_date)}T00:00:00.000Z`);
  const effective=mapping=>{
    const from=text(mapping?.effective_from),to=text(mapping?.effective_to);
    if(!validInstant(from)||(to!==''&&!validInstant(to)))return false;
    const fromAt=Date.parse(from),toAt=to===''?null:Date.parse(to);
    return Number.isFinite(accountingAt)&&Number.isFinite(fromAt)&&(toAt===null||Number.isFinite(toAt)&&toAt>fromAt)&&accountingAt>=fromAt&&(toAt===null||accountingAt<toAt);
  };
  const matches=scoped.filter(effective);
  if(matches.length===0)return {error:exception(row,scoped.length?'WBS_AUTOREC_MAPPING_NOT_EFFECTIVE':'WBS_AUTOREC_MAPPING_MISSING',scoped.length?'No approved scoped mapping is effective for this WBS accounting date':'No approved scoped mapping exists for this persisted WBS source')};
  if(matches.length!==1)return {error:exception(row,'WBS_AUTOREC_MAPPING_AMBIGUOUS','More than one approved scoped mapping exists for this persisted WBS source')};
  return {mapping:matches[0]};
}

function companyControl(row){
  if(!row||typeof row!=='object'||sensitiveInput(row))return {error:exception(row,'WBS_AUTOREC_CONTROL_INPUT_INVALID','Observed WBS control evidence contains an unsafe or invalid locator')};
  const quantities={quantity:decimal(row.quantity),released_quantity:decimal(row.released_quantity),incurred_quantity:decimal(row.incurred_quantity)};
  const amounts={amount:decimal(row.amount),released_amount:decimal(row.released_amount),incurred_amount:decimal(row.incurred_amount),reconciliation_balance:decimal(row.reconciliation_balance),new_balance:decimal(row.new_balance)};
  const periods={match:period(row.completed_match_period),release:period(row.completed_release_period),incur:period(row.completed_incur_period)};
  const signedStages=[amounts.released_amount,amounts.incurred_amount].filter(value=>value!==0);
  const invalid=text(row.company_key)===''||text(row.user_ref)===''||Object.values(periods).some(value=>value===null)||!validDate(row.balance_date)||Object.values(quantities).some(value=>value===null||value<0)||Object.values(amounts).some(value=>value===null)||quantities.released_quantity>quantities.quantity||quantities.incurred_quantity>quantities.quantity||signedStages.some(value=>Math.sign(value)!==Math.sign(amounts.amount))||Math.abs(amounts.released_amount)>Math.abs(amounts.amount)||Math.abs(amounts.incurred_amount)>Math.abs(amounts.amount);
  if(invalid)return {error:exception(row,'WBS_AUTOREC_CONTROL_INVALID','Observed WBS M/R/C quantity, amount, or balance controls are incomplete or do not conserve')};
  return {control:freeze({company_key:text(row.company_key),user_ref:text(row.user_ref),completed_periods:freeze(periods),quantity:quantities.quantity,released_quantity:quantities.released_quantity,incurred_quantity:quantities.incurred_quantity,amount:decimalText(amounts.amount),released_amount:decimalText(amounts.released_amount),incurred_amount:decimalText(amounts.incurred_amount),reconciliation_balance:decimalText(amounts.reconciliation_balance),new_balance:decimalText(amounts.new_balance),balance_date:text(row.balance_date),can_dispatch:false,can_post:false})};
}

function detailControl(row){
  if(!row||typeof row!=='object'||sensitiveInput(row))return {error:exception(row,'WBS_AUTOREC_CONTROL_INPUT_INVALID','Observed WBS detail evidence contains an unsafe or invalid locator')};
  // Every row-level state, relation, or JE trace needs an explicit company
  // scope before it can be retained as AutoRec evidence. Page-level context
  // cannot safely be inferred after the row leaves the WBS response.
  const required=['detail_kind','company_key','receipt_id','receipt_ref','receipt_hash','source_record_id','source_version'];
  const missing=required.filter(key=>text(row[key])==='');
  if(!OBSERVED_DETAIL_KINDS.has(text(row.detail_kind))||missing.length)return {error:exception(row,'WBS_AUTOREC_CONTROL_TRACE_REQUIRED',`Observed WBS detail requires ${missing.join(', ')||'a supported detail kind'}`)};
  const rawStatus=row.wbs_status_code??row.pd_status??'';
  const rawMatchStatus=row.wbs_match_status_code??row.pd_match_status??row.match_status??'';
  if((text(rawStatus)!==''&&statusCode(rawStatus)===null)||(text(rawMatchStatus)!==''&&statusCode(rawMatchStatus)===null))return {error:exception(row,'WBS_AUTOREC_STATUS_CODE_INVALID','Observed WBS status evidence is malformed and cannot be retained safely')};
  if(text(row.detail_kind)==='NOT_MATCH_PAYMENT'){
    const unmatchedRequired=['bank_source_record_id','bank_source_version','transaction_date','posting_date','account_code','ref_no','direction','amount'];
    const unmatchedMissing=unmatchedRequired.filter(key=>key==='amount'?decimal(row[key])===null:text(row[key])==='');
    const assignments=['vendor','project_department','cost_code','user_ref'];
    const workflow=text(row.workflow_status).toUpperCase();
    if(unmatchedMissing.length||assignments.some(key=>text(row[key])==='')||workflow===''||workflow==='NO_WORKFLOW'||workflow==='ADD')return {error:exception(row,'WBS_AUTOREC_UNMATCHED_REVIEW_REQUIRED','Unmatched WBS payment requires source identity, dimensions, and human review before any REFS candidate')};
  }
  if(text(row.detail_kind)==='INCURRED_PAYMENT'){
    const incurredRequired=['bank_source_record_id','bank_source_version','bank_source_receipt_id','bank_source_receipt_ref','bank_source_receipt_hash','autoc_payable_long_id','match_status','transaction_date','posting_date','bank_account_code','ref_no','memo','direction','amount'];
    const incurredMissing=incurredRequired.filter(key=>key==='amount'?decimal(row[key])===null:text(row[key])==='');
    const dimensions=['project_department','cost_code'];
    const humanTrace=['user_ref','reviewer','comments_log'];
    if(incurredMissing.length||dimensions.some(key=>text(row[key])==='')||humanTrace.some(key=>text(row[key])==='')||(text(row.vendor)===''&&text(row.payee)==='')||text(row.invoice_receipt_evidence)==='')return {error:exception(row,'WBS_AUTOREC_INCURRED_RELATION_REQUIRED','Incurred WBS payment requires immutable bank-to-AUTOC relation, dimensions, attachment evidence, and human review trace')};
  }
  if(text(row.detail_kind)==='ACCOUNTING_AUDIT_LOG'){
    const auditRequired=['external_event_id','operation_type','observed_at'];
    if(auditRequired.some(key=>text(row[key])==='')||!validInstant(row.observed_at))return {error:exception(row,'WBS_AUTOREC_AUDIT_TRACE_REQUIRED','WBS accounting audit evidence requires an immutable event identifier, operation label, and exact UTC observation time')};
  }
  const fields=['seq_no','transaction_date','posting_date','create_date','source','journal_no','check_no','payee','vendor','memo','ref_no','account_code','bank_account_code','cost_code','cost_class','project_department','brief_description','payable_ref','unit_ref','invoice_receipt_evidence','comments_log','direction','amount','deposit','payment','debit','credit','originator','reviewer','approver','user_ref','workflow_status','review_status','approval_status','posting_status','bank_source_record_id','bank_source_version','external_event_id','operation_type','observed_at'];
  const observed_fields=Object.fromEntries(fields.filter(key=>row[key]!=null&&text(row[key])!=='').map(key=>[key,(key==='debit'||key==='credit')?decimalText(row[key]):text(row[key])]));
  if(('transaction_date' in observed_fields&&!validDate(observed_fields.transaction_date))||('posting_date' in observed_fields&&!validDate(observed_fields.posting_date))||('create_date' in observed_fields&&!validDate(observed_fields.create_date))||['amount','deposit','payment','debit','credit'].some(key=>key in observed_fields&&decimal(observed_fields[key])===null))return {error:exception(row,'WBS_AUTOREC_CONTROL_TRACE_INVALID','Observed WBS detail has an invalid transaction, posting, creation, or monetary value')};
  const retained_relation=text(row.detail_kind)==='INCURRED_PAYMENT'?freeze({bank_record:freeze({source_record_id:text(row.bank_source_record_id),source_version:text(row.bank_source_version),bank_account_code:text(row.bank_account_code)}),autoc_payable:freeze({long_id:text(row.autoc_payable_long_id)}),match_status:text(row.match_status),dimensions:freeze({project_department:text(row.project_department),cost_code:text(row.cost_code)}),attachment_invoice_evidence:text(row.invoice_receipt_evidence),human_review_trace:freeze({user_ref:text(row.user_ref),reviewer:text(row.reviewer),comments_log:text(row.comments_log)}),can_create_transaction:false,can_approve:false,can_post:false}):null;
  const retained_audit_trace=text(row.detail_kind)==='ACCOUNTING_AUDIT_LOG'?freeze({external_event_id:text(row.external_event_id),operation_type:text(row.operation_type),observed_at:text(row.observed_at),event_authority:'WBS_OBSERVED_EVIDENCE_ONLY',can_transition_state:false,can_create_draft:false,can_approve:false,can_post:false}):null;
  const observedState=OBSERVED_AUTOREC_STATE[text(row.detail_kind)]??null;
  const observedStep=OBSERVED_WORKFLOW_STEP_BY_DETAIL_KIND[text(row.detail_kind)]??null;
  const observed_status_codes=freeze({detail_status:statusCode(rawStatus),match_status:statusCode(rawMatchStatus),semantics:'UNVERIFIED_SOURCE_CODE'});
  return {detail:freeze({detail_kind:text(row.detail_kind),observed_state:observedState,state_authority:observedState?'WBS_OBSERVED_EVIDENCE_ONLY':null,observed_workflow_step:observedStep,workflow_authority:observedStep?'WBS_OBSERVED_EVIDENCE_ONLY':null,observed_status_codes,can_transition_state:false,receipt_id:text(row.receipt_id),receipt_ref:text(row.receipt_ref),receipt_hash:text(row.receipt_hash),source_record_id:text(row.source_record_id),source_version:text(row.source_version),observed_fields:freeze(observed_fields),retained_relation,retained_audit_trace,can_dispatch:false,can_post:false})};
}

// A read-only copy of the observed WBS Auto Bank Reconciliation controls. It
// records four display steps (Company Screening, Data Processing & Release,
// Incur, Incurred List) as evidence only: no WBS action is callable here.
export function projectObservedWbsAutoRecControlEvidence({companyRows,detailRows=[]}={}){
  if(!Array.isArray(companyRows)||!Array.isArray(detailRows))throw new WbsInboundProjectionError('WBS_AUTOREC_CONTROL_ROWS_REQUIRED','Observed WBS company and detail control rows must be arrays');
  const controls=[],details=[],exceptions=[];
  for(const row of companyRows){const result=companyControl(row);result.error?exceptions.push(result.error):controls.push(result.control);}
  // A malformed row-level Release/Incur/JE observation must quarantine only
  // its referenced source. It is not a Company Screening failure and cannot
  // suppress otherwise valid candidates for the same company.
  for(const row of detailRows){const result=detailControl(row);result.error?exceptions.push(scopedException(result.error,'SOURCE')):details.push(result.detail);}
  return freeze({evidence_type:'WBS_AUTOREC_OBSERVED_CONTROL_EVIDENCE_V1',observed_workflow:wbsAutoRecObservedWorkflowContract(),controls:freeze(controls),details:freeze(details),exceptions:freeze(exceptions),forbidden_wbs_operations:FORBIDDEN_WBS_OPERATIONS,can_dispatch:false,can_create_draft:false,can_post:false});
}

// A receipt sequence can prove that WBS displayed different states at different
// times. It cannot prove that those changes form WBS's canonical transition
// graph or authorize the equivalent REFS transition.
export function buildWbsObservedAutoRecStateHistory({observations,persistedRows,scope=null}={}){
  if(!Array.isArray(observations)||!Array.isArray(persistedRows))throw new WbsInboundProjectionError('WBS_AUTOREC_STATE_OBSERVATIONS_REQUIRED','Observed WBS AutoRec state observations and persisted receipt rows must be arrays');
  const exceptions=[],bySource=new Map();
  for(const row of observations){
    const projected=detailControl(row);
    if(projected.error){exceptions.push(scopedException(projected.error,'SOURCE'));continue;}
    const detail=projected.detail,observedAt=text(row?.observed_at);
    if(!detail.observed_state){exceptions.push(scopedException(exception(row,'WBS_AUTOREC_STATE_OBSERVATION_KIND_INVALID','Only observed payment-state detail kinds can enter state history'),'SOURCE'));continue;}
    if(!validInstant(observedAt)){exceptions.push(scopedException(exception(row,'WBS_AUTOREC_STATE_OBSERVATION_TIME_INVALID','Observed WBS state history requires an exact UTC observation time'),'SOURCE'));continue;}
    const bound=receiptBinding(row,persistedRows,scope);
    if(bound.error){exceptions.push(scopedException(bound.error,'SOURCE'));continue;}
    // Provider record identifiers are not globally unique. Keep every
    // observed state sequence inside the immutable persisted scope so an ID
    // reused by another company or entity cannot manufacture a cross-scope
    // transition history.
    const sourceIdentity=freeze({tenant_id:bound.trace.tenant_id,entity_id:bound.trace.entity_id,company_key:text(row.company_key),source_record_id:detail.source_record_id});
    const sourceKey=[sourceIdentity.tenant_id??'',sourceIdentity.entity_id??'',sourceIdentity.company_key,sourceIdentity.source_record_id].join('\u0000'),versionKey=`${detail.source_version}:${detail.receipt_hash}`;
    const entries=bySource.get(sourceKey)??[];
    const duplicate=entries.find(item=>item.version_key===versionKey);
    if(duplicate){
      if(duplicate.observed_state!==detail.observed_state||duplicate.observed_at!==observedAt)exceptions.push(scopedException(exception(row,'WBS_AUTOREC_STATE_OBSERVATION_CONFLICT','One immutable WBS source version cannot attest conflicting state observations'),'SOURCE'));
      continue;
    }
    entries.push(freeze({source_identity:sourceIdentity,source_version:detail.source_version,receipt_trace:bound.trace,observed_at:observedAt,observed_state:detail.observed_state,version_key:versionKey}));
    bySource.set(sourceKey,entries);
  }
  const histories=[];
  for(const [,entries] of bySource){
    const sourceIdentity=entries[0].source_identity,sourceRecordId=sourceIdentity.source_record_id;
    const ordered=[...entries].sort((left,right)=>left.observed_at.localeCompare(right.observed_at)||left.version_key.localeCompare(right.version_key));
    if(ordered.some((item,index)=>index>0&&item.observed_at===ordered[index-1].observed_at&&item.observed_state!==ordered[index-1].observed_state)){
      exceptions.push(scopedException(exception({source_record_id:sourceRecordId},'WBS_AUTOREC_STATE_OBSERVATION_ORDER_AMBIGUOUS','Different WBS states at one observation time cannot establish a sequence'),'SOURCE'));
      continue;
    }
    const events=ordered.map((item,index)=>freeze({observed_at:item.observed_at,observed_state:item.observed_state,previous_observed_state:index?ordered[index-1].observed_state:null,observed_change:index>0&&item.observed_state!==ordered[index-1].observed_state,receipt:item.receipt_trace,source_version:item.source_version,can_transition_state:false,can_release:false,can_incur:false,can_reverse:false,can_post:false}));
    histories.push(freeze({tenant_id:sourceIdentity.tenant_id,entity_id:sourceIdentity.entity_id,company_key:sourceIdentity.company_key,source_record_id:sourceRecordId,observations:freeze(events),latest_observed_state:events.at(-1).observed_state,canonical_wbs_transition_graph:'UNKNOWN',transition_authority:'WBS_OBSERVED_EVIDENCE_ONLY',requires_provider_transition_contract:true,forward_trace:freeze({tenant_id:sourceIdentity.tenant_id,entity_id:sourceIdentity.entity_id,company_key:sourceIdentity.company_key,source_record_id:sourceRecordId,receipt_hashes:freeze(events.map(item=>item.receipt.receipt_hash)),source_versions:freeze(events.map(item=>item.source_version))}),reverse_trace:freeze({tenant_id:sourceIdentity.tenant_id,entity_id:sourceIdentity.entity_id,company_key:sourceIdentity.company_key,latest_receipt_hash:events.at(-1).receipt.receipt_hash,latest_source_version:events.at(-1).source_version,source_record_id:sourceRecordId}),can_transition_state:false,can_release:false,can_incur:false,can_reverse:false,can_post:false}));
  }
  return freeze({evidence_type:'WBS_AUTOREC_OBSERVED_STATE_HISTORY_V1',canonical_wbs_transition_graph:'UNKNOWN',histories:freeze(histories),exceptions:freeze(exceptions),can_transition_state:false,can_release:false,can_incur:false,can_reverse:false,can_post:false});
}

const receiptTrace=row=>freeze({tenant_id:text(row.tenant_id)||null,entity_id:text(row.entity_id)||null,receipt_id:text(row.receipt_id),receipt_ref:text(row.receipt_ref),receipt_hash:text(row.receipt_hash),source_record_id:text(row.source_record_id),source_version:text(row.source_version),company_key:text(row.company_key)});
function receiptBinding(row,persistedRows,scope=null){
  const required=['receipt_id','receipt_ref','receipt_hash','source_record_id','source_version','company_key'];
  if(required.some(key=>text(row?.[key])===''))return {error:exception(row,'WBS_AUTOREC_RECEIPT_TRACE_REQUIRED','Observed WBS evidence requires an immutable receipt, source version, and company scope')};
  const scoped=scope&&typeof scope==='object';
  if(scoped&&(!text(scope.tenant_id)||!text(scope.entity_id)||!text(scope.company_key)))return {error:exception(row,'WBS_AUTOREC_RECEIPT_SCOPE_REQUIRED','Receipt-backed WBS evidence requires tenant, entity, and company scope')};
  const sourceRows=persistedRows.filter(item=>text(item?.source_record_id)===text(row.source_record_id));
  if(sourceRows.length===0)return {error:exception(row,'WBS_AUTOREC_RECEIPT_MISSING','Observed WBS evidence source is absent from the persisted receipt-backed read model')};
  const versionRows=sourceRows.filter(item=>text(item.source_version)===text(row.source_version));
  if(versionRows.length===0)return {error:exception(row,'WBS_AUTOREC_RECEIPT_STALE','Observed WBS evidence source version is stale against the persisted read model')};
  const scopedRows=versionRows.filter(item=>text(item.company_key)===text(row.company_key)&&(!scoped||(text(item.tenant_id)===text(scope.tenant_id)&&text(item.entity_id)===text(scope.entity_id)&&text(item.company_key)===text(scope.company_key))));
  if(scopedRows.length===0)return {error:exception(row,'WBS_AUTOREC_RECEIPT_SCOPE_MISMATCH','Observed WBS evidence company does not match the persisted source scope')};
  const exact=scopedRows.filter(item=>text(item.receipt_id)===text(row.receipt_id)&&text(item.receipt_ref)===text(row.receipt_ref)&&text(item.receipt_hash)===text(row.receipt_hash));
  if(exact.length!==1)return {error:exception(row,'WBS_AUTOREC_RECEIPT_CHANGED','Observed WBS evidence receipt differs from the persisted immutable receipt')};
  return {trace:receiptTrace(exact[0])};
}

// Binds observed Company Screening/Release/Incur/Incurred List evidence to
// persisted REFS receipt rows. This is a read model verification step only.
export function bindReceiptBackedWbsAutoRecControlEvidence({companyRows,detailRows=[],persistedRows,scope=null}={}){
  if(!Array.isArray(companyRows)||!Array.isArray(detailRows)||!Array.isArray(persistedRows))throw new WbsInboundProjectionError('WBS_AUTOREC_PERSISTED_CONTROL_ROWS_REQUIRED','Observed WBS controls and persisted receipt-backed rows must be arrays');
  const controls=[],details=[],exceptions=[];
  for(const row of companyRows){const projected=companyControl(row);if(projected.error){exceptions.push(scopedException(projected.error,'COMPANY'));continue;}const bound=receiptBinding(row,persistedRows,scope);if(bound.error){exceptions.push(scopedException(bound.error,'COMPANY'));continue;}controls.push(freeze({...projected.control,receipt_trace:bound.trace}));}
  for(const row of detailRows){const projected=detailControl(row);if(projected.error){exceptions.push(scopedException(projected.error,'SOURCE'));continue;}const bound=receiptBinding(row,persistedRows,scope);if(bound.error){exceptions.push(scopedException(bound.error,'SOURCE'));continue;}let bank_relation_trace=null;if(text(row.detail_kind)==='INCURRED_PAYMENT'){const bank=receiptBinding({...row,source_record_id:row.bank_source_record_id,source_version:row.bank_source_version,receipt_id:row.bank_source_receipt_id,receipt_ref:row.bank_source_receipt_ref,receipt_hash:row.bank_source_receipt_hash},persistedRows,scope);if(bank.error){exceptions.push(scopedException(bank.error,'SOURCE'));continue;}bank_relation_trace=bank.trace;}details.push(freeze({...projected.detail,receipt_trace:bound.trace,bank_relation_trace}));}
  return freeze({evidence_type:'WBS_AUTOREC_RECEIPT_BACKED_CONTROL_EVIDENCE_V1',observed_workflow:wbsAutoRecObservedWorkflowContract(),controls:freeze(controls),details:freeze(details),exceptions:freeze(exceptions),forbidden_wbs_operations:FORBIDDEN_WBS_OPERATIONS,can_dispatch:false,can_create_draft:false,can_post:false});
}

// A Company Screening row is only useful to a future reconciliation decision
// when it can be traced to one immutable receipt.  Keep its M/R/C totals on
// the candidate as control evidence, never as matching or posting authority.
function receiptBackedCompanyControlTraces(controlEvidence){
  const traces=new Map(),exceptions=[];
  if(controlEvidence?.evidence_type!=='WBS_AUTOREC_RECEIPT_BACKED_CONTROL_EVIDENCE_V1')return {traces,exceptions};
  for(const control of controlEvidence.controls){
    const receipt=control.receipt_trace;
    if(!receipt)continue;
    const snapshot=freeze({company_key:control.company_key,completed_periods:control.completed_periods,quantity:control.quantity,released_quantity:control.released_quantity,incurred_quantity:control.incurred_quantity,amount:control.amount,released_amount:control.released_amount,incurred_amount:control.incurred_amount,reconciliation_balance:control.reconciliation_balance,new_balance:control.new_balance,balance_date:control.balance_date,receipt_trace:receipt});
    const trace=freeze({control_snapshot_hash:canonicalRequestHash(snapshot),receipt_id:receipt.receipt_id,receipt_ref:receipt.receipt_ref,receipt_hash:receipt.receipt_hash,source_record_id:receipt.source_record_id,source_version:receipt.source_version,company_key:control.company_key,completed_periods:control.completed_periods,quantity:control.quantity,released_quantity:control.released_quantity,incurred_quantity:control.incurred_quantity,amount:control.amount,released_amount:control.released_amount,incurred_amount:control.incurred_amount,reconciliation_balance:control.reconciliation_balance,new_balance:control.new_balance,balance_date:control.balance_date,can_match:false,can_allocate:false,can_release:false,can_create_draft:false,can_post:false});
    const current=traces.get(control.company_key)??new Map();current.set(trace.control_snapshot_hash,trace);traces.set(control.company_key,current);
  }
  for(const [companyKey,items] of traces){
    if(items.size!==1)exceptions.push(scopedException(exception({company_key:companyKey},'WBS_AUTOREC_CONTROL_SNAPSHOT_AMBIGUOUS','More than one receipt-backed Company Screening control snapshot exists for this company'), 'COMPANY'));
  }
  return {traces,exceptions};
}

// Read-only projection from a persisted staging/exception read model. It does
// not allocate, release, dispatch a Draft command, or post. The source rows
// must already carry the immutable receipt and Raw→Staging identifiers created
// by the atomic intake command.
export function projectPersistedWbsInboundAutoRec({rows,mappings=[],companyControlRows=null,detailControlRows=[],persistedControlRows=null,scope=null}={}){
  if(!Array.isArray(rows))throw new WbsInboundProjectionError('WBS_AUTOREC_PROJECTION_ROWS_REQUIRED','Persisted WBS inbound rows are required');
  if(!Array.isArray(mappings))throw new WbsInboundProjectionError('WBS_AUTOREC_PROJECTION_MAPPINGS_INVALID','Approved mapping read rows must be an array');
  const candidates=[],exceptions=[];
  const control_evidence=companyControlRows===null?null:(persistedControlRows===null?projectObservedWbsAutoRecControlEvidence({companyRows:companyControlRows,detailRows:detailControlRows}):bindReceiptBackedWbsAutoRecControlEvidence({companyRows:companyControlRows,detailRows:detailControlRows,persistedRows:persistedControlRows,scope}));
  if(control_evidence?.exceptions.length)exceptions.push(...control_evidence.exceptions);
  const controlTraces=receiptBackedCompanyControlTraces(control_evidence);
  if(controlTraces.exceptions.length)exceptions.push(...controlTraces.exceptions);
  const evidenceExceptions=[...(control_evidence?.exceptions||[]),...controlTraces.exceptions];
  const blockedCompanies=new Set(evidenceExceptions.filter(item=>item.block_scope==='COMPANY'||(!item.block_scope&&item.company_key)).map(item=>item.company_key).filter(Boolean));
  const blockedSources=new Set(evidenceExceptions.filter(item=>item.block_scope==='SOURCE'||(!item.block_scope&&!item.company_key)).map(item=>item.bank_source_record_id||item.source_record_id).filter(Boolean));
  const globallyBlocked=evidenceExceptions.some(item=>!item.company_key&&!item.bank_source_record_id&&!item.source_record_id);
  for(const row of rows){
    if(!row||typeof row!=='object'){exceptions.push(exception(null,'WBS_AUTOREC_PERSISTED_ROW_INVALID','Persisted WBS inbound row is invalid'));continue;}
    if(text(row.stage)==='EXCEPTION'){exceptions.push(exception(row,text(row.exception_code)||'WBS_INBOUND_EXCEPTION',text(row.exception_message)||'Persisted inbound exception remains blocked'));continue;}
    if(text(row.stage)!=='STAGING_REVIEWED'){exceptions.push(exception(row,'WBS_AUTOREC_STAGING_REVIEW_REQUIRED','Persisted WBS source must be reviewed before Auto Reconciliation review'));continue;}
    if(globallyBlocked||blockedCompanies.has(text(row.company_key))||blockedSources.has(text(row.source_record_id))){exceptions.push(exception(row,'WBS_AUTOREC_CONTROL_SCOPE_BLOCKED','Observed WBS control evidence blocks this company or source scope'));continue;}
    if(!TRANSACTION_TYPES.has(text(row.source_type))){exceptions.push(exception(row,'WBS_AUTOREC_SOURCE_TYPE_INVALID','Persisted WBS source type cannot enter Auto Reconciliation'));continue;}
    const missing=missingFields(row);if(missing.length){exceptions.push(exception(row,'WBS_AUTOREC_TRACE_REQUIRED',`Persisted WBS source is missing ${missing.join(', ')}`));continue;}
    const relation=externalRelationEvidence(row);if(relation.error){exceptions.push(relation.error);continue;}
    const resolution=mappingFor(row,mappings);if(resolution.error){exceptions.push(resolution.error);continue;}
    const side=row.source_type==='BANK_TRANSACTION'?'BANK_SIDE':'BUSINESS_SIDE';
    const relationTrace=relation.trace===null?null:freeze({fields:relation.trace,trace_hash:relation.trace_hash,can_use_as_source_key:false,can_match:false,can_transition:false,can_post:false});
    const companyControls=controlTraces.traces.get(text(row.company_key));
    const controlTrace=companyControls?.size===1?[...companyControls.values()][0]:null;
    const bankAccountRef=row.source_type==='BANK_TRANSACTION'?text(row.bank_account_ref):text(resolution.mapping.bank_account_ref);
    const trace=freeze({receipt_id:row.receipt_id,receipt_ref:row.receipt_ref,receipt_hash:row.receipt_hash,raw_event_id:row.raw_event_id,source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,source_record_id:row.source_record_id,source_version:row.source_version,mapping_id:resolution.mapping.mapping_id,mapping_version:resolution.mapping.version,mapping_snapshot_hash:resolution.mapping.snapshot_hash,mapping_bank_account_ref:text(resolution.mapping.bank_account_ref),mapping_effective_from:text(resolution.mapping.effective_from),mapping_effective_to:text(resolution.mapping.effective_to)||null,external_relation_evidence:relationTrace,company_control_trace:controlTrace});
    candidates.push(freeze({review_candidate_id:canonicalRequestHash({side,trace}),stage:'STAGING_REVIEWED',side,source_type:row.source_type,entity_id:row.entity_id,company_key:row.company_key,currency:row.currency,amount:decimal(row.amount),business_date:row.business_date,accounting_date:row.accounting_date,direction:text(row.direction).toUpperCase()||null,review_event_id:text(row.review_event_id)||null,bank_account_ref:bankAccountRef,source_record_id:row.source_record_id,source_version:row.source_version,raw_event_id:row.raw_event_id,source_document_id:row.source_document_id,staging_item_id:row.staging_item_id,mapping:freeze({mapping_id:resolution.mapping.mapping_id,version:resolution.mapping.version,snapshot_hash:resolution.mapping.snapshot_hash,bank_account_ref:text(resolution.mapping.bank_account_ref),effective_from:text(resolution.mapping.effective_from),effective_to:text(resolution.mapping.effective_to)||null}),external_relation_evidence:relationTrace,company_control_trace:controlTrace,trace,can_dispatch:false,can_allocate:false,can_release:false,can_create_draft:false,can_post:false}));
  }
  return freeze({projection:'WBS_PERSISTED_INBOUND_AUTOREC_REVIEW_V1',candidates:freeze(candidates),exceptions:freeze(exceptions),control_evidence,controls:freeze({candidate_count:candidates.length,exception_count:exceptions.length,can_dispatch:false,can_post:false}),required_next_controls:freeze(['human Auto Reconciliation review','separate authoritative allocation/release command','standard Draft JE workflow'])});
}
