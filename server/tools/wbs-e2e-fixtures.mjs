// Sanitized WBS read-only MCP fixtures for the end-to-end accounting harness.
//
// These rows are invented. They contain no live WBS data, no customer data, no
// hostname and no credential. They exist to exercise the *formal interface
// contract* (`validateWbsReadEnvelope` + `WBS_READONLY_ROW_FIELDS`) because the
// real provider is not reachable from this environment and has no credentials
// here.
//
// Any result produced from these fixtures is contract-plus-fixture evidence.
// It is never a production PASS.

import { createHash } from 'node:crypto';

import { canonicalRequestBody } from '../runtime/request-hash.mjs';
import {
  buildWbsSourceId,
  buildWbsStableKey,
  wbsRowContentVersion,
} from '../runtime/wbs-mcp-lineage.mjs';

export const FIXTURE_COMPANY_KEY = 'CO-A';
export const FIXTURE_CONTRACT_VERSION = 'WBS-REFS-MCP-V1';
export const FIXTURE_CAPTURED_AT = '2026-08-05T12:00:00.000Z';

export const FIXTURE_PERIOD = Object.freeze({
  periodId: 'PERIOD-CO-A-2026-07',
  periodCode: '2026-07',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
});

/** Builds a contract-shaped envelope with a correctly computed content hash. */
export function fixtureEnvelope(tool, rows, { cursorNext = null } = {}) {
  return Object.freeze({
    contract_version: FIXTURE_CONTRACT_VERSION,
    tool,
    environment: 'production',
    captured_at: FIXTURE_CAPTURED_AT,
    source: { system: 'WBS', module: 'read_only_mcp' },
    scope: { company: FIXTURE_COMPANY_KEY, period: FIXTURE_PERIOD.periodCode },
    record_count: rows.length,
    content_sha256: createHash('sha256').update(canonicalRequestBody(rows), 'utf8').digest('hex'),
    cursor_next: cursorNext,
    etl_notice: 'Snapshot comparison required; the provider declares no CDC and no tombstone contract.',
    rows,
  });
}

/** The stable key the lineage mapper will derive for a row. */
export function fixtureStableKey(tool, row) {
  const { source_id: sourceId } = buildWbsSourceId(tool, row);
  return buildWbsStableKey({
    source_system: 'WBS',
    source_id: sourceId,
    source_version: wbsRowContentVersion(row),
  }).stable_key;
}

/* ------------------------------------------------------------------ */
/* Scenario 1: payables                                                */
/* ------------------------------------------------------------------ */

export const PAYABLE_ROWS = Object.freeze([
  Object.freeze({
    amount: 1250.5,
    ap_guid: 'AP-GUID-0001',
    ap_long_id: 'AP-2026-0001',
    ap_type: 'Invoice',
    business_status: 'Incurred',
    cb_id: 'CB-0001',
    company_code: FIXTURE_COMPANY_KEY,
    cost_id: '03-100',
    cost_ledger_id: 'CL-03-100',
    description: 'Sanitized fixture payable - site utilities',
    incurred_date: '2026-07-31',
    journal_no: '20260731000001',
    pay_status: 'Unpaid',
    pj_code: 'PJ-1',
    pj_name: 'Sanitized Project One',
    posting_date: '2026-07-31',
    project_guid: 'PRJ-GUID-0001',
    review_status: 'Reviewed',
    vendor_name: 'Sanitized Vendor One',
    vendor_no: 'V-0001',
  }),
  Object.freeze({
    amount: 84200.75,
    ap_guid: 'AP-GUID-0002',
    ap_long_id: 'AP-2026-0002',
    ap_type: 'Contract Invoice',
    business_status: 'Incurred',
    company_code: FIXTURE_COMPANY_KEY,
    cost_id: '05-200',
    cost_ledger_id: 'CL-05-200',
    description: 'Sanitized fixture payable - construction draw package',
    incurred_date: '2026-07-30',
    journal_no: '20260730000002',
    pay_status: 'Unpaid',
    pj_code: 'PJ-1',
    pj_name: 'Sanitized Project One',
    posting_date: '2026-07-30',
    project_guid: 'PRJ-GUID-0001',
    review_status: 'Reviewed',
    vendor_name: 'Sanitized Vendor Two',
    vendor_no: 'V-0002',
  }),
  // Deliberate exception row: schema-valid but unstageable (zero amount).
  Object.freeze({
    amount: 0,
    ap_guid: 'AP-GUID-0003',
    ap_long_id: 'AP-2026-0003',
    company_code: FIXTURE_COMPANY_KEY,
    description: 'Sanitized fixture payable - zero amount placeholder',
    incurred_date: '2026-07-28',
    pj_code: 'PJ-1',
    posting_date: '2026-07-28',
    vendor_name: 'Sanitized Vendor Three',
    vendor_no: 'V-0003',
  }),
]);

/**
 * Approved, versioned mapping snapshots. The mapping supplies the REFS cost /
 * expense account; the posting rule supplies the AP control credit.
 */
export const PAYABLE_MAPPINGS = Object.freeze({
  'AP-GUID-0001': Object.freeze([
    Object.freeze({
      mapping_snapshot_id: 'MAP-AP-COST-0001',
      family: 'WBS_PAYABLE_COST_CODE',
      version: 'WBS-REFS-MAPPING-2026-08-A',
      status: 'APPROVED',
      priority: 100,
      effective_from: '2026-01-01',
      effective_to: null,
      account_code: '610900',
    }),
  ]),
  'AP-GUID-0002': Object.freeze([
    Object.freeze({
      mapping_snapshot_id: 'MAP-AP-CWIP-0002',
      family: 'WBS_PAYABLE_COST_CODE',
      version: 'WBS-REFS-MAPPING-2026-08-A',
      status: 'APPROVED',
      priority: 100,
      effective_from: '2026-01-01',
      effective_to: null,
      account_code: '164400',
    }),
  ]),
});

/* ------------------------------------------------------------------ */
/* Scenario 2: bank transactions                                       */
/* ------------------------------------------------------------------ */

export const BANK_ROWS = Object.freeze([
  Object.freeze({
    account_code: '111000',
    cb_id: 'CB-0001',
    come_from: 'FAST',
    company_code: FIXTURE_COMPANY_KEY,
    debtor: 0,
    description: 'Sanitized fixture bank payment - matches AP-GUID-0001',
    lender: 1250.5,
    payee: 'Sanitized Vendor One',
    payee_no: 'V-0001',
    review: 'Reviewed',
    set_date: '2026-07-31',
    statistical_business: 'Payable',
    sys_id: 'SYS-BANK-0001',
    turn_flag: 'N',
  }),
  Object.freeze({
    account_code: '111000',
    cb_id: 'CB-0002',
    come_from: 'FAST',
    company_code: FIXTURE_COMPANY_KEY,
    debtor: 0,
    description: 'Sanitized fixture bank payment - no business counterpart',
    lender: 4400,
    payee: 'Sanitized Vendor Nine',
    payee_no: 'V-0009',
    review: 'Not Match',
    set_date: '2026-07-29',
    statistical_business: 'Payable',
    sys_id: 'SYS-BANK-0002',
    turn_flag: 'N',
  }),
  Object.freeze({
    account_code: '111000',
    cb_id: 'CB-0003',
    come_from: 'Const Loan',
    company_code: FIXTURE_COMPANY_KEY,
    debtor: 500000,
    description: 'Sanitized fixture construction loan draw',
    lender: 0,
    payee: 'Sanitized Lender',
    payee_no: 'L-0001',
    review: 'Reviewed',
    set_date: '2026-07-15',
    statistical_business: 'Financing',
    sys_id: 'SYS-BANK-0003',
    turn_flag: 'N',
  }),
]);

export const BANK_MAPPINGS = Object.freeze({
  'CB-0001': Object.freeze([
    Object.freeze({
      mapping_snapshot_id: 'MAP-BANK-CASH-0001',
      family: 'WBS_BANK_ACCOUNT',
      version: 'WBS-REFS-MAPPING-2026-08-A',
      status: 'APPROVED',
      priority: 100,
      account_code: '111000',
    }),
  ]),
  'CB-0002': Object.freeze([
    Object.freeze({
      mapping_snapshot_id: 'MAP-BANK-CASH-0002',
      family: 'WBS_BANK_ACCOUNT',
      version: 'WBS-REFS-MAPPING-2026-08-A',
      status: 'APPROVED',
      priority: 100,
      account_code: '111000',
    }),
  ]),
  'CB-0003': Object.freeze([
    Object.freeze({
      mapping_snapshot_id: 'MAP-BANK-CASH-0003',
      family: 'WBS_BANK_ACCOUNT',
      version: 'WBS-REFS-MAPPING-2026-08-A',
      status: 'APPROVED',
      priority: 100,
      account_code: '111000',
    }),
  ]),
});

/* ------------------------------------------------------------------ */
/* Scenario 3: cost GL / journal evidence                              */
/* ------------------------------------------------------------------ */

// NOTE ON THE `id` FIELD: the frozen envelope validator enforces
// Number.isSafeInteger on list_journal_entries.id. It is an integer here, and
// `COST_GL_STRING_ID_TRAP_ROW` below exists so a test can prove that a string
// id is rejected by the frozen contract rather than quietly accepted.
export const COST_GL_ROWS = Object.freeze([
  Object.freeze({
    account: '164400',
    bill_no: 'AP-2026-0002',
    cb_id: 'CB-0002',
    closed: 'N',
    come_from: 'FAST',
    company: FIXTURE_COMPANY_KEY,
    cost_code: '05-200',
    debtor: 61000,
    id: 900001,
    journal_no: '20260731000101',
    lender: 0,
    pj_code: 'PJ-1',
    posting_date: '2026-07-31',
    project: 'PRJ-GUID-0001',
    reverse: 'N',
    review: 'Reviewed',
    reviewer: 'wbs.reviewer',
    set_date: '2026-07-31',
    sys_id: 'SYS-JE-0001',
  }),
  Object.freeze({
    account: '291001',
    bill_no: 'AP-2026-0004',
    cb_id: 'CB-0004',
    closed: 'N',
    come_from: 'Internal Transfer',
    company: FIXTURE_COMPANY_KEY,
    cost_code: '05-200',
    debtor: 0,
    id: 900002,
    journal_no: '20260731000102',
    lender: 15000,
    pj_code: 'PJ-1',
    posting_date: '2026-07-31',
    project: 'PRJ-GUID-0001',
    reverse: 'N',
    review: 'Reviewed',
    reviewer: 'wbs.reviewer',
    set_date: '2026-07-31',
    sys_id: 'SYS-JE-0002',
  }),
]);

/** Same row with a string `id`: the frozen contract must reject it. */
export const COST_GL_STRING_ID_TRAP_ROW = Object.freeze({
  ...COST_GL_ROWS[0],
  id: '900001',
  sys_id: 'SYS-JE-0003',
});

/** Project completion dates used by the CWIP cutoff review rule. */
export const PROJECT_COMPLETION = Object.freeze({
  'PJ-1': '2026-06-30',
});

/* ------------------------------------------------------------------ */
/* Actors (segregation of duties)                                      */
/* ------------------------------------------------------------------ */

// The maker deliberately holds GL.JE.APPROVE (ACCT_MANAGER). Without it the
// "maker approves their own journal" attempt would be refused for a missing
// permission and would prove nothing about segregation of duties.
export const ACTORS = Object.freeze({
  maker: Object.freeze({ user_id: 'accounting.manager', role_code: 'ACCT_MANAGER' }),
  reviewer: Object.freeze({ user_id: 'gl.reviewer', role_code: 'REVIEWER' }),
  approver: Object.freeze({ user_id: 'controller', role_code: 'CONTROLLER' }),
  poster: Object.freeze({ user_id: 'senior.accountant', role_code: 'SENIOR_ACCT' }),
});
