import {createHash} from 'node:crypto';

const HASH=/^sha256:[0-9a-f]{64}$/;
const GIT_SHA=/^[0-9a-f]{40}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SAMPLE_COUNT=12;
const text=value=>typeof value==='string'?value.trim():'';
const instant=value=>{if(typeof value!=='string'||!/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/.test(value))return false;const m=value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})Z$/),[,year,month,day,hour,minute,second]=m;const d=new Date(Date.UTC(Number(year),Number(month)-1,Number(day),Number(hour),Number(minute),Number(second)));return d.getUTCFullYear()===Number(year)&&d.getUTCMonth()===Number(month)-1&&d.getUTCDate()===Number(day)&&Number(hour)<24&&Number(minute)<60&&Number(second)<60;};
const fail=code=>{const error=new Error(code);error.code=code;throw error;};
const digest=value=>`sha256:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;

function required(value,fields,code){
  if(!value||typeof value!=='object'||Array.isArray(value)||fields.some(field=>!text(value[field])))fail(code);
}

function unique(values,code){
  if(new Set(values).size!==values.length)fail(code);
}

const httpsUrl=value=>{try{const url=new URL(text(value));return url.protocol==='https:'&&!url.username&&!url.password&&url.hostname?url.toString():null;}catch{return null;}};
const immutableRef=value=>/^(?:object|s3|gs|az|https):\/\/[^\s]{1,2048}$/.test(text(value));
const evidenceReference=(value,code)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(code);
  const verificationId=text(value.verification_id),keyId=text(value.key_id);
  if(!immutableRef(value.reference)||!HASH.test(text(value.content_hash))||!verificationId||verificationId.length>256||!keyId||keyId.length>256||!['Ed25519','ES256','RS256'].includes(value.algorithm)||!instant(text(value.verified_at)))fail(code);
  return Object.freeze({reference:text(value.reference),content_hash:text(value.content_hash),verification_id:verificationId,key_id:keyId,algorithm:value.algorithm,verified_at:text(value.verified_at)});
};
const apiReadback=(value,code)=>{
  if(!value||typeof value!=='object'||Array.isArray(value))fail(code);
  const authenticatedSubject=text(value.authenticated_subject);
  if(!httpsUrl(value.endpoint)||!HASH.test(text(value.response_hash))||!authenticatedSubject||authenticatedSubject.length>512||!instant(text(value.read_at))||!/^2\d\d$/.test(String(value.http_status)))fail(code);
  return Object.freeze({endpoint:httpsUrl(value.endpoint),response_hash:text(value.response_hash),authenticated_subject:authenticatedSubject,read_at:text(value.read_at),http_status:Number(value.http_status)});
};
function sampleIdentity(sample){
  required(sample,['sample_id','company_code','package_hash','snapshot_id','bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id','control_total_hash','bank_reviewed_at','business_reviewed_at','bank_posted_at','business_posted_at'],'WBS_TWELVE_SAMPLE_INVALID');
  if(!/^[A-Z0-9][A-Z0-9_-]{2,63}$/.test(text(sample.sample_id))||!/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(text(sample.company_code))||!UUID.test(text(sample.snapshot_id))||![sample.package_hash,sample.control_total_hash].every(value=>HASH.test(text(value))))fail('WBS_TWELVE_SAMPLE_INVALID');
  const identifiers=['bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id'];
  if(identifiers.some(field=>text(sample[field]).length>256)||sample.bank_source_record_id===sample.business_source_record_id||sample.bank_staging_item_id===sample.business_staging_item_id||sample.bank_review_event_id===sample.business_review_event_id||sample.bank_source_document_id===sample.business_source_document_id||sample.bank_raw_event_id===sample.business_raw_event_id||sample.bank_journal_entry_id===sample.business_journal_entry_id||sample.bank_audit_event_id===sample.business_audit_event_id)fail('WBS_TWELVE_SAMPLE_INVALID');
  if(sample.manual_review_completed!==true||sample.signed_package_verified!==true||sample.g11_posted_trace_verified!==true||sample.gl_report_control_total_matched!==true||sample.authoritative_api_readback_verified!==true)fail('WBS_TWELVE_SAMPLE_INCOMPLETE');
  if(!instant(text(sample.bank_reviewed_at))||!instant(text(sample.business_reviewed_at))||!instant(text(sample.bank_posted_at))||!instant(text(sample.business_posted_at))||Date.parse(sample.bank_reviewed_at)>Date.parse(sample.bank_posted_at)||Date.parse(sample.business_reviewed_at)>Date.parse(sample.business_posted_at))fail('WBS_TWELVE_SAMPLE_REVIEW_ORDER_INVALID');
  const signedPackage=evidenceReference(sample.signed_package_evidence,'WBS_TWELVE_SAMPLE_SIGNED_PACKAGE_EVIDENCE_INVALID');
  const authoritativeReadback=apiReadback(sample.authoritative_api_readback_evidence,'WBS_TWELVE_SAMPLE_API_READBACK_EVIDENCE_INVALID');
  return Object.freeze({sample_id:text(sample.sample_id),company_code:text(sample.company_code),package_hash:text(sample.package_hash),snapshot_id:text(sample.snapshot_id),bank_source_record_id:text(sample.bank_source_record_id),business_source_record_id:text(sample.business_source_record_id),bank_staging_item_id:text(sample.bank_staging_item_id),business_staging_item_id:text(sample.business_staging_item_id),bank_review_event_id:text(sample.bank_review_event_id),business_review_event_id:text(sample.business_review_event_id),bank_source_document_id:text(sample.bank_source_document_id),business_source_document_id:text(sample.business_source_document_id),bank_raw_event_id:text(sample.bank_raw_event_id),business_raw_event_id:text(sample.business_raw_event_id),bank_journal_entry_id:text(sample.bank_journal_entry_id),business_journal_entry_id:text(sample.business_journal_entry_id),bank_audit_event_id:text(sample.bank_audit_event_id),business_audit_event_id:text(sample.business_audit_event_id),report_id:text(sample.report_id),control_total_hash:text(sample.control_total_hash),bank_reviewed_at:text(sample.bank_reviewed_at),business_reviewed_at:text(sample.business_reviewed_at),bank_posted_at:text(sample.bank_posted_at),business_posted_at:text(sample.business_posted_at),signed_package_evidence:signedPackage,authoritative_api_readback_evidence:authoritativeReadback});
}

export function verifyWbsTwelveSampleAcceptance(manifest){
  required(manifest,['schema_version','release_sha','verified_at'],'WBS_TWELVE_SAMPLE_MANIFEST_INVALID');
  if(manifest.schema_version!=='WBS_TWELVE_SAMPLE_ACCEPTANCE_V1'||!GIT_SHA.test(text(manifest.release_sha))||!instant(text(manifest.verified_at))||!Array.isArray(manifest.samples)||manifest.samples.length!==SAMPLE_COUNT)fail('WBS_TWELVE_SAMPLE_MANIFEST_INVALID');
  const samples=manifest.samples.map(sampleIdentity);
  const allKeys=['sample_id','package_hash','snapshot_id','bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id','report_id','control_total_hash'];
  for(const key of allKeys)unique(samples.map(sample=>sample[key]),'WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE');
  const crossCategoryEvidence=['bank_source_record_id','business_source_record_id','bank_staging_item_id','business_staging_item_id','bank_review_event_id','business_review_event_id','bank_source_document_id','business_source_document_id','bank_raw_event_id','business_raw_event_id','bank_journal_entry_id','business_journal_entry_id','bank_audit_event_id','business_audit_event_id'];
  unique(samples.flatMap(sample=>crossCategoryEvidence.map(key=>sample[key])),'WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE');
  if(samples.some(sample=>sample.signed_package_evidence.content_hash!==sample.package_hash))fail('WBS_TWELVE_SAMPLE_SIGNED_PACKAGE_EVIDENCE_INVALID');
  return Object.freeze({ok:true,status:'WBS_TWELVE_SAMPLE_ACCEPTANCE_VERIFIED',sample_count:SAMPLE_COUNT,release_sha:text(manifest.release_sha),manifest_hash:digest({schema_version:manifest.schema_version,release_sha:text(manifest.release_sha),verified_at:text(manifest.verified_at),samples}),requires_authenticated_api_e2e:true,verified_samples:samples.map(sample=>Object.freeze({sample_id:sample.sample_id,company_code:sample.company_code,snapshot_id:sample.snapshot_id}))});
}
