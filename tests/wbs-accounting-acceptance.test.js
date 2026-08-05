import { readFileSync } from 'node:fs';
import {
  ACCOUNT_MAP,
  WBS_MCP_CONTRACTS,
  approveAndPostSuggestedJEs,
  buildAccountingEvents,
  buildTrialBalance,
  createAmortizationScheduleFromInsurance,
  createWbsMockConnector,
  createWbsMockDataset,
  projectToGeneralLedger,
  runDeterministicAccountingRules,
} from '../src/wbs-accounting-foundation.js';
import { buildWbsBankReconciliationEvidence } from '../src/wbs-bank-reconciliation-evidence.js';
import { buildWbsEndToEndFlowEvidence } from '../src/wbs-e2e-flow-evidence.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const byRule = (findings, ruleId) => findings.find(finding => finding.rule_id === ruleId);
const sum = rows => Math.round(rows.reduce((total, row) => total + Number(row.amount || 0), 0) * 100) / 100;
const debit = je => je.lines.reduce((total, line) => total + Number(line.debit_amount || 0), 0);
const credit = je => je.lines.reduce((total, line) => total + Number(line.credit_amount || 0), 0);
const balanced = je => Math.abs(debit(je) - credit(je)) < 0.005;

async function main() {
  const dataset = createWbsMockDataset();
  const connector = createWbsMockConnector(dataset);
  const snapshot = await connector.fetchSnapshot();

  assert(connector.mode === 'WBS_MOCK_CONNECTOR', 'acceptance 1/16: mock WBS connector must identify itself');
  assert(snapshot !== dataset && snapshot.payableInvoices.length && snapshot.bankTransactions.length && snapshot.sourceDocuments.length, 'acceptance 1/16: mock WBS data must load as an isolated snapshot');

  const events = buildAccountingEvents(snapshot);
  assert(events.length >= 10, 'acceptance 2/16: source transactions must convert into accounting events');
  events.forEach(event => {
    ['event_id', 'event_type', 'source_transaction_id', 'entity_id', 'project_id', 'property_id', 'amount', 'accounting_period', 'suggested_debit_account', 'suggested_credit_account', 'rule_id', 'reason'].forEach(field => {
      assert(field in event, `acceptance 2/16: event ${event.event_id} missing ${field}`);
    });
  });

  const findings = runDeterministicAccountingRules(snapshot, events);
  assert(findings.length >= 10, 'acceptance 3/16: deterministic rules must generate AI findings');
  [
    'PREPAID_SCHEDULE_REQUIRED',
    'LOAN_DRAW_RECOGNITION',
    'DUPLICATE_INVOICE_RISK',
    'PAYMENT_WITHOUT_BILL',
    'ACCRUAL_CANDIDATE',
    'MISSING_SOURCE_DOCUMENT',
    'RENT_ROLL_REVENUE_MISMATCH',
  ].forEach(ruleId => assert(byRule(findings, ruleId), `acceptance 3/16: missing finding ${ruleId}`));

  findings.forEach(finding => {
    assert(finding.reason && finding.suggested_action && Number(finding.confidence_score) > 0 && finding.owner && finding.due_date, `acceptance 14/16: finding ${finding.finding_id} missing reason/action/confidence/owner/due date`);
    assert(Array.isArray(finding.audit_trail) && finding.audit_trail.length > 0, `acceptance 15/16: finding ${finding.finding_id} must keep audit trail`);
  });

  const suggestedJEs = findings.map(finding => finding.suggested_je).filter(Boolean);
  assert(suggestedJEs.length >= 8, 'acceptance 4/16: rule engine must generate suggested JEs');
  suggestedJEs.forEach(je => {
    assert(balanced(je), `acceptance 5/16: ${je.je_id} debit must equal credit`);
    assert(je.source_document_id, `acceptance 5/16: ${je.je_id} must retain source reference`);
    assert(Array.isArray(je.audit_trail) && je.audit_trail.length > 0, `acceptance 15/16: ${je.je_id} must keep audit trail`);
  });

  const loanSuggested = suggestedJEs.find(je => je.ai_rule_id === 'LOAN_DRAW_RECOGNITION');
  assert(loanSuggested?.lines.some(line => line.account_code === ACCOUNT_MAP.cash && Number(line.debit_amount) > 0), 'acceptance 10/16: loan draw JE must debit cash');
  assert(loanSuggested?.lines.some(line => line.account_code === ACCOUNT_MAP.loanPayable && Number(line.credit_amount) > 0), 'acceptance 10/16: loan draw JE must credit loan payable');

  const postedLoan = approveAndPostSuggestedJEs({ suggestedJEs: [loanSuggested], periods: snapshot.accountingPeriods })[0];
  assert(postedLoan.posting_status === 'POSTED', 'acceptance 6/16: source-backed balanced suggested JE can approve/post');
  assert(postedLoan.audit_trail.some(entry => entry.action === 'approved') && postedLoan.audit_trail.some(entry => entry.action === 'posted'), 'acceptance 15/16: post action must add approval/post audit trail');

  const missingSourceBlocked = approveAndPostSuggestedJEs({ suggestedJEs: [{ ...loanSuggested, source_document_id: null }], periods: snapshot.accountingPeriods })[0];
  assert(missingSourceBlocked.posting_status === 'BLOCKED' && /source/i.test(missingSourceBlocked.block_reason), 'acceptance 5/16: missing source document blocks posting');
  const closedPeriodBlocked = approveAndPostSuggestedJEs({ suggestedJEs: [{ ...loanSuggested, accounting_period: '2026-06', je_date: '2026-06-28' }], periods: snapshot.accountingPeriods })[0];
  assert(closedPeriodBlocked.posting_status === 'BLOCKED' && /closed/i.test(closedPeriodBlocked.block_reason), 'acceptance 5/16: closed period blocks posting');

  const glLines = projectToGeneralLedger([...snapshot.journalEntries, postedLoan]);
  assert(glLines.some(line => line.je_id === postedLoan.je_id), 'acceptance 7/16: posted JE must flow into GL');
  const tb = buildTrialBalance(glLines);
  assert(tb.balanced && tb.total_debit === tb.total_credit, 'acceptance 8/16: Trial Balance must be generated from posted JE and balance');

  const insuranceInvoice = snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO');
  const amortization = createAmortizationScheduleFromInsurance(insuranceInvoice);
  assert(amortization.lines.length === 12 && sum(amortization.lines) === insuranceInvoice.amount, 'acceptance 9/16: 12-month insurance payment must generate a 12-line amortization schedule tied to source amount');
  amortization.lines.forEach(line => assert(balanced(line.suggested_je), `acceptance 9/16: amortization JE for ${line.period} must balance`));

  assert(byRule(findings, 'DUPLICATE_INVOICE_RISK')?.object_id === 'AP-DUP-02', 'acceptance 11/16: duplicate invoice must be identified');
  const bankEvidence = buildWbsBankReconciliationEvidence(snapshot);
  const unmatchedBank = bankEvidence.bankRows.find(row => row.bank_txn_id === 'BANK-UNMATCHED-01');
  assert(unmatchedBank?.suggested_queue === 'MISSING_AP_EXCEPTION' && unmatchedBank.can_auto_match === false && unmatchedBank.can_post === false, 'acceptance 12/16: unmatched bank transaction must enter exception and stay no-mutation');

  const aiAuditSource = readFileSync('src/module-aiaudit.jsx', 'utf8');
  assert(aiAuditSource.includes('runDeterministicAccountingRules(snapshot, events)') && aiAuditSource.includes('buildWbsEndToEndFlowEvidence(snapshot)'), 'acceptance 13/16: AI Audit Center must display rule results from real mock pipeline functions');

  const e2e = buildWbsEndToEndFlowEvidence(snapshot);
  assert(e2e.controls.total_flows === 10 && e2e.allFlowsTraceable, 'acceptance 13/16: AI Audit flow evidence must cover all 10 source-to-report workflows with trace');
  ['PAYABLE_TO_ACCRUAL', 'BANK_TO_EXCEPTION', 'LOAN_DRAW_TO_REPORTS', 'INSURANCE_TO_AMORTIZATION', 'SOURCE_TO_TB', 'TB_TO_STATEMENTS', 'GL_TO_AI_ANALYSIS'].forEach(id => {
    const row = e2e.flows.find(flow => flow.id === id);
    assert(row?.source_id && row.event_id && row.audit_trail_count > 0, `acceptance 13/16: E2E flow ${id} must retain source, event and audit`);
  });

  ['PayableInvoice', 'BankTransaction', 'SourceDocument', 'JournalEntry', 'JournalEntryLine', 'AIFinding', 'AIRuleResult'].forEach(contractName => {
    assert(WBS_MCP_CONTRACTS[contractName]?.includes('external_source_id') && WBS_MCP_CONTRACTS[contractName]?.includes('audit_trail_id'), `acceptance 16/16: ${contractName} contract must remain adapter-ready`);
  });
  const invoices = await connector.fetchCollection('payableInvoices');
  invoices[0].amount = 1;
  const invoicesAgain = await connector.fetchCollection('payableInvoices');
  assert(invoicesAgain[0].amount === snapshot.payableInvoices[0].amount, 'acceptance 16/16: connector must return replaceable isolated contract snapshots');

  console.log('wbs-accounting-acceptance: 16/16 mock accounting acceptance requirements verified');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
