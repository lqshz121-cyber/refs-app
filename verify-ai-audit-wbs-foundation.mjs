import { readFileSync } from 'node:fs';
import {
  buildAccountingEvents,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './src/wbs-accounting-foundation.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const source = readFileSync('src/module-aiaudit.jsx', 'utf8');
if (!source.includes("from './wbs-accounting-foundation.js'")) fail('AI Audit Center is not connected to WBS accounting foundation.');
if (!source.includes('createWbsMockDataset') || !source.includes('runDeterministicAccountingRules')) fail('AI Audit Center must use mock WBS dataset and deterministic rule results.');
if (/[\p{Script=Han}\uFFFD]/u.test(source)) fail('AI Audit Center contains visible CJK/mojibake characters.');
[
  'Critical Findings',
  'Accounting Logic',
  'Mapping Issues',
  'Missing Source',
  'Duplicate Risk',
  'Cutoff Risk',
  'Reconciliation',
  'Prepaid / Amortization',
  'Accruals',
  'Loan Accounting',
  'Property-level Issues',
  'Resolved',
].forEach(label => {
  if (!source.includes(label)) fail(`AI Audit Center missing tab ${label}.`);
});
['Create Draft JE', 'Create reclass', 'Create amortization schedule', 'Mark resolved', 'Audit trail'].forEach(label => {
  if (!source.includes(label)) fail(`AI Audit Center missing action or evidence label ${label}.`);
});

const snapshot = createWbsMockDataset();
const events = buildAccountingEvents(snapshot);
const findings = runDeterministicAccountingRules(snapshot, events);
const requiredRules = [
  'PREPAID_SCHEDULE_REQUIRED',
  'PAYMENT_WITHOUT_BILL',
  'LOAN_DRAW_RECOGNITION',
  'INTEREST_CAPITALIZATION_REQUIRED',
  'ACCRUAL_CANDIDATE',
  'DUPLICATE_INVOICE_RISK',
  'CWIP_POST_COMPLETION_CUTOFF',
  'LOAN_BALANCE_MISMATCH',
  'RENT_ROLL_REVENUE_MISMATCH',
];
requiredRules.forEach(ruleId => {
  const finding = findings.find(item => item.rule_id === ruleId);
  if (!finding) fail(`Rule engine missing ${ruleId}.`);
  ['reason', 'suggested_action', 'confidence_score', 'owner', 'due_date', 'audit_trail'].forEach(field => {
    if (!(field in finding)) fail(`${ruleId} missing ${field}.`);
  });
});
const suggested = findings.filter(item => item.suggested_je);
if (suggested.length < 8) fail('Expected WBS rule results to produce multiple suggested JE drafts.');
suggested.forEach(item => {
  const debit = item.suggested_je.lines.reduce((sum, line) => sum + Number(line.debit_amount || 0), 0);
  const credit = item.suggested_je.lines.reduce((sum, line) => sum + Number(line.credit_amount || 0), 0);
  if (Math.abs(debit - credit) > 0.005) fail(`${item.rule_id} suggested JE is not balanced.`);
  if (!item.suggested_je.source_document_id) fail(`${item.rule_id} suggested JE lacks source reference.`);
});

console.log('ai-audit-wbs-foundation: connected to deterministic WBS findings, actions, audit trail and balanced suggested JEs');
