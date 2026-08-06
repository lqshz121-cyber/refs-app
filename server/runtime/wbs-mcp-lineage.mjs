// WBS read-only MCP lineage mapper.
//
// This module is the executable, credential-free field map from the eight
// approved read-only WBS MCP sources through the REFS accounting pipeline:
//
//   Receipt -> Raw -> Normalized -> Staging/Exception -> Mapping Review
//           -> AutoRec Review -> Standard JE Request seam / Evidence seam
//
// It performs no network access, holds no endpoint, secret or host reference,
// and never writes WBS. It produces review candidates only: no Draft is
// created, no journal is dispatched and nothing is posted. Everything that
// does not validate becomes an explicit scoped exception; nothing is inferred.
//
// It deliberately reuses the frozen contract already in the repository
// (`wbs-readonly-mcp.mjs` tool list, row-field allowlist and envelope
// validator) rather than restating it, and hands the hard AutoRec eligibility
// gate back to `wbs-inbound-data-adapter.mjs`.

import { createHash } from 'node:crypto';
import { canonicalRequestBody } from './request-hash.mjs';
import {
  WBS_READONLY_ROW_FIELDS,
  WBS_READONLY_TOOLS,
  WbsMcpError,
  validateWbsReadEnvelope,
} from './wbs-readonly-mcp.mjs';

export const WBS_LINEAGE_CONTRACT_VERSION = 'WBS-REFS-MCP-LINEAGE-V1';

/** Pipeline stages, in order. A source may never advance past its terminus. */
export const WBS_PIPELINE_STAGES = Object.freeze([
  'RECEIPT',
  'RAW',
  'NORMALIZED',
  'STAGING',
  'MAPPING_REVIEW',
  'AUTOREC_REVIEW',
  'STANDARD_JE_REQUEST_SEAM',
  'EVIDENCE_SEAM',
]);

/**
 * Scoped exception taxonomy. Every class is explicit, fail-closed and carries
 * a scope so a single bad row never quarantines a whole batch silently.
 */
export const WBS_LINEAGE_EXCEPTIONS = Object.freeze({
  SCHEMA_INVALID: 'WBS_LINEAGE_SCHEMA_INVALID',
  CROSS_COMPANY: 'WBS_LINEAGE_CROSS_COMPANY',
  REVISION_UNKNOWN: 'WBS_LINEAGE_REVISION_UNKNOWN',
  HASH_MISMATCH: 'WBS_LINEAGE_HASH_MISMATCH',
  STABLE_KEY_MISSING: 'WBS_LINEAGE_STABLE_KEY_MISSING',
  STABLE_KEY_DUPLICATE: 'WBS_LINEAGE_STABLE_KEY_DUPLICATE',
  CURRENCY_UNSUPPORTED: 'WBS_LINEAGE_CURRENCY_UNSUPPORTED',
  MAPPING_AMBIGUOUS: 'WBS_LINEAGE_MAPPING_AMBIGUOUS',
  MAPPING_MISSING: 'WBS_LINEAGE_MAPPING_MISSING',
  TRACE_INCOMPLETE: 'WBS_LINEAGE_TRACE_INCOMPLETE',
  CURSOR_INVALID: 'WBS_LINEAGE_CURSOR_INVALID',
});

/** The pilot admits exactly one currency; anything else is an exception. */
export const WBS_SUPPORTED_CURRENCIES = Object.freeze(['USD']);

/** Subsidiary-ledger clearing net (per-member `member` is mandatory). */
export const WBS_SUBSIDIARY_ACCOUNT_RANGE = Object.freeze({ from: 291000, to: 291031 });

/** Loan draw evidence keeps the frozen `Dr Cash / Cr Loan Payable` shape. */
export const WBS_LOAN_DRAW_COME_FROM = Object.freeze(['Const Loan', 'FINDRAW']);
export const WBS_LOAN_DRAW_EXPECTED_SHAPE = 'Dr Cash / Cr Loan Payable';

export class WbsLineageError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WbsLineageError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* Field type primitives                                               */
/* ------------------------------------------------------------------ */

const s = (required = false) => Object.freeze({ type: 'string', required });
const n = (required = false) => Object.freeze({ type: 'number', required });
const int = (required = false) => Object.freeze({ type: 'integer', required });
const amt = (required = false) => Object.freeze({ type: 'amount', required });
const dt = (required = false) => Object.freeze({ type: 'date', required });
const ts = (required = false) => Object.freeze({ type: 'datetime', required });
const acct = (required = false) => Object.freeze({ type: 'account_code', required });
const arr = (required = false) => Object.freeze({ type: 'array', required });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const AMOUNT_RE = /^-?\d+(\.\d{1,4})?$/;
const ACCOUNT_RE = /^\d{6}$/;

const isPlainObject = value =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const text = value => (value === null || value === undefined ? '' : String(value).trim());

const isBlank = value => text(value) === '';

function isCalendarDate(value) {
  if (!DATE_RE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function toAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Number(value.toFixed(4)) : null;
  if (typeof value === 'string' && AMOUNT_RE.test(value.trim())) {
    return Number(Number(value.trim()).toFixed(4));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* The eight-source catalog                                            */
/* ------------------------------------------------------------------ */

/**
 * Each entry declares:
 *  - `role`            what the source may become in REFS;
 *  - `terminus`        the furthest pipeline stage the source may reach;
 *  - `schema`          the fail-closed field schema (closed set, no extras);
 *  - `stable_key`      the source-id parts used for idempotent replay;
 *  - `company_field`   the field that attests the company, or null;
 *  - `source_document_ref_field` the upstream immutable source-document key;
 *  - `normalized`      normalized field <- source field map.
 *
 * `schema` field sets for the six list_* data tools are asserted in tests to
 * equal the frozen `WBS_READONLY_ROW_FIELDS` allowlist. `get_meta` and
 * `trace_by_key` have no frozen row-field allowlist in the repository yet;
 * their schemas below are REFS-declared and must be confirmed by the provider
 * before production admission (recorded in docs/WBS-MCP-LINEAGE.md).
 */
export const WBS_SOURCE_CATALOG = Object.freeze({
  get_meta: Object.freeze({
    tool: 'get_meta',
    source_module: 'wbs.meta',
    role: 'METADATA',
    terminus: 'RECEIPT',
    schema_origin: 'REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION',
    schema: Object.freeze({
      company_codes: arr(),
      contract_version: s(true),
      environment: s(true),
      generated_at: ts(true),
      tools: arr(true),
    }),
    stable_key: Object.freeze(['contract_version', 'generated_at']),
    company_field: null,
    currency_field: null,
    source_document_ref_field: null,
    normalized: Object.freeze({
      contract_version: 'contract_version',
      environment: 'environment',
      generated_at: 'generated_at',
      declared_tools: 'tools',
      company_codes: 'company_codes',
    }),
  }),

  list_payables: Object.freeze({
    tool: 'list_payables',
    source_module: 'BGDATA.payable',
    role: 'TRANSACTION_PRODUCER',
    source_type: 'PAYABLE',
    terminus: 'STANDARD_JE_REQUEST_SEAM',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      amount: amt(true),
      ap_guid: s(true),
      ap_long_id: s(),
      ap_type: s(),
      business_status: s(),
      cb_id: s(),
      check_date: dt(),
      check_no: s(),
      clear_date: dt(),
      company_code: s(true),
      company_name: s(),
      cost_id: s(),
      cost_ledger_id: s(),
      description: s(),
      incurred_date: dt(true),
      journal_no: s(),
      pay_status: s(),
      pay_type: s(),
      pj_code: s(),
      pj_name: s(),
      posting_date: dt(),
      project_guid: s(),
      review_status: s(),
      vendor_name: s(),
      vendor_no: s(),
    }),
    stable_key: Object.freeze(['ap_guid']),
    company_field: 'company_code',
    currency_field: null,
    source_document_ref_field: 'ap_guid',
    normalized: Object.freeze({
      company_key: 'company_code',
      company_name: 'company_name',
      amount: 'amount',
      business_date: 'incurred_date',
      accounting_date: 'posting_date',
      clear_date: 'clear_date',
      check_date: 'check_date',
      check_no: 'check_no',
      vendor_ref: 'vendor_no',
      vendor_name: 'vendor_name',
      project_ref: 'project_guid',
      project_code: 'pj_code',
      project_name: 'pj_name',
      cost_code_ref: 'cost_id',
      cost_ledger_ref: 'cost_ledger_id',
      description: 'description',
      bill_no: 'ap_long_id',
      journal_no: 'journal_no',
      bank_account_ref: 'cb_id',
      payable_type: 'ap_type',
      pay_type: 'pay_type',
      pay_status: 'pay_status',
      business_status: 'business_status',
      review_status: 'review_status',
    }),
  }),

  list_bank_transactions: Object.freeze({
    tool: 'list_bank_transactions',
    source_module: 'BGDATA.bank_transaction',
    role: 'TRANSACTION_PRODUCER',
    source_type: 'BANK_TRANSACTION',
    terminus: 'STANDARD_JE_REQUEST_SEAM',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      account_code: acct(true),
      cb_id: s(true),
      child_come_from: s(),
      child_count: n(),
      come_from: s(),
      company_code: s(true),
      debtor: amt(),
      description: s(),
      lender: amt(),
      payee: s(),
      payee_no: s(),
      review: s(),
      set_date: dt(true),
      statistical_business: s(),
      sys_id: s(),
      turn_flag: s(),
    }),
    stable_key: Object.freeze(['cb_id']),
    company_field: 'company_code',
    currency_field: null,
    source_document_ref_field: 'sys_id',
    normalized: Object.freeze({
      company_key: 'company_code',
      bank_account_ref: 'account_code',
      business_date: 'set_date',
      description: 'description',
      payee: 'payee',
      payee_no: 'payee_no',
      come_from: 'come_from',
      child_come_from: 'child_come_from',
      child_count: 'child_count',
      statistical_business: 'statistical_business',
      review_status: 'review',
      turn_flag: 'turn_flag',
      debit_amount: 'debtor',
      credit_amount: 'lender',
      source_document_ref: 'sys_id',
    }),
  }),

  list_autorec_details: Object.freeze({
    tool: 'list_autorec_details',
    source_module: 'BGDATA.autoc_detail',
    role: 'TRANSACTION_PRODUCER',
    source_type: 'AUTOREC_PAYMENT_DETAIL',
    terminus: 'AUTOREC_REVIEW',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      batch_guid: s(),
      biz_type: s(),
      cb_id: s(),
      clear_date: dt(),
      cost_code: s(),
      data_source: s(),
      deposit: amt(),
      incurred_date: dt(true),
      match_guid: s(),
      match_status: s(),
      payment: amt(),
      pd_guid: s(true),
      pd_pv_guid: s(),
      project_guid: s(),
      released_by: s(),
      released_date: dt(),
      status: s(),
      vendor_no: s(),
    }),
    stable_key: Object.freeze(['pd_guid']),
    // AutoRec detail rows carry no company field. The company must be attested
    // by the envelope scope, otherwise a CROSS_COMPANY exception is raised.
    company_field: null,
    currency_field: null,
    source_document_ref_field: 'pd_pv_guid',
    normalized: Object.freeze({
      batch_ref: 'batch_guid',
      business_type: 'biz_type',
      bank_account_ref: 'cb_id',
      clear_date: 'clear_date',
      cost_code_ref: 'cost_code',
      data_source: 'data_source',
      deposit_amount: 'deposit',
      payment_amount: 'payment',
      business_date: 'incurred_date',
      match_ref: 'match_guid',
      match_status: 'match_status',
      source_document_ref: 'pd_pv_guid',
      project_ref: 'project_guid',
      released_by: 'released_by',
      released_date: 'released_date',
      status: 'status',
      vendor_ref: 'vendor_no',
    }),
  }),

  list_autorec_banks: Object.freeze({
    tool: 'list_autorec_banks',
    source_module: 'BGDATA.autoc_bank',
    role: 'CASE_CONTROL',
    source_type: 'AUTOREC_CASE_CONTROL',
    terminus: 'AUTOREC_REVIEW',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      ah_id: s(),
      ah_name: s(),
      company_code: s(true),
      company_name: s(),
      debit_amount: amt(),
      incurred: n(),
      pay_amount: amt(),
      pb_guid: s(true),
      quantity: n(),
      reconciliation_start_date: dt(),
      released: n(),
      released_quantity: n(),
      status: s(),
    }),
    stable_key: Object.freeze(['pb_guid']),
    company_field: 'company_code',
    currency_field: null,
    source_document_ref_field: null,
    normalized: Object.freeze({
      company_key: 'company_code',
      company_name: 'company_name',
      bank_account_ref: 'ah_id',
      bank_account_name: 'ah_name',
      debit_amount: 'debit_amount',
      pay_amount: 'pay_amount',
      quantity: 'quantity',
      released_count: 'released',
      released_quantity: 'released_quantity',
      incurred_count: 'incurred',
      reconciliation_start_date: 'reconciliation_start_date',
      status: 'status',
    }),
  }),

  list_journal_entries: Object.freeze({
    tool: 'list_journal_entries',
    source_module: 'accounting.accounting_info',
    role: 'LEDGER_EVIDENCE',
    source_type: 'LEDGER_EVIDENCE',
    terminus: 'EVIDENCE_SEAM',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      account: acct(true),
      bill_no: s(),
      cb_id: s(),
      closed: s(),
      come_from: s(),
      company: s(true),
      cost_code: s(),
      debtor: amt(),
      // Integer, not string: the frozen contract validates this stable key with
      // Number.isSafeInteger. See validateWbsReadEnvelope in wbs-readonly-mcp.mjs.
      id: int(true),
      journal_no: s(),
      lender: amt(),
      pj_code: s(),
      posting_date: dt(true),
      project: s(),
      reverse: s(),
      review: s(),
      reviewer: s(),
      set_date: dt(),
      sys_id: s(),
    }),
    stable_key: Object.freeze(['id']),
    company_field: 'company',
    currency_field: null,
    source_document_ref_field: 'sys_id',
    // WBS `description` on the journal workbench carries the subsidiary-ledger
    // member. The frozen row-field allowlist exposes it via `project`/`bill_no`
    // trace only, so the member is read from the mapping-review input instead
    // and its absence is a scoped TRACE_INCOMPLETE exception.
    member_field: null,
    normalized: Object.freeze({
      company_key: 'company',
      account_code: 'account',
      bill_no: 'bill_no',
      bank_account_ref: 'cb_id',
      period_closed: 'closed',
      come_from: 'come_from',
      cost_code_ref: 'cost_code',
      debit_amount: 'debtor',
      credit_amount: 'lender',
      journal_no: 'journal_no',
      project_code: 'pj_code',
      project_ref: 'project',
      accounting_date: 'posting_date',
      business_date: 'set_date',
      reversal_flag: 'reverse',
      review_status: 'review',
      reviewer: 'reviewer',
      source_document_ref: 'sys_id',
    }),
  }),

  list_control_totals: Object.freeze({
    tool: 'list_control_totals',
    source_module: 'accounting.balance_cell',
    role: 'CONTROL_EVIDENCE_ONLY',
    source_type: 'CONTROL_EVIDENCE',
    terminus: 'EVIDENCE_SEAM',
    schema_origin: 'FROZEN_ROW_FIELD_ALLOWLIST',
    schema: Object.freeze({
      cell_count: n(),
      company: s(true),
      formula: s(true),
      period: s(true),
      quality: s(),
      total_balance: amt(),
      total_credit: amt(),
      total_debit: amt(),
    }),
    stable_key: Object.freeze(['company', 'period', 'formula']),
    company_field: 'company',
    currency_field: null,
    source_document_ref_field: null,
    normalized: Object.freeze({
      company_key: 'company',
      period_code: 'period',
      formula: 'formula',
      quality: 'quality',
      cell_count: 'cell_count',
      total_balance: 'total_balance',
      total_credit: 'total_credit',
      total_debit: 'total_debit',
    }),
  }),

  trace_by_key: Object.freeze({
    tool: 'trace_by_key',
    source_module: 'wbs.trace',
    role: 'TRACE',
    source_type: 'TRACE_EVIDENCE',
    terminus: 'EVIDENCE_SEAM',
    schema_origin: 'REFS_DECLARED_PENDING_PROVIDER_CONFIRMATION',
    schema: Object.freeze({
      bill_no: s(),
      company_code: s(true),
      journal_no: s(),
      links: arr(),
      source_document_id: s(true),
      source_module: s(true),
      source_record_id: s(true),
      source_version: s(true),
    }),
    stable_key: Object.freeze(['source_module', 'source_record_id', 'source_version']),
    company_field: 'company_code',
    currency_field: null,
    source_document_ref_field: 'source_document_id',
    normalized: Object.freeze({
      company_key: 'company_code',
      traced_source_module: 'source_module',
      traced_source_record_id: 'source_record_id',
      traced_source_version: 'source_version',
      source_document_ref: 'source_document_id',
      bill_no: 'bill_no',
      journal_no: 'journal_no',
      links: 'links',
    }),
  }),
});

export const WBS_LINEAGE_SOURCE_COUNT = Object.keys(WBS_SOURCE_CATALOG).length;

/* ------------------------------------------------------------------ */
/* Stable keys                                                         */
/* ------------------------------------------------------------------ */

const sha256Hex = value => createHash('sha256').update(value, 'utf8').digest('hex');

/** Content revision used when the provider declares no CDC/revision contract. */
export function wbsRowContentVersion(row) {
  return `content:${sha256Hex(canonicalRequestBody(row))}`;
}

/**
 * Deterministic stable key for `source_system + source_id + source_version`.
 * Identical inputs always produce an identical key, so replay is idempotent.
 */
export function buildWbsStableKey({ source_system, source_id, source_version } = {}) {
  if (isBlank(source_system) || isBlank(source_id) || isBlank(source_version)) {
    throw new WbsLineageError(
      WBS_LINEAGE_EXCEPTIONS.STABLE_KEY_MISSING,
      'A WBS stable key requires source_system, source_id and source_version.',
    );
  }
  const composite = `${text(source_system)}|${text(source_id)}|${text(source_version)}`;
  return Object.freeze({
    source_system: text(source_system),
    source_id: text(source_id),
    source_version: text(source_version),
    composite,
    stable_key: `sha256:${sha256Hex(composite)}`,
  });
}

/** Composes the namespaced `source_id` for a tool row from its key parts. */
export function buildWbsSourceId(toolName, row) {
  const entry = WBS_SOURCE_CATALOG[toolName];
  if (!entry) {
    throw new WbsLineageError(
      WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
      'Unknown WBS read-only source.',
    );
  }
  const missing = entry.stable_key.filter(field => isBlank(row?.[field]));
  if (missing.length) return { source_id: null, missing };
  const source_id = `${entry.source_module}:${entry.stable_key
    .map(field => text(row[field]))
    .join('~')}`;
  return { source_id, missing: [] };
}

/* ------------------------------------------------------------------ */
/* Scoped exceptions                                                   */
/* ------------------------------------------------------------------ */

function scopedException({
  code,
  message,
  level,
  tool,
  rowIndex = null,
  stableKey = null,
  sourceId = null,
  companyKey = null,
  cursor = null,
  detail = {},
}) {
  return Object.freeze({
    stage: 'EXCEPTION',
    code,
    message,
    scope: Object.freeze({
      level, // 'ENVELOPE' | 'ROW' | 'WINDOW'
      tool,
      row_index: rowIndex,
      stable_key: stableKey,
      source_id: sourceId,
      company_key: companyKey,
      cursor,
    }),
    detail: Object.freeze(structuredClone(detail)),
    // No exception ever leaks into an inference or a write.
    inferred: false,
    can_infer: false,
    can_write_wbs: false,
    can_allocate: false,
    can_create_draft: false,
    can_dispatch: false,
    can_post: false,
  });
}

/* ------------------------------------------------------------------ */
/* Schema validation (fail-closed)                                     */
/* ------------------------------------------------------------------ */

function validateField(name, spec, value) {
  const absent = value === null || value === undefined || value === '';
  if (absent) {
    return spec.required ? { field: name, reason: 'REQUIRED_FIELD_MISSING' } : null;
  }
  switch (spec.type) {
    case 'string':
      return typeof value === 'string' ? null : { field: name, reason: 'EXPECTED_STRING' };
    case 'number':
      return typeof value === 'number' && Number.isFinite(value)
        ? null
        : { field: name, reason: 'EXPECTED_NUMBER' };
    // `integer` mirrors the frozen read-only contract in wbs-readonly-mcp.mjs, which
    // enforces Number.isSafeInteger on the `list_journal_entries.id` stable key.
    // Declaring it as a string here would let a row pass this catalog and then fail
    // the upstream envelope validator, which is exactly the drift this type prevents.
    case 'integer':
      return Number.isSafeInteger(value) ? null : { field: name, reason: 'EXPECTED_INTEGER' };
    case 'amount':
      return toAmount(value) === null ? { field: name, reason: 'EXPECTED_AMOUNT' } : null;
    case 'date':
      return typeof value === 'string' && isCalendarDate(value)
        ? null
        : { field: name, reason: 'EXPECTED_ISO_DATE' };
    case 'datetime':
      return typeof value === 'string' && Number.isFinite(Date.parse(value))
        ? null
        : { field: name, reason: 'EXPECTED_ISO_DATETIME' };
    case 'account_code':
      if (typeof value !== 'string') return { field: name, reason: 'EXPECTED_STRING' };
      return ACCOUNT_RE.test(value)
        ? null
        : { field: name, reason: 'ACCOUNT_CODE_NOT_SIX_DIGIT' };
    case 'array':
      return Array.isArray(value) ? null : { field: name, reason: 'EXPECTED_ARRAY' };
    default:
      return { field: name, reason: 'UNKNOWN_FIELD_TYPE' };
  }
}

/**
 * Validates one row against the declared closed schema for a tool.
 * Returns `{ ok, violations }`. Unknown fields are violations: the pilot never
 * guesses the meaning of a field the contract does not declare.
 */
export function validateWbsSourceRow(toolName, row) {
  const entry = WBS_SOURCE_CATALOG[toolName];
  if (!entry) {
    return { ok: false, violations: [{ field: '*', reason: 'UNKNOWN_SOURCE_TOOL' }] };
  }
  if (!isPlainObject(row)) {
    return { ok: false, violations: [{ field: '*', reason: 'EXPECTED_OBJECT_ROW' }] };
  }
  const violations = [];
  for (const [name, spec] of Object.entries(entry.schema)) {
    const violation = validateField(name, spec, row[name]);
    if (violation) violations.push(violation);
  }
  for (const name of Object.keys(row)) {
    if (!Object.hasOwn(entry.schema, name) && name !== 'currency') {
      violations.push({ field: name, reason: 'UNDECLARED_FIELD' });
    }
  }
  return { ok: violations.length === 0, violations };
}

/* ------------------------------------------------------------------ */
/* Normalization                                                       */
/* ------------------------------------------------------------------ */

function normalizeValue(spec, value) {
  if (value === null || value === undefined || value === '') return null;
  if (spec?.type === 'amount') return toAmount(value);
  if (spec?.type === 'number') return value;
  if (spec?.type === 'array') return structuredClone(value);
  return typeof value === 'string' ? value.trim() : value;
}

function deriveDirection(toolName, normalized) {
  if (toolName === 'list_payables') return 'CREDIT';
  const debit = toAmount(normalized.debit_amount ?? normalized.deposit_amount ?? 0) || 0;
  const credit = toAmount(normalized.credit_amount ?? normalized.payment_amount ?? 0) || 0;
  if (debit > 0 && credit === 0) return 'DEBIT';
  if (credit > 0 && debit === 0) return 'CREDIT';
  return null;
}

function deriveAmount(toolName, normalized, row) {
  if (toolName === 'list_payables') return toAmount(row.amount);
  const debit = toAmount(normalized.debit_amount ?? normalized.deposit_amount ?? null);
  const credit = toAmount(normalized.credit_amount ?? normalized.payment_amount ?? null);
  if (debit !== null && debit !== 0) return debit;
  if (credit !== null && credit !== 0) return credit;
  return null;
}

/* ------------------------------------------------------------------ */
/* Cursor semantics                                                    */
/* ------------------------------------------------------------------ */

// Opaque bounded token. Deliberately excludes ':' and '/' so a cursor can
// never carry a URL, a route or a host reference.
const CURSOR_TOKEN_RE = /^[A-Za-z0-9._~+=-]{1,512}$/;

/** The zero cursor. Stateless replay from zero always starts here. */
export function createWbsCursor({ tool, company_key = null } = {}) {
  if (!WBS_SOURCE_CATALOG[tool]) {
    throw new WbsLineageError(
      WBS_LINEAGE_EXCEPTIONS.CURSOR_INVALID,
      'A WBS cursor must name one of the eight approved read-only sources.',
    );
  }
  return Object.freeze({
    contract_version: WBS_LINEAGE_CONTRACT_VERSION,
    tool,
    company_key,
    mode: 'FULL_REPLAY_FROM_ZERO',
    position: null,
    high_water_mark: null,
    pages: 0,
    rows_seen: 0,
    exhausted: false,
    blocked: false,
  });
}

export const resetWbsCursor = createWbsCursor;

/**
 * Advances the cursor after a mapped page.
 *
 * Fail-closed rules:
 *  - any envelope-level exception blocks the cursor (`blocked: true`) and the
 *    position is never advanced, so the same window is re-read next run;
 *  - `cursor_next === null` marks the window exhausted;
 *  - the token must be an opaque bounded ASCII string, never a URL.
 */
export function advanceWbsCursor(cursor, { cursorNext, capturedAt, rowCount, blocked = false } = {}) {
  if (!isPlainObject(cursor) || cursor.contract_version !== WBS_LINEAGE_CONTRACT_VERSION) {
    throw new WbsLineageError(WBS_LINEAGE_EXCEPTIONS.CURSOR_INVALID, 'WBS cursor is invalid.');
  }
  if (blocked) {
    return Object.freeze({ ...cursor, blocked: true, mode: 'BLOCKED_REREAD_SAME_WINDOW' });
  }
  if (cursorNext !== null && cursorNext !== undefined && !CURSOR_TOKEN_RE.test(String(cursorNext))) {
    throw new WbsLineageError(
      WBS_LINEAGE_EXCEPTIONS.CURSOR_INVALID,
      'WBS cursor token must be an opaque bounded token.',
    );
  }
  const nextHighWater =
    capturedAt && (!cursor.high_water_mark || Date.parse(capturedAt) > Date.parse(cursor.high_water_mark))
      ? capturedAt
      : cursor.high_water_mark;
  const exhausted = cursorNext === null || cursorNext === undefined;
  return Object.freeze({
    ...cursor,
    mode: exhausted ? 'INCREMENTAL_WINDOW_COMPLETE' : 'INCREMENTAL_IN_PROGRESS',
    position: exhausted ? null : String(cursorNext),
    high_water_mark: nextHighWater ?? null,
    pages: cursor.pages + 1,
    rows_seen: cursor.rows_seen + (Number.isFinite(rowCount) ? rowCount : 0),
    exhausted,
    blocked: false,
  });
}

/**
 * Compares the keys observed in a completed window against the keys observed
 * in the previous completed window.
 *
 * WBS declares no CDC feed and no tombstone contract, so absence is
 * `UNCONFIRMED`, never `DELETED`. Each absent key raises a scoped
 * REVISION_UNKNOWN exception for human review.
 */
export function reconcileWbsWindowAbsence({ tool, previousKeys = [], currentKeys = [], cursor = null } = {}) {
  const current = new Set(currentKeys);
  const absent = [...new Set(previousKeys)].filter(key => !current.has(key));
  return Object.freeze({
    tool,
    absence_meaning: 'UNCONFIRMED',
    has_cdc_contract: false,
    has_tombstone_contract: false,
    requires_snapshot_diff: true,
    unconfirmed_absent: Object.freeze([...absent]),
    exceptions: Object.freeze(
      absent.map(key =>
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.REVISION_UNKNOWN,
          message:
            'A previously observed WBS stable key is absent from this window. Without a CDC or tombstone contract, absence is unconfirmed and never a deletion.',
          level: 'WINDOW',
          tool,
          stableKey: key,
          cursor,
          detail: { absence_meaning: 'UNCONFIRMED', never: 'DELETED' },
        }),
      ),
    ),
  });
}

/* ------------------------------------------------------------------ */
/* Mapping review                                                      */
/* ------------------------------------------------------------------ */

function effectiveCandidates(candidates, onDate) {
  return candidates.filter(candidate => {
    if (candidate?.status !== 'APPROVED') return false;
    if (candidate.effective_from && onDate && candidate.effective_from > onDate) return false;
    if (candidate.effective_to && onDate && candidate.effective_to < onDate) return false;
    return true;
  });
}

/**
 * Resolves exactly one highest-priority approved mapping.
 * Zero candidates -> MAPPING_MISSING. Tied top priority with differing account
 * codes -> MAPPING_AMBIGUOUS. Row order never resolves a tie.
 */
export function resolveWbsAccountMapping({ toolName, normalized, candidates = [], onDate = null } = {}) {
  const usable = effectiveCandidates(Array.isArray(candidates) ? candidates : [], onDate);
  const base = {
    tool: toolName,
    stable_key: normalized?.stable_key ?? null,
    company_key: normalized?.company_key ?? null,
  };
  if (usable.length === 0) {
    return {
      status: 'MAPPING_EXCEPTION',
      exception: scopedException({
        code: WBS_LINEAGE_EXCEPTIONS.MAPPING_MISSING,
        message: 'No approved effective mapping candidate exists for this WBS source row.',
        level: 'ROW',
        tool: toolName,
        stableKey: base.stable_key,
        companyKey: base.company_key,
        detail: { candidate_count: 0 },
      }),
    };
  }
  const topPriority = Math.max(...usable.map(candidate => Number(candidate.priority) || 0));
  const top = usable.filter(candidate => (Number(candidate.priority) || 0) === topPriority);
  const distinctAccounts = new Set(top.map(candidate => text(candidate.account_code)));
  if (top.length > 1 && distinctAccounts.size > 1) {
    return {
      status: 'MAPPING_EXCEPTION',
      exception: scopedException({
        code: WBS_LINEAGE_EXCEPTIONS.MAPPING_AMBIGUOUS,
        message:
          'Multiple equal-priority approved mapping candidates resolve to different accounts. Equal-priority mappings are never resolved by row order.',
        level: 'ROW',
        tool: toolName,
        stableKey: base.stable_key,
        companyKey: base.company_key,
        detail: {
          candidate_count: top.length,
          candidate_ids: top.map(candidate => candidate.mapping_snapshot_id ?? null),
          account_codes: [...distinctAccounts],
        },
      }),
    };
  }
  const chosen = top[0];
  const accountCode = text(chosen.account_code);
  if (!ACCOUNT_RE.test(accountCode)) {
    return {
      status: 'MAPPING_EXCEPTION',
      exception: scopedException({
        code: WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
        message: 'A mapped REFS account code must be exactly six digits and is never degraded.',
        level: 'ROW',
        tool: toolName,
        stableKey: base.stable_key,
        companyKey: base.company_key,
        detail: { account_code: accountCode, reason: 'ACCOUNT_CODE_NOT_SIX_DIGIT' },
      }),
    };
  }
  return {
    status: 'MAPPING_REVIEW_REQUIRED',
    candidate: Object.freeze({
      ...base,
      stage: 'MAPPING_REVIEW',
      status: 'MAPPING_REVIEW_REQUIRED',
      mapping_snapshot_id: chosen.mapping_snapshot_id ?? null,
      family: chosen.family ?? null,
      version: chosen.version ?? null,
      priority: topPriority,
      account_code: accountCode,
      requires_member: isSubsidiaryAccount(accountCode),
      // Mapping resolution produces a review candidate only.
      can_create_draft: false,
      can_dispatch: false,
      can_post: false,
    }),
  };
}

export function isSubsidiaryAccount(accountCode) {
  if (!ACCOUNT_RE.test(text(accountCode))) return false;
  const numeric = Number(accountCode);
  return numeric >= WBS_SUBSIDIARY_ACCOUNT_RANGE.from && numeric <= WBS_SUBSIDIARY_ACCOUNT_RANGE.to;
}

/* ------------------------------------------------------------------ */
/* Envelope mapping                                                    */
/* ------------------------------------------------------------------ */

const ENVELOPE_ERROR_MAP = Object.freeze({
  WBS_MCP_CONTENT_HASH_MISMATCH: WBS_LINEAGE_EXCEPTIONS.HASH_MISMATCH,
  WBS_MCP_CURRENCY_UNSUPPORTED: WBS_LINEAGE_EXCEPTIONS.CURRENCY_UNSUPPORTED,
  WBS_MCP_ENVELOPE_INVALID: WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
});

/**
 * Maps one read-only MCP envelope from Receipt through to the review seams.
 *
 * Returns candidates for human review only. `je_request_seams` describes the
 * standard REFS command a human must invoke; it never dispatches, never
 * creates a Draft and never posts.
 */
export function mapWbsSourceEnvelope({
  toolName,
  envelope,
  scope = {},
  mappingCandidatesByKey = {},
  memberByKey = {},
  priorKeys = {},
  cursor = null,
} = {}) {
  const entry = WBS_SOURCE_CATALOG[toolName];
  const exceptions = [];
  if (!entry || !WBS_READONLY_TOOLS.includes(toolName)) {
    return frozenResult({
      toolName,
      entry: null,
      exceptions: [
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
          message: 'WBS lineage accepts only the eight approved read-only sources.',
          level: 'ENVELOPE',
          tool: toolName ?? null,
          cursor,
        }),
      ],
    });
  }

  // ---- Receipt: reuse the frozen envelope contract, fail closed. ----
  let receipt = null;
  try {
    receipt = validateWbsReadEnvelope({ toolName, envelope });
  } catch (error) {
    const code =
      error instanceof WbsMcpError
        ? ENVELOPE_ERROR_MAP[error.code] ?? WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID
        : WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID;
    return frozenResult({
      toolName,
      entry,
      cursorNext: null,
      blocked: true,
      exceptions: [
        scopedException({
          code,
          message: 'WBS read envelope failed the frozen read-only contract.',
          level: 'ENVELOPE',
          tool: toolName,
          cursor,
          detail: { upstream_code: error?.code ?? null },
        }),
      ],
    });
  }

  const scopeCompany = text(scope?.company_key) || null;
  const raw = [];
  const normalizedRows = [];
  const staging = [];
  const mappingReview = [];
  const autorecReview = [];
  const jeRequestSeams = [];
  const evidence = [];
  const seenKeys = new Map();

  receipt.rows.forEach((row, rowIndex) => {
    // ---- Raw: exact bytes, read-only, never mutated. ----
    const rawRecord = Object.freeze({
      stage: 'RAW',
      tool: toolName,
      source_module: entry.source_module,
      row_index: rowIndex,
      captured_at: receipt.captured_at,
      contract_version: receipt.contract_version,
      envelope_content_sha256: receipt.content_sha256,
      row: Object.freeze(structuredClone(row)),
      row_content_hash: sha256Hex(canonicalRequestBody(row)),
      read_only: true,
    });
    raw.push(rawRecord);

    // ---- Schema validation, fail closed. ----
    const validation = validateWbsSourceRow(toolName, row);
    if (!validation.ok) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
          message: 'WBS source row does not satisfy the declared schema and is never inferred.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          cursor,
          detail: { violations: validation.violations },
        }),
      );
      return;
    }

    // ---- Stable key. ----
    const { source_id: sourceId, missing } = buildWbsSourceId(toolName, row);
    if (!sourceId) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.STABLE_KEY_MISSING,
          message: 'WBS source row has no stable key and cannot be replayed idempotently.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          cursor,
          detail: { missing_key_parts: missing },
        }),
      );
      return;
    }
    const sourceVersion = wbsRowContentVersion(row);
    const key = buildWbsStableKey({
      source_system: 'WBS',
      source_id: sourceId,
      source_version: sourceVersion,
    });

    if (seenKeys.has(key.stable_key)) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.STABLE_KEY_DUPLICATE,
          message: 'The same WBS stable key appeared twice in one window.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          cursor,
          detail: { first_row_index: seenKeys.get(key.stable_key) },
        }),
      );
      return;
    }
    seenKeys.set(key.stable_key, rowIndex);

    // ---- Changed replay / revision unknown. ----
    const prior = priorKeys?.[sourceId];
    if (prior && prior.source_version !== sourceVersion) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.REVISION_UNKNOWN,
          message:
            'A previously observed WBS source_id replayed with different content. Without a revision or CDC contract, amendment and correction cannot be distinguished.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          cursor,
          detail: {
            prior_source_version: prior.source_version,
            observed_source_version: sourceVersion,
            has_revision_contract: false,
            has_cdc_contract: false,
          },
        }),
      );
      return;
    }

    // ---- Cross-company. ----
    const rowCompany = entry.company_field ? text(row[entry.company_field]) || null : null;
    const companyKey = rowCompany ?? scopeCompany;
    if (!companyKey) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.CROSS_COMPANY,
          message:
            'WBS source row cannot attest a company and the read scope does not pin one. Company is never inferred.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          cursor,
          detail: { row_company: rowCompany, scope_company: scopeCompany },
        }),
      );
      return;
    }
    if (rowCompany && scopeCompany && rowCompany !== scopeCompany) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.CROSS_COMPANY,
          message: 'WBS source row company differs from the requested read scope.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          companyKey: rowCompany,
          cursor,
          detail: { row_company: rowCompany, scope_company: scopeCompany },
        }),
      );
      return;
    }

    // ---- Currency. ----
    const rowCurrency = row.currency === undefined || row.currency === null
      ? text(scope?.currency).toUpperCase() || 'USD'
      : text(row.currency).toUpperCase();
    if (!WBS_SUPPORTED_CURRENCIES.includes(rowCurrency)) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.CURRENCY_UNSUPPORTED,
          message: 'The WBS read-only pilot admits USD rows only.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          companyKey,
          cursor,
          detail: { currency: rowCurrency },
        }),
      );
      return;
    }

    // ---- Normalized. ----
    const mapped = {};
    for (const [target, sourceField] of Object.entries(entry.normalized)) {
      mapped[target] = normalizeValue(entry.schema[sourceField], row[sourceField]);
    }
    const normalized = Object.freeze({
      stage: 'NORMALIZED',
      source_system: 'WBS',
      source_module: entry.source_module,
      source_tool: toolName,
      source_role: entry.role,
      source_type: entry.source_type ?? entry.role,
      source_id: sourceId,
      source_version: sourceVersion,
      stable_key: key.stable_key,
      row_content_hash: rawRecord.row_content_hash,
      envelope_content_sha256: receipt.content_sha256,
      captured_at: receipt.captured_at,
      company_key: companyKey,
      currency: rowCurrency,
      amount: deriveAmount(toolName, mapped, row),
      direction: deriveDirection(toolName, mapped),
      source_document_ref: entry.source_document_ref_field
        ? text(row[entry.source_document_ref_field]) || null
        : null,
      ...mapped,
    });
    normalizedRows.push(normalized);

    // ---- Control / metadata / trace evidence terminate here. ----
    if (entry.role !== 'TRANSACTION_PRODUCER') {
      const evidenceRecord = {
        stage: 'EVIDENCE_SEAM',
        tool: toolName,
        role: entry.role,
        stable_key: key.stable_key,
        source_id: sourceId,
        company_key: companyKey,
        terminus: entry.terminus,
        can_create_source_document: false,
        can_allocate: false,
        can_create_draft: false,
        can_dispatch: false,
        can_post: false,
        normalized,
      };
      if (entry.role === 'TRACE' && !normalized.source_document_ref) {
        exceptions.push(
          scopedException({
            code: WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE,
            message: 'WBS trace evidence is missing source_document_id.',
            level: 'ROW',
            tool: toolName,
            rowIndex,
            stableKey: key.stable_key,
            sourceId,
            companyKey,
            cursor,
            detail: { missing: ['source_document_id'] },
          }),
        );
        return;
      }
      if (entry.role === 'LEDGER_EVIDENCE' && isSubsidiaryAccount(normalized.account_code)) {
        const member = text(memberByKey?.[key.stable_key]);
        if (!member) {
          exceptions.push(
            scopedException({
              code: WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE,
              message:
                'A subsidiary-ledger account line requires a member and the member is never inferred.',
              level: 'ROW',
              tool: toolName,
              rowIndex,
              stableKey: key.stable_key,
              sourceId,
              companyKey,
              cursor,
              detail: { missing: ['member'], account_code: normalized.account_code },
            }),
          );
          return;
        }
        evidenceRecord.member = member;
      }
      if (entry.role === 'CASE_CONTROL') {
        autorecReview.push(
          Object.freeze({
            stage: 'AUTOREC_REVIEW',
            tool: toolName,
            role: entry.role,
            status: 'AUTOREC_CASE_CONTROL_REVIEW_REQUIRED',
            stable_key: key.stable_key,
            source_id: sourceId,
            company_key: companyKey,
            required_next_control: 'evaluateWbsAutoReconciliationEligibility',
            can_release: false,
            can_allocate: false,
            can_create_draft: false,
            can_dispatch: false,
            can_post: false,
            normalized,
          }),
        );
      }
      evidence.push(Object.freeze(evidenceRecord));
      return;
    }

    // ---- Staging / exception for transaction producers. ----
    const stagingMissing = [];
    if (normalized.amount === null || normalized.amount === 0) stagingMissing.push('nonzero_amount');
    if (!normalized.direction) stagingMissing.push('direction');
    if (!normalized.business_date) stagingMissing.push('business_date');
    if (stagingMissing.length) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.SCHEMA_INVALID,
          message: 'WBS transaction row cannot be staged without amount, direction and business date.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          companyKey,
          cursor,
          detail: { missing: stagingMissing },
        }),
      );
      return;
    }

    const stagingItem = Object.freeze({
      stage: 'STAGING',
      status: 'STAGING_REVIEW_REQUIRED',
      tool: toolName,
      stable_key: key.stable_key,
      source_id: sourceId,
      source_version: sourceVersion,
      company_key: companyKey,
      currency: rowCurrency,
      amount: normalized.amount,
      direction: normalized.direction,
      business_date: normalized.business_date,
      accounting_date: normalized.accounting_date ?? normalized.business_date,
      source_document_ref: normalized.source_document_ref,
      can_allocate: false,
      can_create_draft: false,
      can_dispatch: false,
      can_post: false,
      normalized,
    });
    staging.push(stagingItem);

    // ---- Incomplete trace blocks the JE seam. ----
    if (!normalized.source_document_ref) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE,
          message:
            'WBS transaction row has no source_document_id and can never reach the standard JE request seam.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          companyKey,
          cursor,
          detail: {
            missing: ['source_document_id'],
            source_document_ref_field: entry.source_document_ref_field,
          },
        }),
      );
      return;
    }

    // ---- Mapping review. ----
    const resolution = resolveWbsAccountMapping({
      toolName,
      normalized,
      candidates: mappingCandidatesByKey?.[key.stable_key] ?? [],
      onDate: normalized.accounting_date ?? normalized.business_date,
    });
    if (resolution.status === 'MAPPING_EXCEPTION') {
      exceptions.push(resolution.exception);
      return;
    }
    mappingReview.push(resolution.candidate);

    // ---- Subsidiary member is mandatory on the clearing net. ----
    if (resolution.candidate.requires_member && !text(memberByKey?.[key.stable_key])) {
      exceptions.push(
        scopedException({
          code: WBS_LINEAGE_EXCEPTIONS.TRACE_INCOMPLETE,
          message:
            'A subsidiary-ledger account line requires a member and the member is never inferred.',
          level: 'ROW',
          tool: toolName,
          rowIndex,
          stableKey: key.stable_key,
          sourceId,
          companyKey,
          cursor,
          detail: { missing: ['member'], account_code: resolution.candidate.account_code },
        }),
      );
      return;
    }

    // ---- AutoRec review seam (bank/business pairing stays with the kernel). ----
    if (entry.terminus === 'AUTOREC_REVIEW') {
      autorecReview.push(
        Object.freeze({
          stage: 'AUTOREC_REVIEW',
          tool: toolName,
          role: entry.role,
          status: 'AUTOREC_REVIEW_REQUIRED',
          stable_key: key.stable_key,
          source_id: sourceId,
          company_key: companyKey,
          required_next_control: 'evaluateWbsAutoReconciliationEligibility',
          can_release: false,
          can_allocate: false,
          can_create_draft: false,
          can_dispatch: false,
          can_post: false,
          staging_item: stagingItem,
          mapping_review: resolution.candidate,
        }),
      );
      return;
    }

    // ---- Standard JE request seam: a description of the human command. ----
    jeRequestSeams.push(
      Object.freeze({
        stage: 'STANDARD_JE_REQUEST_SEAM',
        status: 'HUMAN_REVIEW_REQUIRED',
        tool: toolName,
        stable_key: key.stable_key,
        source_id: sourceId,
        company_key: companyKey,
        account_code: resolution.candidate.account_code,
        member: text(memberByKey?.[key.stable_key]) || null,
        expected_shape: WBS_LOAN_DRAW_COME_FROM.includes(text(normalized.come_from))
          ? WBS_LOAN_DRAW_EXPECTED_SHAPE
          : null,
        required_command: 'buildStandardDraftRequest',
        required_preconditions: Object.freeze([
          'persisted reviewed staging item (STAGING_REVIEWED)',
          'approved versioned mapping snapshot',
          'complete raw_event / source_document / staging trace',
          'balanced standard REFS journal request',
        ]),
        can_create_draft: false,
        can_dispatch: false,
        can_post: false,
        can_write_wbs: false,
        staging_item: stagingItem,
      }),
    );
  });

  const blocked = exceptions.some(exception => exception.scope.level === 'ENVELOPE');
  return frozenResult({
    toolName,
    entry,
    receipt,
    raw,
    normalized: normalizedRows,
    staging,
    mappingReview,
    autorecReview,
    jeRequestSeams,
    evidence,
    exceptions,
    cursorNext: receipt.cursor_next ?? null,
    blocked,
    observedKeys: [...seenKeys.keys()],
    sourceVersions: Object.fromEntries(
      normalizedRows.map(entryRow => [entryRow.source_id, { source_version: entryRow.source_version }]),
    ),
  });
}

function frozenResult({
  toolName,
  entry,
  receipt = null,
  raw = [],
  normalized = [],
  staging = [],
  mappingReview = [],
  autorecReview = [],
  jeRequestSeams = [],
  evidence = [],
  exceptions = [],
  cursorNext = null,
  blocked = false,
  observedKeys = [],
  sourceVersions = {},
}) {
  return Object.freeze({
    contract_version: WBS_LINEAGE_CONTRACT_VERSION,
    tool: toolName ?? null,
    role: entry?.role ?? null,
    terminus: entry?.terminus ?? null,
    read_only: true,
    can_write_wbs: false,
    can_create_draft: false,
    can_dispatch: false,
    can_post: false,
    receipt,
    raw: Object.freeze(raw),
    normalized: Object.freeze(normalized),
    staging: Object.freeze(staging),
    mapping_review: Object.freeze(mappingReview),
    autorec_review: Object.freeze(autorecReview),
    je_request_seams: Object.freeze(jeRequestSeams),
    evidence: Object.freeze(evidence),
    exceptions: Object.freeze(exceptions),
    cursor_next: cursorNext,
    blocked,
    observed_keys: Object.freeze(observedKeys),
    source_versions: Object.freeze(sourceVersions),
  });
}

/* ------------------------------------------------------------------ */
/* Batch replay                                                        */
/* ------------------------------------------------------------------ */

/**
 * Maps an ordered list of `{ toolName, envelope }` pages.
 *
 * `priorState` is the state produced by a previous run. Passing `undefined`
 * performs a stateless replay from zero, which must produce byte-identical
 * stable keys and identical results.
 */
export function replayWbsLineage({
  pages = [],
  scope = {},
  mappingCandidatesByKey = {},
  memberByKey = {},
  priorState = null,
} = {}) {
  const priorKeys = priorState?.source_versions ?? {};
  const priorWindowKeys = priorState?.observed_keys_by_tool ?? {};
  const cursors = {};
  const results = [];
  const observedKeysByTool = {};
  const sourceVersions = { ...priorKeys };

  for (const page of pages) {
    const toolName = page?.toolName;
    if (!cursors[toolName]) {
      cursors[toolName] = WBS_SOURCE_CATALOG[toolName]
        ? createWbsCursor({ tool: toolName, company_key: scope?.company_key ?? null })
        : null;
    }
    const result = mapWbsSourceEnvelope({
      toolName,
      envelope: page?.envelope,
      scope,
      mappingCandidatesByKey,
      memberByKey,
      priorKeys,
      cursor: cursors[toolName]?.position ?? null,
    });
    results.push(result);
    if (cursors[toolName]) {
      cursors[toolName] = advanceWbsCursor(cursors[toolName], {
        cursorNext: result.cursor_next,
        capturedAt: result.receipt?.captured_at ?? null,
        rowCount: result.raw.length,
        blocked: result.blocked,
      });
    }
    observedKeysByTool[toolName] = [...(observedKeysByTool[toolName] ?? []), ...result.observed_keys];
    Object.assign(sourceVersions, result.source_versions);
  }

  const absence = Object.entries(observedKeysByTool).map(([tool, keys]) =>
    reconcileWbsWindowAbsence({
      tool,
      previousKeys: priorWindowKeys[tool] ?? [],
      currentKeys: keys,
      cursor: cursors[tool]?.position ?? null,
    }),
  );

  const allExceptions = [
    ...results.flatMap(result => result.exceptions),
    ...absence.flatMap(item => item.exceptions),
  ];

  return Object.freeze({
    contract_version: WBS_LINEAGE_CONTRACT_VERSION,
    read_only: true,
    can_write_wbs: false,
    can_create_draft: false,
    can_dispatch: false,
    can_post: false,
    results: Object.freeze(results),
    cursors: Object.freeze(cursors),
    absence: Object.freeze(absence),
    exceptions: Object.freeze(allExceptions),
    exception_counts: Object.freeze(
      allExceptions.reduce((counts, exception) => {
        counts[exception.code] = (counts[exception.code] ?? 0) + 1;
        return counts;
      }, {}),
    ),
    observed_keys_by_tool: Object.freeze(observedKeysByTool),
    source_versions: Object.freeze(sourceVersions),
  });
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

/** Declared-field and normalized-field coverage for the eight sources. */
export function describeWbsMappingCoverage() {
  const perSource = Object.entries(WBS_SOURCE_CATALOG).map(([tool, entry]) => {
    const declared = Object.keys(entry.schema);
    // A declared field counts as mapped when it feeds a normalized alias, the
    // stable key (`source_id`), or the `source_document_ref` trace.
    const mappedSourceFields = new Set([
      ...Object.values(entry.normalized),
      ...entry.stable_key,
      ...(entry.source_document_ref_field ? [entry.source_document_ref_field] : []),
    ]);
    const unmapped = declared.filter(field => !mappedSourceFields.has(field));
    return Object.freeze({
      tool,
      source_module: entry.source_module,
      role: entry.role,
      terminus: entry.terminus,
      schema_origin: entry.schema_origin,
      declared_fields: declared.length,
      normalized_fields: Object.keys(entry.normalized).length,
      mapped_source_fields: declared.length - unmapped.length,
      unmapped_source_fields: Object.freeze(unmapped),
      stable_key_parts: entry.stable_key,
      source_document_ref_field: entry.source_document_ref_field,
      required_fields: Object.freeze(
        declared.filter(field => entry.schema[field].required),
      ),
    });
  });
  const declared = perSource.reduce((sum, item) => sum + item.declared_fields, 0);
  const mapped = perSource.reduce((sum, item) => sum + item.mapped_source_fields, 0);
  return Object.freeze({
    contract_version: WBS_LINEAGE_CONTRACT_VERSION,
    source_count: perSource.length,
    declared_fields: declared,
    mapped_source_fields: mapped,
    coverage_ratio: Number((mapped / declared).toFixed(4)),
    exception_classes: Object.freeze(Object.values(WBS_LINEAGE_EXCEPTIONS)),
    per_source: Object.freeze(perSource),
  });
}

/** Binds the catalog back to the frozen row-field allowlist. */
export function verifyCatalogAgainstFrozenRowFields() {
  const drift = [];
  for (const [tool, fields] of Object.entries(WBS_READONLY_ROW_FIELDS)) {
    const declared = Object.keys(WBS_SOURCE_CATALOG[tool]?.schema ?? {}).sort();
    const frozen = [...fields].sort();
    if (declared.join('|') !== frozen.join('|')) {
      drift.push({
        tool,
        missing_in_catalog: frozen.filter(field => !declared.includes(field)),
        extra_in_catalog: declared.filter(field => !frozen.includes(field)),
      });
    }
  }
  return Object.freeze({ ok: drift.length === 0, drift: Object.freeze(drift) });
}
