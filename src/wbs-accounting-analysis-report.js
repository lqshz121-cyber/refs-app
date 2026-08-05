import { buildWbsEndToEndFlowEvidence } from './wbs-e2e-flow-evidence.js';
import { buildWbsReportImpact } from './wbs-report-impact.js';

const money = value => Math.round(Number(value || 0) * 100) / 100;
const riskRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };

export function buildWbsAccountingAnalysisReport(snapshot) {
  const reportImpact = buildWbsReportImpact(snapshot);
  const flowEvidence = buildWbsEndToEndFlowEvidence(snapshot);
  const findings = [...reportImpact.findings].sort((a, b) => (riskRank[a.risk_level] ?? 9) - (riskRank[b.risk_level] ?? 9) || b.confidence_score - a.confidence_score);
  const openHighRisk = findings.filter(finding => finding.risk_level === 'HIGH' && finding.status !== 'RESOLVED');
  const suggestedJEs = findings.map(finding => finding.suggested_je).filter(Boolean);
  const postableSuggestedJEs = suggestedJEs.filter(je => je.source_document_id && je.lines?.length && Math.abs(
    je.lines.reduce((sum, line) => sum + Number(line.debit_amount || 0), 0) -
    je.lines.reduce((sum, line) => sum + Number(line.credit_amount || 0), 0),
  ) < 0.005);
  const blockedFlows = flowEvidence.flows.filter(flow => /REVIEW|BLOCK|EXCEPTION|CONTRACT_READY/.test(flow.control_state));
  const postedFlows = flowEvidence.flows.filter(flow => /POSTED|TIED|READY|RETAINED/.test(flow.control_state));
  const controlRows = [
    ...reportImpact.controls.map(row => ({ area: 'Financial statement', control: row.control, state: row.state, evidence: row.evidence })),
    { area: 'Workflow trace', control: 'Mock close flows traceable', state: flowEvidence.allFlowsTraceable ? 'TIED' : 'REVIEW_REQUIRED', evidence: `${flowEvidence.controls.flows_with_audit}/${flowEvidence.controls.total_flows} flows with audit trail` },
    { area: 'Posting gate', control: 'Suggested JE postability', state: postableSuggestedJEs.length ? 'REVIEW_READY' : 'REVIEW_REQUIRED', evidence: `${postableSuggestedJEs.length}/${suggestedJEs.length} suggested JEs are balanced and source-backed` },
    { area: 'Exception gate', control: 'Review-only blockers retained', state: blockedFlows.length ? 'REVIEW_REQUIRED' : 'TIED', evidence: `${blockedFlows.length} flows require human review before close` },
  ];
  const executiveFindings = findings.slice(0, 8).map(finding => ({
    rule_id: finding.rule_id,
    risk_level: finding.risk_level,
    object_id: finding.object_id,
    reason: finding.reason,
    suggested_action: finding.suggested_action,
    confidence_score: finding.confidence_score,
    owner: finding.owner,
    due_date: finding.due_date,
    suggested_je_number: finding.suggested_je?.je_number || null,
    audit_trail_count: finding.audit_trail?.length || 0,
  }));
  return {
    mode: 'WBS_MOCK_ACCOUNTING_ANALYSIS_REPORT',
    report_period: '2026-07',
    source_mode: 'WBS_MOCK_CONNECTOR',
    summary: {
      total_findings: findings.length,
      open_high_risk: openHighRisk.length,
      suggested_jes: suggestedJEs.length,
      postable_suggested_jes: postableSuggestedJEs.length,
      workflows: flowEvidence.controls.total_flows,
      blocked_or_review_flows: blockedFlows.length,
      posted_or_tied_flows: postedFlows.length,
      trial_balance_state: reportImpact.trialBalance.balanced ? 'TIED' : 'REVIEW_REQUIRED',
      balance_sheet_state: reportImpact.statement.balanceSheetTied ? 'TIED' : 'REVIEW_REQUIRED',
      net_income: money(reportImpact.statement.netIncome),
      closing_cash: money(reportImpact.cashFlow.closingCash),
    },
    executiveFindings,
    controlRows,
    workflowRows: flowEvidence.flows.map(flow => ({
      id: flow.id,
      name: flow.name,
      source_id: flow.source_id,
      event_id: flow.event_id,
      control_state: flow.control_state,
      posted_state: flow.posted_state,
      next_action: flow.next_action,
      audit_trail_count: flow.audit_trail_count,
    })),
    boundaries: [
      'Mock WBS connector only',
      'No production WBS call',
      'No automatic posting outside the guarded mock posting gate',
      'No report export or external sync',
      'Global release still requires real HTTPS/OIDC, provider S3/scanner, and signed WBS receipt evidence',
    ],
  };
}
