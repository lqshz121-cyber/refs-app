import { readFileSync } from 'node:fs';
import {
  approveAndPostSuggestedJEs,
  buildAccountingEvents,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './src/wbs-accounting-foundation.js';

const fail = message => {
  console.error(message);
  process.exit(1);
};

const moduleSource = readFileSync('src/module-ai-je-workbench.jsx', 'utf8');
const appSource = readFileSync('src/app.jsx', 'utf8');

if (/[\p{Script=Han}\uFFFD]/u.test(moduleSource)) fail('AI JE Workbench contains visible CJK/mojibake characters.');
if (!appSource.includes("import { AIJEWorkbench }")) fail('AI JE Workbench is not imported by app.jsx.');
if (!appSource.includes("['aijeworkbench','AI JE Workbench']")) fail('AI JE Workbench is not in navigation.');
if (!appSource.includes('aijeworkbench:AIJEWorkbench')) fail('AI JE Workbench is not registered in route component map.');
[
  'AI JE Workbench',
  'Debit preview',
  'Credit preview',
  'Source retained',
  'Create Draft JE',
  'Post with controls',
  'Approve',
  'Reject',
  'Review note',
  'Audit trail',
].forEach(label => {
  if (!moduleSource.includes(label)) fail(`AI JE Workbench missing visible label/action ${label}.`);
});
if (!moduleSource.includes('approveAndPostSuggestedJEs')) fail('AI JE Workbench must use posting controls before post action.');
if (!moduleSource.includes('actions.newJEFromRule')) fail('AI JE Workbench must create JE records through app action boundary.');

const snapshot = createWbsMockDataset();
const events = buildAccountingEvents(snapshot);
const candidates = runDeterministicAccountingRules(snapshot, events).filter(item => item.suggested_je);
if (candidates.length < 8) fail('AI JE Workbench candidate source should expose multiple suggested JEs.');
candidates.forEach(candidate => {
  const debit = candidate.suggested_je.lines.reduce((total, line) => total + Number(line.debit_amount || 0), 0);
  const credit = candidate.suggested_je.lines.reduce((total, line) => total + Number(line.credit_amount || 0), 0);
  if (Math.abs(debit - credit) > 0.005) fail(`${candidate.rule_id} candidate is not balanced.`);
  if (!candidate.suggested_je.source_document_id) fail(`${candidate.rule_id} candidate lacks source document.`);
});

const [posted] = approveAndPostSuggestedJEs({
  suggestedJEs: [candidates.find(item => item.rule_id === 'LOAN_DRAW_RECOGNITION').suggested_je],
  periods: snapshot.accountingPeriods,
});
if (posted.posting_status !== 'POSTED') fail('AI JE Workbench posting control should allow a balanced source-backed open-period JE.');
const [blocked] = approveAndPostSuggestedJEs({
  suggestedJEs: [{ ...candidates[0].suggested_je, source_document_id: null }],
  periods: snapshot.accountingPeriods,
});
if (blocked.posting_status !== 'BLOCKED' || !/source/i.test(blocked.block_reason)) fail('AI JE Workbench posting control must block missing source documents.');

console.log('ai-je-workbench: route, controls, balanced candidates, source blockers and post validation passed');
