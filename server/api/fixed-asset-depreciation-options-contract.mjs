const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^sha256:[a-f0-9]{64}$/;
const MONEY=/^-?(0|[1-9]\d{0,15})\.\d{4}$/;
const keys=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===fields.split(' ').sort().join('|');
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const timestamp=value=>typeof value==='string'&&value.length<=64&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));
const money=value=>typeof value==='string'&&MONEY.test(value);
const amount=value=>BigInt(value.replace('.',''));
const roundedPositive=(value,divisor)=>{const n=BigInt(divisor);return value/n+(value%n*2n>=n?1n:0n);};

export const FIXED_ASSET_DEPRECIATION_READINESS=Object.freeze([
 'READY','BLOCKED_ASSET_INACTIVE','BLOCKED_PERIOD_NOT_OPEN','BLOCKED_ACQUISITION_NOT_POSTED','BLOCKED_ACQUISITION_EVIDENCE',
 'BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED','BLOCKED_ASSET_DISPOSED','BLOCKED_NOT_DUE','BLOCKED_COST_RECONCILIATION',
 'BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION','BLOCKED_ALREADY_POSTED'
]);

function validPostImpairmentPolicy(policy,{assetId,salvageValue}){
 if(!keys(policy,'schema_version policy_id policy_evidence_hash status fixed_asset_register_evidence_id impairment_assessment_evidence_id impairment_assessment_hash impairment_journal_entry_id impairment_posting_snapshot_hash effective_period_id effective_from convention remaining_useful_life_months posted_cost_balance prior_accumulated_depreciation posted_accumulated_impairment revised_carrying_value salvage_value revised_depreciable_basis regular_period_amount final_period_amount reviewed_by reviewed_at review_reason'))return false;
 if(policy.schema_version!=='FIXED_ASSET_POST_IMPAIRMENT_DEPRECIATION_POLICY_V1'||policy.status!=='INDEPENDENTLY_REVIEWED'||policy.fixed_asset_register_evidence_id!==assetId||policy.salvage_value!==salvageValue||policy.convention!=='NEXT_PERIOD_FULL_MONTH')return false;
 if(![policy.policy_id,policy.impairment_assessment_evidence_id,policy.impairment_journal_entry_id,policy.effective_period_id].every(value=>UUID.test(value||''))||![policy.policy_evidence_hash,policy.impairment_assessment_hash,policy.impairment_posting_snapshot_hash].every(value=>HASH.test(value||''))||!date(policy.effective_from)||!Number.isSafeInteger(policy.remaining_useful_life_months)||policy.remaining_useful_life_months<1||policy.remaining_useful_life_months>600||!text(policy.reviewed_by,512)||!timestamp(policy.reviewed_at)||!text(policy.review_reason,2000)||policy.review_reason.trim().length<8)return false;
 const fields=['posted_cost_balance','prior_accumulated_depreciation','posted_accumulated_impairment','revised_carrying_value','salvage_value','revised_depreciable_basis','regular_period_amount','final_period_amount'];
 if(!fields.every(field=>money(policy[field])))return false;
 const cost=amount(policy.posted_cost_balance),prior=amount(policy.prior_accumulated_depreciation),impairment=amount(policy.posted_accumulated_impairment),carrying=amount(policy.revised_carrying_value),salvage=amount(policy.salvage_value),basis=amount(policy.revised_depreciable_basis),regular=amount(policy.regular_period_amount),final=amount(policy.final_period_amount);
 if(cost<0n||prior<0n||impairment<0n||salvage<0n||carrying<=0n||basis<=0n||regular<=0n||final<=0n||carrying!==cost-prior-impairment||basis!==carrying-salvage)return false;
 return regular===roundedPositive(basis,policy.remaining_useful_life_months)&&final===basis-regular*BigInt(policy.remaining_useful_life_months-1);
}

export function validFixedAssetDepreciationOptions(value,{tenantId,entityId,assetId,periodId}){
 if(!keys(value,'schema_version tenant_id entity_id asset_id asset_tag evidence_status register_evidence_hash member_trace currency cost_basis salvage_value asset_account_code accumulated_depreciation_account_code depreciation_expense_account_code period source acquisition policy post_impairment_policy schedule actual_posted_cost actual_prior_accumulated_depreciation acquisition_posted impairment_recorded disposal_recorded readiness_status pending_journals more_pending_journals requires_command_validation'))return false;
 if(value.schema_version!=='FIXED_ASSET_DEPRECIATION_OPTIONS_V2'||value.tenant_id!==tenantId||value.entity_id!==entityId||value.asset_id!==assetId||![tenantId,entityId,assetId,periodId].every(id=>UUID.test(id||''))||!text(value.asset_tag,100)||!['ACTIVE','INACTIVE'].includes(value.evidence_status)||!HASH.test(value.register_evidence_hash||'')||!/^[A-Z]{3}$/.test(value.currency||'')||![value.cost_basis,value.salvage_value,value.actual_posted_cost,value.actual_prior_accumulated_depreciation].every(money)||amount(value.cost_basis)<=0n||amount(value.salvage_value)<0n||amount(value.salvage_value)>=amount(value.cost_basis)||!text(value.asset_account_code,128)||!text(value.accumulated_depreciation_account_code,128)||!text(value.depreciation_expense_account_code,128))return false;
 const p=value.period;if(!keys(p,'period_id period_code starts_on ends_on status')||p.period_id!==periodId||!UUID.test(p.period_id)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.period_code)||!date(p.starts_on)||!date(p.ends_on)||p.starts_on>p.ends_on||!['OPEN','SOFT_CLOSED','CLOSED'].includes(p.status))return false;
 const member=value.member_trace;if(!keys(member,'project_ref property_ref allocation_basis')||!text(member.allocation_basis,128)||member.project_ref!==null&&!text(member.project_ref,128)||member.property_ref!==null&&!text(member.property_ref,128))return false;
 const policy=value.policy;if(!keys(policy,'policy_snapshot_id policy_snapshot_hash policy_snapshot_version policy_version')||!UUID.test(policy.policy_snapshot_id||'')||!HASH.test(policy.policy_snapshot_hash||'')||!Number.isSafeInteger(policy.policy_snapshot_version)||policy.policy_snapshot_version<1||!Number.isSafeInteger(policy.policy_version)||policy.policy_version<1)return false;
 const postPolicy=value.post_impairment_policy;if(postPolicy!==null&&!validPostImpairmentPolicy(postPolicy,{assetId,salvageValue:value.salvage_value}))return false;
 const s=value.schedule;if(!keys(s,'schedule_snapshot_hash schedule_basis revised_period_number expected_period_depreciation expected_accumulated_depreciation expected_prior_accumulated_depreciation')||!HASH.test(s.schedule_snapshot_hash||'')||!['ORIGINAL_REGISTER','POST_IMPAIRMENT_REVISED'].includes(s.schedule_basis)||![s.expected_period_depreciation,s.expected_accumulated_depreciation,s.expected_prior_accumulated_depreciation].every(money)||[s.expected_period_depreciation,s.expected_accumulated_depreciation,s.expected_prior_accumulated_depreciation].some(value=>amount(value)<0n)||amount(s.expected_accumulated_depreciation)!==amount(s.expected_prior_accumulated_depreciation)+amount(s.expected_period_depreciation))return false;
 if(s.schedule_basis==='ORIGINAL_REGISTER'&&s.revised_period_number!==null||s.schedule_basis==='POST_IMPAIRMENT_REVISED'&&(!Number.isSafeInteger(s.revised_period_number)||s.revised_period_number<1))return false;
 if(!value.impairment_recorded&&postPolicy!==null||!value.impairment_recorded&&s.schedule_basis!=='ORIGINAL_REGISTER'||postPolicy===null&&s.schedule_basis==='POST_IMPAIRMENT_REVISED')return false;
 if(postPolicy!==null){
  const revised=p.starts_on>=postPolicy.effective_from;
  if(revised!==(s.schedule_basis==='POST_IMPAIRMENT_REVISED'))return false;
  if(revised){
   const number=s.revised_period_number,life=postPolicy.remaining_useful_life_months,basis=amount(postPolicy.revised_depreciable_basis),regular=amount(postPolicy.regular_period_amount),final=amount(postPolicy.final_period_amount),prior=amount(postPolicy.prior_accumulated_depreciation);
   const due=number<life?regular:number===life?final:0n;
   const cumulative=number<life?regular*BigInt(number):basis;
   if(amount(s.expected_period_depreciation)!==due||amount(s.expected_accumulated_depreciation)!==prior+cumulative||amount(s.expected_prior_accumulated_depreciation)!==prior+cumulative-due)return false;
  }
 }
 if((value.source===null)!==(value.acquisition===null))return false;
 if(value.source!==null&&(!keys(value.source,'source_document_id source_document_version source_payload_hash source_document_line_id source_line_snapshot_hash original_evidence_id original_evidence_hash')||!UUID.test(value.source.source_document_id||'')||!Number.isSafeInteger(value.source.source_document_version)||value.source.source_document_version<1||!HASH.test(value.source.source_payload_hash||'')||!UUID.test(value.source.source_document_line_id||'')||!HASH.test(value.source.source_line_snapshot_hash||'')||!UUID.test(value.source.original_evidence_id||'')||!HASH.test(value.source.original_evidence_hash||'')))return false;
 if(value.acquisition!==null&&(!keys(value.acquisition,'binding_id journal_entry_id')||!UUID.test(value.acquisition.binding_id||'')||!UUID.test(value.acquisition.journal_entry_id||'')))return false;
 if(!Array.isArray(value.pending_journals)||value.pending_journals.length>20||typeof value.more_pending_journals!=='boolean'||value.more_pending_journals&&value.pending_journals.length!==20)return false;
 if(value.pending_journals.some((j,index)=>!keys(j,'journal_entry_id period_id journal_number journal_date status revision')||!UUID.test(j.journal_entry_id||'')||j.period_id!==periodId||!text(j.journal_number,100)||!date(j.journal_date)||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].includes(j.status)||!Number.isSafeInteger(j.revision)||j.revision<0||index>0&&value.pending_journals[index-1].journal_entry_id>=j.journal_entry_id))return false;
 if(!FIXED_ASSET_DEPRECIATION_READINESS.includes(value.readiness_status)||typeof value.acquisition_posted!=='boolean'||typeof value.impairment_recorded!=='boolean'||typeof value.disposal_recorded!=='boolean'||value.requires_command_validation!==true)return false;
 if(value.acquisition_posted!==(value.acquisition!==null))return false;
 const due=amount(s.expected_period_depreciation),costMatches=amount(value.actual_posted_cost)===amount(value.cost_basis),priorMatches=amount(value.actual_prior_accumulated_depreciation)===amount(s.expected_prior_accumulated_depreciation);
 const active=value.evidence_status==='ACTIVE',open=p.status==='OPEN',acquired=value.acquisition_posted,covered=!value.impairment_recorded||postPolicy!==null;
 const coherent={
  READY:active&&open&&acquired&&covered&&!value.disposal_recorded&&due>0n&&costMatches&&priorMatches,
  BLOCKED_ASSET_INACTIVE:!active,
  BLOCKED_PERIOD_NOT_OPEN:active&&!open,
  BLOCKED_ACQUISITION_NOT_POSTED:active&&open&&!acquired,
  BLOCKED_ACQUISITION_EVIDENCE:active&&open&&acquired,
  BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED:active&&open&&acquired&&!covered,
  BLOCKED_ASSET_DISPOSED:active&&open&&acquired&&covered&&value.disposal_recorded,
  BLOCKED_NOT_DUE:active&&open&&acquired&&covered&&!value.disposal_recorded&&due<=0n,
  BLOCKED_COST_RECONCILIATION:active&&open&&acquired&&covered&&!value.disposal_recorded&&due>0n&&!costMatches,
  BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION:active&&open&&acquired&&covered&&!value.disposal_recorded&&due>0n&&costMatches&&!priorMatches,
  BLOCKED_ALREADY_POSTED:active&&open&&acquired&&covered&&!value.disposal_recorded&&due>0n&&costMatches&&priorMatches
 };
 return Boolean(coherent[value.readiness_status]);
}
