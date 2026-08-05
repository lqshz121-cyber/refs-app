import { readFileSync } from 'node:fs';
import { createWbsMockDataset } from './src/wbs-accounting-foundation.js';
import { buildWbsAccountingAnalysisReport } from './src/wbs-accounting-analysis-report.js';
import { buildWbsAccountingActionQueue } from './src/wbs-accounting-action-queue.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync('src/wbs-accounting-action-queue.js', 'utf8');
const uiSource = readFileSync('src/module-aiaudit.jsx', 'utf8');
if (/[\p{Script=Han}\uFFFD]/u.test(source)) fail('Accounting action queue source contains visible CJK or replacement characters.');
if (!uiSource.includes("import { buildWbsAccountingActionQueue }")) fail('AI Audit does not import accounting action queue.');
if (!uiSource.includes('const accountingActionQueue = buildWbsAccountingActionQueue(accountingAnalysisReport);')) fail('AI Audit must build the action queue from the accounting analysis report.');
[
  'Accounting action queue',
  'Controller-ready work items generated from AI findings, workflow blockers and source-backed suggested journals.',
  'Total actions',
  'P0 actions',
  'Draft ready',
  'Review required',
  'Posting disabled',
  'JE gate',
  'entity, period, date, type, source document, rule, idempotency, balanced lines, and member trace',
].forEach(label => {
  if (!uiSource.includes(label)) fail(`AI Audit accounting action queue section missing label: ${label}`);
});

const report = buildWbsAccountingAnalysisReport(createWbsMockDataset());
const queue = buildWbsAccountingActionQueue(report);
if (queue.mode !== 'WBS_MOCK_ACCOUNTING_ACTION_QUEUE') fail('Unexpected action queue mode.');
if (queue.source_mode !== 'WBS_MOCK_CONNECTOR') fail('Action queue must retain mock WBS source mode.');
if (queue.summary.total_actions < 10) fail('Action queue must include findings and workflow blockers.');
if (queue.summary.p0_actions < 6) fail('Action queue must expose critical controller work.');
if (queue.summary.draft_ready < 4) fail('Action queue must expose source-backed draft-ready work.');
if (queue.summary.review_required < 3) fail('Action queue must retain review-only blockers.');
if (!queue.summary.no_post_without_review) fail('Action queue must fail closed on automatic posting.');
if (!queue.actions.every(row => row.can_post_without_review === false)) fail('No action may allow posting without review.');
if (!queue.actions.some(row => row.action_type === 'CREATE_AMORTIZATION_REVIEW')) fail('Prepaid/amortization action missing.');
if (!queue.actions.some(row => row.action_type === 'CREATE_ACCRUAL_DRAFT')) fail('Accrual action missing.');
if (!queue.actions.some(row => row.action_type === 'RECONCILIATION_EXCEPTION_REVIEW')) fail('Reconciliation exception action missing.');
if (!queue.actions.some(row => row.action_type === 'WAIT_FOR_SOURCE_CONTRACT')) fail('Source-contract blocker action missing.');
if (!queue.actions.some(row => row.source_type === 'CLOSE_WORKFLOW' && row.readiness === 'REVIEW_REQUIRED')) fail('Workflow review actions must be retained.');
['PAYMENT_WITHOUT_BILL', 'DUPLICATE_INVOICE_RISK', 'MISSING_SOURCE_DOCUMENT', 'MANUAL_JE_LARGE_NO_ATTACHMENT'].forEach(ruleId => {
  const row = queue.actions.find(action => action.title === ruleId);
  if (!row) fail(`${ruleId} action missing.`);
  if (row.readiness !== 'REVIEW_REQUIRED' || row.can_create_draft_je) fail(`${ruleId} must remain review-only, not Draft-ready.`);
});
queue.actions.forEach(row => {
  ['action_id', 'source_type', 'source_id', 'priority', 'action_type', 'reason', 'next_action', 'owner', 'due_date', 'readiness', 'audit_trail_count', 'blockers'].forEach(field => {
    if (!(field in row)) fail(`Action row missing ${field}.`);
  });
  if (!/^P[0-3]$/.test(row.priority)) fail(`${row.action_id} has invalid priority.`);
  if (row.readiness === 'DRAFT_READY' && (!row.can_create_draft_je || !row.suggested_je_number)) fail(`${row.action_id} is draft-ready without a suggested JE.`);
  if (!row.draft_je_gate || !row.draft_je_gate.state) fail(`${row.action_id} is missing draft JE gate state.`);
  if (row.readiness === 'DRAFT_READY' && row.draft_je_gate.state !== 'PASS') fail(`${row.action_id} is draft-ready without a passing Draft JE gate.`);
  if (row.draft_je_gate.state === 'PASS') {
    ['je_number', 'entity_id', 'accounting_period', 'je_date', 'je_type', 'source_document_id', 'rule_id', 'idempotency_key', 'debit', 'credit', 'line_count', 'member_trace'].forEach(field => {
      if (!(field in row.draft_je_gate)) fail(`${row.action_id} passing Draft JE gate missing ${field}.`);
    });
    if (Math.abs(row.draft_je_gate.debit - row.draft_je_gate.credit) >= 0.005) fail(`${row.action_id} passing Draft JE gate is not balanced.`);
    ['entity_id', 'project_id', 'property_id'].forEach(field => {
      if (!row.draft_je_gate.member_trace[field]) fail(`${row.action_id} passing Draft JE gate missing member trace ${field}.`);
    });
  }
  if (row.readiness === 'REVIEW_REQUIRED' && !row.blockers.length) fail(`${row.action_id} review-required action must explain blockers.`);
});
if (!queue.boundaries.includes('No production WBS call, export, sync, or automatic posting')) fail('Missing production boundary.');
if (!queue.boundaries.includes('Draft JE gate requires entity, period, date, type, source document, rule, idempotency, balanced lines, and member trace')) fail('Missing Draft JE required-field boundary.');

console.log('wbs-accounting-action-queue: controller action queue, draft readiness, blockers and automatic-posting-disabled gate passed');
