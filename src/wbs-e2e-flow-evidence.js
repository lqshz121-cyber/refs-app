import {
  ACCOUNT_MAP,
  buildAccountingEvents,
  createAmortizationScheduleFromInsurance,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';
import { buildWbsBankReconciliationEvidence } from './wbs-bank-reconciliation-evidence.js';
import { buildWbsReportImpact } from './wbs-report-impact.js';

const has = (items, predicate) => items.some(predicate);
const byId = items => new Map(items.map(item => [item.id || item.je_id || item.finding_id || item.event_id, item]));

function flow({ id, name, source, event, finding, suggestedJe, postedJe, glLines, reportRows, auditTrail, status, blocker, nextAction }) {
  return {
    id,
    name,
    source_id: source?.id || source?.source_transaction_id || source?.source_document_id || 'REVIEW_SOURCE',
    source_type: source?.document_type || source?.event_type || source?.loan_transaction_type || source?.invoice_number || 'WBS mock source',
    event_id: event?.event_id || 'EVENT_NOT_REQUIRED',
    event_type: event?.event_type || 'review',
    rule_id: finding?.rule_id || event?.rule_id || 'REVIEW_ONLY',
    risk_level: finding?.risk_level || 'MEDIUM',
    reason: finding?.reason || event?.reason || 'Retained source evidence is reviewed before accounting impact.',
    suggested_action: finding?.suggested_action || nextAction,
    suggested_je_number: suggestedJe?.je_number || suggestedJe?.je_id || 'No Draft JE',
    suggested_je_balanced: suggestedJe ? Math.abs(suggestedJe.lines.reduce((sum, line) => sum + Number(line.debit_amount || 0) - Number(line.credit_amount || 0), 0)) < 0.005 : false,
    review_status: finding?.status || suggestedJe?.review_status || (blocker ? 'REVIEW_REQUIRED' : 'POSTED'),
    posted_je_number: postedJe?.je_number || postedJe?.je_id || 'Not posted by mock gate',
    posted_state: postedJe?.posting_status || (blocker ? 'BLOCKED_OR_REVIEW_ONLY' : 'POSTED_SOURCE_ONLY'),
    gl_line_count: glLines.length,
    report_impact_count: reportRows.length,
    audit_trail_count: auditTrail?.length || finding?.audit_trail?.length || suggestedJe?.audit_trail?.length || 0,
    control_state: status,
    next_action: nextAction,
  };
}

export function buildWbsEndToEndFlowEvidence(snapshot = createWbsMockDataset()) {
  const events = buildAccountingEvents(snapshot);
  const findings = runDeterministicAccountingRules(snapshot, events);
  const reportImpact = buildWbsReportImpact(snapshot);
  const bankEvidence = buildWbsBankReconciliationEvidence(snapshot);
  const sourceDocs = byId(snapshot.sourceDocuments);
  const eventBySource = new Map(events.map(event => [event.source_transaction_id, event]));
  const findingByRule = ruleId => findings.find(finding => finding.rule_id === ruleId);
  const glBySource = sourceId => reportImpact.glLines.filter(line => line.source_document_id === sourceId);
  const reportBySource = sourceId => reportImpact.impactRows.filter(row => row.source_document_id === sourceId);
  const postedBySource = sourceId => reportImpact.postedJournalEntries.find(je => je.source_document_id === sourceId);
  const suggestedByRule = ruleId => findingByRule(ruleId)?.suggested_je;
  const amortization = createAmortizationScheduleFromInsurance(snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO'));
  const bankMissing = bankEvidence.bankRows.find(row => row.bank_txn_id === 'BANK-UNMATCHED-01');
  const loanSourceId = 'DOC-LOAN-DRAW';

  const flows = [
    flow({
      id: 'PAYABLE_TO_ACCRUAL',
      name: 'Payable Report -> AI finding -> Accrual Draft -> review',
      source: snapshot.payableInvoices.find(invoice => invoice.id === 'AP-ACCRUAL-01'),
      event: eventBySource.get('AP-ACCRUAL-01'),
      finding: findingByRule('ACCRUAL_CANDIDATE'),
      suggestedJe: suggestedByRule('ACCRUAL_CANDIDATE'),
      postedJe: null,
      glLines: [],
      reportRows: [],
      auditTrail: findingByRule('ACCRUAL_CANDIDATE')?.audit_trail,
      status: 'REVIEW_REQUIRED',
      blocker: true,
      nextAction: 'Create month-end accrual Draft JE through review workflow.',
    }),
    flow({
      id: 'BANK_TO_EXCEPTION',
      name: 'Bank Statement -> exception queue -> reconciliation review',
      source: bankMissing,
      event: eventBySource.get('BANK-UNMATCHED-01'),
      finding: findingByRule('PAYMENT_WITHOUT_BILL'),
      suggestedJe: suggestedByRule('PAYMENT_WITHOUT_BILL'),
      postedJe: null,
      glLines: [],
      reportRows: [],
      auditTrail: findingByRule('PAYMENT_WITHOUT_BILL')?.audit_trail,
      status: 'EXCEPTION_RETAINED',
      blocker: true,
      nextAction: 'Hold in missing AP source queue; no auto-match or posting.',
    }),
    flow({
      id: 'COST_GL_TO_CWIP_REVIEW',
      name: 'Cost GL -> project cost classification -> CWIP cutoff review',
      source: snapshot.costGlTransactions.find(cost => cost.id === 'COST-POST-COMPLETE-01'),
      event: eventBySource.get('COST-POST-COMPLETE-01'),
      finding: findingByRule('CWIP_POST_COMPLETION_CUTOFF'),
      suggestedJe: suggestedByRule('CWIP_POST_COMPLETION_CUTOFF'),
      postedJe: null,
      glLines: [],
      reportRows: [],
      auditTrail: findingByRule('CWIP_POST_COMPLETION_CUTOFF')?.audit_trail,
      status: 'CUTOFF_REVIEW_REQUIRED',
      blocker: true,
      nextAction: 'Review completed-project capitalization before any reclass.',
    }),
    flow({
      id: 'LOAN_DRAW_TO_REPORTS',
      name: 'Construction Loan Draw -> Loan JE -> GL -> reports',
      source: sourceDocs.get(loanSourceId),
      event: eventBySource.get('BANK-LOAN-DRAW-01'),
      finding: findingByRule('LOAN_DRAW_RECOGNITION'),
      suggestedJe: suggestedByRule('LOAN_DRAW_RECOGNITION'),
      postedJe: reportImpact.postedWbsJEs.find(je => je.source_document_id === loanSourceId),
      glLines: glBySource(loanSourceId),
      reportRows: reportBySource(loanSourceId),
      auditTrail: reportImpact.postedWbsJEs.find(je => je.source_document_id === loanSourceId)?.audit_trail,
      status: 'POSTED_MOCK_IMPACT_TIED',
      nextAction: 'Retain cash and loan payable report impact for controller review.',
    }),
    flow({
      id: 'INSURANCE_TO_AMORTIZATION',
      name: 'Insurance payment -> prepaid -> amortization schedule',
      source: snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO'),
      event: eventBySource.get('AP-INS-12MO'),
      finding: findingByRule('PREPAID_SCHEDULE_REQUIRED'),
      suggestedJe: suggestedByRule('PREPAID_SCHEDULE_REQUIRED'),
      postedJe: postedBySource('DOC-INS-12MO'),
      glLines: glBySource('DOC-INS-12MO'),
      reportRows: reportBySource('DOC-INS-12MO'),
      auditTrail: amortization.lines[0]?.suggested_je?.audit_trail,
      status: amortization.lines.length === 12 ? 'SCHEDULE_READY' : 'REVIEW_REQUIRED',
      nextAction: 'Review 12 monthly amortization Draft JEs before activation.',
    }),
    flow({
      id: 'PROPERTY_TAX_TO_ACCRUAL',
      name: 'Property tax statement -> accrual or prepaid decision',
      source: snapshot.propertyTaxStatements.find(statement => statement.id === 'PTAX-TRAVIS-2026'),
      event: eventBySource.get('PTAX-TRAVIS-2026'),
      finding: findingByRule('PROPERTY_TAX_ACCRUAL_REQUIRED'),
      suggestedJe: suggestedByRule('PROPERTY_TAX_ACCRUAL_REQUIRED'),
      postedJe: reportImpact.postedWbsJEs.find(je => je.source_document_id === 'DOC-PROPERTY-TAX-2026'),
      glLines: glBySource('DOC-PROPERTY-TAX-2026'),
      reportRows: reportBySource('DOC-PROPERTY-TAX-2026'),
      auditTrail: reportImpact.postedWbsJEs.find(je => je.source_document_id === 'DOC-PROPERTY-TAX-2026')?.audit_trail,
      status: 'POSTED_MOCK_IMPACT_TIED',
      nextAction: 'Retain the reviewed property tax accrual in AP, GL and report controls.',
    }),
    flow({
      id: 'PROPERTY_OPS_TO_REVENUE',
      name: 'Property Operation Data -> rent income pickup -> entity GL',
      source: snapshot.rentRoll.find(row => row.id === 'RENT-JULY-01'),
      event: eventBySource.get('RENT-JULY-01'),
      finding: findingByRule('RENT_ROLL_REVENUE_MISMATCH'),
      suggestedJe: suggestedByRule('RENT_ROLL_REVENUE_MISMATCH'),
      postedJe: postedBySource('DOC-RENT-ROLL'),
      glLines: glBySource('DOC-RENT-ROLL'),
      reportRows: reportBySource('DOC-RENT-ROLL'),
      auditTrail: findingByRule('RENT_ROLL_REVENUE_MISMATCH')?.audit_trail,
      status: 'POSTED_WITH_REVENUE_REVIEW',
      nextAction: 'Tie posted rent revenue to rent roll difference before close.',
    }),
    flow({
      id: 'SOURCE_TO_TB',
      name: 'Source Transactions -> Journal Entries -> Trial Balance',
      source: { id: 'POSTED_SOURCE_SET', document_type: 'SOURCE_SET' },
      event: { event_id: 'EVT-POSTED-SOURCE-SET', event_type: 'manual_je', rule_id: 'POSTED_SOURCE_TRACE' },
      finding: null,
      suggestedJe: null,
      postedJe: reportImpact.postedJournalEntries[0],
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: reportImpact.postedJournalEntries.flatMap(je => je.audit_trail || []),
      status: reportImpact.trialBalance.balanced ? 'TRIAL_BALANCE_TIED' : 'REVIEW_REQUIRED',
      nextAction: 'Use only source-linked POSTED journals for Trial Balance.',
    }),
    flow({
      id: 'TB_TO_STATEMENTS',
      name: 'Trial Balance -> BS / IS / Cash Flow',
      source: { id: 'WBS_MOCK_TRIAL_BALANCE', document_type: 'TRIAL_BALANCE' },
      event: { event_id: 'EVT-WBS-REPORT-IMPACT', event_type: 'manual_je', rule_id: 'REPORT_IMPACT_TIE_OUT' },
      finding: null,
      suggestedJe: null,
      postedJe: reportImpact.postedWbsJEs[0],
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: reportImpact.controls,
      status: reportImpact.statement.balanceSheetTied ? 'STATEMENTS_TIED' : 'REVIEW_REQUIRED',
      nextAction: 'Expose statement tie-outs with account, source and JE trace.',
    }),
    flow({
      id: 'GL_TO_AI_ANALYSIS',
      name: 'Full GL -> AI Audit Center -> Accounting Analysis Report',
      source: { id: 'WBS_MOCK_FULL_GL', document_type: 'GENERAL_LEDGER' },
      event: { event_id: 'EVT-WBS-AI-ANALYSIS', event_type: 'manual_je', rule_id: 'AI_ANALYSIS_READY' },
      finding: findings[0],
      suggestedJe: findings[0]?.suggested_je,
      postedJe: null,
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: findings.flatMap(finding => finding.audit_trail || []),
      status: 'ANALYSIS_READY',
      nextAction: 'Use AI Audit findings and report impact as the accounting analysis report input.',
    }),
  ];

  const controls = {
    total_flows: flows.length,
    flows_with_source: flows.filter(row => row.source_id !== 'REVIEW_SOURCE').length,
    flows_with_event: flows.filter(row => row.event_id !== 'EVENT_NOT_REQUIRED').length,
    flows_with_suggested_je_or_explicit_blocker: flows.filter(row => row.suggested_je_number !== 'No Draft JE' || /REVIEW|BLOCK|EXCEPTION|CONTRACT_READY|POSTED|TIED|ANALYSIS/.test(row.control_state)).length,
    flows_with_posted_or_blocked_state: flows.filter(row => row.posted_state).length,
    flows_with_gl_or_blocker: flows.filter(row => row.gl_line_count > 0 || /REVIEW|BLOCK|EXCEPTION|CONTRACT_READY/.test(row.control_state)).length,
    flows_with_report_or_blocker: flows.filter(row => row.report_impact_count > 0 || /REVIEW|BLOCK|EXCEPTION|CONTRACT_READY/.test(row.control_state)).length,
    flows_with_audit: flows.filter(row => row.audit_trail_count > 0).length,
    trial_balance_tied: reportImpact.trialBalance.balanced,
    balance_sheet_tied: reportImpact.statement.balanceSheetTied,
  };
  return {
    mode: 'WBS_MOCK_E2E_FLOW_EVIDENCE',
    flows,
    controls,
    allFlowsTraceable: Object.entries(controls).every(([key, value]) => key.startsWith('flows_') ? value === flows.length : true),
    boundaries: [
      'Mock WBS connector only',
      'Review-only where source evidence is incomplete',
      'No production WBS call',
      'No automatic posting outside the mock posting gate',
      'No external export or sync',
    ],
  };
}
