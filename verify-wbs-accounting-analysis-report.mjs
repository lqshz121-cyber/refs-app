import { readFileSync } from 'node:fs';
import { createWbsMockDataset } from './src/wbs-accounting-foundation.js';
import { buildWbsAccountingAnalysisReport } from './src/wbs-accounting-analysis-report.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync('src/wbs-accounting-analysis-report.js', 'utf8');
const uiSource = readFileSync('src/module-aiaudit.jsx', 'utf8');
if (/[\p{Script=Han}\uFFFD]/u.test(source)) fail('Accounting analysis report source contains visible CJK or replacement characters.');
if (!uiSource.includes("import { buildWbsAccountingAnalysisReport }")) fail('AI Audit does not import accounting analysis report.');
if (!uiSource.includes('const accountingAnalysisReport = buildWbsAccountingAnalysisReport(snapshot);')) fail('AI Audit does not build accounting analysis report from the same WBS mock snapshot.');
[
  'Accounting analysis report',
  'Findings, close controls, posted impact and workflow blockers from the WBS mock accounting pipeline.',
  'High-risk open',
  'Postable JEs',
  'Blocked workflows',
  'Controls tied',
  'Global release still requires real HTTPS/OIDC',
].forEach(label => {
  if (!uiSource.includes(label)) fail(`AI Audit accounting analysis section missing label: ${label}`);
});

const report = buildWbsAccountingAnalysisReport(createWbsMockDataset());
if (report.mode !== 'WBS_MOCK_ACCOUNTING_ANALYSIS_REPORT') fail('Unexpected accounting analysis report mode.');
if (report.source_mode !== 'WBS_MOCK_CONNECTOR') fail('Analysis report must identify mock WBS connector source mode.');
if (report.summary.total_findings < 10) fail('Analysis report must include deterministic findings.');
if (report.summary.open_high_risk < 6) fail('Analysis report must expose high-risk open findings.');
if (report.summary.suggested_jes < 8 || report.summary.postable_suggested_jes < 8) fail('Analysis report must expose balanced source-backed suggested JEs.');
if (report.summary.workflows !== 10) fail('Analysis report must include the 10 mock E2E close workflows.');
if (report.summary.trial_balance_state !== 'TIED' || report.summary.balance_sheet_state !== 'TIED') fail('Financial statement controls must tie in the deterministic mock report.');
if (report.summary.net_income !== 73500 || report.summary.closing_cash !== 238000) fail('Report summary must retain property-tax-adjusted net income and deterministic closing cash.');
if (report.findingRows.length !== report.summary.total_findings) fail('Analysis report must retain every deterministic finding for downstream queues.');
if (report.executiveFindings.length < 6) fail('Executive findings must provide a usable close-review list.');
report.executiveFindings.forEach(row => {
  ['rule_id', 'risk_level', 'object_id', 'reason', 'suggested_action', 'confidence_score', 'owner', 'due_date', 'audit_trail_count'].forEach(field => {
    if (!(field in row)) fail(`Executive finding missing ${field}.`);
  });
  if (row.audit_trail_count < 1) fail(`${row.rule_id} must keep audit trail evidence.`);
});
if (!report.controlRows.some(row => row.control === 'Trial Balance' && row.state === 'TIED')) fail('Trial Balance control row missing.');
if (!report.controlRows.some(row => row.control === 'Review-only blockers retained' && row.state === 'REVIEW_REQUIRED')) fail('Review-only blocker control row missing.');
if (!report.workflowRows.some(row => row.id === 'GL_TO_AI_ANALYSIS' && row.control_state === 'ANALYSIS_READY')) fail('GL to AI analysis workflow row missing.');
if (!report.boundaries.includes('No production WBS call')) fail('Missing production WBS boundary.');
if (!report.boundaries.some(row => /real HTTPS\/OIDC/.test(row))) fail('Missing external release boundary.');

console.log('wbs-accounting-analysis-report: findings, controls, workflow blockers, report impact and audit trail passed');
