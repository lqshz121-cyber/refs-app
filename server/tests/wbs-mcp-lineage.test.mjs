import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

import { canonicalRequestBody } from '../runtime/request-hash.mjs';
import { WBS_READONLY_ROW_FIELDS, WBS_READONLY_TOOLS } from '../runtime/wbs-readonly-mcp.mjs';
import {
  WBS_LINEAGE_CONTRACT_VERSION,
  WBS_LINEAGE_EXCEPTIONS,
  WBS_LINEAGE_SOURCE_COUNT,
  WBS_LOAN_DRAW_EXPECTED_SHAPE,
  WBS_PIPELINE_STAGES,
  WBS_SOURCE_CATALOG,
  advanceWbsCursor,
  buildWbsSourceId,
  buildWbsStableKey,
  createWbsCursor,
  describeWbsMappingCoverage,
  isSubsidiaryAccount,
  mapWbsSourceEnvelope,
  reconcileWbsWindowAbsence,
  replayWbsLineage,
  resolveWbsAccountMapping,
  validateWbsSourceRow,
  verifyCatalogAgainstFrozenRowFields,
  wbsRowContentVersion,
} from '../runtime/wbs-mcp-lineage.mjs';

/* ---------------- sanitized fixtures (no live data, no secrets) --------- */

const SCOPE = Object.freeze({ company_key: 'CO-A' });

const envelopeFor = (tool, rows, { cursorNext = null } = {}) => ({
  contract_version: 'WBS-REFS-MCP-V1',
  tool,
  environment: 'production',
  captured_at: '2026-08-05T12:00:00.000Z',
  source: { system: 'WBS' },
  scope: { company: 'CO-A' },
  record_count: rows.length,
  content_sha256: createHash('sha256').update(canonicalRequestBody(rows), 'utf8').digest('hex'),
  cursor_next: cursorNext,
  etl_notice: 'Snapshot comparison required; no CDC or tombstone contract.',
  rows,
});

const ROWS = Object.freeze({
  get_meta: Object.freeze({
    company_codes: ['CO-A'],
    contract_version: 'WBS-REFS-MCP-V1',
    environment: 'production',
    generated_at: '2026-08-05T12:00:00.000Z',
    tools: [...WBS_READONLY_TOOLS],
  }),
  list_payables: Object.freeze({
    amount: 1250.5,
    ap_guid: 'AP-GUID-0001',
    ap_long_id: 'AP-2026-0001',
    bank_account_ref: '111000',
    business_id: 'PD-GUID-0001',
    company_code: 'CO-A',
    cost_id: '03-100',
    description: 'Sanitized fixture payable',
    incurred_date: '2026-07-31',
    journal_no: '20260731000001',
    pj_code: 'PJ-1',
    posting_date: '2026-07-31',
    vendor_name: 'Sanitized Vendor',
    vendor_no: 'V-0001',
  }),
  list_bank_transactions: Object.freeze({
    account_code: '111000',
    bank_transaction_id: 'BANK-GUID-0001',
    cb_id: 'CB-0001',
    come_from: 'FAST',
    company_code: 'CO-A',
    debtor: 0,
    description: 'Sanitized bank line',
    lender: 1250.5,
    payee: 'Sanitized Payee',
    payee_no: 'P-0001',
    posting_date: '2026-07-31',
    set_date: '2026-07-31',
    sys_id: 'SYS-0001',
  }),
  list_autorec_details: Object.freeze({
    batch_guid: 'BATCH-0001',
    biz_type: 'WB',
    cb_id: 'CB-0001',
    cost_code: '03-100',
    data_source: 'Auto Payment',
    deposit: 0,
    incurred_date: '2026-07-31',
    match_guid: 'MATCH-0001',
    match_status: 'Matched',
    payment: 1250.5,
    pd_guid: 'PD-GUID-0001',
    pd_pv_guid: 'PV-GUID-0001',
    posting_date: '2026-07-31',
    project_guid: 'PRJ-0001',
    status: 'Released',
    vendor_no: 'V-0001',
  }),
  list_autorec_banks: Object.freeze({
    ah_id: 'AH-1',
    ah_name: 'Sanitized Bank Account',
    company_code: 'CO-A',
    company_name: 'Sanitized Company A',
    debit_amount: 1250.5,
    incurred: 1,
    pay_amount: 1250.5,
    pb_guid: 'PB-GUID-0001',
    quantity: 2,
    reconciliation_start_date: '2026-07-01',
    released: 1,
    released_quantity: 1,
    status: 'Released',
  }),
  list_journal_entries: Object.freeze({
    account: '640000',
    bill_no: 'AP-2026-0001',
    cb_id: 'CB-0001',
    closed: 'N',
    come_from: 'FAST',
    company: 'CO-A',
    cost_code: '03-100',
    debtor: 1250.5,
    // Integer: the frozen envelope validator enforces Number.isSafeInteger on this
    // stable key, so a string id would be rejected upstream before mapping runs.
    id: 10001,
    journal_no: '20260731000001',
    lender: 0,
    pj_code: 'PJ-1',
    posting_date: '2026-07-31',
    project: 'PRJ-0001',
    reverse: 'N',
    review: 'Y',
    reviewer: 'Sanitized Reviewer',
    set_date: '2026-07-31',
    sys_id: 'SYS-0001',
  }),
  list_control_totals: Object.freeze({
    cell_count: 12,
    company: 'CO-A',
    formula: 'SUM(111000)',
    period: '2026-07',
    quality: 'COMPLETE',
    total_balance: 1250.5,
    total_credit: 1250.5,
    total_debit: 0,
  }),
  trace_by_key: Object.freeze({
    bill_no: 'AP-2026-0001',
    company_code: 'CO-A',
    journal_no: '20260731000001',
    links: [{ type: 'PAYABLE', ref: 'AP-GUID-0001' }],
    source_document_id: 'SD-0001',
    source_module: 'BGDATA.payable',
    source_record_id: 'AP-GUID-0001',
    source_version: '2026-07-31T12:00:00Z',
  }),
});

function stableKeyOf(tool, row) {
  const { source_id } = buildWbsSourceId(tool, row);
  return buildWbsStableKey({
    source_system: 'WBS',
    source_id,
    source_version: wbsRowContentVersion(row),
  }).stable_key;
}

const approvedMapping = (accountCode, overrides = {}) => ({
  mapping_snapshot_id: '11111111-1111-4111-8111-111111111111',
  family: 'COST_CODE_ACCOUNT',
  scope_type: 'ENTITY',
  scope_key: 'CO-A',
  status: 'APPROVED',
  version: 4,
  priority: 100,
  account_code: accountCode,
  ...overrides,
});

const mappingsFor = (pairs) =>
  Object.fromEntries(pairs.map(([tool, row, accountCode]) => [stableKeyOf(tool, row), [approvedMapping(accountCode)]]));

const codes = result => result.exceptions.map(exception => exception.code);

/* ---------------- 1. catalog + schema declaration ---------------------- */

test('the catalog declares exactly the eight approved read-only sources with a schema, stable key, role and terminus', () => {
  assert.equal(WBS_LINEAGE_SOURCE_COUNT, 8);
  assert.deepEqual(Object.keys(WBS_SOURCE_CATALOG).sort(), [...WBS_READONLY_TOOLS].sort());
  for (const [tool, entry] of Object.entries(WBS_SOURCE_CATALOG)) {
    assert.ok(Object.keys(entry.schema).length > 0, `${tool} must declare a schema`);
    assert.ok(entry.stable_key.length > 0, `${tool} must declare stable key parts`);
    assert.ok(WBS_PIPELINE_STAGES.includes(entry.terminus), `${tool} terminus must be a pipeline stage`);
    assert.ok(entry.role, `${tool} must declare a role`);
    for (const part of entry.stable_key) {
      assert.ok(Object.hasOwn(entry.schema, part), `${tool} stable key part ${part} must be declared`);
      assert.equal(entry.schema[part].required, true, `${tool} stable key part ${part} must be required`);
    }
  }
});

test('the catalog schema is bound to the frozen row-field allowlist and never drifts', () => {
  const verified = verifyCatalogAgainstFrozenRowFields();
  assert.deepEqual(verified.drift, []);
  assert.equal(verified.ok, true);
  for (const tool of Object.keys(WBS_READONLY_ROW_FIELDS)) {
    assert.deepEqual(
      Object.keys(WBS_SOURCE_CATALOG[tool].schema).sort(),
      [...WBS_READONLY_ROW_FIELDS[tool]].sort(),
    );
  }
  // get_meta and trace_by_key have no frozen allowlist yet and must say so.
  assert.equal(WBS_SOURCE_CATALOG.get_meta.schema_origin, 'REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION');
  assert.equal(WBS_SOURCE_CATALOG.trace_by_key.schema_origin, 'REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION');
});

test('mapping coverage is reported for every source and every declared field is typed', () => {
  const coverage = describeWbsMappingCoverage();
  assert.equal(coverage.source_count, 8);
  assert.equal(coverage.per_source.length, 8);
  assert.ok(coverage.declared_fields >= 100, 'the eight sources declare the full field surface');
  assert.equal(coverage.mapped_source_fields, coverage.declared_fields);
  assert.equal(coverage.coverage_ratio, 1);
  for (const item of coverage.per_source) {
    assert.deepEqual(item.unmapped_source_fields, [], `${item.tool} must map every declared field`);
    assert.ok(item.normalized_fields > 0);
  }
});

/* ---------------- 2. stable keys and idempotent replay ------------------ */

test('stable keys are deterministic across replays and change only when content changes', () => {
  const first = stableKeyOf('list_payables', ROWS.list_payables);
  const second = stableKeyOf('list_payables', { ...ROWS.list_payables });
  assert.equal(first, second);
  const reordered = Object.fromEntries(Object.entries(ROWS.list_payables).reverse());
  assert.equal(stableKeyOf('list_payables', reordered), first, 'key order must not change the stable key');
  const changed = stableKeyOf('list_payables', { ...ROWS.list_payables, amount: 1250.51 });
  assert.notEqual(changed, first);
});

test('a stable key requires source_system, source_id and source_version', () => {
  assert.throws(
    () => buildWbsStableKey({ source_system: 'WBS', source_id: 'x' }),
    error => error.code === WBS_LINEAGE_EXCEPTIONS.STABLE_KEY_MISSING,
  );
  const key = buildWbsStableKey({ source_system: 'WBS', source_id: 'a', source_version: 'v1' });
  assert.equal(key.composite, 'WBS|a|v1');
  assert.match(key.stable_key, /^sha256:[0-9a-f]{64}$/);
});

/* ---------------- 3. happy path through the pipeline -------------------- */

test('a payable envelope flows Receipt -> Raw -> Normalized -> Staging -> Mapping Review -> Standard JE request seam without ever creating a draft', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: mappingsFor([['list_payables', ROWS.list_payables, '640000']]),
  });
  assert.deepEqual(codes(result), []);
  assert.equal(result.raw.length, 1);
  assert.equal(result.normalized.length, 1);
  assert.equal(result.staging.length, 1);
  assert.equal(result.mapping_review.length, 1);
  assert.equal(result.je_request_seams.length, 1);
  const seam = result.je_request_seams[0];
  assert.equal(seam.status, 'HUMAN_REVIEW_REQUIRED');
  assert.equal(seam.required_command, 'buildStandardDraftRequest');
  for (const flag of ['can_create_draft', 'can_dispatch', 'can_post', 'can_write_wbs']) {
    assert.equal(seam[flag], false, `${flag} must stay false`);
  }
  assert.equal(result.can_post, false);
  assert.equal(result.read_only, true);
  const normalized = result.normalized[0];
  assert.equal(normalized.company_key, 'CO-A');
  assert.equal(normalized.currency, 'USD');
  assert.equal(normalized.amount, 1250.5);
  assert.equal(normalized.direction, 'CREDIT');
  assert.equal(normalized.vendor_ref, 'V-0001');
  assert.equal(normalized.cost_code_ref, '03-100');
  assert.equal(normalized.source_document_ref, 'AP-GUID-0001');
});

test('every one of the eight sources maps at least one sanitized row to its declared terminus', () => {
  const mappings = mappingsFor([
    ['list_payables', ROWS.list_payables, '640000'],
    ['list_bank_transactions', ROWS.list_bank_transactions, '111000'],
    ['list_autorec_details', ROWS.list_autorec_details, '291001'],
  ]);
  const members = { [stableKeyOf('list_autorec_details', ROWS.list_autorec_details)]: 'Sanitized Payee' };
  const reached = {};
  for (const tool of WBS_READONLY_TOOLS) {
    const result = mapWbsSourceEnvelope({
      toolName: tool,
      envelope: envelopeFor(tool, [ROWS[tool]]),
      scope: SCOPE,
      mappingCandidatesByKey: mappings,
      memberByKey: members,
    });
    assert.deepEqual(codes(result), [], `${tool} must map cleanly`);
    assert.equal(result.normalized.length, 1, `${tool} must normalize its row`);
    const terminusReached =
      result.je_request_seams.length + result.autorec_review.length + result.evidence.length;
    assert.ok(terminusReached >= 1, `${tool} must reach a terminus`);
    reached[tool] = WBS_SOURCE_CATALOG[tool].terminus;
  }
  assert.deepEqual(reached, {
    get_meta: 'RECEIPT',
    list_payables: 'STANDARD_JE_REQUEST_SEAM',
    list_bank_transactions: 'STANDARD_JE_REQUEST_SEAM',
    list_autorec_details: 'AUTOREC_REVIEW',
    list_autorec_banks: 'AUTOREC_REVIEW',
    list_journal_entries: 'EVIDENCE_SEAM',
    list_control_totals: 'EVIDENCE_SEAM',
    trace_by_key: 'EVIDENCE_SEAM',
  });
});

test('control, ledger, metadata and trace sources can never create a source document or a journal', () => {
  for (const tool of ['get_meta', 'list_journal_entries', 'list_control_totals', 'trace_by_key']) {
    const result = mapWbsSourceEnvelope({
      toolName: tool,
      envelope: envelopeFor(tool, [ROWS[tool]]),
      scope: SCOPE,
    });
    assert.equal(result.je_request_seams.length, 0);
    assert.equal(result.staging.length, 0);
    assert.equal(result.evidence.length, 1);
    const evidence = result.evidence[0];
    for (const flag of ['can_create_source_document', 'can_allocate', 'can_create_draft', 'can_dispatch', 'can_post']) {
      assert.equal(evidence[flag], false, `${tool}.${flag} must stay false`);
    }
  }
});

test('the AutoRec sources stop at AutoRec Review and hand the eligibility gate to the kernel adapter', () => {
  for (const tool of ['list_autorec_details', 'list_autorec_banks']) {
    const result = mapWbsSourceEnvelope({
      toolName: tool,
      envelope: envelopeFor(tool, [ROWS[tool]]),
      scope: SCOPE,
      mappingCandidatesByKey: mappingsFor([['list_autorec_details', ROWS.list_autorec_details, '291001']]),
      memberByKey: { [stableKeyOf('list_autorec_details', ROWS.list_autorec_details)]: 'Sanitized Payee' },
    });
    assert.deepEqual(codes(result), []);
    assert.equal(result.je_request_seams.length, 0);
    assert.equal(result.autorec_review.length, 1);
    assert.equal(result.autorec_review[0].required_next_control, 'evaluateWbsAutoReconciliationEligibility');
    assert.equal(result.autorec_review[0].can_post, false);
    assert.equal(result.autorec_review[0].can_release, false);
  }
});

/* ---------------- 4. exception class: schema invalid -------------------- */

test('schema violations become a scoped exception and are never inferred', () => {
  const undeclared = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [{ ...ROWS.list_payables, invented_column: 'x' }]),
    scope: SCOPE,
  });
  assert.deepEqual(codes(undeclared), [WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID]);
  assert.equal(undeclared.exceptions[0].inferred, false);
  assert.equal(undeclared.exceptions[0].can_infer, false);
  assert.equal(undeclared.exceptions[0].scope.level, 'ROW');
  assert.deepEqual(undeclared.exceptions[0].detail.violations, [
    { field: 'invented_column', reason: 'UNDECLARED_FIELD' },
  ]);
  assert.equal(undeclared.normalized.length, 0);
  assert.equal(undeclared.raw.length, 1, 'the raw row is still retained read-only');

  const missingRequired = validateWbsSourceRow('list_payables', {
    ...ROWS.list_payables,
    incurred_date: null,
  });
  assert.equal(missingRequired.ok, false);
  assert.deepEqual(missingRequired.violations, [{ field: 'incurred_date', reason: 'REQUIRED_FIELD_MISSING' }]);

  const badDate = validateWbsSourceRow('list_payables', { ...ROWS.list_payables, posting_date: '2026-02-31' });
  assert.deepEqual(badDate.violations, [{ field: 'posting_date', reason: 'EXPECTED_ISO_DATE' }]);
});

test('a four-digit account code is a scoped exception and is never widened to six digits', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_bank_transactions',
    envelope: envelopeFor('list_bank_transactions', [{ ...ROWS.list_bank_transactions, account_code: '1110' }]),
    scope: SCOPE,
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID]);
  assert.deepEqual(result.exceptions[0].detail.violations, [
    { field: 'account_code', reason: 'ACCOUNT_CODE_NOT_SIX_DIGIT' },
  ]);
  const mapped = resolveWbsAccountMapping({
    toolName: 'list_payables',
    normalized: { stable_key: 'k', company_key: 'CO-A' },
    candidates: [approvedMapping('6400')],
  });
  assert.equal(mapped.status, 'MAPPING_EXCEPTION');
  assert.equal(mapped.exception.detail.reason, 'ACCOUNT_CODE_NOT_SIX_DIGIT');
});

/* ---------------- 5. exception class: cross company --------------------- */

test('a row whose company differs from the read scope raises a scoped cross-company exception', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [{ ...ROWS.list_payables, company_code: 'CO-B' }]),
    scope: SCOPE,
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID]);
  assert.equal(result.exceptions[0].detail.upstream_code, 'WBS_MCP_ENVELOPE_SCOPE_MISMATCH');
  assert.equal(result.staging.length, 0);
});

test('a source that cannot attest a company and has no scoped company raises cross-company rather than guessing', () => {
  assert.equal(WBS_SOURCE_CATALOG.list_autorec_details.company_field, null);
  const result = mapWbsSourceEnvelope({
    toolName: 'list_autorec_details',
    envelope: envelopeFor('list_autorec_details', [ROWS.list_autorec_details]),
    scope: {},
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.CROSS_COMPANY]);
  assert.equal(result.exceptions[0].detail.row_company, null);
  assert.equal(result.exceptions[0].detail.scope_company, null);
});

/* ---------------- 6. exception class: revision unknown ------------------ */

test('a changed replay of a known source_id raises revision-unknown because there is no CDC contract', () => {
  const first = replayWbsLineage({
    pages: [{ toolName: 'list_payables', envelope: envelopeFor('list_payables', [ROWS.list_payables]) }],
    scope: SCOPE,
    mappingCandidatesByKey: mappingsFor([['list_payables', ROWS.list_payables, '640000']]),
  });
  assert.deepEqual(first.exceptions, []);

  const amended = { ...ROWS.list_payables, amount: 1300.75 };
  const second = replayWbsLineage({
    pages: [{ toolName: 'list_payables', envelope: envelopeFor('list_payables', [amended]) }],
    scope: SCOPE,
    priorState: first,
  });
  const revision = second.exceptions.filter(
    exception => exception.code === WBS_LINEAGE_EXCEPTIONS.REVISION_UNKNOWN && exception.scope.level === 'ROW',
  );
  assert.equal(revision.length, 1);
  assert.equal(revision[0].detail.has_cdc_contract, false);
  assert.equal(revision[0].detail.has_revision_contract, false);
  assert.notEqual(revision[0].detail.prior_source_version, revision[0].detail.observed_source_version);
  assert.equal(second.results[0].staging.length, 0, 'a changed replay never advances to staging');
});

test('absence in a later window is unconfirmed, never a deletion', () => {
  const absence = reconcileWbsWindowAbsence({
    tool: 'list_payables',
    previousKeys: ['sha256:aaa', 'sha256:bbb'],
    currentKeys: ['sha256:aaa'],
  });
  assert.equal(absence.absence_meaning, 'UNCONFIRMED');
  assert.equal(absence.has_tombstone_contract, false);
  assert.equal(absence.requires_snapshot_diff, true);
  assert.deepEqual(absence.unconfirmed_absent, ['sha256:bbb']);
  assert.equal(absence.exceptions[0].code, WBS_LINEAGE_EXCEPTIONS.REVISION_UNKNOWN);
  assert.equal(absence.exceptions[0].detail.never, 'DELETED');
  assert.equal(absence.exceptions[0].scope.level, 'WINDOW');
});

/* ---------------- 7. exception class: hash mismatch --------------------- */

test('a content hash that does not match the canonical rows raises a scoped envelope exception', () => {
  const envelope = envelopeFor('list_payables', [ROWS.list_payables]);
  envelope.rows = [{ ...ROWS.list_payables, amount: 9999 }];
  const result = mapWbsSourceEnvelope({ toolName: 'list_payables', envelope, scope: SCOPE });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.HASH_MISMATCH]);
  assert.equal(result.exceptions[0].scope.level, 'ENVELOPE');
  assert.equal(result.blocked, true);
  assert.equal(result.raw.length, 0);
  assert.equal(result.exceptions[0].detail.upstream_code, 'WBS_MCP_CONTENT_HASH_MISMATCH');
});

/* ---------------- 8. exception class: missing/duplicate stable key ------ */

test('a row without its stable key parts raises a scoped missing-stable-key exception', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_control_totals',
    envelope: envelopeFor('list_control_totals', [{ ...ROWS.list_control_totals, period: '   ' }]),
    scope: SCOPE,
  });
  const found = codes(result);
  assert.ok(
    found.includes(WBS_LINEAGE_EXCEPTIONS.STABLE_KEY_MISSING) ||
      found.includes(WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID),
    'a blank stable key part must fail closed',
  );
  const direct = buildWbsSourceId('list_control_totals', { ...ROWS.list_control_totals, formula: '' });
  assert.equal(direct.source_id, null);
  assert.deepEqual(direct.missing, ['formula']);
});

test('the same stable key twice in one window raises a scoped duplicate exception', () => {
  const rows = [ROWS.list_payables, { ...ROWS.list_payables }];
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', rows),
    scope: SCOPE,
    mappingCandidatesByKey: mappingsFor([['list_payables', ROWS.list_payables, '640000']]),
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID]);
  assert.equal(result.exceptions[0].detail.upstream_code, 'WBS_MCP_ROWS_NOT_SORTED');
  assert.equal(result.je_request_seams.length, 0, 'a duplicate invalidates the complete receipt page');
});

/* ---------------- 9. exception class: unsupported currency -------------- */

test('a non-USD scope raises a scoped currency exception at row level', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: { company_key: 'CO-A', currency: 'CAD' },
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.CURRENCY_UNSUPPORTED]);
  assert.equal(result.exceptions[0].detail.currency, 'CAD');
  assert.equal(result.staging.length, 0);
});

test('a non-USD row currency is rejected by the frozen envelope contract and reported as the same class', () => {
  const rows = [{ ...ROWS.list_payables, currency: 'EUR' }];
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', rows),
    scope: SCOPE,
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.CURRENCY_UNSUPPORTED]);
  assert.equal(result.exceptions[0].scope.level, 'ENVELOPE');
  assert.equal(result.exceptions[0].detail.upstream_code, 'WBS_MCP_CURRENCY_UNSUPPORTED');
});

/* ---------------- 10. exception class: ambiguous mapping ---------------- */

test('equal-priority approved mappings with different accounts are ambiguous and never resolved by row order', () => {
  const key = stableKeyOf('list_payables', ROWS.list_payables);
  const candidates = [
    approvedMapping('164500', { mapping_snapshot_id: '11111111-1111-4111-8111-111111111111', version: 4 }),
    approvedMapping('795000', { mapping_snapshot_id: '22222222-2222-4222-8222-222222222222', version: 3 }),
  ];
  const forward = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: { [key]: candidates },
  });
  const reversed = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: { [key]: [...candidates].reverse() },
  });
  assert.deepEqual(codes(forward), [WBS_LINEAGE_EXCEPTIONS.MAPPING_AMBIGUOUS]);
  assert.deepEqual(codes(reversed), [WBS_LINEAGE_EXCEPTIONS.MAPPING_AMBIGUOUS]);
  assert.equal(forward.exceptions[0].detail.candidate_count, 2);
  assert.deepEqual(forward.exceptions[0].detail.account_codes.sort(), ['164500', '795000']);
  assert.equal(forward.je_request_seams.length, 0);
});

test('zero approved effective candidates is a scoped missing-mapping exception', () => {
  const result = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: {},
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.MAPPING_MISSING]);
  const expired = resolveWbsAccountMapping({
    toolName: 'list_payables',
    normalized: { stable_key: 'k', company_key: 'CO-A' },
    candidates: [approvedMapping('640000', { effective_to: '2026-01-01' })],
    onDate: '2026-07-31',
  });
  assert.equal(expired.status, 'MAPPING_EXCEPTION');
  assert.equal(expired.exception.code, WBS_LINEAGE_EXCEPTIONS.MAPPING_MISSING);
  const draftStatus = resolveWbsAccountMapping({
    toolName: 'list_payables',
    normalized: { stable_key: 'k' },
    candidates: [approvedMapping('640000', { status: 'DRAFT' })],
  });
  assert.equal(draftStatus.exception.code, WBS_LINEAGE_EXCEPTIONS.MAPPING_MISSING);
});

/* ---------------- 11. exception class: incomplete trace ----------------- */

test('a transaction row without source_document_id can never reach the standard JE request seam', () => {
  const rows = [{ ...ROWS.list_bank_transactions, sys_id: '' }];
  const result = mapWbsSourceEnvelope({
    toolName: 'list_bank_transactions',
    envelope: envelopeFor('list_bank_transactions', rows),
    scope: SCOPE,
    mappingCandidatesByKey: { [stableKeyOf('list_bank_transactions', rows[0])]: [approvedMapping('111000')] },
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE]);
  assert.deepEqual(result.exceptions[0].detail.missing, ['source_document_id']);
  assert.equal(result.staging.length, 1, 'the row is staged but blocked before the JE seam');
  assert.equal(result.je_request_seams.length, 0);
});

test('trace evidence without source_document_id is an incomplete-trace exception', () => {
  const rows = [{ ...ROWS.trace_by_key, source_document_id: '   ' }];
  const result = mapWbsSourceEnvelope({
    toolName: 'trace_by_key',
    envelope: envelopeFor('trace_by_key', rows),
    scope: SCOPE,
  });
  const found = codes(result);
  assert.ok(
    found.includes(WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE) ||
      found.includes(WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID),
    'blank source_document_id must fail closed',
  );
  assert.equal(result.evidence.length, 0);
});

test('a subsidiary-ledger account requires a member and the member is never inferred', () => {
  assert.equal(isSubsidiaryAccount('291001'), true);
  assert.equal(isSubsidiaryAccount('291032'), false);
  assert.equal(isSubsidiaryAccount('6400'), false);
  const key = stableKeyOf('list_payables', ROWS.list_payables);
  const withoutMember = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: { [key]: [approvedMapping('291001')] },
  });
  assert.deepEqual(codes(withoutMember), [WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE]);
  assert.deepEqual(withoutMember.exceptions[0].detail.missing, ['member']);
  assert.equal(withoutMember.je_request_seams.length, 0);

  const withMember = mapWbsSourceEnvelope({
    toolName: 'list_payables',
    envelope: envelopeFor('list_payables', [ROWS.list_payables]),
    scope: SCOPE,
    mappingCandidatesByKey: { [key]: [approvedMapping('291001')] },
    memberByKey: { [key]: 'Sanitized Payee' },
  });
  assert.deepEqual(codes(withMember), []);
  assert.equal(withMember.je_request_seams[0].member, 'Sanitized Payee');
  assert.equal(withMember.mapping_review[0].requires_member, true);
});

test('a subsidiary ledger evidence line without a member fails closed as well', () => {
  const rows = [{ ...ROWS.list_journal_entries, account: '291001' }];
  const result = mapWbsSourceEnvelope({
    toolName: 'list_journal_entries',
    envelope: envelopeFor('list_journal_entries', rows),
    scope: SCOPE,
  });
  assert.deepEqual(codes(result), [WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE]);
  assert.equal(result.evidence.length, 0);
});

/* ---------------- 12. cursor semantics ---------------------------------- */

test('cursor semantics support incremental sync and stateless replay from zero', () => {
  const zero = createWbsCursor({ tool: 'list_payables', company_key: 'CO-A' });
  assert.equal(zero.mode, 'FULL_REPLAY_FROM_ZERO');
  assert.equal(zero.position, null);
  assert.equal(zero.exhausted, false);

  const page1 = advanceWbsCursor(zero, {
    cursorNext: 'page-2-token',
    capturedAt: '2026-08-05T12:00:00.000Z',
    rowCount: 10,
  });
  assert.equal(page1.mode, 'INCREMENTAL_IN_PROGRESS');
  assert.equal(page1.position, 'page-2-token');
  assert.equal(page1.rows_seen, 10);
  assert.equal(page1.high_water_mark, '2026-08-05T12:00:00.000Z');

  const page2 = advanceWbsCursor(page1, {
    cursorNext: null,
    capturedAt: '2026-08-05T12:05:00.000Z',
    rowCount: 3,
  });
  assert.equal(page2.exhausted, true);
  assert.equal(page2.position, null);
  assert.equal(page2.mode, 'INCREMENTAL_WINDOW_COMPLETE');
  assert.equal(page2.rows_seen, 13);
  assert.equal(page2.high_water_mark, '2026-08-05T12:05:00.000Z');

  assert.throws(
    () => createWbsCursor({ tool: 'database.query' }),
    error => error.code === WBS_LINEAGE_EXCEPTIONS.CURSOR_INVALID,
  );
  assert.throws(
    () => advanceWbsCursor(zero, { cursorNext: 'https://example.invalid/next' }),
    error => error.code === WBS_LINEAGE_EXCEPTIONS.CURSOR_INVALID,
  );
});

test('an envelope-level exception blocks the cursor so the same window is re-read', () => {
  const envelope = envelopeFor('list_payables', [ROWS.list_payables]);
  envelope.content_sha256 = '0'.repeat(64);
  const replay = replayWbsLineage({ pages: [{ toolName: 'list_payables', envelope }], scope: SCOPE });
  assert.equal(replay.results[0].blocked, true);
  assert.equal(replay.cursors.list_payables.blocked, true);
  assert.equal(replay.cursors.list_payables.mode, 'BLOCKED_REREAD_SAME_WINDOW');
  assert.equal(replay.cursors.list_payables.position, null);
  assert.equal(replay.cursors.list_payables.pages, 0);
});

test('a stateless replay from zero produces identical stable keys and identical results', () => {
  const pages = WBS_READONLY_TOOLS.map(tool => ({
    toolName: tool,
    envelope: envelopeFor(tool, [ROWS[tool]]),
  }));
  const mappingCandidatesByKey = mappingsFor([
    ['list_payables', ROWS.list_payables, '640000'],
    ['list_bank_transactions', ROWS.list_bank_transactions, '111000'],
    ['list_autorec_details', ROWS.list_autorec_details, '291001'],
  ]);
  const memberByKey = {
    [stableKeyOf('list_autorec_details', ROWS.list_autorec_details)]: 'Sanitized Payee',
  };
  const runA = replayWbsLineage({ pages, scope: SCOPE, mappingCandidatesByKey, memberByKey });
  const runB = replayWbsLineage({ pages, scope: SCOPE, mappingCandidatesByKey, memberByKey });
  assert.deepEqual(runA.exceptions, []);
  assert.deepEqual(runA.observed_keys_by_tool, runB.observed_keys_by_tool);
  assert.deepEqual(runA.source_versions, runB.source_versions);
  assert.deepEqual(JSON.parse(JSON.stringify(runA.results)), JSON.parse(JSON.stringify(runB.results)));
  assert.equal(Object.keys(runA.observed_keys_by_tool).length, 8);

  const incremental = replayWbsLineage({
    pages,
    scope: SCOPE,
    mappingCandidatesByKey,
    memberByKey,
    priorState: runA,
  });
  assert.deepEqual(incremental.exceptions, [], 'an unchanged incremental window is clean');
  assert.deepEqual(incremental.observed_keys_by_tool, runA.observed_keys_by_tool);
});

test('the batch replay reports the exception classes it raised', () => {
  const pages = [
    { toolName: 'list_payables', envelope: envelopeFor('list_payables', [{ ...ROWS.list_payables, company_code: 'CO-B' }]) },
    { toolName: 'list_bank_transactions', envelope: envelopeFor('list_bank_transactions', [{ ...ROWS.list_bank_transactions, account_code: '1110' }]) },
  ];
  const replay = replayWbsLineage({ pages, scope: SCOPE });
  assert.deepEqual(replay.exception_counts, {
    [WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID]: 2,
  });
  assert.equal(replay.can_post, false);
  assert.equal(replay.can_write_wbs, false);
});

/* ---------------- 13. accounting red lines ------------------------------ */

test('a loan draw bank line declares the frozen Dr Cash / Cr Loan Payable shape for the reviewer', () => {
  const rows = [{ ...ROWS.list_bank_transactions, come_from: 'Const Loan', debtor: 5000, lender: 0 }];
  const result = mapWbsSourceEnvelope({
    toolName: 'list_bank_transactions',
    envelope: envelopeFor('list_bank_transactions', rows),
    scope: SCOPE,
    mappingCandidatesByKey: { [stableKeyOf('list_bank_transactions', rows[0])]: [approvedMapping('111000')] },
  });
  assert.deepEqual(codes(result), []);
  assert.equal(result.je_request_seams[0].expected_shape, WBS_LOAN_DRAW_EXPECTED_SHAPE);
  assert.equal(result.je_request_seams[0].can_post, false);
  assert.equal(result.normalized[0].direction, 'DEBIT');
});

test('no mapping output ever authorizes a write, a draft, a dispatch or a post', () => {
  const pages = WBS_READONLY_TOOLS.map(tool => ({ toolName: tool, envelope: envelopeFor(tool, [ROWS[tool]]) }));
  const replay = replayWbsLineage({ pages, scope: SCOPE });
  const flat = JSON.stringify(replay);
  assert.equal(/"can_post":true/.test(flat), false);
  assert.equal(/"can_create_draft":true/.test(flat), false);
  assert.equal(/"can_dispatch":true/.test(flat), false);
  assert.equal(/"can_write_wbs":true/.test(flat), false);
  assert.equal(/"can_allocate":true/.test(flat), false);
});

/* ---------------- 14. credential-free source ---------------------------- */

test('the lineage module embeds no endpoint, host, header name or secret', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = await readFile(resolve(here, '..', 'runtime', 'wbs-mcp-lineage.mjs'), 'utf8');
  for (const forbidden of [/https?:\/\/(?!example\.invalid)/, /wbm3/i, /CF-Access/i, /X-REFS-Auth/i, /Bearer\s/i, /\bcookie\b/i, /\.com\b/i, /\.cn\b/i]) {
    assert.equal(forbidden.test(source), false, `lineage module must not contain ${forbidden}`);
  }
  assert.equal(/fetch\s*\(/.test(source), false, 'the lineage module performs no network access');
});

test('the lineage contract version and documentation stay in step', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const doc = await readFile(join(resolve(here, '..', '..'), 'docs', 'WBS-MCP-LINEAGE.md'), 'utf8');
  assert.ok(doc.includes(WBS_LINEAGE_CONTRACT_VERSION));
  for (const tool of WBS_READONLY_TOOLS) assert.ok(doc.includes(tool), `docs must list ${tool}`);
  for (const code of Object.values(WBS_LINEAGE_EXCEPTIONS)) {
    assert.ok(doc.includes(code), `docs must define ${code}`);
  }
  const coverage = describeWbsMappingCoverage();
  assert.ok(doc.includes(String(coverage.declared_fields)), 'docs must state the declared field count');
});
