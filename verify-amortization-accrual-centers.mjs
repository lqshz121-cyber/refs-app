import { readFileSync } from 'node:fs';
import {
  ACCOUNT_MAP,
  buildAccountingEvents,
  createAmortizationScheduleFromInsurance,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './src/wbs-accounting-foundation.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};
const sum = (items, fn) => items.reduce((total, item) => total + Number(fn(item) || 0), 0);
const balanced = je => Math.abs(sum(je.lines || [], line => line.debit_amount) - sum(je.lines || [], line => line.credit_amount)) < 0.005;

const moduleSource = readFileSync('src/module-amortization-accrual.jsx', 'utf8');
const appSource = readFileSync('src/app.jsx', 'utf8');

if (/[\p{Script=Han}\uFFFD]/u.test(moduleSource)) fail('Amortization/Accrual module contains visible CJK or mojibake.');
if (!appSource.includes("import { AccrualCenter, AmortizationCenter }")) fail('Amortization/Accrual centers are not imported by app.jsx.');
if (!appSource.includes("['amortization', 'Amortization Center']")) fail('Amortization Center is not registered in navigation.');
if (!appSource.includes("['accruals', 'Accrual Center']")) fail('Accrual Center is not registered in navigation.');
if (!appSource.includes('COMP.amortization = AmortizationCenter')) fail('Amortization Center is not registered in route component map.');
if (!appSource.includes('COMP.accruals = AccrualCenter')) fail('Accrual Center is not registered in route component map.');

[
  'Amortization Center',
  'Coverage period',
  'Monthly lines',
  'Recognized',
  'Remaining balance',
  'Source evidence',
  'Automatic 12-month schedule',
  'automatically creates this prepaid amortization schedule',
  'Create selected monthly Draft JE',
  'Accrual Center',
  'Month-end accrual checklist',
  'Create accrual Draft JE',
  'Create reversing Draft JE',
  'Reversing JE preview',
  'No automatic posting',
].forEach(label => {
  if (!moduleSource.includes(label)) fail(`Missing required visible label or control: ${label}`);
});
if (!moduleSource.includes("const scheduleStatus = state.status || 'AUTO_SCHEDULED'")) fail('Insurance amortization must render as an automatically generated schedule.');
if (moduleSource.includes('Activate schedule')) fail('Automatic insurance schedules must not require manual activation.');
if (!moduleSource.includes('actions.newJEFromRule')) fail('Centers must create Draft JEs through the app action boundary.');
if (/posting_status:\\s*'POSTED'/.test(moduleSource)) fail('Centers must not create posted journal entries.');

const snapshot = createWbsMockDataset();
const insuranceInvoice = snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO');
const schedule = createAmortizationScheduleFromInsurance(insuranceInvoice);
if (schedule.lines.length !== 12) fail(`Expected 12 amortization lines, got ${schedule.lines.length}.`);
const scheduleTotal = sum(schedule.lines, line => line.amount);
if (Math.abs(scheduleTotal - 12000) > 0.005) fail(`Amortization schedule does not tie to source amount: ${scheduleTotal}.`);
schedule.lines.forEach(line => {
  if (!balanced(line.suggested_je)) fail(`Amortization JE for ${line.period} is not balanced.`);
  if (line.suggested_je.source_document_id !== 'DOC-INS-12MO') fail(`Amortization JE for ${line.period} lost source document.`);
  const [debit, credit] = line.suggested_je.lines;
  if (debit.account_code !== ACCOUNT_MAP.insuranceExpense || credit.account_code !== ACCOUNT_MAP.prepaidInsurance) fail(`Amortization JE for ${line.period} uses wrong accounts.`);
});

const events = buildAccountingEvents(snapshot);
const findings = runDeterministicAccountingRules(snapshot, events);
const accrual = findings.find(finding => finding.rule_id === 'ACCRUAL_CANDIDATE');
if (!accrual?.suggested_je) fail('Expected source-backed accrual candidate with suggested JE.');
if (!balanced(accrual.suggested_je)) fail('Accrual candidate suggested JE is not balanced.');
if (accrual.suggested_je.source_document_id !== 'DOC-AP-MISSING-GL') fail('Accrual candidate lost source document.');
if (accrual.suggested_je.lines[0].account_code !== ACCOUNT_MAP.cwip || accrual.suggested_je.lines[1].account_code !== ACCOUNT_MAP.ap) fail('Accrual candidate uses wrong accounts.');
if (!moduleSource.includes('reversalSpecFromJE')) fail('Accrual Center must build a deterministic reversing Draft JE preview.');

console.log('amortization-accrual-centers: routes, labels, source-backed schedules, balanced accrual and draft-only controls passed');
