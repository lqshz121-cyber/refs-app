import { readFileSync } from 'node:fs';
import { buildWbsEndToEndFlowEvidence } from './src/wbs-e2e-flow-evidence.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync('src/wbs-e2e-flow-evidence.js', 'utf8');
const aiAuditSource = readFileSync('src/module-aiaudit.jsx', 'utf8');
const sectionStart = aiAuditSource.indexOf('WBS mock end-to-end accounting flow evidence');
const sectionEnd = aiAuditSource.indexOf('<Tabs tabs={Object.keys(TAB_RULES)}', sectionStart);
const section = sectionStart >= 0 && sectionEnd > sectionStart ? aiAuditSource.slice(sectionStart, sectionEnd) : '';

if (/[\p{Script=Han}\uFFFD]/u.test(source)) fail('WBS E2E flow evidence source contains visible CJK or replacement characters.');
if (/[\p{Script=Han}\uFFFD]/u.test(section)) fail('WBS E2E flow evidence UI section contains visible CJK or replacement characters.');
if (!aiAuditSource.includes("import { buildWbsEndToEndFlowEvidence }")) fail('AI Audit does not import WBS E2E flow evidence.');
if (!aiAuditSource.includes('const e2eFlowEvidence = buildWbsEndToEndFlowEvidence(snapshot);')) fail('AI Audit does not build WBS E2E flow evidence from the mock snapshot.');
[
  'WBS mock end-to-end accounting flow evidence',
  'Source data, accounting event, finding, suggested JE, review state, posted JE, GL impact, report impact, and audit trail',
  'Mock flows',
  'Source + event',
  'JE or blocker',
  'Audit trail',
  'does not call production WBS',
  'create automatic postings',
  'export',
  'external release gates',
].forEach(label => {
  if (!section.includes(label)) fail(`Missing E2E UI label/boundary: ${label}`);
});

const evidence = buildWbsEndToEndFlowEvidence();
if (evidence.mode !== 'WBS_MOCK_E2E_FLOW_EVIDENCE') fail('Unexpected E2E evidence mode.');
if (evidence.controls.total_flows !== 10) fail(`Expected 10 E2E mock flows, got ${evidence.controls.total_flows}.`);
[
  'PAYABLE_TO_ACCRUAL',
  'BANK_TO_EXCEPTION',
  'COST_GL_TO_CWIP_REVIEW',
  'LOAN_DRAW_TO_REPORTS',
  'INSURANCE_TO_AMORTIZATION',
  'PROPERTY_TAX_TO_ACCRUAL',
  'PROPERTY_OPS_TO_REVENUE',
  'SOURCE_TO_TB',
  'TB_TO_STATEMENTS',
  'GL_TO_AI_ANALYSIS',
].forEach(id => {
  const row = evidence.flows.find(flow => flow.id === id);
  if (!row) fail(`Missing required E2E flow ${id}.`);
  if (!row.source_id || !row.event_id || !row.rule_id || !row.reason || !row.suggested_action || !row.review_status || !row.posted_state || !row.control_state) fail(`E2E flow ${id} is missing required trace fields.`);
  if (row.audit_trail_count < 1) fail(`E2E flow ${id} has no audit trail evidence.`);
});
const loan = evidence.flows.find(flow => flow.id === 'LOAN_DRAW_TO_REPORTS');
if (loan.posted_je_number === 'Not posted by mock gate' || loan.gl_line_count !== 2 || loan.report_impact_count !== 2 || loan.control_state !== 'POSTED_MOCK_IMPACT_TIED') fail('Loan draw E2E flow must reach posted JE, GL and report impact.');
const insurance = evidence.flows.find(flow => flow.id === 'INSURANCE_TO_AMORTIZATION');
if (insurance.control_state !== 'SCHEDULE_READY' || insurance.gl_line_count !== 2 || insurance.report_impact_count !== 2) fail('Insurance E2E flow must retain posted payment and amortization schedule readiness.');
const bankException = evidence.flows.find(flow => flow.id === 'BANK_TO_EXCEPTION');
if (bankException.posted_state !== 'BLOCKED_OR_REVIEW_ONLY' || bankException.control_state !== 'EXCEPTION_RETAINED') fail('Unmatched bank payment must remain exception/review only.');
const propertyTax = evidence.flows.find(flow => flow.id === 'PROPERTY_TAX_TO_ACCRUAL');
if (propertyTax.source_id !== 'PTAX-TRAVIS-2026' || propertyTax.rule_id !== 'PROPERTY_TAX_ACCRUAL_REQUIRED') fail('Property tax flow must derive from the WBS mock statement and deterministic accrual rule.');
if (!propertyTax.suggested_je_balanced || propertyTax.review_status !== 'REVIEW_REQUIRED') fail('Property tax flow must retain a balanced Draft and human review state before the mock posted projection.');
if (propertyTax.control_state !== 'POSTED_MOCK_IMPACT_TIED' || propertyTax.posted_state !== 'POSTED' || propertyTax.gl_line_count !== 2 || propertyTax.report_impact_count !== 2 || propertyTax.audit_trail_count < 4) fail('Property tax flow must retain explicit review, posted, GL, report and audit evidence after the guarded mock gate.');
if (!evidence.controls.trial_balance_tied || !evidence.controls.balance_sheet_tied) fail('E2E report controls must tie for the mock posted set.');
if (!evidence.allFlowsTraceable) fail('Every E2E mock flow must have source, event, JE/blocker, GL/report or blocker, and audit evidence.');
if (!evidence.boundaries.includes('No production WBS call')) fail('Missing production WBS boundary.');

console.log('wbs-e2e-flow-evidence: 10 mock close workflows have traceable source, event, JE/review, GL/report impact and audit evidence');
