import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {verifyWbsTwelveSampleAcceptance} from '../runtime/wbs-twelve-sample-acceptance.mjs';
import {verifyWbsTwelveSampleAcceptanceFile} from '../tools/verify-wbs-twelve-sample-acceptance.mjs';

const hash=letter=>`sha256:${letter.repeat(64)}`;
const sample=index=>({sample_id:`WBS-SAMPLE-${String(index).padStart(2,'0')}`,company_code:'WBPA',package_hash:hash(index.toString(16).padStart(1,'a').slice(-1)),snapshot_id:randomUUID(),bank_source_record_id:`bank-source-${index}`,business_source_record_id:`business-source-${index}`,bank_staging_item_id:`bank-stage-${index}`,business_staging_item_id:`business-stage-${index}`,bank_review_event_id:`bank-review-${index}`,business_review_event_id:`business-review-${index}`,bank_source_document_id:`bank-document-${index}`,business_source_document_id:`business-document-${index}`,bank_raw_event_id:`bank-raw-${index}`,business_raw_event_id:`business-raw-${index}`,bank_journal_entry_id:`bank-je-${index}`,business_journal_entry_id:`business-je-${index}`,bank_audit_event_id:`bank-audit-${index}`,business_audit_event_id:`business-audit-${index}`,report_id:`report-${index}`,control_total_hash:hash((15-index).toString(16).padStart(1,'b').slice(-1)),manual_review_completed:true,signed_package_verified:true,g11_posted_trace_verified:true,gl_report_control_total_matched:true,authoritative_api_readback_verified:true});
const manifest=()=>({schema_version:'WBS_TWELVE_SAMPLE_ACCEPTANCE_V1',release_sha:'abcdef0123456789',verified_at:'2026-09-13T00:00:00.000Z',samples:Array.from({length:12},(_,index)=>sample(index+1))});

test('twelve sample acceptance requires unique signed, manually reviewed, posted and readback evidence',()=>{
  const result=verifyWbsTwelveSampleAcceptance(manifest());
  assert.equal(result.status,'WBS_TWELVE_SAMPLE_ACCEPTANCE_VERIFIED');assert.equal(result.sample_count,12);assert.match(result.manifest_hash,/^sha256:[a-f0-9]{64}$/);assert.equal(result.verified_samples.length,12);assert.equal(result.requires_authenticated_api_e2e,true);
});

test('twelve sample acceptance rejects incomplete counts, duplicate evidence, and missing online readback',()=>{
  const tooFew=manifest();tooFew.samples.pop();assert.throws(()=>verifyWbsTwelveSampleAcceptance(tooFew),{code:'WBS_TWELVE_SAMPLE_MANIFEST_INVALID'});
  const impossible=manifest();impossible.verified_at='2026-02-30T00:00:00.000Z';assert.throws(()=>verifyWbsTwelveSampleAcceptance(impossible),{code:'WBS_TWELVE_SAMPLE_MANIFEST_INVALID'});
  const repeated=manifest();repeated.samples[11].package_hash=repeated.samples[0].package_hash;assert.throws(()=>verifyWbsTwelveSampleAcceptance(repeated),{code:'WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE'});
  const replayed=manifest();replayed.samples[11].bank_source_record_id=replayed.samples[0].bank_source_record_id;assert.throws(()=>verifyWbsTwelveSampleAcceptance(replayed),{code:'WBS_TWELVE_SAMPLE_DUPLICATE_EVIDENCE'});
  const unverified=manifest();unverified.samples[0].authoritative_api_readback_verified=false;assert.throws(()=>verifyWbsTwelveSampleAcceptance(unverified),{code:'WBS_TWELVE_SAMPLE_INCOMPLETE'});
});

test('twelve sample command requires one explicit local manifest path',()=>{
  assert.throws(()=>verifyWbsTwelveSampleAcceptanceFile([]),{code:'WBS_TWELVE_SAMPLE_ARGUMENT_INVALID'});
  assert.throws(()=>verifyWbsTwelveSampleAcceptanceFile(['--manifest','missing.json']),{code:'WBS_TWELVE_SAMPLE_MANIFEST_MISSING'});
});
