import {
  ACCOUNT_MAP,
  buildAccountingEvents,
  createAmortizationScheduleFromInsurance,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';
import { buildWbsBankReconciliationEvidence } from './wbs-bank-reconciliation-evidence.js';
import { buildWbsReportImpact } from './wbs-report-impact.js';

const byId = items => new Map(items.map(item => [item.id || item.je_id || item.finding_id || item.event_id, item]));

const COMPLETION_REQUIREMENTS = Object.freeze({
  POSTED_JE: ['source_data', 'accounting_event', 'suggested_je', 'review', 'posted_je', 'gl_impact', 'report_impact', 'audit_trail'],
  CONTROL_REVIEW: ['source_data', 'accounting_event', 'review', 'audit_trail', 'terminal_outcome'],
  AGGREGATE_POSTED: ['source_data', 'accounting_event', 'suggested_je', 'review', 'posted_je', 'gl_impact', 'report_impact', 'audit_trail', 'aggregate_trace'],
  AI_ANALYSIS: ['source_data', 'accounting_event', 'gl_impact', 'report_impact', 'audit_trail', 'terminal_outcome', 'aggregate_trace'],
});

function flow({ id, name, source, lineageSourceDocumentId = null, sourceType = null, event, finding, suggestedJe, postedJe, glLines, reportRows, auditTrail, terminalReview = null, aggregateTrace = null, completionModel = 'POSTED_JE', status, blocker, nextAction }) {
  const sourceId = source?.id || source?.source_transaction_id || source?.source_document_id || null;
  const sourceDocumentId = lineageSourceDocumentId || source?.source_document_id || (source?.document_type && /^DOC-/.test(String(source?.id || '')) ? source.id : null);
  const eventId = event?.event_id || null;
  const suggestedJeId = suggestedJe?.je_id || null;
  const postedJeId = postedJe?.je_id || null;
  const suggestedBalanced = Boolean(suggestedJe) && Math.abs(suggestedJe.lines.reduce((sum, line) => sum + Number(line.debit_amount || 0) - Number(line.credit_amount || 0), 0)) < 0.005;
  const sourceEvidence = Boolean(sourceId && sourceDocumentId);
  const eventEvidence = Boolean(eventId && sourceDocumentId && event?.source_document_id === sourceDocumentId);
  const suggestedEvidence = Boolean(suggestedJeId && suggestedBalanced && sourceDocumentId && suggestedJe?.source_document_id === sourceDocumentId);
  const postedEvidence = Boolean(
    postedJeId
    && postedJe?.posting_status === 'POSTED'
    && postedJeId === suggestedJeId
    && sourceDocumentId
    && postedJe?.source_document_id === sourceDocumentId
  );
  const postedAudit = postedEvidence && Array.isArray(postedJe?.audit_trail) ? postedJe.audit_trail : [];
  const postedReviewEvidence = postedEvidence && postedAudit.some(entry => ['review-approved', 'approved'].includes(String(entry?.action || '').toLowerCase()));
  const postedAuditEvidence = postedEvidence && postedAudit.some(entry => String(entry?.action || '').toLowerCase() === 'posted');
  const sameLineageGl = postedEvidence
    ? glLines.filter(line => line.je_id === postedJeId && line.source_document_id === sourceDocumentId)
    : [];
  const sameLineageReport = postedEvidence
    ? reportRows.filter(row => row.je_number === postedJe?.je_number && row.source_document_id === sourceDocumentId)
    : [];
  const terminalEvidence = Boolean(
    terminalReview?.state
    && terminalReview?.source_document_id === sourceDocumentId
    && terminalReview?.event_id === eventId
    && terminalReview?.actor
    && terminalReview?.reviewed_at
    && Array.isArray(terminalReview?.audit_trail)
    && terminalReview.audit_trail.length > 0
  );
  const pendingAudit = sourceEvidence && suggestedEvidence
    ? (suggestedJe?.audit_trail || finding?.audit_trail || auditTrail || [])
    : [];
  const lineageAudit = postedEvidence ? postedAudit : (terminalEvidence ? terminalReview.audit_trail : pendingAudit);
  const reviewEvidence = postedReviewEvidence || terminalEvidence;
  const aggregateEvidence = Boolean(
    aggregateTrace
    && Array.isArray(aggregateTrace.source_document_ids)
    && aggregateTrace.source_document_ids.length > 0
    && Array.isArray(aggregateTrace.journal_entry_ids)
    && aggregateTrace.journal_entry_ids.length > 0
    && aggregateTrace.trial_balance_tied === true
  );
  const effectiveGl = aggregateTrace ? glLines : sameLineageGl;
  const effectiveReport = aggregateTrace ? reportRows : sameLineageReport;
  const evidence = {
    source_data: sourceEvidence,
    accounting_event: eventEvidence,
    suggested_je: suggestedEvidence,
    review: reviewEvidence,
    posted_je: postedEvidence,
    gl_impact: effectiveGl.length > 0,
    report_impact: effectiveReport.length > 0,
    audit_trail: postedEvidence ? postedAuditEvidence : lineageAudit.length > 0,
    terminal_outcome: terminalEvidence,
    aggregate_trace: aggregateEvidence,
  };
  const requiredEvidence = COMPLETION_REQUIREMENTS[completionModel] || COMPLETION_REQUIREMENTS.POSTED_JE;
  const missingEvidence = requiredEvidence.filter(key => !evidence[key]);
  return {
    id,
    name,
    source_id: sourceId || 'REVIEW_SOURCE',
    lineage_source_document_id: sourceDocumentId,
    source_type: sourceType || source?.document_type || source?.event_type || source?.loan_transaction_type || source?.invoice_number || 'WBS mock source',
    event_id: eventId || 'EVENT_NOT_REQUIRED',
    event_source_document_id: event?.source_document_id || null,
    event_type: event?.event_type || 'review',
    rule_id: finding?.rule_id || event?.rule_id || 'REVIEW_ONLY',
    risk_level: finding?.risk_level || 'MEDIUM',
    reason: finding?.reason || event?.reason || 'Retained source evidence is reviewed before accounting impact.',
    suggested_action: finding?.suggested_action || nextAction,
    suggested_je_number: suggestedJe?.je_number || suggestedJe?.je_id || 'No Draft JE',
    suggested_je_id: suggestedJeId,
    suggested_je_source_document_id: suggestedJe?.source_document_id || null,
    suggested_je_balanced: suggestedBalanced,
    completion_model: completionModel,
    required_evidence: requiredEvidence,
    review_status: postedReviewEvidence ? 'APPROVED_FOR_MOCK_POSTING' : (terminalReview?.state || finding?.status || suggestedJe?.review_status || (blocker ? 'REVIEW_REQUIRED' : 'EVIDENCE_INCOMPLETE')),
    posted_je_number: postedJe?.je_number || postedJe?.je_id || 'Not posted by mock gate',
    posted_je_id: postedJeId,
    posted_je_source_document_id: postedJe?.source_document_id || null,
    posted_state: postedEvidence ? 'POSTED_SAME_LINEAGE' : (postedJe ? 'POSTED_LINEAGE_MISMATCH' : (blocker ? 'BLOCKED_OR_REVIEW_ONLY' : 'INCOMPLETE_NO_POSTED_JE')),
    terminal_outcome: terminalReview?.state || null,
    gl_line_count: effectiveGl.length,
    observed_gl_line_count: glLines.length,
    report_impact_count: effectiveReport.length,
    observed_report_impact_count: reportRows.length,
    audit_trail_count: lineageAudit.length,
    evidence,
    evidence_state: missingEvidence.length === 0 ? 'COMPLETE' : 'INCOMPLETE',
    missing_evidence: missingEvidence,
    aggregate_trace: aggregateTrace,
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
  const terminalByFlow = new Map((reportImpact.terminalReviews || []).map(row => [row.flow_id, row]));
  const aggregateTrace = {
    source_document_ids: [...new Set(reportImpact.glLines.map(line => line.source_document_id).filter(Boolean))],
    journal_entry_ids: [...new Set(reportImpact.postedJournalEntries.map(je => je.je_id).filter(Boolean))],
    trial_balance_tied: reportImpact.trialBalance.balanced,
    balance_sheet_tied: reportImpact.statement.balanceSheetTied,
  };
  const payableSource = snapshot.payableInvoices.find(invoice => invoice.id === 'AP-ACCRUAL-01');
  const payableEvent = eventBySource.get('AP-ACCRUAL-01');
  const payableFinding = findingByRule('ACCRUAL_CANDIDATE');
  const payableSuggested = suggestedByRule('ACCRUAL_CANDIDATE');
  const payablePosted = reportImpact.postedWbsJEs.find(je => je.source_document_id === 'DOC-AP-MISSING-GL');
  const insuranceJulyDraft = reportImpact.insurance?.lines.find(line => line.period === '2026-07')?.suggested_je || null;
  const insuranceJulyPosted = reportImpact.postedWbsJEs.find(je => je.je_id === insuranceJulyDraft?.je_id) || null;

  const flows = [
    flow({
      id: 'PAYABLE_TO_ACCRUAL',
      name: 'Payable Report -> AI finding -> Accrual Draft -> review',
      source: payableSource,
      event: payableEvent,
      finding: payableFinding,
      suggestedJe: payableSuggested,
      postedJe: payablePosted,
      glLines: glBySource('DOC-AP-MISSING-GL'),
      reportRows: reportBySource('DOC-AP-MISSING-GL'),
      auditTrail: reportImpact.postedWbsJEs.find(je => je.source_document_id === 'DOC-AP-MISSING-GL')?.audit_trail,
      status: 'POSTED_MOCK_IMPACT_TIED',
      nextAction: 'Retain the reviewed payable accrual in AP, GL and report controls.',
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
      terminalReview: terminalByFlow.get('BANK_TO_EXCEPTION'),
      completionModel: 'CONTROL_REVIEW',
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
      terminalReview: terminalByFlow.get('COST_GL_TO_CWIP_REVIEW'),
      completionModel: 'CONTROL_REVIEW',
      status: 'CUTOFF_REVIEW_REQUIRED',
      blocker: true,
      nextAction: 'Review completed-project capitalization before any reclass.',
    }),
    flow({
      id: 'LOAN_DRAW_TO_REPORTS',
      name: 'Construction Loan Draw -> Loan JE -> GL -> reports',
      source: sourceDocs.get(loanSourceId),
      lineageSourceDocumentId: loanSourceId,
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
      suggestedJe: insuranceJulyDraft,
      postedJe: insuranceJulyPosted,
      glLines: glBySource('DOC-INS-12MO'),
      reportRows: reportBySource('DOC-INS-12MO'),
      auditTrail: insuranceJulyPosted?.audit_trail,
      status: amortization.lines.length === 12 && insuranceJulyPosted ? 'SCHEDULE_POSTED_MOCK_IMPACT_TIED' : 'REVIEW_REQUIRED',
      nextAction: 'Retain the 12-month schedule; only the explicitly reviewed 2026-07 mock amortization is posted.',
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
      // Existing retained rent GL does not prove the 10,500 variance is a
      // valid pickup adjustment. Keep the mismatch as a reviewed terminal
      // control state instead of borrowing that unrelated posting.
      postedJe: null,
      glLines: glBySource('DOC-RENT-ROLL'),
      reportRows: reportBySource('DOC-RENT-ROLL'),
      auditTrail: findingByRule('RENT_ROLL_REVENUE_MISMATCH')?.audit_trail,
      terminalReview: terminalByFlow.get('PROPERTY_OPS_TO_REVENUE'),
      completionModel: 'CONTROL_REVIEW',
      status: 'REVENUE_MISMATCH_RETAINED',
      nextAction: 'Retain the revenue mismatch for controller review; no pickup adjustment is auto-posted.',
    }),
    flow({
      id: 'SOURCE_TO_TB',
      name: 'Source Transactions -> Journal Entries -> Trial Balance',
      source: payableSource,
      sourceType: 'POSTED_SOURCE_SET',
      event: payableEvent,
      finding: payableFinding,
      suggestedJe: payableSuggested,
      postedJe: payablePosted,
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: reportImpact.postedJournalEntries.flatMap(je => je.audit_trail || []),
      aggregateTrace,
      completionModel: 'AGGREGATE_POSTED',
      status: reportImpact.trialBalance.balanced ? 'TRIAL_BALANCE_TIED' : 'REVIEW_REQUIRED',
      nextAction: 'Use only source-linked POSTED journals for Trial Balance.',
    }),
    flow({
      id: 'TB_TO_STATEMENTS',
      name: 'Trial Balance -> BS / IS / Cash Flow',
      source: payableSource,
      sourceType: 'TRIAL_BALANCE_SNAPSHOT',
      event: payableEvent,
      finding: payableFinding,
      suggestedJe: payableSuggested,
      postedJe: payablePosted,
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: reportImpact.controls,
      aggregateTrace,
      completionModel: 'AGGREGATE_POSTED',
      status: reportImpact.statement.balanceSheetTied ? 'STATEMENTS_TIED' : 'REVIEW_REQUIRED',
      nextAction: 'Expose statement tie-outs with account, source and JE trace.',
    }),
    flow({
      id: 'GL_TO_AI_ANALYSIS',
      name: 'Full GL -> AI Audit Center -> Accounting Analysis Report',
      source: payableSource,
      sourceType: 'POSTED_GENERAL_LEDGER_SNAPSHOT',
      event: payableEvent,
      finding: payableFinding,
      suggestedJe: payableSuggested,
      postedJe: null,
      glLines: reportImpact.glLines,
      reportRows: reportImpact.impactRows,
      auditTrail: findings.flatMap(finding => finding.audit_trail || []),
      terminalReview: terminalByFlow.get('GL_TO_AI_ANALYSIS'),
      aggregateTrace,
      completionModel: 'AI_ANALYSIS',
      status: 'ANALYSIS_RETAINED',
      nextAction: 'Use AI Audit findings and report impact as the accounting analysis report input.',
    }),
  ];

  const controls = {
    total_flows: flows.length,
    flows_with_source: flows.filter(row => row.evidence.source_data).length,
    flows_with_event: flows.filter(row => row.evidence.accounting_event).length,
    flows_with_suggested_je: flows.filter(row => row.evidence.suggested_je).length,
    flows_with_review: flows.filter(row => row.evidence.review).length,
    flows_with_posted_je: flows.filter(row => row.evidence.posted_je).length,
    flows_with_gl_impact: flows.filter(row => row.evidence.gl_impact).length,
    flows_with_report_impact: flows.filter(row => row.evidence.report_impact).length,
    flows_with_audit: flows.filter(row => row.evidence.audit_trail).length,
    complete_flows: flows.filter(row => row.evidence_state === 'COMPLETE').length,
    incomplete_flows: flows.filter(row => row.evidence_state === 'INCOMPLETE').length,
    // Legacy UI counters remain available, but blockers are never counted as evidence.
    flows_with_suggested_je_or_explicit_blocker: flows.filter(row => row.evidence.suggested_je).length,
    flows_with_posted_or_blocked_state: flows.filter(row => row.evidence.posted_je).length,
    flows_with_gl_or_blocker: flows.filter(row => row.evidence.gl_impact).length,
    flows_with_report_or_blocker: flows.filter(row => row.evidence.report_impact).length,
    trial_balance_tied: reportImpact.trialBalance.balanced,
    balance_sheet_tied: reportImpact.statement.balanceSheetTied,
  };
  const allFlowSourceDocumentsAdmitted = flows.every(row => sourceDocs.has(row.lineage_source_document_id));
  return {
    mode: 'WBS_MOCK_E2E_FLOW_EVIDENCE',
    flows,
    controls,
    allFlowsReported: flows.length === 10 && new Set(flows.map(row => row.id)).size === flows.length,
    allFlowsTraceable: allFlowSourceDocumentsAdmitted && flows.every(row => row.evidence.source_data && row.evidence.accounting_event && row.evidence.audit_trail),
    allFlowsComplete: controls.complete_flows === flows.length,
    all_flow_source_documents_admitted: allFlowSourceDocumentsAdmitted,
    boundaries: [
      'Mock WBS connector only',
      'Review-only where source evidence is incomplete',
      'No production WBS call',
      'No automatic posting outside the mock posting gate',
      'No external export or sync',
    ],
  };
}
