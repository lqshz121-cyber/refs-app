import { readFileSync } from 'node:fs';
import { buildWbsBankReconciliationEvidence } from './src/wbs-bank-reconciliation-evidence.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const evidenceSource = readFileSync('src/wbs-bank-reconciliation-evidence.js', 'utf8');
const bankRecSource = readFileSync('src/module-bankrec.jsx', 'utf8');
const sectionStart = bankRecSource.indexOf('WBS mock bank rule evidence');
const sectionEnd = bankRecSource.indexOf('Reconciliation statement bridge', sectionStart);
const section = sectionStart >= 0 && sectionEnd > sectionStart ? bankRecSource.slice(sectionStart, sectionEnd) : '';

if (/[\p{Script=Han}\uFFFD]/u.test(evidenceSource)) fail('WBS bank reconciliation evidence source contains visible CJK or replacement characters.');
if (/[\p{Script=Han}\uFFFD]/u.test(section)) fail('WBS bank evidence UI section contains visible CJK or replacement characters.');
if (!bankRecSource.includes("import { buildWbsBankReconciliationEvidence }")) fail('BankRec does not import WBS bank reconciliation evidence.');
if (!bankRecSource.includes('useMemo(()=>buildWbsBankReconciliationEvidence(),[])')) fail('BankRec does not build WBS bank evidence through a stable memoized model.');
[
  'WBS mock bank rule evidence',
  'Read-only WBS mock bank transactions are classified before reconciliation.',
  'Total WBS bank rows',
  'Matched candidates',
  'Missing AP exceptions',
  'Loan draws detected',
  'Review required',
  'WBS bank item',
  'Control state',
  'cannot update the local worksheet',
].forEach(label => {
  if (!section.includes(label)) fail(`Missing WBS bank evidence label/control: ${label}`);
});
['auto-matches', 'clears', 'posts', 'signs off'].forEach(boundary => {
  if (!section.includes(boundary)) fail(`Missing no-mutation boundary language: ${boundary}`);
});

const evidence = buildWbsBankReconciliationEvidence();
if (evidence.mode !== 'WBS_MOCK_BANK_RECONCILIATION') fail('Unexpected WBS bank evidence mode.');
if (evidence.summary.total !== 3) fail(`Expected 3 WBS bank rows, got ${evidence.summary.total}.`);
if (evidence.summary.matched !== 1) fail(`Expected 1 matched candidate, got ${evidence.summary.matched}.`);
if (evidence.summary.missingAp !== 1) fail(`Expected 1 missing AP exception, got ${evidence.summary.missingAp}.`);
if (evidence.summary.loanDraws !== 1) fail(`Expected 1 loan draw, got ${evidence.summary.loanDraws}.`);
if (evidence.summary.reviewRequired !== 2) fail(`Expected 2 review-required rows, got ${evidence.summary.reviewRequired}.`);
if (Math.abs(evidence.summary.totalAmount - 229500) > 0.005) fail(`WBS bank signed total does not tie: ${evidence.summary.totalAmount}.`);
const exact = evidence.bankRows.find(row => row.bank_txn_id === 'BANK-INS-PAY');
if (!exact || exact.suggested_queue !== 'EXACT_MATCH_REVIEW' || exact.control_state !== 'MATCH_CANDIDATE_RETAINED' || exact.can_auto_match !== false || exact.can_post !== false) fail('Exact match candidate classification is incorrect or mutating.');
const missing = evidence.bankRows.find(row => row.bank_txn_id === 'BANK-UNMATCHED-01');
if (!missing || missing.suggested_queue !== 'MISSING_AP_EXCEPTION' || missing.control_state !== 'AP_SOURCE_REQUIRED' || missing.risk_level !== 'HIGH' || !/invoice|payable|support/i.test(`${missing.reason} ${missing.suggested_action}`)) fail('Missing AP bank exception classification is incorrect.');
const loan = evidence.bankRows.find(row => row.bank_txn_id === 'BANK-LOAN-DRAW-01');
if (!loan || loan.suggested_queue !== 'LOAN_DRAW_REVIEW' || loan.control_state !== 'LOAN_DRAW_DETECTED' || loan.rule_id !== 'LOAN_DRAW_RECOGNITION') fail('Loan draw bank classification is incorrect.');
if (evidence.bankRows.some(row => row.can_auto_match || row.can_post)) fail('WBS bank evidence must not authorize auto-match or posting.');

console.log('wbs-bank-reconciliation-evidence: mock bank classification, exception queues and no-mutation UI boundary passed');
