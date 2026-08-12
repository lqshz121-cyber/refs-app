import {canonicalRequestHash} from './request-hash.mjs';
import {projectPersistedWbsInboundAutoRec} from './wbs-inbound-autorec-projection.mjs';
import {buildReceiptBoundWbsAutoReconciliationReviewPlan,validateWbsAutoRecG11PostedTrace} from './wbs-inbound-data-adapter.mjs';

const text=value=>value==null?'':String(value).trim();
const freeze=value=>Object.freeze(value);
// The API boundary never leaks a JavaScript Number for money.  Planning may
// use scaled values internally, but browser consumers receive MONEY4 tokens
// only; this prevents a client from reinterpreting a binary float as an
// accounting amount.
const money4=value=>{
  if(typeof value!=='number'||!Number.isFinite(value)||!Number.isSafeInteger(Math.round(value*10000)))throw new TypeError('WBS read composition received a non-canonical monetary value');
  return (Object.is(value,-0)?0:value).toFixed(4);
};
const readonlyPlan=plan=>freeze({...plan,
  allocation_plan:freeze(plan.allocation_plan.map(item=>freeze({...item,amount:money4(item.amount)}))),
  control_totals:freeze({...plan.control_totals,
    bank_total:money4(plan.control_totals.bank_total),business_total:money4(plan.control_totals.business_total),allocated_total:money4(plan.control_totals.allocated_total),bank_unallocated:money4(plan.control_totals.bank_unallocated),business_unallocated:money4(plan.control_totals.business_unallocated),difference:money4(plan.control_totals.difference),tolerance:money4(plan.control_totals.tolerance)
  })
});
const readonlyProjection=projection=>freeze({...projection,candidates:freeze(projection.candidates.map(candidate=>freeze({...candidate,amount:money4(candidate.amount)})))});
const empty=(code,replayed=false)=>freeze({status:'BLOCKED',code,replayed,candidates:freeze([]),exceptions:freeze([freeze({stage:'EXCEPTION',code,can_dispatch:false,can_post:false})]),controls:freeze({candidate_count:0,can_dispatch:false,can_post:false}),can_dispatch:false,can_create_draft:false,can_post:false});
const selectionFor=input=>{
  const tenantId=text(input?.tenantId),entityId=text(input?.entityId),companyKey=text(input?.companyKey),replayKey=text(input?.replayKey);
  const sourceRecordIds=[...new Set((input?.sourceRecordIds||[]).map(text).filter(Boolean))].sort();
  if(!tenantId||!entityId||!companyKey||!replayKey||!sourceRecordIds.length)return null;
  return freeze({tenantId,entityId,companyKey,sourceRecordIds:freeze(sourceRecordIds),replayKey});
};
const scoped=(rows,selection)=>Array.isArray(rows)&&rows.every(row=>row&&text(row.tenant_id)===selection.tenantId&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey&&selection.sourceRecordIds.includes(text(row.source_record_id)));
const matchingPolicy=row=>freeze({...row,receipt_id:text(row.policy_id),receipt_ref:`refs-config:mapping-snapshot/${text(row.policy_id)}`,receipt_hash:text(row.policy_snapshot_hash),evidence_type:'REFS_MATCHING_POLICY_SNAPSHOT'});
const policyScope=row=>[text(row?.company_key),text(row?.currency),text(row?.bank_account_ref)].join('\u0000');
const dateValue=value=>{const raw=text(value);if(!/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(raw))return null;const parsed=Date.parse(raw);return Number.isNaN(parsed)?null:parsed;};
const policyEffectiveForRows=(policy,rows)=>{
  const from=dateValue(policy.effective_from),to=policy.effective_to==null||text(policy.effective_to)===''?null:dateValue(policy.effective_to);
  if(from==null||(policy.effective_to!=null&&text(policy.effective_to)!==''&&to==null))return false;
  return rows.every(row=>{const accountingDate=dateValue(row.accounting_date);return accountingDate!=null&&accountingDate>=from&&(to==null||accountingDate<to);});
};
const plansFor=(candidates,policies)=>{
  const grouped=new Map();for(const row of policies){const key=policyScope(row);const items=grouped.get(key)??[];items.push(row);grouped.set(key,items);}
  const plans=[],exceptions=[];
  for(const [scopeKey,items] of grouped){
    const scopePolicy=items[0],toPlanRow=item=>freeze({...item,...item.trace,mapping:item.mapping}),bank=candidates.filter(item=>item.side==='BANK_SIDE'&&item.bank_account_ref===scopePolicy.bank_account_ref&&item.currency===scopePolicy.currency),business=candidates.filter(item=>item.side==='BUSINESS_SIDE'&&item.bank_account_ref===scopePolicy.bank_account_ref&&item.currency===scopePolicy.currency);
    if(!bank.length||!business.length)continue;
    for(const row of [...bank,...business])if(!items.some(policy=>policyEffectiveForRows(policy,[row])))exceptions.push(freeze({stage:'EXCEPTION',code:'WBS_AUTOREC_MATCHING_POLICY_NOT_EFFECTIVE',policy_scope:scopeKey,source_record_id:text(row.source_record_id)||null,source_version:text(row.source_version)||null,can_allocate:false,can_dispatch:false,can_post:false}));
    const effective=items.map(item=>freeze({policy:item,bank:bank.filter(row=>policyEffectiveForRows(item,[row])),business:business.filter(row=>policyEffectiveForRows(item,[row]))})).filter(item=>item.bank.length&&item.business.length);
    if(!effective.length)continue;
    const memberships=new Set(),ambiguous=effective.some(item=>[...item.bank,...item.business].some(row=>{const key=[row.side,row.source_record_id,row.source_version].join('\u0000');if(memberships.has(key))return true;memberships.add(key);return false;}));
    if(ambiguous){exceptions.push(freeze({stage:'EXCEPTION',code:'WBS_AUTOREC_MATCHING_POLICY_AMBIGUOUS',policy_scope:scopeKey,can_allocate:false,can_dispatch:false,can_post:false}));continue;}
    for(const item of effective){
      const policy=matchingPolicy(item.policy),plan=buildReceiptBoundWbsAutoReconciliationReviewPlan({bankRows:item.bank.map(toPlanRow),businessRows:item.business.map(toPlanRow),matchingPolicy:policy});
      if(plan.status==='BLOCKED')exceptions.push(...plan.exceptions);else plans.push(freeze({...plan,policy_evidence_type:policy.evidence_type,can_allocate:false,can_release:false,can_post:false}));
    }
  }
  return freeze({plans:freeze(plans),exceptions:freeze(exceptions)});
};

// Composition-only seam. The injected repository is read-only and must return
// persisted rows; this module never opens a transaction or dispatches a JE.
export function createWbsInboundAutoRecReadComposition({repository}={}){
  const replays=new Map();
  return freeze({
    async read(input={}){
      const selection=selectionFor(input);if(!selection)return empty('WBS_AUTOREC_READ_SELECTION_INVALID');
      const requestHash=canonicalRequestHash({tenantId:selection.tenantId,entityId:selection.entityId,companyKey:selection.companyKey,sourceRecordIds:selection.sourceRecordIds});
      const prior=replays.get(selection.replayKey);if(prior){if(prior.request_hash!==requestHash)return empty('WBS_AUTOREC_READ_REPLAY_CONFLICT',true);return freeze({...prior.result,replayed:true});}
      const methods=['readPersistedWbsInboundRows','readPersistedWbsControlRows','readApprovedWbsAutoRecMappings','readApprovedWbsAutoRecMatchingPolicies','readWbsAutoRecObservedStateEvidence'];
      if(!repository||methods.some(name=>typeof repository[name]!=='function'))return empty('WBS_AUTOREC_READ_CAPABILITY_UNAVAILABLE');
      let inbound,control,mappings,matchingPolicies,observedStateEvidence;
      try{[inbound,control,mappings,matchingPolicies,observedStateEvidence]=await Promise.all([repository.readPersistedWbsInboundRows({...selection,read_only:true}),repository.readPersistedWbsControlRows({...selection,read_only:true}),repository.readApprovedWbsAutoRecMappings({...selection,read_only:true}),repository.readApprovedWbsAutoRecMatchingPolicies({...selection,read_only:true}),repository.readWbsAutoRecObservedStateEvidence({...selection,read_only:true})]);}catch{return empty('WBS_AUTOREC_READ_FAILED');}
      if(!scoped(inbound,selection)||!control||!scoped(control.companyRows,selection)||!scoped(control.detailRows,selection)||!scoped(control.persistedRows,selection)||!scoped(observedStateEvidence,selection)||!Array.isArray(mappings)||!mappings.every(row=>row&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey)||!Array.isArray(matchingPolicies)||!matchingPolicies.every(row=>row&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey))return empty('WBS_AUTOREC_READ_SCOPE_INVALID');
      const projection=projectPersistedWbsInboundAutoRec({rows:inbound,mappings,companyControlRows:control.companyRows,detailControlRows:control.detailRows,persistedControlRows:control.persistedRows,scope:{tenant_id:selection.tenantId,entity_id:selection.entityId,company_key:selection.companyKey}});
      const policyPlans=plansFor(projection.candidates,matchingPolicies);
      const result=freeze({status:'READ_ONLY_PROJECTED',request_hash:requestHash,replayed:false,...readonlyProjection(projection),matching_policy_evidence:freeze(matchingPolicies.map(matchingPolicy)),matching_policy_exceptions:policyPlans.exceptions,review_plans:freeze(policyPlans.plans.map(readonlyPlan)),observed_state_evidence:freeze(observedStateEvidence.map(row=>freeze({...row,can_transition_refs:false,can_release:false,can_incur:false,can_create_draft:false,can_post:false}))),can_dispatch:false,can_create_draft:false,can_post:false});
      replays.set(selection.replayKey,freeze({request_hash:requestHash,result}));return result;
    }
  });
}

const g11SelectionFor=input=>{
  const tenantId=text(input?.tenantId),entityId=text(input?.entityId),companyKey=text(input?.companyKey),reviewCandidateId=text(input?.reviewCandidateId),replayKey=text(input?.replayKey);
  return tenantId&&entityId&&companyKey&&reviewCandidateId&&replayKey?freeze({tenantId,entityId,companyKey,reviewCandidateId,replayKey}):null;
};
const g11Scoped=(row,selection)=>row&&text(row.tenant_id)===selection.tenantId&&text(row.entity_id)===selection.entityId&&text(row.company_key)===selection.companyKey;

// This composition layer reads authoritative kernel evidence and passes it to
// the G11 verifier. It cannot create, approve, post, or transition a case.
export function createWbsAutoRecG11ReadVerifier({repository}={}){
  const replays=new Map();
  return freeze({
    async verify(input={}){
      const selection=g11SelectionFor(input);if(!selection)return empty('WBS_AUTOREC_G11_SELECTION_INVALID');
      const requestHash=canonicalRequestHash({tenantId:selection.tenantId,entityId:selection.entityId,companyKey:selection.companyKey,reviewCandidateId:selection.reviewCandidateId});
      const prior=replays.get(selection.replayKey);if(prior){if(prior.request_hash!==requestHash)return empty('WBS_AUTOREC_G11_REPLAY_CONFLICT',true);return freeze({...prior.result,replayed:true});}
      const methods=['readReviewedWbsAutoRecRequest','readPostedWbsAutoRecJournalEvidence'];
      if(!repository||methods.some(name=>typeof repository[name]!=='function'))return empty('WBS_AUTOREC_G11_READ_CAPABILITY_UNAVAILABLE');
      let reviewRequest,postedJournals;
      try{[reviewRequest,postedJournals]=await Promise.all([repository.readReviewedWbsAutoRecRequest({...selection,read_only:true}),repository.readPostedWbsAutoRecJournalEvidence({...selection,read_only:true})]);}catch{return empty('WBS_AUTOREC_G11_READ_FAILED');}
      if(!g11Scoped(reviewRequest,selection)||text(reviewRequest.review_candidate_id)!==selection.reviewCandidateId||!Array.isArray(postedJournals)||!postedJournals.every(row=>g11Scoped(row,selection)&&text(row.review_candidate_id)===selection.reviewCandidateId))return empty('WBS_AUTOREC_G11_READ_SCOPE_INVALID');
      let verification;try{verification=validateWbsAutoRecG11PostedTrace({reviewRequest,postedJournals});}catch(error){return empty(error?.code||'WBS_AUTOREC_G11_EVIDENCE_INVALID');}
      const result=freeze({status:'G11_POSTED_TRACE_VERIFIED',request_hash:requestHash,replayed:false,review_candidate_id:selection.reviewCandidateId,verification,can_dispatch:false,can_create_draft:false,can_post:false});
      replays.set(selection.replayKey,freeze({request_hash:requestHash,result}));return result;
    }
  });
}
