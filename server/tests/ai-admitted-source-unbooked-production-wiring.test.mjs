import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import test from 'node:test';

const runtime=new URL('../runtime/',import.meta.url);

test('production kernel derives AP, all-Journal, and ledger evidence from one retained-source population query',async()=>{
  const source=await readFile(new URL('kernel-repository.mjs',runtime),'utf8'),start=source.indexOf('async listAiAdmittedSourceBookingEvidence'),end=source.indexOf('\n  async ',start+10),method=source.slice(start,end);
  assert.match(method,/refs_assert_scope\(\$1,\$2,'AI\.ANALYSIS\.EXPLAIN'\)/);assert.match(method,/wbs_final1_retained_source_row/);assert.match(method,/wbs_final1_retained_evidence_admission/);assert.match(method,/r\.domain='PAYABLES'/);assert.match(method,/r\.outcome='STAGING_REVIEW_REQUIRED'/);assert.match(method,/r\.exception_codes='\[\]'::jsonb/);
  assert.match(method,/business_document/);assert.match(method,/document_kind='AP_BILL'/);assert.match(method,/source_link/);assert.match(method,/journal_entry_id IS NOT NULL/);assert.match(method,/ledger_line/);assert.match(method,/LIMIT \$4/);assert.match(method,/limit\+1/);
  assert.doesNotMatch(method,/INSERT|UPDATE|DELETE|raw_event\.payload|storage_ref|authorization/i);
});

test('production Full Controller scan registers admitted-source-unbooked through the trusted kernel reader',async()=>{
  const source=await readFile(new URL('accounting-server.mjs',runtime),'utf8');
  assert.match(source,/createAiAdmittedSourceUnbookedAnalysisService/);assert.match(source,/bookingEvidenceReader:scope=>kernel\.listAiAdmittedSourceBookingEvidence\(scope\)/);assert.match(source,/ADMITTED_SOURCE_UNBOOKED:admittedSourceUnbooked/);assert.match(source,/limit:Math\.min\(input\.limit,500\)/);
});
