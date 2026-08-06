// WBS -> accounting end-to-end chain (contract + fixture evidence).
//
// This module is the executable chain from an already-received WBS read-only
// MCP envelope through to Trial Balance / Balance Sheet / Income Statement and
// back to the originating WBS row.
//
//   WBS MCP read (envelope supplied by the caller; this module never fetches)
//     -> immutable receipt (frozen validateWbsReadEnvelope)
//     -> Raw / Normalized / Staging / Exception (frozen wbs-mcp-lineage mapper)
//     -> mapping version + rule version
//     -> accounting event
//     -> suggested BALANCED Draft JE
//     -> controller review
//     -> standard JE command -> Approve -> Post
//     -> GL -> Trial Balance -> Balance Sheet / Income Statement
//     -> audit lineage back to the originating WBS row
//
// HONESTY BOUNDARIES, enforced in code and repeated in
// docs/WBS-END-TO-END-EVIDENCE.md:
//
//  * No network, no hostname, no credential, no WBS write. The envelope is an
//    input. `runWbsPayableAccrualChain` cannot reach a provider even in
//    principle.
//  * REFS-side persistence of raw_event / source_document / staging_item is a
//    PostgreSQL command (`persistWbsInboundRows`, migration 058). It is not
//    available in-process, so the identities are derived deterministically and
//    marked `IN_PROCESS_SIMULATED`. The caller must opt in explicitly with
//    `allowSimulatedPersistence: true`; there is no silent default.
//  * The posting engine used here is the repository's own
//    NON_PRODUCTION_EXECUTABLE_SPEC `JEService` + `MemoryJEDatabase`. The
//    production command is `PostgresAccountingKernel.createAutoJournal` +
//    `postJournal`.
//  * The statement builders below are an exact executable mirror of
//    `refs_get_financial_statements` (migration 062): the same account-class
//    prefix rule, the same sections and the same display-balance formulas.
//    They are a mirror, not the production function.
//
// Money is fixed point. Every amount is carried as an integer number of
// 1/10000 units in BigInt. No JavaScript floating point arithmetic is used for
// money anywhere in this module.

import { createHash } from 'node:crypto';

import { canonicalRequestBody } from './request-hash.mjs';
import { validateWbsReadEnvelope } from './wbs-readonly-mcp.mjs';
import {
  WBS_LOAN_DRAW_COME_FROM,
  WBS_LOAN_DRAW_EXPECTED_SHAPE,
  WBS_SOURCE_CATALOG,
  isSubsidiaryAccount,
  mapWbsSourceEnvelope,
} from './wbs-mcp-lineage.mjs';
import { buildStandardDraftRequest } from './wbs-inbound-data-adapter.mjs';

export const WBS_E2E_CONTRACT_VERSION = 'WBS-REFS-E2E-V1';

/** Evidence class for every stage this module can produce. */
export const WBS_E2E_EVIDENCE_CLASS = Object.freeze({
  /** Executed against the frozen in-repository contract with sanitized rows. */
  CONTRACT_PLUS_FIXTURE: 'CONTRACT_PLUS_FIXTURE',
  /** Executed, but against a non-production in-process substitute. */
  NON_PRODUCTION_EXECUTABLE_SPEC: 'NON_PRODUCTION_EXECUTABLE_SPEC',
  /** Not executed at all here; a real run needs the named external component. */
  UNVERIFIED_REQUIRES_PRODUCTION: 'UNVERIFIED_REQUIRES_PRODUCTION',
});

export class WbsE2eError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'WbsE2eError';
    this.code = code;
    this.detail = detail;
  }
}

/* ------------------------------------------------------------------ */
/* Fixed-point money                                                   */
/* ------------------------------------------------------------------ */

export const MONEY_SCALE = 4;
const SCALE_FACTOR = 10n ** BigInt(MONEY_SCALE);
const DECIMAL_RE = /^(-)?(\d{1,18})(?:\.(\d{1,4}))?$/;

/**
 * Parses a decimal string, or a JS number whose shortest round-trip decimal
 * representation has at most four fraction digits, into signed minor units.
 *
 * A number whose shortest representation is exponential or carries more than
 * four fraction digits is rejected rather than rounded: the pilot never
 * silently loses or invents cents.
 */
export function parseMoney(value, field = 'amount') {
  const text =
    typeof value === 'number'
      ? Number.isFinite(value)
        ? String(value)
        : null
      : typeof value === 'string'
        ? value.trim()
        : typeof value === 'bigint'
          ? null
          : null;
  if (typeof value === 'bigint') return value;
  if (text === null || text === '') {
    throw new WbsE2eError('WBS_E2E_AMOUNT_INVALID', `Money field ${field} is not a decimal value.`, { field, value });
  }
  const match = DECIMAL_RE.exec(text);
  if (!match) {
    throw new WbsE2eError(
      'WBS_E2E_AMOUNT_PRECISION_UNSUPPORTED',
      `Money field ${field} is not representable in ${MONEY_SCALE} fixed decimal places.`,
      { field, value: text },
    );
  }
  const [, sign, whole, fraction = ''] = match;
  const padded = (fraction + '0'.repeat(MONEY_SCALE)).slice(0, MONEY_SCALE);
  const minor = BigInt(whole) * SCALE_FACTOR + BigInt(padded);
  return sign === '-' ? -minor : minor;
}

/** Renders signed minor units as a fixed 4-decimal string. */
export function formatMoney(minor) {
  if (typeof minor !== 'bigint') {
    throw new WbsE2eError('WBS_E2E_AMOUNT_INVALID', 'formatMoney requires minor units as BigInt.');
  }
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = absolute / SCALE_FACTOR;
  const fraction = (absolute % SCALE_FACTOR).toString().padStart(MONEY_SCALE, '0');
  return `${negative ? '-' : ''}${whole}.${fraction}`;
}

const sumMinor = values => values.reduce((total, value) => total + value, 0n);

/* ------------------------------------------------------------------ */
/* Harness chart of accounts                                           */
/* ------------------------------------------------------------------ */

const ACCOUNT_RE = /^\d{6}$/;

/**
 * Harness-local account master. Production reads `account_master`; this table
 * exists only so the chain can name accounts and so `isValidAccount` is a real
 * closed set rather than a permissive stub.
 */
export const WBS_E2E_ACCOUNT_MASTER = Object.freeze({
  111000: Object.freeze({ name: 'Operating Cash', required_member_type: 'BANK' }),
  120200: Object.freeze({ name: 'Accounts Receivable', required_member_type: null }),
  140100: Object.freeze({ name: 'Prepaid Insurance', required_member_type: null }),
  164400: Object.freeze({ name: 'Construction in Progress', required_member_type: null }),
  211000: Object.freeze({ name: 'Loan Payable', required_member_type: null }),
  220100: Object.freeze({ name: 'Accounts Payable', required_member_type: null }),
  291001: Object.freeze({ name: 'Due To / Due From Clearing', required_member_type: 'INTERCOMPANY' }),
  411000: Object.freeze({ name: 'Rental Revenue', required_member_type: null }),
  610100: Object.freeze({ name: 'Insurance Expense', required_member_type: null }),
  610200: Object.freeze({ name: 'Property Tax Expense', required_member_type: null }),
  610900: Object.freeze({ name: 'Project Operating Expense', required_member_type: null }),
});

export const isSixDigitAccount = code => ACCOUNT_RE.test(String(code ?? '').trim());
export const isKnownAccount = code =>
  isSixDigitAccount(code) && Object.hasOwn(WBS_E2E_ACCOUNT_MASTER, String(code).trim());
export const accountName = code =>
  WBS_E2E_ACCOUNT_MASTER[String(code ?? '').trim()]?.name ?? 'Unmapped account';

/** Mirrors migration 062: account class from the six-digit account prefix. */
export function accountClass(code) {
  const text = String(code ?? '').trim();
  if (!ACCOUNT_RE.test(text)) return 'UNCLASSIFIED';
  const first = text[0];
  if (first === '1') return 'ASSET';
  if (first === '2') return 'LIABILITY';
  if (first === '3') return 'EQUITY';
  if (first === '4') return 'REVENUE';
  if (first >= '5' && first <= '9') return 'EXPENSE';
  return 'UNCLASSIFIED';
}

/* ------------------------------------------------------------------ */
/* Versioned mapping and rules                                         */
/* ------------------------------------------------------------------ */

export const WBS_E2E_MAPPING_VERSION = 'WBS-REFS-MAPPING-2026-08-A';

/**
 * The rule catalog. A rule turns exactly one reviewed staging item plus one
 * approved mapping snapshot into a balanced two-sided journal shape. Rules are
 * versioned, deterministic and never post.
 */
export const WBS_E2E_RULES = Object.freeze({
  AP_ACCRUAL_V1: Object.freeze({
    rule_id: 'AP_ACCRUAL_V1',
    rule_code: 'R-WBS-AP-ACCRUAL',
    rule_version: '1.0.0',
    source_tool: 'list_payables',
    event_type: 'PAYABLE_ACCRUAL',
    // The mapping snapshot supplies the cost/expense account (the debit).
    // The rule supplies the AP control account (the credit).
    debit_from: 'MAPPED_ACCOUNT',
    credit_account: '220100',
    description: 'Accrue an unbilled/unposted WBS payable against the AP control account.',
  }),
  LOAN_DRAW_V1: Object.freeze({
    rule_id: 'LOAN_DRAW_V1',
    rule_code: 'R-WBS-LOAN-DRAW',
    rule_version: '1.0.0',
    source_tool: 'list_bank_transactions',
    event_type: 'LOAN_DRAW',
    debit_account: '111000',
    credit_account: '211000',
    expected_shape: WBS_LOAN_DRAW_EXPECTED_SHAPE,
    description: 'A construction loan draw is Dr Cash / Cr Loan Payable and is never a cost.',
  }),
});

/* ------------------------------------------------------------------ */
/* Stage 1-4: receipt, lineage, mapping/rule version                   */
/* ------------------------------------------------------------------ */

const sha256Hex = value => createHash('sha256').update(value, 'utf8').digest('hex');

function stage(name, evidenceClass, payload) {
  return Object.freeze({ stage: name, evidence_class: evidenceClass, ...payload });
}

/**
 * Stage 1 + 2. Verifies the envelope against the frozen read-only contract and
 * restates what the receipt actually attests: content hash, source, contract
 * version, company scope and currency.
 */
export function buildImmutableReceipt({ toolName, envelope, scope = {} } = {}) {
  const receipt = validateWbsReadEnvelope({ toolName, envelope });
  const recomputed = sha256Hex(canonicalRequestBody(receipt.rows));
  const currencies = [
    ...new Set(receipt.rows.map(row => String(row?.currency ?? scope?.currency ?? 'USD').toUpperCase())),
  ];
  return stage('RECEIPT', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    tool: receipt.tool_name,
    contract_version: receipt.contract_version,
    environment: receipt.environment,
    captured_at: receipt.captured_at,
    source: receipt.source,
    scope: receipt.scope,
    requested_company_key: scope?.company_key ?? null,
    record_count: receipt.record_count,
    content_sha256: receipt.content_sha256,
    content_sha256_recomputed: recomputed,
    content_hash_verified: recomputed === receipt.content_sha256,
    currencies,
    cursor_next: receipt.cursor_next,
    // Repeated from the frozen contract so no reader has to assume it.
    has_revision_contract: receipt.has_revision_contract,
    has_cdc_contract: receipt.has_cdc_contract,
    has_tombstone_contract: receipt.has_tombstone_contract,
    requires_snapshot_diff: receipt.requires_snapshot_diff,
    deletion_inference_permitted: false,
    receipt,
  });
}

/**
 * Stage 3. Raw / Normalized / Staging / Exception, produced by the frozen
 * lineage mapper. Nothing here is re-derived; the mapper is the authority.
 */
export function buildLineageStage({ toolName, envelope, scope, mappingCandidatesByKey, memberByKey } = {}) {
  const mapped = mapWbsSourceEnvelope({ toolName, envelope, scope, mappingCandidatesByKey, memberByKey });
  return stage('RAW_NORMALIZED_STAGING', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    tool: toolName,
    role: mapped.role,
    terminus: mapped.terminus,
    raw_count: mapped.raw.length,
    normalized_count: mapped.normalized.length,
    staging_count: mapped.staging.length,
    mapping_review_count: mapped.mapping_review.length,
    je_request_seam_count: mapped.je_request_seams.length,
    evidence_count: mapped.evidence.length,
    exception_count: mapped.exceptions.length,
    exceptions: mapped.exceptions,
    blocked: mapped.blocked,
    mapped,
  });
}

/* ------------------------------------------------------------------ */
/* Stage 5: REFS-side persisted staging identity (SIMULATED)           */
/* ------------------------------------------------------------------ */

const namespacedId = (prefix, stableKey) => `${prefix}-${sha256Hex(`${prefix}|${stableKey}`).slice(0, 32)}`;

/**
 * The standard JE command requires a *persisted, reviewed* staging item with a
 * raw_event_id, source_document_id and staging_item_id. Those identities are
 * minted by `refs_persist_wbs_inbound_rows` (migration 058) inside PostgreSQL.
 *
 * There is no PostgreSQL here, so this derives them deterministically from the
 * WBS stable key and labels the result SIMULATED. It refuses to run unless the
 * caller opts in, so the simulation can never be reached by accident.
 */
export function simulatePersistedReviewedStaging({
  stagingItem,
  reviewedBy,
  reviewedAt,
  allowSimulatedPersistence = false,
} = {}) {
  if (allowSimulatedPersistence !== true) {
    throw new WbsE2eError(
      'WBS_E2E_PERSISTENCE_UNAVAILABLE',
      'REFS raw_event / source_document / staging_item persistence is a PostgreSQL command (persistWbsInboundRows, migration 058) and is unavailable in process. Pass allowSimulatedPersistence:true to run the chain on simulated identities.',
      { required_command: 'persistWbsInboundRows', migration: '058_wbs_inbound_atomic_persistence.sql' },
    );
  }
  if (!stagingItem || stagingItem.stage !== 'STAGING' || !stagingItem.stable_key) {
    throw new WbsE2eError('WBS_E2E_STAGING_INVALID', 'A mapper STAGING item is required.');
  }
  if (typeof reviewedBy !== 'string' || reviewedBy.trim() === '') {
    throw new WbsE2eError('WBS_E2E_REVIEWER_REQUIRED', 'Staging review requires a named reviewer.');
  }
  const key = stagingItem.stable_key;
  return stage('STAGING_REVIEWED', WBS_E2E_EVIDENCE_CLASS.NON_PRODUCTION_EXECUTABLE_SPEC, {
    persistence: 'IN_PROCESS_SIMULATED',
    production_command: 'persistWbsInboundRows',
    production_migration: '058_wbs_inbound_atomic_persistence.sql',
    reviewed_by: reviewedBy,
    reviewed_at: reviewedAt,
    item: Object.freeze({
      stage: 'STAGING_REVIEWED',
      staging_item_id: namespacedId('STG', key),
      raw_event_id: namespacedId('RAW', key),
      source_document_id: namespacedId('SRCDOC', key),
      source_record_id: stagingItem.source_id,
      source_version: stagingItem.source_version,
      stable_key: key,
      company_key: stagingItem.company_key,
      currency: stagingItem.currency,
      amount: stagingItem.amount,
      direction: stagingItem.direction,
      business_date: stagingItem.business_date,
      accounting_date: stagingItem.accounting_date,
      wbs_source_document_ref: stagingItem.source_document_ref,
      reviewed_by: reviewedBy,
      reviewed_at: reviewedAt,
      can_allocate: false,
      can_create_draft: false,
      can_post: false,
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Stage 6: accounting event                                           */
/* ------------------------------------------------------------------ */

/**
 * Turns one reviewed staging item plus one approved mapping snapshot into an
 * accounting event. The event carries both versions explicitly; nothing
 * downstream may read a mapping or a rule that is not named here.
 */
export function buildAccountingEvent({ rule, reviewedStaging, mappingReview, normalized } = {}) {
  if (!rule || !WBS_E2E_RULES[rule.rule_id]) {
    throw new WbsE2eError('WBS_E2E_RULE_UNKNOWN', 'An accounting event requires a catalogued rule.');
  }
  if (!reviewedStaging || reviewedStaging.stage !== 'STAGING_REVIEWED') {
    throw new WbsE2eError('WBS_E2E_STAGING_REVIEW_REQUIRED', 'An accounting event requires a reviewed staging item.');
  }
  const amountMinor = parseMoney(reviewedStaging.amount, 'staging.amount');
  if (amountMinor <= 0n) {
    throw new WbsE2eError('WBS_E2E_AMOUNT_INVALID', 'An accounting event requires a positive amount.');
  }
  return stage('ACCOUNTING_EVENT', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    event_id: namespacedId('EVT', reviewedStaging.stable_key),
    event_type: rule.event_type,
    rule_id: rule.rule_id,
    rule_code: rule.rule_code,
    rule_version: rule.rule_version,
    mapping_version: WBS_E2E_MAPPING_VERSION,
    mapping_snapshot_id: mappingReview?.mapping_snapshot_id ?? null,
    mapping_family: mappingReview?.family ?? null,
    mapped_account_code: mappingReview?.account_code ?? null,
    company_key: reviewedStaging.company_key,
    currency: reviewedStaging.currency,
    amount_minor: amountMinor.toString(),
    amount: formatMoney(amountMinor),
    business_date: reviewedStaging.business_date,
    accounting_date: reviewedStaging.accounting_date,
    source_system: 'WBS',
    source_tool: rule.source_tool,
    wbs_source_document_ref: reviewedStaging.wbs_source_document_ref,
    source_record_id: reviewedStaging.source_record_id,
    source_version: reviewedStaging.source_version,
    staging_item_id: reviewedStaging.staging_item_id,
    raw_event_id: reviewedStaging.raw_event_id,
    source_document_id: reviewedStaging.source_document_id,
    normalized_description: normalized?.description ?? null,
    vendor_ref: normalized?.vendor_ref ?? null,
    vendor_name: normalized?.vendor_name ?? null,
    project_code: normalized?.project_code ?? null,
    cost_code_ref: normalized?.cost_code_ref ?? null,
    can_create_draft: false,
    can_post: false,
  });
}

/* ------------------------------------------------------------------ */
/* Stage 7: suggested balanced Draft JE                                */
/* ------------------------------------------------------------------ */

function journalLine({ account_code, debitMinor, creditMinor, member = null, extra = {} }) {
  const code = String(account_code ?? '').trim();
  if (!isSixDigitAccount(code)) {
    throw new WbsE2eError('WBS_E2E_ACCOUNT_NOT_SIX_DIGIT', `Account ${code || '(blank)'} is not a six-digit account.`);
  }
  if (!isKnownAccount(code)) {
    throw new WbsE2eError('WBS_E2E_ACCOUNT_UNKNOWN', `Account ${code} is not in the account master.`);
  }
  if (isSubsidiaryAccount(code) && (typeof member !== 'string' || member.trim() === '')) {
    throw new WbsE2eError('WBS_E2E_MEMBER_REQUIRED', `Subsidiary-ledger account ${code} requires a member.`);
  }
  if ((debitMinor > 0n && creditMinor > 0n) || (debitMinor === 0n && creditMinor === 0n)) {
    throw new WbsE2eError('WBS_E2E_LINE_AMOUNT_INVALID', `Account ${code} line must be one-sided and non-zero.`);
  }
  if (debitMinor < 0n || creditMinor < 0n) {
    throw new WbsE2eError('WBS_E2E_LINE_AMOUNT_INVALID', `Account ${code} line may not be negative.`);
  }
  return Object.freeze({
    account_code: code,
    account_name: accountName(code),
    account_class: accountClass(code),
    member: member ?? null,
    debit_amount: formatMoney(debitMinor),
    credit_amount: formatMoney(creditMinor),
    debit_minor: debitMinor.toString(),
    credit_minor: creditMinor.toString(),
    ...extra,
  });
}

/**
 * Builds the suggested Draft. Balance is proved on integers: the sum of debit
 * minor units must equal the sum of credit minor units exactly. There is no
 * tolerance and no rounding step.
 */
export function buildSuggestedDraftJournal({ event, rule, member = null, periodCode, journalNumber } = {}) {
  const amountMinor = BigInt(event.amount_minor);
  let debitAccount;
  let creditAccount;
  if (rule.debit_from === 'MAPPED_ACCOUNT') {
    debitAccount = event.mapped_account_code;
    creditAccount = rule.credit_account;
    if (!isSixDigitAccount(debitAccount)) {
      throw new WbsE2eError('WBS_E2E_MAPPING_MISSING', 'The approved mapping did not supply a six-digit debit account.');
    }
  } else {
    debitAccount = rule.debit_account;
    creditAccount = rule.credit_account;
  }
  if (rule.rule_id === 'LOAN_DRAW_V1') {
    // Red line: a loan draw is Dr Cash / Cr Loan Payable and never a cost.
    if (debitAccount !== '111000' || creditAccount !== '211000') {
      throw new WbsE2eError('WBS_E2E_LOAN_DRAW_SHAPE_VIOLATION', `A loan draw must be ${WBS_LOAN_DRAW_EXPECTED_SHAPE}.`);
    }
    if (accountClass(debitAccount) !== 'ASSET' || accountClass(creditAccount) !== 'LIABILITY') {
      throw new WbsE2eError('WBS_E2E_LOAN_DRAW_SHAPE_VIOLATION', 'A loan draw may never touch a cost account.');
    }
  }
  const lines = [
    journalLine({
      account_code: debitAccount,
      debitMinor: amountMinor,
      creditMinor: 0n,
      member: isSubsidiaryAccount(debitAccount) ? member : null,
      extra: { line_no: 1, wbs_source_document_ref: event.wbs_source_document_ref },
    }),
    journalLine({
      account_code: creditAccount,
      debitMinor: 0n,
      creditMinor: amountMinor,
      member: isSubsidiaryAccount(creditAccount) ? member : null,
      extra: { line_no: 2, wbs_source_document_ref: event.wbs_source_document_ref },
    }),
  ];
  const totalDebit = sumMinor(lines.map(line => BigInt(line.debit_minor)));
  const totalCredit = sumMinor(lines.map(line => BigInt(line.credit_minor)));
  if (totalDebit !== totalCredit || totalDebit <= 0n) {
    throw new WbsE2eError('WBS_E2E_UNBALANCED', 'Suggested journal debits and credits are not exactly equal.', {
      total_debit_minor: totalDebit.toString(),
      total_credit_minor: totalCredit.toString(),
    });
  }
  const journal = Object.freeze({
    je_id: namespacedId('JE', event.source_record_id),
    je_number: journalNumber,
    entity_id: event.company_key,
    period_code: periodCode,
    je_date: event.accounting_date,
    je_type: 'AUTO',
    source_system: 'WBS_MCP',
    source_doc_id: event.source_document_id,
    rule_code: event.rule_code,
    setting_used: Object.freeze({
      rule_id: event.rule_id,
      rule_version: event.rule_version,
      credit_account: rule.credit_account,
      debit_from: rule.debit_from ?? 'RULE_ACCOUNT',
    }),
    mapping_used: Object.freeze({
      mapping_version: event.mapping_version,
      mapping_snapshot_id: event.mapping_snapshot_id,
      mapped_account_code: event.mapped_account_code,
    }),
    idempotency_key: `wbs-mcp/${event.source_record_id}/${event.rule_id}`,
    currency: event.currency,
    description: `${event.event_type} · ${event.normalized_description ?? event.wbs_source_document_ref}`,
    attachments: Object.freeze([]),
    lines: Object.freeze(lines),
    wbs_trace: Object.freeze({
      source_system: 'WBS',
      source_tool: event.source_tool,
      source_record_id: event.source_record_id,
      source_version: event.source_version,
      wbs_source_document_ref: event.wbs_source_document_ref,
      raw_event_id: event.raw_event_id,
      staging_item_id: event.staging_item_id,
      source_document_id: event.source_document_id,
      event_id: event.event_id,
    }),
  });
  return stage('SUGGESTED_DRAFT_JE', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    balanced_exact: true,
    total_debit_minor: totalDebit.toString(),
    total_credit_minor: totalCredit.toString(),
    total_debit: formatMoney(totalDebit),
    total_credit: formatMoney(totalCredit),
    posting_status: 'DRAFT',
    can_post: false,
    journal,
  });
}

/* ------------------------------------------------------------------ */
/* Stage 9: GL / Trial Balance / Balance Sheet / Income Statement      */
/* ------------------------------------------------------------------ */

const withinPeriod = (date, from, to) => date >= from && date <= to;

/**
 * Posts the POSTED journals into ledger lines. One journal line becomes one
 * ledger line; the WBS trace is carried onto every ledger line so the audit
 * lineage never depends on joining back through mutable state.
 */
export function buildGeneralLedger(journals) {
  const lines = [];
  for (const journal of journals) {
    if (journal.posting_status !== 'POSTED') continue;
    journal.lines.forEach((line, index) => {
      lines.push(
        Object.freeze({
          ledger_line_id: namespacedId('LL', `${journal.je_id}|${index}`),
          journal_line_id: namespacedId('JL', `${journal.je_id}|${index}`),
          journal_entry_id: journal.je_id,
          je_number: journal.je_number,
          journal_date: journal.je_date,
          entity_id: journal.entity_id,
          account_code: line.account_code,
          account_name: accountName(line.account_code),
          account_class: accountClass(line.account_code),
          member: line.member ?? null,
          debit_minor: line.debit_minor,
          credit_minor: line.credit_minor,
          debit_amount: line.debit_amount,
          credit_amount: line.credit_amount,
          source_system: journal.source_system ?? null,
          source_document_id: journal.source_doc_id ?? null,
          wbs_source_document_ref: journal.wbs_trace?.wbs_source_document_ref ?? null,
          wbs_source_record_id: journal.wbs_trace?.source_record_id ?? null,
          wbs_source_version: journal.wbs_trace?.source_version ?? null,
        }),
      );
    });
  }
  return Object.freeze(lines);
}

/**
 * Aggregates ledger lines exactly as `refs_get_financial_statements` does:
 * opening (before period start), period (inside the period) and ending
 * (everything up to period end), all on integer minor units.
 */
export function buildAccountTotals(ledgerLines, { periodStart, periodEnd }) {
  const totals = new Map();
  for (const line of ledgerLines) {
    if (line.journal_date > periodEnd) continue;
    const key = line.account_code;
    if (!totals.has(key)) {
      totals.set(key, {
        account_code: key,
        account_name: line.account_name,
        account_class: line.account_class,
        required_member_type: WBS_E2E_ACCOUNT_MASTER[key]?.required_member_type ?? null,
        opening_debit: 0n,
        opening_credit: 0n,
        period_debit: 0n,
        period_credit: 0n,
        ending_debit: 0n,
        ending_credit: 0n,
        journal_entry_ids: new Set(),
        ledger_line_ids: new Set(),
        source_document_ids: new Set(),
        wbs_source_document_refs: new Set(),
      });
    }
    const bucket = totals.get(key);
    const debit = BigInt(line.debit_minor);
    const credit = BigInt(line.credit_minor);
    if (line.journal_date < periodStart) {
      bucket.opening_debit += debit;
      bucket.opening_credit += credit;
    }
    if (withinPeriod(line.journal_date, periodStart, periodEnd)) {
      bucket.period_debit += debit;
      bucket.period_credit += credit;
    }
    bucket.ending_debit += debit;
    bucket.ending_credit += credit;
    bucket.journal_entry_ids.add(line.journal_entry_id);
    bucket.ledger_line_ids.add(line.ledger_line_id);
    if (line.source_document_id) bucket.source_document_ids.add(line.source_document_id);
    if (line.wbs_source_document_ref) bucket.wbs_source_document_refs.add(line.wbs_source_document_ref);
  }
  return [...totals.values()].sort((left, right) => left.account_code.localeCompare(right.account_code));
}

const freezeTotals = bucket =>
  Object.freeze({
    account_code: bucket.account_code,
    account_name: bucket.account_name,
    account_class: bucket.account_class,
    opening_debit: formatMoney(bucket.opening_debit),
    opening_credit: formatMoney(bucket.opening_credit),
    period_debit: formatMoney(bucket.period_debit),
    period_credit: formatMoney(bucket.period_credit),
    ending_debit: formatMoney(bucket.ending_debit),
    ending_credit: formatMoney(bucket.ending_credit),
    journal_entry_ids: Object.freeze([...bucket.journal_entry_ids].sort()),
    ledger_line_ids: Object.freeze([...bucket.ledger_line_ids].sort()),
    source_document_ids: Object.freeze([...bucket.source_document_ids].sort()),
    wbs_source_document_refs: Object.freeze([...bucket.wbs_source_document_refs].sort()),
  });

/** TRIAL_BALANCE / ALL_ACCOUNTS, display_balance = ending_debit - ending_credit. */
export function buildTrialBalance(ledgerLines, period) {
  const buckets = buildAccountTotals(ledgerLines, period);
  const rows = buckets.map(bucket =>
    Object.freeze({
      statement_type: 'TRIAL_BALANCE',
      statement_section: 'ALL_ACCOUNTS',
      classification_basis: 'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',
      display_balance: formatMoney(bucket.ending_debit - bucket.ending_credit),
      ...freezeTotals(bucket),
    }),
  );
  const totalDebit = sumMinor(buckets.map(bucket => bucket.ending_debit));
  const totalCredit = sumMinor(buckets.map(bucket => bucket.ending_credit));
  return Object.freeze({
    period_code: period.periodCode,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    rows: Object.freeze(rows),
    total_debit: formatMoney(totalDebit),
    total_credit: formatMoney(totalCredit),
    total_debit_minor: totalDebit.toString(),
    total_credit_minor: totalCredit.toString(),
    balanced_exact: totalDebit === totalCredit,
  });
}

const BALANCE_SHEET_SECTION = Object.freeze({
  ASSET: 'ASSETS',
  LIABILITY: 'LIABILITIES',
  EQUITY: 'EQUITY',
  REVENUE: 'CURRENT_EARNINGS',
  EXPENSE: 'CURRENT_EARNINGS',
});

/** BALANCE_SHEET, mirroring migration 062 sections and display balances. */
export function buildBalanceSheet(ledgerLines, period) {
  const buckets = buildAccountTotals(ledgerLines, period);
  const rows = buckets.map(bucket => {
    const section = BALANCE_SHEET_SECTION[bucket.account_class] ?? 'UNCLASSIFIED';
    const value =
      bucket.account_class === 'ASSET'
        ? bucket.ending_debit - bucket.ending_credit
        : bucket.ending_credit - bucket.ending_debit;
    return Object.freeze({
      statement_type: 'BALANCE_SHEET',
      statement_section: section,
      classification_basis: 'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',
      display_balance: formatMoney(value),
      display_balance_minor: value.toString(),
      ...freezeTotals(bucket),
    });
  });
  const sectionTotal = name =>
    sumMinor(rows.filter(row => row.statement_section === name).map(row => BigInt(row.display_balance_minor)));
  const assets = sectionTotal('ASSETS');
  const liabilities = sectionTotal('LIABILITIES');
  const equity = sectionTotal('EQUITY');
  // Migration 062 presents revenue and expense inside CURRENT_EARNINGS using
  // the "everything that is not an asset shows credit-minus-debit" rule, so a
  // net loss appears as a negative current-earnings figure.
  const currentEarnings = sectionTotal('CURRENT_EARNINGS');
  return Object.freeze({
    period_code: period.periodCode,
    rows: Object.freeze(rows),
    sections: Object.freeze({
      ASSETS: formatMoney(assets),
      LIABILITIES: formatMoney(liabilities),
      EQUITY: formatMoney(equity),
      CURRENT_EARNINGS: formatMoney(currentEarnings),
    }),
    total_assets: formatMoney(assets),
    total_liabilities_equity_and_earnings: formatMoney(liabilities + equity + currentEarnings),
    tied_exact: assets === liabilities + equity + currentEarnings,
  });
}

/** INCOME_STATEMENT, period movement only, mirroring migration 062. */
export function buildIncomeStatement(ledgerLines, period) {
  const buckets = buildAccountTotals(ledgerLines, period).filter(bucket =>
    ['REVENUE', 'EXPENSE'].includes(bucket.account_class),
  );
  const rows = buckets.map(bucket => {
    const value =
      bucket.account_class === 'REVENUE'
        ? bucket.period_credit - bucket.period_debit
        : bucket.period_debit - bucket.period_credit;
    return Object.freeze({
      statement_type: 'INCOME_STATEMENT',
      statement_section: bucket.account_class === 'REVENUE' ? 'REVENUE' : 'EXPENSES',
      classification_basis: 'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',
      display_balance: formatMoney(value),
      display_balance_minor: value.toString(),
      ...freezeTotals(bucket),
    });
  });
  const sectionTotal = name =>
    sumMinor(rows.filter(row => row.statement_section === name).map(row => BigInt(row.display_balance_minor)));
  const revenue = sectionTotal('REVENUE');
  const expenses = sectionTotal('EXPENSES');
  return Object.freeze({
    period_code: period.periodCode,
    rows: Object.freeze(rows),
    total_revenue: formatMoney(revenue),
    total_expenses: formatMoney(expenses),
    net_income: formatMoney(revenue - expenses),
    net_income_minor: (revenue - expenses).toString(),
  });
}

/* ------------------------------------------------------------------ */
/* Stage 10: audit lineage back to the originating WBS row             */
/* ------------------------------------------------------------------ */

/**
 * Walks the chain backwards from a statement line to the exact WBS row bytes.
 * Every hop is an identity that was actually carried, not a reconstruction.
 */
export function buildLineageTrace({ receiptStage, lineageStage, event, postedJournal, ledgerLines, trialBalance }) {
  const normalized = lineageStage.mapped.normalized.find(row => row.source_id === event.source_record_id);
  const raw = lineageStage.mapped.raw.find(row => row.row_content_hash === normalized?.row_content_hash);
  const relatedLedger = ledgerLines.filter(line => line.journal_entry_id === postedJournal.je_id);
  const touchedAccounts = [...new Set(relatedLedger.map(line => line.account_code))].sort();
  const tbRows = trialBalance.rows.filter(row => touchedAccounts.includes(row.account_code));
  return stage('AUDIT_LINEAGE', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    hops: Object.freeze([
      Object.freeze({
        hop: 1,
        level: 'WBS_SOURCE_ROW',
        tool: receiptStage.tool,
        source_module: WBS_SOURCE_CATALOG[receiptStage.tool]?.source_module ?? null,
        row_index: raw?.row_index ?? null,
        row_content_hash: raw?.row_content_hash ?? null,
        row: raw?.row ?? null,
      }),
      Object.freeze({
        hop: 2,
        level: 'IMMUTABLE_RECEIPT',
        contract_version: receiptStage.contract_version,
        captured_at: receiptStage.captured_at,
        envelope_content_sha256: receiptStage.content_sha256,
        content_hash_verified: receiptStage.content_hash_verified,
      }),
      Object.freeze({
        hop: 3,
        level: 'NORMALIZED',
        source_id: normalized?.source_id ?? null,
        source_version: normalized?.source_version ?? null,
        stable_key: normalized?.stable_key ?? null,
        company_key: normalized?.company_key ?? null,
        currency: normalized?.currency ?? null,
      }),
      Object.freeze({
        hop: 4,
        level: 'STAGING_REVIEWED',
        staging_item_id: event.staging_item_id,
        raw_event_id: event.raw_event_id,
        source_document_id: event.source_document_id,
        persistence: 'IN_PROCESS_SIMULATED',
      }),
      Object.freeze({
        hop: 5,
        level: 'ACCOUNTING_EVENT',
        event_id: event.event_id,
        rule_id: event.rule_id,
        rule_version: event.rule_version,
        mapping_version: event.mapping_version,
        mapping_snapshot_id: event.mapping_snapshot_id,
      }),
      Object.freeze({
        hop: 6,
        level: 'POSTED_JOURNAL',
        je_id: postedJournal.je_id,
        je_number: postedJournal.je_number,
        posting_status: postedJournal.posting_status,
        created_by: postedJournal.created_by,
        reviewer: postedJournal.reviewer ?? null,
        approver: postedJournal.approver ?? null,
        posted_by: postedJournal.posted_by ?? null,
        history: postedJournal.history ?? [],
      }),
      Object.freeze({
        hop: 7,
        level: 'LEDGER_LINES',
        ledger_line_ids: Object.freeze(relatedLedger.map(line => line.ledger_line_id)),
        accounts: Object.freeze(touchedAccounts),
      }),
      Object.freeze({
        hop: 8,
        level: 'TRIAL_BALANCE',
        rows: Object.freeze(
          tbRows.map(row =>
            Object.freeze({
              account_code: row.account_code,
              display_balance: row.display_balance,
              wbs_source_document_refs: row.wbs_source_document_refs,
            }),
          ),
        ),
      }),
    ]),
    reverse_lookup_ok: Boolean(
      raw &&
        normalized &&
        relatedLedger.length > 0 &&
        relatedLedger.every(line => line.wbs_source_document_ref === event.wbs_source_document_ref),
    ),
  });
}

/* ------------------------------------------------------------------ */
/* Standard JE command seam                                            */
/* ------------------------------------------------------------------ */

/**
 * Hands the suggested Draft to the repository's own standard-command builder.
 * `buildStandardDraftRequest` is the function the frozen lineage mapper names
 * as `required_command`; it refuses anything that is not a reviewed staging
 * item plus an approved versioned mapping plus a balanced journal.
 */
export function buildStandardJeCommand({ reviewedStaging, event, draft, periodId }) {
  const request = buildStandardDraftRequest({
    stagingItem: reviewedStaging,
    mapping: {
      status: 'APPROVED',
      mapping_id: event.mapping_snapshot_id,
      version: event.mapping_version,
    },
    journal: {
      period_id: periodId,
      journal_number: draft.journal.je_number,
      description: draft.journal.description,
      lines: draft.journal.lines.map(line => ({
        account_code: line.account_code,
        member: line.member,
        debit_amount: line.debit_amount,
        credit_amount: line.credit_amount,
      })),
    },
  });
  return stage('STANDARD_JE_COMMAND', WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE, {
    request_type: request.request_type,
    status: request.status,
    kernel_method: request.kernel_method,
    can_dispatch: request.can_dispatch,
    can_post: request.can_post,
    production_kernel: 'PostgresAccountingKernel.createAutoJournal',
    request,
  });
}
