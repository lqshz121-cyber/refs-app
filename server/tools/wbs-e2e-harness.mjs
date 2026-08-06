#!/usr/bin/env node
// Runnable WBS -> accounting end-to-end harness.
//
//   node server/tools/wbs-e2e-harness.mjs            # all three scenarios
//   node server/tools/wbs-e2e-harness.mjs payable    # scenario 1 only
//   node server/tools/wbs-e2e-harness.mjs bank
//   node server/tools/wbs-e2e-harness.mjs costgl
//   node server/tools/wbs-e2e-harness.mjs --json     # machine-readable result
//
// It reads nothing from the network. The WBS envelopes are sanitized fixtures
// that satisfy the frozen read-only contract, because the real provider is not
// reachable here and has no credentials here. Every printed stage is labelled
// with its evidence class. Nothing in this file is a production PASS.

import { pathToFileURL } from 'node:url';

import { JEService } from '../api/je-service.mjs';
import { MemoryJEDatabase } from '../db/memory-je-db.mjs';
import { evaluateWbsAutoReconciliationEligibility } from '../runtime/wbs-inbound-data-adapter.mjs';
import { canonicalRequestHash } from '../runtime/request-hash.mjs';
import { isSubsidiaryAccount } from '../runtime/wbs-mcp-lineage.mjs';
import {
  WBS_E2E_EVIDENCE_CLASS,
  WBS_E2E_RULES,
  WbsE2eError,
  accountClass,
  buildAccountingEvent,
  buildBalanceSheet,
  buildGeneralLedger,
  buildImmutableReceipt,
  buildIncomeStatement,
  buildLineageStage,
  buildLineageTrace,
  buildStandardJeCommand,
  buildSuggestedDraftJournal,
  buildTrialBalance,
  formatMoney,
  isKnownAccount,
  parseMoney,
  simulatePersistedReviewedStaging,
} from '../runtime/wbs-accounting-e2e.mjs';
import {
  ACTORS,
  BANK_MAPPINGS,
  BANK_ROWS,
  COST_GL_ROWS,
  COST_GL_STRING_ID_TRAP_ROW,
  FIXTURE_COMPANY_KEY,
  FIXTURE_PERIOD,
  PAYABLE_MAPPINGS,
  PAYABLE_ROWS,
  PROJECT_COMPLETION,
  fixtureEnvelope,
  fixtureStableKey,
} from './wbs-e2e-fixtures.mjs';

const REVIEWED_AT = '2026-08-05T13:00:00.000Z';

const keyed = (tool, rows, byNaturalKey, naturalKeyField) => {
  const out = {};
  for (const row of rows) {
    const candidates = byNaturalKey[row[naturalKeyField]];
    if (candidates) out[fixtureStableKey(tool, row)] = candidates;
  }
  return out;
};

/* ------------------------------------------------------------------ */
/* Draft -> Review -> Approve -> Post through the repository engine     */
/* ------------------------------------------------------------------ */

function createJournalEngine() {
  const db = new MemoryJEDatabase({
    periods: [
      { entity_id: FIXTURE_COMPANY_KEY, period_code: FIXTURE_PERIOD.periodCode, status: 'OPEN' },
      { entity_id: FIXTURE_COMPANY_KEY, period_code: '2026-06', status: 'CLOSED' },
    ],
  });
  const service = new JEService(db, {
    now: () => REVIEWED_AT,
    isValidAccount: code => isKnownAccount(code),
    requiresMember: code => isSubsidiaryAccount(code),
  });
  return { db, service };
}

/**
 * Drives the standard controlled workflow with four distinct actors and
 * records the segregation-of-duties refusals as positive evidence.
 */
function runControlledWorkflow({ service, journal }) {
  const steps = [];
  const record = (label, result) => {
    steps.push({
      step: label,
      ok: result.ok === true,
      code: result.code ?? null,
      message: result.message ?? null,
      posting_status: result.data?.je?.posting_status ?? null,
    });
    return result;
  };

  const created = record('create (maker)', service.create({ actor: ACTORS.maker, je: journal }));
  if (!created.ok) return { ok: false, steps, journal: null };

  const submitted = record(
    'submit (maker)',
    service.transition({ actor: ACTORS.maker, id: journal.je_id, action: 'submit' }),
  );
  if (!submitted.ok) return { ok: false, steps, journal: null };

  const reviewed = record(
    'review (reviewer)',
    service.transition({ actor: ACTORS.reviewer, id: journal.je_id, action: 'review' }),
  );
  if (!reviewed.ok) return { ok: false, steps, journal: null };

  // Segregation of duties: the maker may not approve their own journal.
  const makerApprove = record(
    'approve attempted by maker (must be refused)',
    service.transition({ actor: ACTORS.maker, id: journal.je_id, action: 'approve' }),
  );
  const sodMakerRefused = makerApprove.ok === false && makerApprove.code === 'JE_SOD_MAKER';

  const approved = record(
    'approve (controller)',
    service.transition({ actor: ACTORS.approver, id: journal.je_id, action: 'approve' }),
  );
  if (!approved.ok) return { ok: false, steps, journal: null };

  // Segregation of duties: the approver may not post what they approved.
  const approverPost = record(
    'post attempted by approver (must be refused)',
    service.transition({ actor: ACTORS.approver, id: journal.je_id, action: 'post' }),
  );
  const sodApproverRefused = approverPost.ok === false && approverPost.code === 'JE_SOD_APPROVER_POSTER';

  const posted = record(
    'post (senior accountant)',
    service.transition({ actor: ACTORS.poster, id: journal.je_id, action: 'post' }),
  );
  if (!posted.ok) return { ok: false, steps, journal: null };

  return {
    ok: true,
    steps,
    sod_maker_cannot_approve: sodMakerRefused,
    sod_approver_cannot_post: sodApproverRefused,
    journal: posted.data.je,
  };
}

/* ------------------------------------------------------------------ */
/* Scenario 1: payable -> accrual JE -> GL -> TB -> BS / IS            */
/* ------------------------------------------------------------------ */

export function runPayableAccrualScenario({ allowSimulatedPersistence = true } = {}) {
  const tool = 'list_payables';
  const scope = { company_key: FIXTURE_COMPANY_KEY, currency: 'USD' };
  const envelope = fixtureEnvelope(tool, PAYABLE_ROWS);
  const receiptStage = buildImmutableReceipt({ toolName: tool, envelope, scope });
  const lineageStage = buildLineageStage({
    toolName: tool,
    envelope,
    scope,
    mappingCandidatesByKey: keyed(tool, PAYABLE_ROWS, PAYABLE_MAPPINGS, 'ap_guid'),
    memberByKey: {},
  });

  const { service } = createJournalEngine();
  const items = [];

  for (const seam of lineageStage.mapped.je_request_seams) {
    const stagingItem = seam.staging_item;
    const normalized = stagingItem.normalized;
    const mappingReview = lineageStage.mapped.mapping_review.find(row => row.stable_key === seam.stable_key);
    const reviewed = simulatePersistedReviewedStaging({
      stagingItem,
      reviewedBy: ACTORS.reviewer.user_id,
      reviewedAt: REVIEWED_AT,
      allowSimulatedPersistence,
    });
    const event = buildAccountingEvent({
      rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
      reviewedStaging: reviewed.item,
      mappingReview,
      normalized,
    });
    const draft = buildSuggestedDraftJournal({
      event,
      rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
      periodCode: FIXTURE_PERIOD.periodCode,
      journalNumber: `WBS-AP-${normalized.bill_no ?? event.source_record_id}`,
    });
    const command = buildStandardJeCommand({
      reviewedStaging: reviewed.item,
      event,
      draft,
      periodId: FIXTURE_PERIOD.periodId,
    });
    const workflow = runControlledWorkflow({ service, journal: draft.journal });
    items.push({ seam, stagingReview: reviewed, event, draft, command, workflow });
  }

  const postedJournals = items.filter(item => item.workflow.ok).map(item => item.workflow.journal);
  const ledgerLines = buildGeneralLedger(postedJournals);
  const trialBalance = buildTrialBalance(ledgerLines, FIXTURE_PERIOD);
  const balanceSheet = buildBalanceSheet(ledgerLines, FIXTURE_PERIOD);
  const incomeStatement = buildIncomeStatement(ledgerLines, FIXTURE_PERIOD);
  const traces = items
    .filter(item => item.workflow.ok)
    .map(item =>
      buildLineageTrace({
        receiptStage,
        lineageStage,
        event: item.event,
        postedJournal: item.workflow.journal,
        ledgerLines,
        trialBalance,
      }),
    );

  return Object.freeze({
    scenario: 'PAYABLE_TO_ACCRUAL_JE',
    priority: 1,
    reached: postedJournals.length > 0 ? 'BALANCE_SHEET_AND_INCOME_STATEMENT' : 'BLOCKED',
    receiptStage,
    lineageStage,
    items,
    postedJournals,
    ledgerLines,
    trialBalance,
    balanceSheet,
    incomeStatement,
    traces,
  });
}

/* ------------------------------------------------------------------ */
/* Scenario 2: bank statement -> reconciliation exception              */
/* ------------------------------------------------------------------ */

/** Everything the WBS contract plus simulated REFS persistence can supply. */
function autorecSide({ side, normalized, reviewed, receiptStage, extra }) {
  return {
    stage: 'STAGING_REVIEWED',
    source_type: side === 'BANK_SIDE' ? 'BANK_TRANSACTION' : 'PAYABLE',
    receipt_id: null, // REFS receipt identity: minted by persistWbsInboundRows.
    receipt_ref: `wbs-mcp://${receiptStage.tool}/${receiptStage.captured_at}`,
    receipt_hash: canonicalRequestHash({ content_sha256: receiptStage.content_sha256 }),
    raw_event_id: reviewed.item.raw_event_id,
    source_document_id: reviewed.item.source_document_id,
    staging_item_id: reviewed.item.staging_item_id,
    source_record_id: reviewed.item.source_record_id,
    source_version: reviewed.item.source_version,
    company_key: reviewed.item.company_key,
    currency: reviewed.item.currency,
    amount: reviewed.item.amount,
    business_date: reviewed.item.business_date,
    accounting_date: reviewed.item.accounting_date,
    bank_account_ref: normalized.bank_account_ref ?? null,
    direction: reviewed.item.direction,
    account_before: null, // REFS review state, not a WBS field.
    account_after: null, // REFS review state, not a WBS field.
    review_event_id: null, // REFS review state, not a WBS field.
    ...extra,
  };
}

export function runBankReconciliationScenario({ allowSimulatedPersistence = true } = {}) {
  const bankTool = 'list_bank_transactions';
  const payableTool = 'list_payables';
  const scope = { company_key: FIXTURE_COMPANY_KEY, currency: 'USD' };

  const bankEnvelope = fixtureEnvelope(bankTool, BANK_ROWS);
  const bankReceipt = buildImmutableReceipt({ toolName: bankTool, envelope: bankEnvelope, scope });
  const bankLineage = buildLineageStage({
    toolName: bankTool,
    envelope: bankEnvelope,
    scope,
    mappingCandidatesByKey: keyed(bankTool, BANK_ROWS, BANK_MAPPINGS, 'cb_id'),
    memberByKey: {},
  });

  const payableEnvelope = fixtureEnvelope(payableTool, PAYABLE_ROWS);
  const payableReceipt = buildImmutableReceipt({ toolName: payableTool, envelope: payableEnvelope, scope });
  const payableLineage = buildLineageStage({
    toolName: payableTool,
    envelope: payableEnvelope,
    scope,
    mappingCandidatesByKey: keyed(payableTool, PAYABLE_ROWS, PAYABLE_MAPPINGS, 'ap_guid'),
    memberByKey: {},
  });

  const bankSeamFor = sysId =>
    bankLineage.mapped.je_request_seams.find(
      seam => seam.staging_item.normalized.source_document_ref === sysId,
    );
  const payableSeamFor = guid =>
    payableLineage.mapped.je_request_seams.find(seam => seam.staging_item.normalized.source_document_ref === guid);

  // The frozen contract maps list_bank_transactions.bank_account_ref from
  // `account_code` (a GL account) while list_payables carries `cb_id` (a cash
  // book id). They do not join. The cash-book id is the only reference both
  // sides share, so it is recovered from the raw row rather than invented.
  const cashBookIdOf = (lineage, seam) =>
    lineage.mapped.raw.find(
      record => record.row_content_hash === seam.staging_item.normalized.row_content_hash,
    )?.row?.cb_id ?? null;

  const reviewedFor = seam =>
    simulatePersistedReviewedStaging({
      stagingItem: seam.staging_item,
      reviewedBy: ACTORS.reviewer.user_id,
      reviewedAt: REVIEWED_AT,
      allowSimulatedPersistence,
    });

  /* --- 2a. Matched candidate run through the real eligibility gate --- */
  const bankSeam = bankSeamFor('SYS-BANK-0001');
  const payableSeam = payableSeamFor('AP-GUID-0001');
  const bankReviewed = reviewedFor(bankSeam);
  const payableReviewed = reviewedFor(payableSeam);
  const bankStaging = autorecSide({
    side: 'BANK_SIDE',
    normalized: bankSeam.staging_item.normalized,
    reviewed: bankReviewed,
    receiptStage: bankReceipt,
    extra: {
      bank_account_ref: cashBookIdOf(bankLineage, bankSeam),
      // `journal_no` is required by the eligibility gate but is NOT part of the
      // frozen list_bank_transactions row-field allowlist. It is left null on
      // purpose: inventing it would be fabricating provider data.
      journal_no: null,
      payee_no: bankSeam.staging_item.normalized.payee_no ?? null,
    },
  });
  const businessStaging = autorecSide({
    side: 'BUSINESS_SIDE',
    normalized: payableSeam.staging_item.normalized,
    reviewed: payableReviewed,
    receiptStage: payableReceipt,
    extra: {
      bank_account_ref: payableSeam.staging_item.normalized.bank_account_ref ?? null,
      bill_no: payableSeam.staging_item.normalized.bill_no ?? null,
      project_ref: payableSeam.staging_item.normalized.project_ref ?? null,
      project_code: payableSeam.staging_item.normalized.project_code ?? null,
    },
  });
  const eligibility = evaluateWbsAutoReconciliationEligibility({ bankStaging, businessStaging });

  /* --- 2b. Bank row with no business counterpart --- */
  const orphanSeam = bankSeamFor('SYS-BANK-0002');
  const orphanNormalized = orphanSeam.staging_item.normalized;
  const payablePayees = new Set(
    payableLineage.mapped.staging.map(item => item.normalized.vendor_ref).filter(Boolean),
  );
  const orphanException = Object.freeze({
    stage: 'EXCEPTION',
    code: 'WBS_E2E_BANK_NO_BUSINESS_COUNTERPART',
    message:
      'A reviewed WBS bank line has no WBS business-side counterpart in the same read window. It is retained as a reconciliation exception and never auto-matched, never allocated and never posted.',
    scope: Object.freeze({
      level: 'ROW',
      tool: bankTool,
      stable_key: orphanSeam.stable_key,
      source_id: orphanSeam.source_id,
      company_key: orphanSeam.company_key,
    }),
    detail: Object.freeze({
      bank_source_document_ref: orphanNormalized.source_document_ref,
      payee_no: orphanNormalized.payee_no,
      amount: formatMoney(parseMoney(orphanNormalized.amount, 'bank.amount')),
      business_date: orphanNormalized.business_date,
      candidate_business_payees: Object.freeze([...payablePayees].sort()),
    }),
    can_create_draft: false,
    can_dispatch: false,
    can_post: false,
  });

  /* --- 2c. Loan draw shape guard (Dr Cash / Cr Loan Payable) --- */
  const loanSeam = bankSeamFor('SYS-BANK-0003');
  const loanReviewed = reviewedFor(loanSeam);
  const loanEvent = buildAccountingEvent({
    rule: WBS_E2E_RULES.LOAN_DRAW_V1,
    reviewedStaging: loanReviewed.item,
    mappingReview: bankLineage.mapped.mapping_review.find(row => row.stable_key === loanSeam.stable_key),
    normalized: loanSeam.staging_item.normalized,
  });
  const loanDraft = buildSuggestedDraftJournal({
    event: loanEvent,
    rule: WBS_E2E_RULES.LOAN_DRAW_V1,
    periodCode: FIXTURE_PERIOD.periodCode,
    journalNumber: `WBS-LOAN-${loanEvent.source_record_id}`,
  });
  const loanShapeOk =
    loanDraft.journal.lines[0].account_code === '111000' &&
    loanDraft.journal.lines[1].account_code === '211000' &&
    loanDraft.journal.lines.every(line => accountClass(line.account_code) !== 'EXPENSE');

  return Object.freeze({
    scenario: 'BANK_STATEMENT_TO_RECONCILIATION_EXCEPTION',
    priority: 2,
    reached: 'RECONCILIATION_EXCEPTION',
    bankReceipt,
    bankLineage,
    payableReceipt,
    matched_pair: Object.freeze({
      bank_source_document_ref: bankStaging.source_record_id,
      business_source_document_ref: businessStaging.source_record_id,
      eligibility_status: eligibility.status,
      eligibility,
      contract_gap_fields: Object.freeze(['journal_no']),
      bank_account_join_note:
        'WBS_READONLY_ROW_FIELDS maps list_bank_transactions.bank_account_ref from account_code (a GL account) while list_payables carries cb_id (a cash book id). The harness joins on cb_id, which both rows do carry; a production run needs an approved REFS cash-book to GL-account map instead of this convention.',
      refs_review_state_fields: Object.freeze([
        'receipt_id',
        'account_before',
        'account_after',
        'review_event_id',
      ]),
    }),
    orphan_exception: orphanException,
    loan_draw: Object.freeze({
      expected_shape: WBS_E2E_RULES.LOAN_DRAW_V1.expected_shape,
      shape_ok: loanShapeOk,
      posted: false,
      draft: loanDraft,
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Scenario 3: cost GL -> CWIP cutoff                                  */
/* ------------------------------------------------------------------ */

export function runCostGlCwipScenario() {
  const tool = 'list_journal_entries';
  const scope = { company_key: FIXTURE_COMPANY_KEY, currency: 'USD' };
  const envelope = fixtureEnvelope(tool, COST_GL_ROWS);

  // 3a. Without a supplied member the subsidiary-ledger row must be refused.
  const withoutMember = buildLineageStage({ toolName: tool, envelope, scope, memberByKey: {} });

  // 3b. With the member supplied by the controller both rows reach evidence.
  const subsidiaryKey = fixtureStableKey(tool, COST_GL_ROWS[1]);
  const withMember = buildLineageStage({
    toolName: tool,
    envelope,
    scope,
    memberByKey: { [subsidiaryKey]: 'CO-B' },
  });

  // 3c. CWIP cutoff review over the ledger evidence.
  const findings = [];
  for (const record of withMember.mapped.evidence) {
    const normalized = record.normalized;
    if (normalized.account_code !== '164400') continue;
    const completion = PROJECT_COMPLETION[normalized.project_code];
    if (!completion) {
      findings.push({
        code: 'WBS_E2E_CWIP_COMPLETION_DATE_UNKNOWN',
        message: 'No approved project completion date exists, so the CWIP cutoff cannot be evaluated.',
        stable_key: record.stable_key,
        project_code: normalized.project_code,
      });
      continue;
    }
    if (normalized.accounting_date > completion) {
      findings.push({
        code: 'WBS_E2E_CWIP_POST_COMPLETION_CUTOFF',
        message:
          'WBS ledger evidence capitalises cost to CWIP after the approved project completion date. A controller must decide capitalise-vs-expense; the harness never creates the reclass.',
        stable_key: record.stable_key,
        source_id: record.source_id,
        account_code: normalized.account_code,
        project_code: normalized.project_code,
        completion_date: completion,
        accounting_date: normalized.accounting_date,
        amount: formatMoney(parseMoney(normalized.debit_amount ?? 0, 'debtor')),
        can_create_draft: false,
        can_post: false,
      });
    }
  }

  // 3d. The list_journal_entries.id integer trap.
  const trapEnvelope = fixtureEnvelope(tool, [COST_GL_STRING_ID_TRAP_ROW]);
  const trapResult = buildLineageStage({ toolName: tool, envelope: trapEnvelope, scope, memberByKey: {} });

  return Object.freeze({
    scenario: 'COST_GL_TO_CWIP_CUTOFF',
    priority: 3,
    reached: 'EVIDENCE_SEAM_AND_CUTOFF_REVIEW',
    terminus_by_contract: 'EVIDENCE_SEAM',
    je_possible: false,
    je_impossible_reason:
      'list_journal_entries is LEDGER_EVIDENCE in the frozen catalog with terminus EVIDENCE_SEAM. It can never reach the standard JE request seam, so a CWIP reclass cannot originate from WBS ledger evidence. The reclass must originate from a REFS-posted journal and be corrected by reversal only.',
    without_member: Object.freeze({
      exception_codes: Object.freeze(withoutMember.mapped.exceptions.map(item => item.code)),
      exceptions: withoutMember.mapped.exceptions,
      evidence_count: withoutMember.mapped.evidence.length,
    }),
    with_member: Object.freeze({
      evidence_count: withMember.mapped.evidence.length,
      exception_count: withMember.mapped.exceptions.length,
      members: Object.freeze(withMember.mapped.evidence.map(record => record.member ?? null)),
    }),
    cutoff_findings: Object.freeze(findings),
    string_id_trap: Object.freeze({
      blocked: trapResult.mapped.blocked,
      exception_codes: Object.freeze(trapResult.mapped.exceptions.map(item => item.code)),
      upstream_codes: Object.freeze(
        trapResult.mapped.exceptions.map(item => item.detail?.upstream_code ?? null),
      ),
    }),
  });
}

/* ------------------------------------------------------------------ */
/* Reporting                                                           */
/* ------------------------------------------------------------------ */

const rule = char => char.repeat(78);
const head = title => `\n${rule('=')}\n${title}\n${rule('=')}`;
const sub = title => `\n${title}\n${rule('-')}`;

function printPayable(result, out) {
  out(head('SCENARIO 1 (priority 1) - WBS payable -> accrual JE -> GL -> TB -> BS / IS'));

  const receipt = result.receiptStage;
  out(sub('STAGE 1-2  WBS MCP read -> immutable receipt'));
  out(`  transport                : NOT EXERCISED (no provider, no credentials) - fixture envelope`);
  out(`  evidence class           : ${receipt.evidence_class}`);
  out(`  tool                     : ${receipt.tool}`);
  out(`  contract_version         : ${receipt.contract_version}`);
  out(`  environment              : ${receipt.environment}`);
  out(`  captured_at              : ${receipt.captured_at}`);
  out(`  source                   : ${JSON.stringify(receipt.source)}`);
  out(`  scope / company          : ${JSON.stringify(receipt.scope)} / ${receipt.requested_company_key}`);
  out(`  record_count             : ${receipt.record_count}`);
  out(`  content_sha256           : ${receipt.content_sha256}`);
  out(`  content hash verified    : ${receipt.content_hash_verified}`);
  out(`  currencies               : ${receipt.currencies.join(', ')}`);
  out(`  revision/CDC/tombstone   : ${receipt.has_revision_contract}/${receipt.has_cdc_contract}/${receipt.has_tombstone_contract} -> deletion may NOT be inferred`);

  const lineage = result.lineageStage;
  out(sub('STAGE 3     Raw -> Normalized -> Staging / Exception'));
  out(`  raw rows                 : ${lineage.raw_count}`);
  out(`  normalized rows          : ${lineage.normalized_count}`);
  out(`  staging items            : ${lineage.staging_count}`);
  out(`  mapping review candidates: ${lineage.mapping_review_count}`);
  out(`  standard JE seams        : ${lineage.je_request_seam_count}`);
  out(`  exceptions               : ${lineage.exception_count}`);
  for (const exception of lineage.exceptions) {
    out(`    - ${exception.code} row=${exception.scope.row_index} ${JSON.stringify(exception.detail)}`);
  }

  for (const item of result.items) {
    const { event, draft, command, workflow, stagingReview } = item;
    out(sub(`ITEM  ${event.wbs_source_document_ref}  (${event.normalized_description ?? ''})`));
    out(`  STAGE 4  staging review  : ${stagingReview.stage} by ${stagingReview.reviewed_by} [${stagingReview.evidence_class}, persistence=${stagingReview.persistence}]`);
    out(`           staging_item_id : ${event.staging_item_id}`);
    out(`           raw_event_id    : ${event.raw_event_id}`);
    out(`           source_document : ${event.source_document_id}`);
    out(`  STAGE 5  mapping version : ${event.mapping_version} (snapshot ${event.mapping_snapshot_id})`);
    out(`           rule version    : ${event.rule_id} ${event.rule_code} v${event.rule_version}`);
    out(`  STAGE 6  accounting event: ${event.event_id} type=${event.event_type} amount=${event.amount} ${event.currency}`);
    out(`  STAGE 7  suggested Draft : ${draft.journal.je_number} (${draft.posting_status}) date=${draft.journal.je_date}`);
    out('           account  member       account name                      debit         credit');
    for (const line of draft.journal.lines) {
      out(
        `           ${line.account_code}   ${String(line.member ?? '-').padEnd(12)} ${line.account_name.padEnd(32)} ${line.debit_amount.padStart(13)} ${line.credit_amount.padStart(14)}`,
      );
    }
    out(`           totals                                                    ${draft.total_debit.padStart(13)} ${draft.total_credit.padStart(14)}`);
    out(`           balanced on integer minor units (scale 1e-4): ${draft.balanced_exact} (${draft.total_debit_minor} == ${draft.total_credit_minor})`);
    out(`  STAGE 8  standard command: ${command.request_type} status=${command.status} kernel=${command.kernel_method} can_dispatch=${command.can_dispatch}`);
    out(`           production kernel: ${command.production_kernel} [${WBS_E2E_EVIDENCE_CLASS.UNVERIFIED_REQUIRES_PRODUCTION}]`);
    out(`  STAGE 8b controlled workflow [${WBS_E2E_EVIDENCE_CLASS.NON_PRODUCTION_EXECUTABLE_SPEC} - JEService + MemoryJEDatabase]`);
    for (const step of workflow.steps) {
      out(`           ${step.ok ? 'OK   ' : 'REFUSED'} ${step.step.padEnd(44)} ${step.code ?? step.posting_status ?? ''}`);
    }
    out(`           maker cannot approve : ${workflow.sod_maker_cannot_approve}`);
    out(`           approver cannot post : ${workflow.sod_approver_cannot_post}`);
    out(`           final status         : ${workflow.journal?.posting_status ?? 'NOT POSTED'}`);
  }

  out(sub('STAGE 9a  General ledger (posted lines only)'));
  out('  ledger_line_id                        account  je_number                     debit         credit  wbs source');
  for (const line of result.ledgerLines) {
    out(
      `  ${line.ledger_line_id.padEnd(36)} ${line.account_code}   ${String(line.je_number).padEnd(28)} ${line.debit_amount.padStart(13)} ${line.credit_amount.padStart(14)}  ${line.wbs_source_document_ref}`,
    );
  }

  const tb = result.trialBalance;
  out(sub(`STAGE 9b  Trial Balance  period ${tb.period_code} (${tb.period_start} .. ${tb.period_end})`));
  out('  account  account name                       period debit  period credit    ending balance');
  for (const row of tb.rows) {
    out(
      `  ${row.account_code}   ${row.account_name.padEnd(32)} ${row.period_debit.padStart(13)} ${row.period_credit.padStart(14)} ${row.display_balance.padStart(17)}`,
    );
  }
  out(`  TOTALS                                     ${tb.total_debit.padStart(13)} ${tb.total_credit.padStart(14)}`);
  out(`  trial balance ties exactly on integers: ${tb.balanced_exact}`);

  const bs = result.balanceSheet;
  out(sub('STAGE 9c  Balance Sheet (mirror of refs_get_financial_statements, migration 062)'));
  out('  section            account  account name                        display balance');
  for (const row of bs.rows) {
    out(
      `  ${row.statement_section.padEnd(18)} ${row.account_code}   ${row.account_name.padEnd(32)} ${row.display_balance.padStart(16)}`,
    );
  }
  out(`  ASSETS                                                             ${bs.sections.ASSETS.padStart(16)}`);
  out(`  LIABILITIES                                                        ${bs.sections.LIABILITIES.padStart(16)}`);
  out(`  EQUITY                                                             ${bs.sections.EQUITY.padStart(16)}`);
  out(`  CURRENT_EARNINGS                                                   ${bs.sections.CURRENT_EARNINGS.padStart(16)}`);
  out(`  assets == liabilities + equity + current earnings : ${bs.tied_exact}`);

  const is = result.incomeStatement;
  out(sub('STAGE 9d  Income Statement (period movement)'));
  out('  section            account  account name                        display balance');
  for (const row of is.rows) {
    out(
      `  ${row.statement_section.padEnd(18)} ${row.account_code}   ${row.account_name.padEnd(32)} ${row.display_balance.padStart(16)}`,
    );
  }
  out(`  total revenue                                                      ${is.total_revenue.padStart(16)}`);
  out(`  total expenses                                                     ${is.total_expenses.padStart(16)}`);
  out(`  net income                                                         ${is.net_income.padStart(16)}`);

  out(sub('STAGE 10  Audit lineage back to the originating WBS row'));
  for (const trace of result.traces) {
    const source = trace.hops[0];
    out(`  --- ${source.row?.ap_guid ?? '(row)'} ---  reverse lookup ok: ${trace.reverse_lookup_ok}`);
    for (const hop of trace.hops) {
      const detail =
        hop.level === 'WBS_SOURCE_ROW'
          ? `row_index=${hop.row_index} row_content_hash=${hop.row_content_hash}`
          : hop.level === 'IMMUTABLE_RECEIPT'
            ? `sha256=${hop.envelope_content_sha256} verified=${hop.content_hash_verified}`
            : hop.level === 'NORMALIZED'
              ? `${hop.source_id} version=${hop.source_version}`
              : hop.level === 'STAGING_REVIEWED'
                ? `${hop.staging_item_id} (${hop.persistence})`
                : hop.level === 'ACCOUNTING_EVENT'
                  ? `${hop.event_id} rule=${hop.rule_id}@${hop.rule_version} mapping=${hop.mapping_version}`
                  : hop.level === 'POSTED_JOURNAL'
                    ? `${hop.je_number} ${hop.posting_status} maker=${hop.created_by} approver=${hop.approver} poster=${hop.posted_by}`
                    : hop.level === 'LEDGER_LINES'
                      ? `${hop.ledger_line_ids.length} lines on ${hop.accounts.join(', ')}`
                      : hop.rows.map(row => `${row.account_code}=${row.display_balance}`).join('  ');
      out(`    hop ${hop.hop}  ${hop.level.padEnd(20)} ${detail}`);
    }
  }
}

function printBank(result, out) {
  out(head('SCENARIO 2 (priority 2) - WBS bank statement -> reconciliation exception'));
  out(sub('2a  Matched candidate through the repository eligibility gate'));
  const pair = result.matched_pair;
  out(`  bank source              : ${pair.bank_source_document_ref}`);
  out(`  business source          : ${pair.business_source_document_ref}`);
  out(`  eligibility status       : ${pair.eligibility_status}`);
  for (const exception of pair.eligibility.exceptions) {
    out(`    ${exception.side.padEnd(14)} ${exception.code}`);
    out(`      missing: ${exception.missing.join(', ')}`);
  }
  out(`  FROZEN CONTRACT GAP      : ${pair.contract_gap_fields.join(', ')} is required by the gate but is not in WBS_READONLY_ROW_FIELDS.list_bank_transactions`);
  out(`  REFS review-state gap    : ${pair.refs_review_state_fields.join(', ')} are produced by REFS review persistence, not by WBS`);
  out(`  bank account join        : ${pair.bank_account_join_note}`);
  out('  Result: the pair is BLOCKED. No auto-match, no allocation, no Draft, no post.');

  out(sub('2b  Bank line with no business counterpart'));
  const orphan = result.orphan_exception;
  out(`  ${orphan.code}`);
  out(`  bank source              : ${orphan.detail.bank_source_document_ref}  payee_no=${orphan.detail.payee_no}  amount=${orphan.detail.amount}`);
  out(`  can_create_draft/post    : ${orphan.can_create_draft}/${orphan.can_post}`);

  out(sub('2c  Loan draw red line'));
  out(`  expected shape           : ${result.loan_draw.expected_shape}`);
  for (const line of result.loan_draw.draft.journal.lines) {
    out(`    ${line.account_code} ${line.account_name.padEnd(24)} class=${line.account_class.padEnd(10)} Dr ${line.debit_amount.padStart(13)}  Cr ${line.credit_amount.padStart(13)}`);
  }
  out(`  shape holds, never a cost: ${result.loan_draw.shape_ok}   posted: ${result.loan_draw.posted}`);
}

function printCostGl(result, out) {
  out(head('SCENARIO 3 (priority 3) - WBS cost GL -> CWIP cutoff'));
  out(sub('3a  Subsidiary-ledger member is mandatory'));
  out(`  exceptions without member: ${result.without_member.exception_codes.join(', ') || '(none)'}`);
  for (const exception of result.without_member.exceptions) {
    out(`    ${exception.code} ${JSON.stringify(exception.detail)}`);
  }
  out(sub('3b  With the controller-supplied member'));
  out(`  evidence records         : ${result.with_member.evidence_count}`);
  out(`  members carried          : ${JSON.stringify(result.with_member.members)}`);
  out(`  exceptions               : ${result.with_member.exception_count}`);

  out(sub('3c  CWIP cutoff review'));
  out(`  terminus by frozen catalog: ${result.terminus_by_contract}`);
  out(`  JE possible from this source: ${result.je_possible}`);
  out(`  reason: ${result.je_impossible_reason}`);
  for (const finding of result.cutoff_findings) {
    out(`    ${finding.code}`);
    out(`      account=${finding.account_code} project=${finding.project_code} completed=${finding.completion_date} posted=${finding.accounting_date} amount=${finding.amount}`);
  }

  out(sub('3d  list_journal_entries.id integer trap'));
  out(`  string id blocked        : ${result.string_id_trap.blocked}`);
  out(`  exception codes          : ${result.string_id_trap.exception_codes.join(', ')}`);
  out(`  upstream frozen codes    : ${result.string_id_trap.upstream_codes.join(', ')}`);
}

function printSummary(results, out) {
  out(head('SUMMARY - how far each scenario actually got'));
  out('  scenario                                    reached');
  for (const result of results) {
    out(`  ${result.scenario.padEnd(43)} ${result.reached}`);
  }
  out(sub('Evidence classes present in this run'));
  out(`  ${WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE}      : frozen contract + sanitized fixture rows`);
  out(`  ${WBS_E2E_EVIDENCE_CLASS.NON_PRODUCTION_EXECUTABLE_SPEC} : JEService/MemoryJEDatabase, simulated REFS persistence`);
  out(`  ${WBS_E2E_EVIDENCE_CLASS.UNVERIFIED_REQUIRES_PRODUCTION}: WBS transport, PostgresAccountingKernel, refs_get_financial_statements`);
  out('\n  THIS IS NOT A PRODUCTION PASS. See docs/WBS-END-TO-END-EVIDENCE.md.');
}

export function runAllScenarios(options = {}) {
  return {
    payable: runPayableAccrualScenario(options),
    bank: runBankReconciliationScenario(options),
    costgl: runCostGlCwipScenario(options),
  };
}

function main(argv) {
  const json = argv.includes('--json');
  const selected = argv.filter(arg => !arg.startsWith('--'));
  const wanted = selected.length ? selected : ['payable', 'bank', 'costgl'];
  const lines = [];
  const out = line => lines.push(line);
  const results = [];

  try {
    if (wanted.includes('payable')) {
      const result = runPayableAccrualScenario();
      results.push(result);
      if (!json) printPayable(result, out);
    }
    if (wanted.includes('bank')) {
      const result = runBankReconciliationScenario();
      results.push(result);
      if (!json) printBank(result, out);
    }
    if (wanted.includes('costgl')) {
      const result = runCostGlCwipScenario();
      results.push(result);
      if (!json) printCostGl(result, out);
    }
  } catch (error) {
    if (error instanceof WbsE2eError) {
      console.error(`CHAIN BROKE: ${error.code} - ${error.message}`);
      if (error.detail) console.error(JSON.stringify(error.detail, null, 2));
      return 1;
    }
    throw error;
  }

  if (json) {
    console.log(
      JSON.stringify(
        results.map(result => ({ scenario: result.scenario, reached: result.reached })),
        null,
        2,
      ),
    );
    return 0;
  }

  printSummary(results, out);
  console.log(lines.join('\n'));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = main(process.argv.slice(2));
}
