import { buildWbsAccountingAnalysisReport } from './wbs-accounting-analysis-report.js';
import { createWbsMockDataset } from './wbs-accounting-foundation.js';

const priorityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
const workflowStates = /REVIEW|BLOCK|EXCEPTION|CONTRACT_READY/i;

function priorityForFinding(row) {
  if (row.risk_level === 'HIGH') return 'P0';
  if (row.risk_level === 'MEDIUM') return 'P1';
  return 'P2';
}

function actionTypeForFinding(row) {
  if (/PAYMENT_WITHOUT_BILL|BANK|MATCH|BALANCE|RECON/i.test(row.rule_id)) return 'RECONCILIATION_EXCEPTION_REVIEW';
  if (/DUPLICATE/i.test(row.rule_id)) return 'DUPLICATE_RISK_REVIEW';
  if (/PREPAID|AMORT/i.test(row.rule_id)) return 'CREATE_AMORTIZATION_REVIEW';
  if (/ACCRUAL/i.test(row.rule_id)) return 'CREATE_ACCRUAL_DRAFT';
  if (/LOAN|INTEREST/i.test(row.rule_id)) return 'REVIEW_LOAN_ACCOUNTING';
  return row.suggested_je_number ? 'CREATE_DRAFT_JE' : 'CONTROL_REVIEW';
}

function actionTypeForWorkflow(row) {
  if (/EXCEPTION/i.test(row.control_state)) return 'EXCEPTION_QUEUE_REVIEW';
  if (/CONTRACT_READY/i.test(row.control_state)) return 'WAIT_FOR_SOURCE_CONTRACT';
  if (/CUTOFF/i.test(row.control_state)) return 'CUTOFF_REVIEW';
  return 'WORKFLOW_REVIEW';
}

function isPostableFinding(row) {
  if (/PAYMENT_WITHOUT_BILL|MISSING_SOURCE|DUPLICATE|MANUAL_JE_LARGE_NO_ATTACHMENT/i.test(row.rule_id)) return false;
  return Boolean(row.suggested_je_number && row.audit_trail_count > 0 && row.suggested_je_gate?.state === 'PASS');
}

function blockersForFinding(row) {
  if (isPostableFinding(row)) return [];
  const missing = row.suggested_je_gate?.missing || [];
  const base = ['Review-only exception: source completeness, duplicate risk, attachment support, or reconciliation status must be resolved before any Draft JE is prepared.'];
  return missing.length ? [`Draft JE gate missing: ${missing.join(', ')}`, ...base] : base;
}

export function buildWbsAccountingActionQueue(input = createWbsMockDataset()) {
  const report = input?.mode === 'WBS_MOCK_ACCOUNTING_ANALYSIS_REPORT'
    ? input
    : buildWbsAccountingAnalysisReport(input);
  const findingActions = (report.findingRows || report.executiveFindings).map(row => ({
    action_id: `ACT-FINDING-${row.rule_id}-${row.object_id}`,
    source_type: 'AI_FINDING',
    source_id: row.object_id,
    priority: priorityForFinding(row),
    action_type: actionTypeForFinding(row),
    title: row.rule_id,
    reason: row.reason,
    next_action: row.suggested_action,
    owner: row.owner,
    due_date: row.due_date,
    readiness: isPostableFinding(row) ? 'DRAFT_READY' : 'REVIEW_REQUIRED',
    can_create_draft_je: isPostableFinding(row),
    can_post_without_review: false,
    suggested_je_number: row.suggested_je_number,
    draft_je_gate: row.suggested_je_gate || { state: 'NOT_AVAILABLE', missing: ['suggested_je'] },
    audit_trail_count: row.audit_trail_count,
    blockers: blockersForFinding(row),
  }));
  const workflowActions = report.workflowRows
    .filter(row => workflowStates.test(row.control_state))
    .map(row => ({
      action_id: `ACT-WORKFLOW-${row.id}`,
      source_type: 'CLOSE_WORKFLOW',
      source_id: row.source_id,
      priority: /BLOCK|EXCEPTION/i.test(row.control_state) ? 'P0' : 'P1',
      action_type: actionTypeForWorkflow(row),
      title: row.name,
      reason: `${row.control_state}: ${row.posted_state}`,
      next_action: row.next_action,
      owner: /P0/.test(row.control_state) ? 'CONTROLLER' : 'SENIOR_ACCT',
      due_date: /BLOCK|EXCEPTION/i.test(row.control_state) ? '2026-08-06' : '2026-08-15',
      readiness: 'REVIEW_REQUIRED',
      can_create_draft_je: false,
      can_post_without_review: false,
      suggested_je_number: null,
      draft_je_gate: { state: 'NOT_AVAILABLE', missing: ['workflow_review_required'] },
      audit_trail_count: row.audit_trail_count,
      blockers: ['Workflow remains review-only until retained source evidence is complete.'],
    }));
  const actions = [...findingActions, ...workflowActions]
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || a.due_date.localeCompare(b.due_date) || a.action_id.localeCompare(b.action_id));
  const summary = {
    total_actions: actions.length,
    p0_actions: actions.filter(row => row.priority === 'P0').length,
    draft_ready: actions.filter(row => row.readiness === 'DRAFT_READY').length,
    review_required: actions.filter(row => row.readiness === 'REVIEW_REQUIRED').length,
    blocked_workflows: workflowActions.length,
    no_post_without_review: actions.every(row => row.can_post_without_review === false),
  };
  return {
    mode: 'WBS_MOCK_ACCOUNTING_ACTION_QUEUE',
    report_period: report.report_period,
    source_mode: report.source_mode,
    summary,
    actions,
    boundaries: [
      'Local WBS mock action queue only',
      'Every action requires human review before posting',
      'Draft JE creation is allowed only for source-backed balanced suggested JEs',
      'Draft JE gate requires entity, period, date, type, source document, rule, idempotency, balanced lines, and member trace',
      'No production WBS call, export, sync, or automatic posting',
    ],
  };
}
