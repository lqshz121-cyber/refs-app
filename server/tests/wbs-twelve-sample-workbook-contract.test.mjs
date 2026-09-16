import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {verifyWbsTwelveSampleAcceptance} from '../runtime/wbs-twelve-sample-acceptance.mjs';

const serverDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = relative => readFileSync(join(serverDir, relative), 'utf8');

const WORKBOOK = 'WBS-TWELVE-SAMPLE-ACCEPTANCE-WORKBOOK.md';
const TEMPLATE = 'fixtures/wbs-twelve-sample-acceptance-template.json';
const RUNTIME = 'runtime/wbs-twelve-sample-acceptance.mjs';
const TOOL = 'tools/verify-wbs-twelve-sample-acceptance.mjs';

const SCALAR_FIELDS = [
  'sample_id', 'company_code', 'package_hash', 'snapshot_id',
  'bank_source_record_id', 'business_source_record_id',
  'bank_staging_item_id', 'business_staging_item_id',
  'bank_review_event_id', 'business_review_event_id',
  'bank_source_document_id', 'business_source_document_id',
  'bank_raw_event_id', 'business_raw_event_id',
  'bank_journal_entry_id', 'business_journal_entry_id',
  'bank_audit_event_id', 'business_audit_event_id',
  'report_id', 'control_total_hash',
  'bank_reviewed_at', 'business_reviewed_at', 'bank_posted_at', 'business_posted_at'
];
const ATTESTATIONS = [
  'manual_review_completed', 'signed_package_verified', 'g11_posted_trace_verified',
  'gl_report_control_total_matched', 'authoritative_api_readback_verified'
];
const EVIDENCE_OBJECTS = ['signed_package_evidence', 'authoritative_api_readback_evidence'];

test('the runtime still requires exactly the scalar fields the workbook rosters', () => {
  const runtime = read(RUNTIME);
  const declared = runtime.match(/required\(sample,\[([^\]]*)\]/);
  assert.ok(declared, 'sampleIdentity required() list not found — runtime shape changed');
  const runtimeFields = declared[1].split(',').map(part => part.trim().replace(/^'|'$/g, ''));
  assert.deepEqual(new Set(runtimeFields), new Set(SCALAR_FIELDS));
});

test('the workbook rosters every scalar field, attestation and evidence object', () => {
  const workbook = read(WORKBOOK);
  for (const field of [...SCALAR_FIELDS, ...ATTESTATIONS, ...EVIDENCE_OBJECTS]) {
    assert.ok(workbook.includes('`' + field + '`'), `workbook does not mention ${field}`);
  }
});

test('the workbook documents every refusal code the runtime and tool can throw', () => {
  const workbook = read(WORKBOOK);
  const codes = new Set([...read(RUNTIME).matchAll(/WBS_TWELVE_SAMPLE_[A-Z_]+/g)].map(match => match[0]));
  for (const match of read(TOOL).matchAll(/WBS_TWELVE_SAMPLE_[A-Z_]+/g)) codes.add(match[0]);
  for (const code of [...codes]) if (code.startsWith('WBS_TWELVE_SAMPLE_ACCEPTANCE')) codes.delete(code);
  assert.ok(codes.size >= 8, `expected the full refusal code set, saw ${codes.size}`);
  for (const code of codes) assert.ok(workbook.includes('`' + code + '`'), `workbook does not document ${code}`);
});

test('the workbook keeps twelve selection rows and fourteen check steps, and binds each attestation to steps', () => {
  const workbook = read(WORKBOOK);
  for (let index = 1; index <= 12; index += 1) assert.ok(workbook.includes(`| S-${index} |`), `selection row S-${index} missing`);
  for (let index = 1; index <= 14; index += 1) assert.ok(workbook.includes(`| C${index} |`), `check step C${index} missing`);
  assert.ok(/\| `manual_review_completed` \| C\d/.test(workbook), 'attestation-to-step mapping missing');
  assert.ok(workbook.includes('Never write to WBS'), 'read-only standing rule missing');
});

test('the blank template carries every manifest key and no real figures', () => {
  const template = JSON.parse(read(TEMPLATE));
  assert.equal(template.schema_version, 'WBS_TWELVE_SAMPLE_ACCEPTANCE_V1');
  assert.equal(template.samples.length, 12);
  for (const sample of template.samples) {
    for (const field of SCALAR_FIELDS) assert.ok(field in sample, `template sample missing ${field}`);
    for (const field of ATTESTATIONS) assert.equal(sample[field], false, `${field} must start false`);
    for (const field of EVIDENCE_OBJECTS) assert.equal(typeof sample[field], 'object');
    assert.equal(sample.authoritative_api_readback_evidence.http_status, 0);
  }
  const placeholders = JSON.stringify(template).match(/FILL/g) ?? [];
  assert.ok(placeholders.length > 300, 'template looks populated — it must stay blank');
});

test('the blank template is refused by the verifier, so it can never be mistaken for evidence', () => {
  assert.throws(() => verifyWbsTwelveSampleAcceptance(JSON.parse(read(TEMPLATE))), error =>
    typeof error.code === 'string' && error.code.startsWith('WBS_TWELVE_SAMPLE_'));
});

test('no completed manifest is committed alongside the template', () => {
  const template = read(TEMPLATE);
  assert.ok(!/sha256:[0-9a-f]{64}/.test(template), 'template contains a concrete digest');
  assert.ok(!/https:\/\/[a-z0-9.-]+\.onrender\.com/.test(template), 'template contains a concrete endpoint');
});
