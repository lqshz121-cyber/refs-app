import test from 'node:test';
import assert from 'node:assert/strict';

import {
  WBS_E2E_EVIDENCE_CLASS,
  WBS_E2E_RULES,
  WbsE2eError,
  accountClass,
  buildImmutableReceipt,
  buildSuggestedDraftJournal,
  formatMoney,
  parseMoney,
  simulatePersistedReviewedStaging,
} from '../runtime/wbs-accounting-e2e.mjs';
import {
  runAllScenarios,
  runBankReconciliationScenario,
  runCostGlCwipScenario,
  runPayableAccrualScenario,
} from '../tools/wbs-e2e-harness.mjs';
import {
  FIXTURE_COMPANY_KEY,
  PAYABLE_ROWS,
  fixtureEnvelope,
} from '../tools/wbs-e2e-fixtures.mjs';

/* ------------------------------------------------------------------ */
/* Fixed-point money                                                   */
/* ------------------------------------------------------------------ */

test('money parses and renders at four fixed decimal places', () => {
  assert.equal(formatMoney(parseMoney('1250.5')), '1250.5000');
  assert.equal(formatMoney(parseMoney(1250.5)), '1250.5000');
  assert.equal(formatMoney(parseMoney('0')), '0.0000');
  assert.equal(formatMoney(parseMoney('-84200.75')), '-84200.7500');
  assert.equal(formatMoney(parseMoney('0.0001')), '0.0001');
});

const throwsCode = (fn, code) =>
  assert.throws(fn, error => error instanceof WbsE2eError && error.code === code, `expected ${code}`);

test('money refuses precision it cannot represent instead of rounding', () => {
  throwsCode(() => parseMoney('1.000005'), 'WBS_E2E_AMOUNT_PRECISION_UNSUPPORTED');
  throwsCode(() => parseMoney(1e21), 'WBS_E2E_AMOUNT_PRECISION_UNSUPPORTED');
  throwsCode(() => parseMoney(Number.NaN), 'WBS_E2E_AMOUNT_INVALID');
  throwsCode(() => parseMoney(null), 'WBS_E2E_AMOUNT_INVALID');
});

test('money accumulation is exact where floating point is not', () => {
  const floatSum = 0.1 + 0.2;
  assert.notEqual(floatSum, 0.3);
  const exact = parseMoney('0.1') + parseMoney('0.2');
  assert.equal(exact, parseMoney('0.3'));
  assert.equal(formatMoney(exact), '0.3000');
  let total = 0n;
  for (let index = 0; index < 1000; index += 1) total += parseMoney('0.0001');
  assert.equal(formatMoney(total), '0.1000');
});

/* ------------------------------------------------------------------ */
/* Receipt                                                             */
/* ------------------------------------------------------------------ */

test('the receipt verifies hash, source, version, company and currency', () => {
  const envelope = fixtureEnvelope('list_payables', PAYABLE_ROWS);
  const receipt = buildImmutableReceipt({
    toolName: 'list_payables',
    envelope,
    scope: { company_key: FIXTURE_COMPANY_KEY, currency: 'USD' },
  });
  assert.equal(receipt.evidence_class, WBS_E2E_EVIDENCE_CLASS.CONTRACT_PLUS_FIXTURE);
  assert.equal(receipt.content_hash_verified, true);
  assert.equal(receipt.content_sha256, receipt.content_sha256_recomputed);
  assert.equal(receipt.environment, 'production');
  assert.equal(receipt.contract_version, 'WBS-REFS-MCP-V1');
  assert.deepEqual(receipt.currencies, ['USD']);
  assert.equal(receipt.record_count, PAYABLE_ROWS.length);
});

test('a tampered row is rejected by the frozen envelope validator', () => {
  const envelope = fixtureEnvelope('list_payables', PAYABLE_ROWS);
  const tampered = { ...envelope, rows: [{ ...PAYABLE_ROWS[0], amount: 9999.99 }, ...PAYABLE_ROWS.slice(1)] };
  assert.throws(
    () => buildImmutableReceipt({ toolName: 'list_payables', envelope: tampered }),
    error => error.code === 'WBS_MCP_CONTENT_HASH_MISMATCH',
  );
});

test('the receipt refuses to imply deletion without a CDC or tombstone contract', () => {
  const receipt = buildImmutableReceipt({
    toolName: 'list_payables',
    envelope: fixtureEnvelope('list_payables', PAYABLE_ROWS),
  });
  assert.equal(receipt.has_revision_contract, false);
  assert.equal(receipt.has_cdc_contract, false);
  assert.equal(receipt.has_tombstone_contract, false);
  assert.equal(receipt.requires_snapshot_diff, true);
  assert.equal(receipt.deletion_inference_permitted, false);
});

/* ------------------------------------------------------------------ */
/* Persistence gap is explicit, never silent                           */
/* ------------------------------------------------------------------ */

test('staging persistence refuses to simulate unless the caller opts in', () => {
  const result = runPayableAccrualScenario();
  const stagingItem = result.lineageStage.mapped.staging[0];
  assert.throws(
    () => simulatePersistedReviewedStaging({ stagingItem, reviewedBy: 'x', reviewedAt: 'y' }),
    error =>
      error instanceof WbsE2eError &&
      error.code === 'WBS_E2E_PERSISTENCE_UNAVAILABLE' &&
      error.detail.required_command === 'persistWbsInboundRows',
  );
});

/* ------------------------------------------------------------------ */
/* Scenario 1: payable -> accrual -> post -> TB / BS / IS              */
/* ------------------------------------------------------------------ */

const payable = runPayableAccrualScenario();

test('payable lineage splits staging from exception without inference', () => {
  assert.equal(payable.lineageStage.raw_count, 3);
  assert.equal(payable.lineageStage.normalized_count, 3);
  assert.equal(payable.lineageStage.staging_count, 2);
  assert.equal(payable.lineageStage.exception_count, 1);
  assert.equal(payable.lineageStage.exceptions[0].code, 'WBS_LINEAGE_SCHEMA_INVALID');
  assert.deepEqual(payable.lineageStage.exceptions[0].detail.missing, ['nonzero_amount']);
  assert.equal(payable.lineageStage.mapped.can_post, false);
});

test('every suggested Draft is exactly balanced on integer minor units', () => {
  assert.equal(payable.items.length, 2);
  for (const item of payable.items) {
    assert.equal(item.draft.balanced_exact, true);
    assert.equal(item.draft.total_debit_minor, item.draft.total_credit_minor);
    assert.equal(item.draft.posting_status, 'DRAFT');
    assert.equal(item.draft.can_post, false);
    const debit = item.draft.journal.lines.reduce((sum, line) => sum + BigInt(line.debit_minor), 0n);
    const credit = item.draft.journal.lines.reduce((sum, line) => sum + BigInt(line.credit_minor), 0n);
    assert.equal(debit, credit);
    assert.ok(debit > 0n);
  }
});

test('the payable accrual Draft is Dr mapped cost / Cr accounts payable', () => {
  const first = payable.items.find(item => item.event.wbs_source_document_ref === 'AP-GUID-0001');
  assert.deepEqual(
    first.draft.journal.lines.map(line => [line.account_code, line.debit_amount, line.credit_amount]),
    [
      ['610900', '1250.5000', '0.0000'],
      ['220100', '0.0000', '1250.5000'],
    ],
  );
  const second = payable.items.find(item => item.event.wbs_source_document_ref === 'AP-GUID-0002');
  assert.deepEqual(
    second.draft.journal.lines.map(line => [line.account_code, line.debit_amount, line.credit_amount]),
    [
      ['164400', '84200.7500', '0.0000'],
      ['220100', '0.0000', '84200.7500'],
    ],
  );
});

test('every journal line uses a six-digit account', () => {
  for (const item of payable.items) {
    for (const line of item.draft.journal.lines) {
      assert.match(line.account_code, /^\d{6}$/);
    }
  }
});

test('the Draft carries its mapping version and its rule version', () => {
  for (const item of payable.items) {
    assert.equal(item.event.mapping_version, 'WBS-REFS-MAPPING-2026-08-A');
    assert.equal(item.event.rule_id, 'AP_ACCRUAL_V1');
    assert.equal(item.event.rule_version, '1.0.0');
    assert.equal(item.draft.journal.mapping_used.mapping_version, item.event.mapping_version);
    assert.equal(item.draft.journal.setting_used.rule_version, item.event.rule_version);
  }
});

test('the standard JE command seam is the repository builder and never dispatches', () => {
  for (const item of payable.items) {
    assert.equal(item.command.request_type, 'STANDARD_AUTO_JOURNAL_REQUEST');
    assert.equal(item.command.status, 'READY_FOR_STANDARD_JE_COMMAND');
    assert.equal(item.command.kernel_method, 'createAutoJournal');
    assert.equal(item.command.can_dispatch, false);
    assert.equal(item.command.can_post, false);
  }
});

test('Draft -> Review -> Approve -> Post runs with segregation of duties enforced', () => {
  for (const item of payable.items) {
    assert.equal(item.workflow.ok, true);
    assert.equal(item.workflow.journal.posting_status, 'POSTED');
    assert.equal(item.workflow.sod_maker_cannot_approve, true);
    assert.equal(item.workflow.sod_approver_cannot_post, true);
    const refusals = item.workflow.steps.filter(step => !step.ok).map(step => step.code);
    assert.deepEqual(refusals, ['JE_SOD_MAKER', 'JE_SOD_APPROVER_POSTER']);
    assert.notEqual(item.workflow.journal.created_by, item.workflow.journal.approver);
    assert.notEqual(item.workflow.journal.approver, item.workflow.journal.posted_by);
    assert.notEqual(item.workflow.journal.created_by, item.workflow.journal.posted_by);
  }
});

test('trial balance ties exactly and carries the WBS source on every account', () => {
  const tb = payable.trialBalance;
  assert.equal(tb.balanced_exact, true);
  assert.equal(tb.total_debit, '85451.2500');
  assert.equal(tb.total_credit, '85451.2500');
  assert.deepEqual(
    tb.rows.map(row => [row.account_code, row.display_balance]),
    [
      ['164400', '84200.7500'],
      ['220100', '-85451.2500'],
      ['610900', '1250.5000'],
    ],
  );
  for (const row of tb.rows) {
    assert.ok(row.wbs_source_document_refs.length > 0);
  }
});

test('balance sheet ties and mirrors the migration 062 section rule', () => {
  const bs = payable.balanceSheet;
  assert.equal(bs.tied_exact, true);
  assert.equal(bs.sections.ASSETS, '84200.7500');
  assert.equal(bs.sections.LIABILITIES, '85451.2500');
  assert.equal(bs.sections.EQUITY, '0.0000');
  assert.equal(bs.sections.CURRENT_EARNINGS, '-1250.5000');
  assert.equal(bs.total_assets, bs.total_liabilities_equity_and_earnings);
  const cwip = bs.rows.find(row => row.account_code === '164400');
  assert.equal(cwip.statement_section, 'ASSETS');
  const expense = bs.rows.find(row => row.account_code === '610900');
  assert.equal(expense.statement_section, 'CURRENT_EARNINGS');
});

test('income statement shows only the period movement of revenue and expense', () => {
  const is = payable.incomeStatement;
  assert.equal(is.total_revenue, '0.0000');
  assert.equal(is.total_expenses, '1250.5000');
  assert.equal(is.net_income, '-1250.5000');
  assert.deepEqual(
    is.rows.map(row => [row.statement_section, row.account_code, row.display_balance]),
    [['EXPENSES', '610900', '1250.5000']],
  );
  // The CWIP capitalisation is an asset and must never appear in the P&L.
  assert.equal(is.rows.some(row => row.account_code === '164400'), false);
});

test('audit lineage walks back from the statement to the exact WBS row', () => {
  assert.equal(payable.traces.length, 2);
  for (const trace of payable.traces) {
    assert.equal(trace.reverse_lookup_ok, true);
    assert.equal(trace.hops.length, 8);
    assert.deepEqual(
      trace.hops.map(hop => hop.level),
      [
        'WBS_SOURCE_ROW',
        'IMMUTABLE_RECEIPT',
        'NORMALIZED',
        'STAGING_REVIEWED',
        'ACCOUNTING_EVENT',
        'POSTED_JOURNAL',
        'LEDGER_LINES',
        'TRIAL_BALANCE',
      ],
    );
    assert.equal(trace.hops[1].content_hash_verified, true);
    assert.equal(trace.hops[3].persistence, 'IN_PROCESS_SIMULATED');
    assert.equal(trace.hops[5].posting_status, 'POSTED');
  }
  const first = payable.traces.find(trace => trace.hops[0].row.ap_guid === 'AP-GUID-0001');
  assert.ok(first);
  assert.equal(first.hops[0].source_module, 'BGDATA.payable');
  assert.equal(first.hops[2].source_id, 'BGDATA.payable:AP-GUID-0001');
});

test('replay from zero is deterministic', () => {
  const again = runPayableAccrualScenario();
  assert.deepEqual(
    again.items.map(item => item.event.event_id),
    payable.items.map(item => item.event.event_id),
  );
  assert.deepEqual(
    again.ledgerLines.map(line => line.ledger_line_id),
    payable.ledgerLines.map(line => line.ledger_line_id),
  );
  assert.equal(again.trialBalance.total_debit, payable.trialBalance.total_debit);
  assert.equal(again.receiptStage.content_sha256, payable.receiptStage.content_sha256);
});

/* ------------------------------------------------------------------ */
/* Accounting red lines                                                */
/* ------------------------------------------------------------------ */

const sampleEvent = payable.items[0].event;

test('a journal line refuses an account that is not six digits or not mastered', () => {
  assert.throws(
    () =>
      buildSuggestedDraftJournal({
        event: { ...sampleEvent, mapped_account_code: '61090' },
        rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
        periodCode: '2026-07',
        journalNumber: 'X',
      }),
    error => ['WBS_E2E_MAPPING_MISSING', 'WBS_E2E_ACCOUNT_NOT_SIX_DIGIT'].includes(error.code),
  );
  assert.throws(
    () =>
      buildSuggestedDraftJournal({
        event: { ...sampleEvent, mapped_account_code: '619999' },
        rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
        periodCode: '2026-07',
        journalNumber: 'X',
      }),
    error => error.code === 'WBS_E2E_ACCOUNT_UNKNOWN',
  );
});

test('a subsidiary-ledger line without a member is refused', () => {
  assert.throws(
    () =>
      buildSuggestedDraftJournal({
        event: { ...sampleEvent, mapped_account_code: '291001' },
        rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
        periodCode: '2026-07',
        journalNumber: 'X',
      }),
    error => error.code === 'WBS_E2E_MEMBER_REQUIRED',
  );
  const withMember = buildSuggestedDraftJournal({
    event: { ...sampleEvent, mapped_account_code: '291001' },
    rule: WBS_E2E_RULES.AP_ACCRUAL_V1,
    member: 'CO-B',
    periodCode: '2026-07',
    journalNumber: 'X',
  });
  assert.equal(withMember.journal.lines[0].member, 'CO-B');
});

test('a loan draw can never be pointed at a cost account', () => {
  assert.throws(
    () =>
      buildSuggestedDraftJournal({
        event: sampleEvent,
        rule: { ...WBS_E2E_RULES.LOAN_DRAW_V1, debit_account: '610900' },
        periodCode: '2026-07',
        journalNumber: 'X',
      }),
    error => error.code === 'WBS_E2E_LOAN_DRAW_SHAPE_VIOLATION',
  );
});

/* ------------------------------------------------------------------ */
/* Scenario 2: bank -> reconciliation exception                        */
/* ------------------------------------------------------------------ */

const bank = runBankReconciliationScenario();

test('the matched bank/business pair is blocked by the repository eligibility gate', () => {
  assert.equal(bank.matched_pair.eligibility_status, 'BLOCKED');
  assert.equal(bank.matched_pair.eligibility.can_create_draft, false);
  assert.equal(bank.matched_pair.eligibility.can_post, false);
  const bankSide = bank.matched_pair.eligibility.exceptions.find(item => item.side === 'BANK_SIDE');
  assert.equal(bankSide.code, 'WBS_AUTOREC_ELIGIBILITY_TRACE_REQUIRED');
  // journal_no is required by the gate and is absent from the frozen contract.
  assert.ok(bankSide.missing.includes('journal_no'));
  for (const field of ['account_before', 'account_after', 'review_event_id']) {
    assert.ok(bankSide.missing.includes(field));
  }
});

test('a bank line with no business counterpart becomes a retained exception', () => {
  assert.equal(bank.orphan_exception.code, 'WBS_E2E_BANK_NO_BUSINESS_COUNTERPART');
  assert.equal(bank.orphan_exception.can_create_draft, false);
  assert.equal(bank.orphan_exception.can_post, false);
  assert.equal(bank.orphan_exception.detail.bank_source_document_ref, 'SYS-BANK-0002');
  assert.equal(bank.orphan_exception.detail.amount, '4400.0000');
});

test('a construction loan draw stays Dr Cash / Cr Loan Payable and is not posted', () => {
  assert.equal(bank.loan_draw.shape_ok, true);
  assert.equal(bank.loan_draw.posted, false);
  const [debit, credit] = bank.loan_draw.draft.journal.lines;
  assert.equal(debit.account_code, '111000');
  assert.equal(accountClass(debit.account_code), 'ASSET');
  assert.equal(credit.account_code, '211000');
  assert.equal(accountClass(credit.account_code), 'LIABILITY');
  assert.equal(debit.debit_amount, '500000.0000');
  assert.equal(credit.credit_amount, '500000.0000');
});

/* ------------------------------------------------------------------ */
/* Scenario 3: cost GL -> CWIP cutoff                                  */
/* ------------------------------------------------------------------ */

const costgl = runCostGlCwipScenario();

test('WBS ledger evidence terminates at the evidence seam and can never post', () => {
  assert.equal(costgl.terminus_by_contract, 'EVIDENCE_SEAM');
  assert.equal(costgl.je_possible, false);
  assert.match(costgl.je_impossible_reason, /LEDGER_EVIDENCE/);
});

test('a subsidiary-ledger evidence row without a member is refused', () => {
  assert.deepEqual(costgl.without_member.exception_codes, ['WBS_LINEAGE_TRACE_INCOMPLETE']);
  assert.equal(costgl.without_member.evidence_count, 1);
  assert.equal(costgl.with_member.evidence_count, 2);
  assert.equal(costgl.with_member.exception_count, 0);
  assert.deepEqual(costgl.with_member.members, [null, 'CO-B']);
});

test('CWIP capitalised after project completion raises a cutoff review', () => {
  assert.equal(costgl.cutoff_findings.length, 1);
  const [finding] = costgl.cutoff_findings;
  assert.equal(finding.code, 'WBS_E2E_CWIP_POST_COMPLETION_CUTOFF');
  assert.equal(finding.account_code, '164400');
  assert.equal(finding.completion_date, '2026-06-30');
  assert.equal(finding.accounting_date, '2026-07-31');
  assert.equal(finding.amount, '61000.0000');
  assert.equal(finding.can_create_draft, false);
  assert.equal(finding.can_post, false);
});

test('a string list_journal_entries.id is rejected by the frozen contract', () => {
  assert.equal(costgl.string_id_trap.blocked, true);
  assert.deepEqual(costgl.string_id_trap.exception_codes, ['WBS_LINEAGE_SCHEMA_INVALID']);
  assert.deepEqual(costgl.string_id_trap.upstream_codes, ['WBS_MCP_ENVELOPE_INVALID']);
});

/* ------------------------------------------------------------------ */
/* Whole-harness invariants                                            */
/* ------------------------------------------------------------------ */

test('the harness reports how far each scenario actually reached', () => {
  const all = runAllScenarios();
  assert.equal(all.payable.reached, 'BALANCE_SHEET_AND_INCOME_STATEMENT');
  assert.equal(all.bank.reached, 'RECONCILIATION_EXCEPTION');
  assert.equal(all.costgl.reached, 'EVIDENCE_SEAM_AND_CUTOFF_REVIEW');
});

test('nothing in the chain claims WBS write authority', () => {
  for (const result of [payable.lineageStage.mapped, bank.bankLineage.mapped]) {
    assert.equal(result.read_only, true);
    assert.equal(result.can_write_wbs, false);
    assert.equal(result.can_create_draft, false);
    assert.equal(result.can_dispatch, false);
    assert.equal(result.can_post, false);
  }
});
