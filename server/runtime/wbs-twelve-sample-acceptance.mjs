import {createHash} from 'node:crypto';

const HASH=/^sha256:[0-9a-f]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAMPLE_COUNT=12;
const text=value=>typeof value==='string'?value.trim():'';
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const digest=value=>`sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

function required(value,fields,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||fields.some(field=>!text(value[field])))fail(code);
}

function unique(values,code){
  if(new Set(values).size!==values.length)fail(code);
}

function sampleIdentity(sample){
  required(sample,['sample_id','company_code','package_hash','snapshot_id','bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id','control_total_hash'],'WBS_TWELVE_SAMPLE_INVALID');
  if(!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(text(sample.sample_id))||!UUID.test(text(sample.snapshot_id))||![sample.package_hash,sample.control_total_hash].every(value=>HASH.test(text(value))))fail('WBS_TWELVE_SAMPLE_INVALID');
  const identifiers=['bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id'];
  if(identifiers.some(field=>text(sample[field]).length>256)||sample.bank_source_record_id===sample.business_source_record_id||sample.bank_staging_item_id===sample.business_staging_item_id||sample.bank_journal_entry_id===sample.business_journal_entry_id)fail('WBS_TWELVE_SAMPLE_INVALID');
  if(sample.manual_review_completed!==true||sample.signed_package_verified!==true||sample.g11_posted_trace_verified!==true||sample.gl_report_control_total_matched!==true||sample.authoritative_api_readback_verified!==true)fail('WBS_TWELVE_SAMPLE_INCOMPLETE');
  return Object.freeze({sample_id:text(sample.sample_id),company_code:text(sample.company_code),package_hash:text(sample.package_hash),snapshot_id:text(sample.snapshot_id),bank_source_record_id:text(sample.bank_source_record_id),business_source_record_id:text(sample.business_source_record_id),bank_staging_item_id:text(sample.bank_staging_item_id),business_staging_item_id:text(sample.business_staging_item_id),bank_review_event_id:text(sample.bank_review_event_id),business_review_event_id:text(sample.business_review_event_id),bank_source_document_id:text(sample.bank_source_document_id),business_source_document_id:text(sample.business_source_document_id),bank_raw_event_id:text(sample.bank_raw_event_id),business_raw_event_id:text(sample.business_raw_event_id),bank_journal_entry_id:text(sample.bank_journal_entry_id),business_journal_entry_id:text(sample.business_journal_entry_id),bank_audit_event_id:text(sample.bank_audit_event_id),business_audit_event_id:text(sample.business_audit_event_id),report_id:text(sample.report_id),control_total_hash:text(sample.control_total_hash)});
}

export function verifyWbsTwelveSampleAcceptance(manifest){
  required(manifest,['schema_version','release_sha','verified_at'],'WBS_TWELVE_SAMPLE_MANIFEST_INVALID');
  if(manifest.schema_version!=='WBS_TWELVE_SAMPLE_ACCEPTANCE_V1'||!/^[-0-9A-Za-z._/]{7,128}$/.test(text(manifest.release_sha))||!Array.isArray(manifest.samples)||manifest.samples.length!==SAMPLE_COUNT)fail('WBS_TWELVE_SAMPLE_MANIFEST_INVALID');
  const samples=manifest.samples.map(sampleIdentity);
  const allKeys=['sample_id','package_hash','snapshot_id','bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id','control_total_hash'];
  for(const key of allKeys)unique(samples.map(sample=>sample[key]),'WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE');
  return Object.freeze({ok:true,status:'WBS_TWELVE_SAMPLE_ACCEPTANCE_VERIFIED',sample_count:SAMPLE_COUNT,release_sha:text(manifest.release_sha),manifest_hash:digest({schema_version:manifest.schema_version,release_sha:text(manifest.release_sha),verified_at:text(manifest.verified_at),samples}),requires_authenticated_api_e2e:true,verified_samples:samples.map(sample=>Object.freeze({sample_id:sample.sample_id,company_code:sample.company_code,snapshot_id:sample.snapshot_id}))});
}
