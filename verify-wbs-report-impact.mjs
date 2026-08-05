import { readFileSync } from 'node:fs';
import { buildWbsReportImpact } from './src/wbs-report-impact.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync('src/wbs-report-impact.js', 'utf8');
const reportsSource = readFileSync('src/modules-more.jsx', 'utf8');
const auditSource = readFileSync('src/module-aiaudit.jsx', 'utf8');
const sectionStart = auditSource.indexOf('Accounting analysis report');
const sectionEnd = auditSource.indexOf('Accounting action queue', sectionStart);
const section = sectionStart >= 0 && sectionEnd > sectionStart ? auditSource.slice(sectionStart, sectionEnd) : '';

if (/[\p{Script=Han}\uFFFD]/u.test(source)) fail('WBS report impact source contains visible CJK or replacement characters.');
if (/[\p{Script=Han}\uFFFD]/u.test(section)) fail('WBS report impact UI section contains visible CJK or replacement characters.');
if (!auditSource.includes("import { buildWbsAccountingAnalysisReport }")) fail('AI Audit does not import the WBS accounting analysis report.');
if (!auditSource.includes('const accountingAnalysisReport = buildWbsAccountingAnalysisReport(snapshot);')) fail('AI Audit does not build the WBS accounting analysis report.');
if (reportsSource.includes('aria-label="WBS mock posted JE report impact"')) fail('Unscoped WBS mock values must not be rendered inside entity-scoped Reports Center results.');
[
  'Accounting analysis report',
  'Findings, close controls, posted impact and workflow blockers',
  'Controls tied',
  'Net income',
  'Closing cash',
  'never calls production WBS',
  'never exports report data',
  'never posts outside the guarded mock posting gate',
].forEach(label => {
  if (!section.includes(label)) fail(`Missing report-impact UI label/boundary: ${label}`);
});

const impact = buildWbsReportImpact();
if (impact.mode !== 'WBS_MOCK_POSTED_REPORT_IMPACT') fail('Unexpected report-impact mode.');
if (impact.postedWbsJEs.length !== 1) fail(`Expected exactly one posted WBS mock JE, got ${impact.postedWbsJEs.length}.`);
const loanJe = impact.postedWbsJEs[0];
if (loanJe.posting_status !== 'POSTED' || loanJe.ai_rule_id !== 'LOAN_DRAW_RECOGNITION') fail('Loan draw mock JE must be posted and rule-bound.');
if (impact.postedJournalEntries.some(je => je.posting_status !== 'POSTED')) fail('Report impact must include POSTED journal entries only.');
if (!impact.glLines.some(line => line.source_document_id === 'DOC-LOAN-DRAW' && line.account_code === '111000' && line.debit_amount === 250000)) fail('Loan draw cash GL impact is missing.');
if (!impact.glLines.some(line => line.source_document_id === 'DOC-LOAN-DRAW' && line.account_code === '211000' && line.credit_amount === 250000)) fail('Loan draw loan-payable GL impact is missing.');
if (!impact.trialBalance.balanced) fail('WBS mock Trial Balance projection must tie.');
if (!impact.statement.balanceSheetTied) fail('WBS mock Balance Sheet projection must tie.');
if (impact.statement.revenue !== 87500) fail(`Expected rent revenue 87500, got ${impact.statement.revenue}.`);
if (impact.statement.netIncome !== 87500) fail(`Expected net income 87500, got ${impact.statement.netIncome}.`);
if (impact.cashFlow.financing !== 250000) fail(`Expected financing cash flow 250000, got ${impact.cashFlow.financing}.`);
if (impact.cashFlow.closingCash !== 238000) fail(`Expected closing cash 238000, got ${impact.cashFlow.closingCash}.`);
if (impact.controls.some(control => control.state !== 'TIED')) fail('All local report impact controls should tie for the deterministic mock dataset.');
if (!impact.boundaries.includes('No real WBS call or signed receipt')) fail('Missing external WBS boundary.');

console.log('wbs-report-impact: posted JE projection, financial statement controls, source trace and no-mutation UI boundary passed');
