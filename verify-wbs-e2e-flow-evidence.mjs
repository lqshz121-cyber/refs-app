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
if (!evidence.allFlowsReported || !evidence.allFlowsTraceable || !evidence.allFlowsComplete || !evidence.all_flow_source_documents_admitted) fail('All 10 named local mock flows must retain an admitted source document and their explicit terminal evidence.');
if (evidence.controls.complete_flows !== 10 || evidence.controls.incomplete_flows !== 0) fail('Every local mock flow must reach its explicitly permitted terminal state.');
if (evidence.controls.flows_with_suggested_je !== 10 || evidence.controls.flows_with_review !== 10 || evidence.controls.flows_with_posted_je !== 6 || evidence.controls.flows_with_gl_impact !== 7 || evidence.controls.flows_with_report_impact !== 7 || evidence.controls.flows_with_audit !== 10) fail('The evidence counters must distinguish posted, review-only, aggregate and analysis terminal states.');
if (evidence.controls.flows_with_suggested_je_or_explicit_blocker !== evidence.controls.flows_with_suggested_je
  || evidence.controls.flows_with_posted_or_blocked_state !== evidence.controls.flows_with_posted_je
  || evidence.controls.flows_with_gl_or_blocker !== evidence.controls.flows_with_gl_impact
  || evidence.controls.flows_with_report_or_blocker !== evidence.controls.flows_with_report_impact) fail('Legacy counters must remain fail-closed and must never count blockers as completed evidence.');
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
  if (!row.evidence || row.evidence_state !== 'COMPLETE' || !Array.isArray(row.required_evidence) || !Array.isArray(row.missing_evidence)) fail(`E2E flow ${id} is missing its explicit completion result.`);
  const missing = row.required_evidence.filter(key => !row.evidence[key]);
  if (missing.join('|') !== row.missing_evidence.join('|')) fail(`E2E flow ${id} has inconsistent missing-evidence metadata.`);
  if (missing.length !== 0) fail(`E2E flow ${id} must satisfy every evidence item required by its completion model.`);
  if (row.posted_state === 'POSTED_SOURCE_ONLY') fail(`E2E flow ${id} must not infer a posted state without a same-lineage posted JE.`);
});
const loan = evidence.flows.find(flow => flow.id === 'LOAN_DRAW_TO_REPORTS');
if (loan.evidence_state !== 'COMPLETE' || loan.posted_state !== 'POSTED_SAME_LINEAGE' || loan.posted_je_id !== loan.suggested_je_id || loan.gl_line_count !== 2 || loan.report_impact_count !== 2 || loan.control_state !== 'POSTED_MOCK_IMPACT_TIED') fail('Loan draw E2E flow must retain the same source and JE identity through review, posting, GL and report impact.');
const insurance = evidence.flows.find(flow => flow.id === 'INSURANCE_TO_AMORTIZATION');
if (insurance.control_state !== 'SCHEDULE_POSTED_MOCK_IMPACT_TIED' || insurance.evidence_state !== 'COMPLETE' || insurance.posted_je_id !== 'AMORT-AP-INS-12MO-2026-07' || insurance.gl_line_count !== 2 || insurance.report_impact_count !== 2 || insurance.observed_gl_line_count !== 4 || insurance.observed_report_impact_count !== 4) fail('Insurance must retain a 12-month schedule while only the reviewed July amortization posts into same-lineage evidence.');
const bankException = evidence.flows.find(flow => flow.id === 'BANK_TO_EXCEPTION');
if (bankException.completion_model !== 'CONTROL_REVIEW' || bankException.terminal_outcome !== 'EXCEPTION_RETAINED' || bankException.evidence_state !== 'COMPLETE' || bankException.evidence.posted_je || bankException.evidence.gl_impact || bankException.evidence.report_impact) fail('Unmatched bank payment must complete as an audited retained exception and never count as posted/GL/report evidence.');
const propertyTax = evidence.flows.find(flow => flow.id === 'PROPERTY_TAX_TO_ACCRUAL');
if (propertyTax.source_id !== 'PTAX-TRAVIS-2026' || propertyTax.rule_id !== 'PROPERTY_TAX_ACCRUAL_REQUIRED') fail('Property tax flow must derive from the WBS mock statement and deterministic accrual rule.');
if (!propertyTax.suggested_je_balanced || propertyTax.review_status !== 'APPROVED_FOR_MOCK_POSTING') fail('Property tax flow must retain its explicit review approval before the mock posted projection.');
if (propertyTax.evidence_state !== 'COMPLETE' || propertyTax.control_state !== 'POSTED_MOCK_IMPACT_TIED' || propertyTax.posted_state !== 'POSTED_SAME_LINEAGE' || propertyTax.posted_je_id !== propertyTax.suggested_je_id || propertyTax.gl_line_count !== 2 || propertyTax.report_impact_count !== 2 || propertyTax.audit_trail_count < 4) fail('Property tax flow must retain the same source and JE identity through review, posting, GL, report and audit evidence.');
const payable = evidence.flows.find(flow => flow.id === 'PAYABLE_TO_ACCRUAL');
if (payable.evidence_state !== 'COMPLETE' || payable.control_state !== 'POSTED_MOCK_IMPACT_TIED' || payable.posted_state !== 'POSTED_SAME_LINEAGE' || payable.posted_je_id !== payable.suggested_je_id || payable.gl_line_count !== 2 || payable.report_impact_count !== 2 || payable.audit_trail_count < 4) fail('Payable accrual flow must retain the same source and JE identity through explicit review, posting, GL, report and audit evidence.');
const cost = evidence.flows.find(flow => flow.id === 'COST_GL_TO_CWIP_REVIEW');
if (cost.completion_model !== 'CONTROL_REVIEW' || cost.terminal_outcome !== 'CUTOFF_REVIEW_RETAINED' || cost.evidence_state !== 'COMPLETE' || cost.gl_line_count !== 0 || cost.report_impact_count !== 0) fail('Cost GL cutoff must complete as a retained controller review without a reclass posting.');
const rent = evidence.flows.find(flow => flow.id === 'PROPERTY_OPS_TO_REVENUE');
if (rent.completion_model !== 'CONTROL_REVIEW' || rent.terminal_outcome !== 'REVENUE_MISMATCH_RETAINED' || rent.evidence_state !== 'COMPLETE' || rent.posted_je_id !== null) fail('Rent roll variance must complete as an audited retained mismatch; existing revenue cannot be borrowed as a pickup adjustment.');
for (const id of ['SOURCE_TO_TB', 'TB_TO_STATEMENTS']) {
  const aggregate = evidence.flows.find(flow => flow.id === id);
  if (aggregate.completion_model !== 'AGGREGATE_POSTED' || aggregate.evidence_state !== 'COMPLETE' || !aggregate.evidence.aggregate_trace || aggregate.gl_line_count < 1 || aggregate.report_impact_count < 1 || aggregate.aggregate_trace.source_document_ids.length < 2) fail(`${id} must retain a tied multi-source posted aggregate trace.`);
}
const analysis = evidence.flows.find(flow => flow.id === 'GL_TO_AI_ANALYSIS');
if (analysis.completion_model !== 'AI_ANALYSIS' || analysis.evidence_state !== 'COMPLETE' || analysis.terminal_outcome !== 'ANALYSIS_RETAINED' || analysis.posted_je_id !== null || analysis.gl_line_count < 1 || analysis.report_impact_count < 1 || analysis.audit_trail_count < 1) fail('GL-to-analysis must complete as an audited read-only analysis and never become an AI posting path.');
if (!evidence.controls.trial_balance_tied || !evidence.controls.balance_sheet_tied) fail('E2E report controls must tie for the mock posted set.');
if (!evidence.boundaries.includes('No production WBS call')) fail('Missing production WBS boundary.');

console.log('wbs-e2e-flow-evidence: 10 workflows reached their explicit local mock terminal evidence states without fabricating review-only or AI postings');
