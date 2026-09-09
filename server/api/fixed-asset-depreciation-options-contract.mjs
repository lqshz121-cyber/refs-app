const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const HASH=/^sha256:[a-f0-9]{64}$/;
const MONEY=/^-?(0|[1-9]\d{0,15})\.\d{4}$/;
const keys=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===fields.split(' ').sort().join('|');
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/.test(value);
const date=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const money=value=>typeof value==='string'&&MONEY.test(value);
export const FIXED_ASSET_DEPRECIATION_READINESS=Object.freeze([
 'READY','BLOCKED_ASSET_INACTIVE','BLOCKED_PERIOD_NOT_OPEN','BLOCKED_ACQUISITION_NOT_POSTED','BLOCKED_ACQUISITION_EVIDENCE',
 'BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED','BLOCKED_ASSET_DISPOSED','BLOCKED_NOT_DUE','BLOCKED_COST_RECONCILIATION',
 'BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION','BLOCKED_ALREADY_POSTED'
]);
export function validFixedAssetDepreciationOptions(value,{tenantId,entityId,assetId,periodId}){
 if(!keys(value,'schema_version tenant_id entity_id asset_id asset_tag evidence_status register_evidence_hash member_trace currency cost_basis salvage_value asset_account_code accumulated_depreciation_account_code depreciation_expense_account_code period source acquisition policy schedule actual_posted_cost actual_prior_accumulated_depreciation acquisition_posted impairment_recorded disposal_recorded readiness_status pending_journals more_pending_journals requires_command_validation'))return false;
 if(value.schema_version!=='FIXED_ASSET_DEPRECIATION_OPTIONS_V1'||value.tenant_id!==tenantId||value.entity_id!==entityId||value.asset_id!==assetId||![tenantId,entityId,assetId,periodId].every(id=>UUID.test(id||''))||!text(value.asset_tag,100)||!['ACTIVE','INACTIVE'].includes(value.evidence_status)||!HASH.test(value.register_evidence_hash||'')||!/^[A-Z]{3}$/.test(value.currency||'')||![value.cost_basis,value.salvage_value,value.actual_posted_cost,value.actual_prior_accumulated_depreciation].every(money)||BigInt(value.cost_basis.replace('.',''))<=0n||BigInt(value.salvage_value.replace('.',''))<0n||BigInt(value.salvage_value.replace('.',''))>=BigInt(value.cost_basis.replace('.',''))||!text(value.asset_account_code,128)||!text(value.accumulated_depreciation_account_code,128)||!text(value.depreciation_expense_account_code,128))return false;
 const p=value.period;if(!keys(p,'period_id period_code starts_on ends_on status')||p.period_id!==periodId||!UUID.test(p.period_id)||!/^\d{4}-(0[1-9]|1[0-2])$/.test(p.period_code)||!date(p.starts_on)||!date(p.ends_on)||p.starts_on>p.ends_on||!['OPEN','SOFT_CLOSED','CLOSED'].includes(p.status))return false;
 const member=value.member_trace;if(!keys(member,'project_ref property_ref allocation_basis')||!text(member.allocation_basis,128)||member.project_ref!==null&&!text(member.project_ref,128)||member.property_ref!==null&&!text(member.property_ref,128))return false;
 const s=value.schedule;if(!keys(s,'schedule_snapshot_hash expected_period_depreciation expected_accumulated_depreciation expected_prior_accumulated_depreciation')||!HASH.test(s.schedule_snapshot_hash||'')||![s.expected_period_depreciation,s.expected_accumulated_depreciation,s.expected_prior_accumulated_depreciation].every(money)||[s.expected_period_depreciation,s.expected_accumulated_depreciation,s.expected_prior_accumulated_depreciation].some(amount=>BigInt(amount.replace('.',''))<0n)||BigInt(s.expected_accumulated_depreciation.replace('.',''))!==BigInt(s.expected_prior_accumulated_depreciation.replace('.',''))+BigInt(s.expected_period_depreciation.replace('.','')))return false;
 const policy=value.policy;if(!keys(policy,'policy_snapshot_id policy_snapshot_hash policy_snapshot_version policy_version')||!UUID.test(policy.policy_snapshot_id||'')||!HASH.test(policy.policy_snapshot_hash||'')||!Number.isSafeInteger(policy.policy_snapshot_version)||policy.policy_snapshot_version<1||!Number.isSafeInteger(policy.policy_version)||policy.policy_version<1)return false;
 if((value.source===null)!==(value.acquisition===null))return false;
 if(value.source!==null&&(!keys(value.source,'source_document_id source_document_version source_payload_hash source_document_line_id source_line_snapshot_hash original_evidence_id original_evidence_hash')||!UUID.test(value.source.source_document_id||'')||!Number.isSafeInteger(value.source.source_document_version)||value.source.source_document_version<1||!HASH.test(value.source.source_payload_hash||'')||!UUID.test(value.source.source_document_line_id||'')||!HASH.test(value.source.source_line_snapshot_hash||'')||!UUID.test(value.source.original_evidence_id||'')||!HASH.test(value.source.original_evidence_hash||'')))return false;
 if(value.acquisition!==null&&(!keys(value.acquisition,'binding_id journal_entry_id')||!UUID.test(value.acquisition.binding_id||'')||!UUID.test(value.acquisition.journal_entry_id||'')))return false;
 if(!Array.isArray(value.pending_journals)||value.pending_journals.length>20||typeof value.more_pending_journals!=='boolean'||value.more_pending_journals&&value.pending_journals.length!==20)return false;
 if(value.pending_journals.some((j,index)=>!keys(j,'journal_entry_id period_id journal_number journal_date status revision')||!UUID.test(j.journal_entry_id||'')||j.period_id!==periodId||!text(j.journal_number,100)||!date(j.journal_date)||!['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED'].includes(j.status)||!Number.isSafeInteger(j.revision)||j.revision<0||index>0&&value.pending_journals[index-1].journal_entry_id>=j.journal_entry_id))return false;
 if(!FIXED_ASSET_DEPRECIATION_READINESS.includes(value.readiness_status)||typeof value.acquisition_posted!=='boolean'||typeof value.impairment_recorded!=='boolean'||typeof value.disposal_recorded!=='boolean'||value.requires_command_validation!==true)return false;
 if(value.acquisition_posted!==(value.acquisition!==null))return false;
 const due=BigInt(s.expected_period_depreciation.replace('.','')),costMatches=BigInt(value.actual_posted_cost.replace('.',''))===BigInt(value.cost_basis.replace('.','')),priorMatches=BigInt(value.actual_prior_accumulated_depreciation.replace('.',''))===BigInt(s.expected_prior_accumulated_depreciation.replace('.',''));
 const active=value.evidence_status==='ACTIVE',open=p.status==='OPEN',acquired=value.acquisition_posted;
 const coherent={
  READY:active&&open&&acquired&&!value.impairment_recorded&&!value.disposal_recorded&&due>0n&&costMatches&&priorMatches,
  BLOCKED_ASSET_INACTIVE:!active,
  BLOCKED_PERIOD_NOT_OPEN:active&&!open,
  BLOCKED_ACQUISITION_NOT_POSTED:active&&open&&!acquired,
  BLOCKED_ACQUISITION_EVIDENCE:active&&open&&acquired,
  BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED:active&&open&&acquired&&value.impairment_recorded,
  BLOCKED_ASSET_DISPOSED:active&&open&&acquired&&!value.impairment_recorded&&value.disposal_recorded,
  BLOCKED_NOT_DUE:active&&open&&acquired&&!value.impairment_recorded&&!value.disposal_recorded&&due<=0n,
  BLOCKED_COST_RECONCILIATION:active&&open&&acquired&&!value.impairment_recorded&&!value.disposal_recorded&&due>0n&&!costMatches,
  BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION:active&&open&&acquired&&!value.impairment_recorded&&!value.disposal_recorded&&due>0n&&costMatches&&!priorMatches,
  BLOCKED_ALREADY_POSTED:active&&open&&acquired&&!value.impairment_recorded&&!value.disposal_recorded&&due>0n&&costMatches&&priorMatches
 };
 if(!coherent[value.readiness_status])return false;
 return true;
}
