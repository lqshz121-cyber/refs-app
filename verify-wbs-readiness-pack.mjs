import { readFileSync } from 'node:fs';
import { WBS_MCP_CONTRACTS, createWbsMockDataset, buildAccountingEvents, runDeterministicAccountingRules } from './src/wbs-accounting-foundation.js';
import { buildWbsEndToEndFlowEvidence } from './src/wbs-e2e-flow-evidence.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const docPath = 'outputs/REFS-WBS-MOCK-ACCOUNTING-READINESS.md';
const doc = readFileSync(docPath, 'utf8');
if (/[\p{Script=Han}\uFFFD]/u.test(doc)) fail('Readiness pack contains visible CJK or replacement characters.');

[
  'WBS MCP Data Contract',
  'Database Architecture and Mock Persistence',
  'WBS Mock Connector Coverage',
  'AI Accounting Rule Engine',
  'QuickBooks Gap Backlog',
  'Mock End-to-End Flow Evidence',
  'MCP Readiness Checklist',
  'How to Verify Locally',
].forEach(section => {
  if (!doc.includes(section)) fail(`Readiness pack missing section: ${section}`);
});

Object.keys(WBS_MCP_CONTRACTS).forEach(contract => {
  if (!doc.includes(`| ${contract} |`)) fail(`Readiness pack missing WBS contract row: ${contract}`);
});

[
  'entity_master',
  'project_master',
  'property_master',
  'vendor_master',
  'customer_master',
  'chart_of_accounts',
  'accounting_periods / close_periods',
  'source_documents',
  'source_transactions',
  'bank_accounts / bank_transactions / bank_matches',
  'payable_invoices / payable_payments',
  'construction_loans / loan_transactions',
  'cost_gl_transactions / property_operations',
  'accounting_events',
  'journal_entries / journal_entry_lines',
  'recurring_journal_entries',
  'amortization_schedules / amortization_schedule_lines',
  'accrual_schedules',
  'intercompany_mappings / account_mapping_rules',
  'ai_accounting_rules / ai_rule_results / ai_findings',
  'audit_logs / review_workflows',
  'financial_statement_snapshots / report_definitions',
  'user_permissions',
].forEach(table => {
  if (!doc.includes(table)) fail(`Readiness pack missing database table/mapping: ${table}`);
});

[
  'PREPAID_SCHEDULE_REQUIRED',
  'PAYMENT_WITHOUT_BILL',
  'LOAN_DRAW_RECOGNITION',
  'INTEREST_CAPITALIZATION_REQUIRED',
  'ACCRUAL_CANDIDATE',
  'DUPLICATE_INVOICE_RISK',
  'CWIP_POST_COMPLETION_CUTOFF',
  'LOAN_BALANCE_MISMATCH',
  'RENT_ROLL_REVENUE_MISMATCH',
  'MISSING_SOURCE_DOCUMENT',
  'JE_CONTROL_FAILURE',
  'MANUAL_JE_LARGE_NO_ATTACHMENT',
].forEach(rule => {
  if (!doc.includes(rule)) fail(`Readiness pack missing AI rule: ${rule}`);
});

[
  'Quick Create',
  'Banking',
  'Bank reconciliation',
  'Chart of accounts',
  'Journal entry',
  'Reports',
  'AP bills and vendors',
  'Customers and AR',
  'Recurring transactions',
  'Rules',
  'Attachments',
  'Audit log',
  'Close books',
  'Export CSV',
].forEach(feature => {
  if (!doc.includes(`| ${feature} |`)) fail(`Readiness pack missing QuickBooks backlog row: ${feature}`);
});

const snapshot = createWbsMockDataset();
const events = buildAccountingEvents(snapshot);
const findings = runDeterministicAccountingRules(snapshot, events);
const e2e = buildWbsEndToEndFlowEvidence(snapshot);

if (events.length < 10) fail(`Expected accounting events from WBS mock dataset, got ${events.length}.`);
if (findings.length < 10) fail(`Expected deterministic AI findings, got ${findings.length}.`);
if (
  e2e.controls.total_flows !== 10
  || !e2e.allFlowsReported
  || e2e.allFlowsTraceable
  || e2e.allFlowsComplete
  || e2e.controls.complete_flows !== 3
  || e2e.controls.incomplete_flows !== 7
) fail('Readiness pack E2E status is not backed by the current evidence builder.');
e2e.flows.forEach(flow => {
  if (!doc.includes(flow.name)) fail(`Readiness pack missing E2E flow: ${flow.name}`);
  if (!['COMPLETE', 'INCOMPLETE'].includes(flow.evidence_state)) fail(`E2E flow has no explicit evidence state: ${flow.name}`);
  if (flow.evidence_state === 'COMPLETE' && flow.missing_evidence.length !== 0) fail(`Complete E2E flow still has missing evidence: ${flow.name}`);
  if (flow.evidence_state === 'INCOMPLETE' && flow.missing_evidence.length === 0) fail(`Incomplete E2E flow does not identify missing evidence: ${flow.name}`);
  if (!doc.includes(`| ${flow.name} | ${flow.evidence_state} |`)) fail(`Readiness pack missing truthful E2E status row: ${flow.name}`);
});

[
  '3 COMPLETE',
  '7 INCOMPLETE',
  'Blockers and aggregate observations do not substitute for retained posted JE, GL, report, or audit evidence.',
].forEach(statement => {
  if (!doc.includes(statement)) fail(`Readiness pack missing truthful E2E statement: ${statement}`);
});

[
  'node verify-wbs-e2e-flow-evidence.mjs',
  'node verify-wbs-report-impact.mjs',
  'npm.cmd run build',
  'git diff --check',
  'npm.cmd test',
  'HTTPS/OIDC',
  'provider S3/scanner lifecycle',
  'WBS signed nonempty receipt',
].forEach(gate => {
  if (!doc.includes(gate)) fail(`Readiness pack missing verifier/gate: ${gate}`);
});

console.log('wbs-readiness-pack: contracts, DB mapping, QB backlog, AI rules, and 3 COMPLETE / 7 INCOMPLETE E2E evidence states are documented and code-backed');
