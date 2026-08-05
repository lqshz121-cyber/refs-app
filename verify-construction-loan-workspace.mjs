import { readFileSync } from 'node:fs';
import {
  ACCOUNT_MAP,
  buildAccountingEvents,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './src/wbs-accounting-foundation.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};
const sum = (items, fn) => items.reduce((total, item) => total + Number(fn(item) || 0), 0);
const balanced = je => Math.abs(sum(je?.lines || [], line => line.debit_amount) - sum(je?.lines || [], line => line.credit_amount)) < 0.005;

const source = readFileSync('src/modules-core.jsx', 'utf8');
const start = source.indexOf('export function LoanWorkspace');
const end = source.indexOf('// ---------------- Property Operations Pickup', start);
if (start < 0 || end < 0) fail('LoanWorkspace function block not found.');
const block = source.slice(start, end);

if (/[\p{Script=Han}\uFFFD]/u.test(block)) fail('Construction Loan Workspace block contains visible CJK or replacement characters.');
[
  'Construction Loan Workspace',
  'WBS mock loan draw',
  'Loan number',
  'Lender balance',
  'GL loan balance',
  'Variance',
  'Loan findings',
  'Rule findings',
  'Accounting events',
  'Open review',
  'Draft blocked: construction-loan JE must be balanced and source-backed.',
  'Create Draft JE',
  'View source events',
  'No lender connection, bank feed, automatic capitalization, posting or reconciliation sign-off is performed here.',
].forEach(label => {
  if (!block.includes(label)) fail(`Construction Loan Workspace missing required label/control: ${label}`);
});
if (!source.includes("import { repo } from './repo.js';")) fail('Construction Loan Workspace must import repo for review persistence and audit.');
if (!block.includes('createWbsMockDataset') || !block.includes('runDeterministicAccountingRules')) fail('Construction Loan Workspace must consume WBS mock rule output.');
if (!block.includes('actions.newJEFromRule')) fail('Construction Loan Workspace must create Draft JEs through app action boundary.');
if (/posting_status:\\s*'POSTED'/.test(block)) fail('Construction Loan Workspace must not create posted journal entries.');
if (!block.includes('CONSTRUCTION_LOAN_DRAFT_BLOCKED')) fail('Missing-source loan candidates must have an auditable blocked path.');

const snapshot = createWbsMockDataset();
const events = buildAccountingEvents(snapshot);
const loanEvents = events.filter(event => /loan/i.test(event.event_type) || /LOAN|INTEREST/i.test(event.rule_id));
const findings = runDeterministicAccountingRules(snapshot, events).filter(finding => /LOAN|INTEREST/i.test(finding.rule_id));
if (loanEvents.length < 3) fail(`Expected at least 3 loan-related accounting events, got ${loanEvents.length}.`);
['BANK_LOAN_DRAW_DETECTED', 'LOAN_DRAW', 'LOAN_INTEREST'].forEach(ruleId => {
  if (!loanEvents.some(event => event.rule_id === ruleId)) fail(`Missing loan accounting event ${ruleId}.`);
});
['LOAN_DRAW_RECOGNITION', 'INTEREST_CAPITALIZATION_REQUIRED', 'LOAN_BALANCE_MISMATCH'].forEach(ruleId => {
  if (!findings.some(finding => finding.rule_id === ruleId)) fail(`Missing construction loan finding ${ruleId}.`);
});
const draw = findings.find(finding => finding.rule_id === 'LOAN_DRAW_RECOGNITION' && finding.suggested_je?.source_document_id);
if (!draw || !balanced(draw.suggested_je)) fail('Source-backed loan draw recognition must produce a balanced suggested JE.');
if (draw.suggested_je.lines[0].account_code !== ACCOUNT_MAP.cash || draw.suggested_je.lines[1].account_code !== ACCOUNT_MAP.loanPayable) fail('Loan draw JE must debit cash and credit loan payable.');
const interest = findings.find(finding => finding.rule_id === 'INTEREST_CAPITALIZATION_REQUIRED');
if (!interest || !balanced(interest.suggested_je)) fail('Interest capitalization finding must produce a balanced suggested JE.');
if (interest.suggested_je.lines[0].account_code !== ACCOUNT_MAP.capitalizedInterest) fail('Interest capitalization must debit capitalized interest/CWIP account.');
if (!interest.suggested_je.source_document_id) fail('Interest capitalization must retain the WBS mock source transaction reference.');
const mismatch = findings.find(finding => finding.rule_id === 'LOAN_BALANCE_MISMATCH');
if (!mismatch || Math.abs(snapshot.constructionLoans[0].lender_balance - snapshot.constructionLoans[0].gl_balance) !== 250000) fail('Loan balance mismatch evidence does not tie to lender/GL variance.');

console.log('construction-loan-workspace: WBS mock events, loan findings, balanced draft previews and missing-source blockers passed');
