import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const runtime=new URL('../runtime/',import.meta.url);

test('production kernel derives AP, all-Journal, and ledger evidence from one retained-source population query',async()=>{
  const source=await readFile(new URL('kernel-repository.mjs',runtime),'utf8'),migration=await readFile(new URL('../db/migrations/282_ai_admitted_source_booking_evidence_read.sql',import.meta.url),'utf8'),start=source.indexOf('async listAiAdmittedSourceBookingEvidence'),end=source.indexOf('\n  async ',start+10),method=source.slice(start,end);
  assert.match(method,/refs_read_ai_admitted_source_booking_evidence\(\$1,\$2,\$3,\$4\)/);assert.match(method,/limit\+1/);assert.doesNotMatch(method,/SELECT r\.|business_document|source_link|ledger_line|INSERT|UPDATE|DELETE|raw_event\.payload|storage_ref|authorization/i);
  assert.match(await readFile(new URL('ai-admitted-source-unbooked-service.mjs',runtime),'utf8'),/rows\.length>limit/);
  assert.match(migration,/SECURITY DEFINER/);assert.match(migration,/refs_assert_scope\(p_tenant,p_entity,'AI\.ANALYSIS\.EXPLAIN'\)/);assert.match(migration,/wbs_final1_retained_source_row/);assert.match(migration,/wbs_final1_retained_evidence_admission/);assert.match(migration,/r\.domain='PAYABLES'/);assert.match(migration,/r\.outcome IN \('STAGING_REVIEW_REQUIRED','EXCEPTION_REVIEW_REQUIRED'\)/);assert.match(migration,/r\.exception_codes/);assert.doesNotMatch(migration,/r\.exception_codes='\[\]'::jsonb/);assert.match(migration,/d\.status IN \('QUARANTINED','PENDING_REVIEW','READY_FOR_DRAFT'\)/);
  assert.match(migration,/business_document/);assert.match(migration,/document_kind='AP_BILL'/);assert.match(migration,/source_link/);assert.match(migration,/journal_entry_id IS NOT NULL/);assert.match(migration,/ledger_line/);assert.match(migration,/LIMIT p_limit/);assert.match(migration,/REVOKE ALL ON FUNCTION refs_read_ai_admitted_source_booking_evidence/);assert.match(migration,/GRANT EXECUTE ON FUNCTION refs_read_ai_admitted_source_booking_evidence/);assert.doesNotMatch(migration,/GRANT SELECT|INSERT|UPDATE|DELETE|raw_event\.payload|storage_ref|authorization/i);
});

test('production Full Controller scan registers admitted-source-unbooked through the trusted kernel reader',async()=>{
  const source=await readFile(new URL('accounting-server.mjs',runtime),'utf8');
  assert.match(source,/createAiAdmittedSourceUnbookedAnalysisService/);assert.match(source,/bookingEvidenceReader:scope=>kernel\.listAiAdmittedSourceBookingEvidence\(scope\)/);assert.match(source,/ADMITTED_SOURCE_UNBOOKED:admittedSourceUnbooked/);assert.match(source,/limit:Math\.min\(input\.limit,500\)/);
});
