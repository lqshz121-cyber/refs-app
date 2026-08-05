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
  'Approve',
  'Reject',
  'Review note',
  'Audit trail',
].forEach(label => {
  if (!moduleSource.includes(label)) fail(`AI JE Workbench missing visible label/action ${label}.`);
});
if (moduleSource.includes('approveAndPostSuggestedJEs') || moduleSource.includes('postCandidate') || moduleSource.includes('Post with controls')) fail('AI JE Workbench must not expose a posting path.');
if (!moduleSource.includes('Posting from workbench') || !moduleSource.includes('value="Disabled"')) fail('AI JE Workbench must visibly disable posting.');
if (!moduleSource.includes('posting remain in the controlled Journal Entry workflow')) fail('AI JE Workbench must route posting to the controlled JE workflow.');
if (!moduleSource.includes('actions.newJEFromRule')) fail('AI JE Workbench must create JE records through app action boundary.');
if (!moduleSource.includes("specFromItem(item, 'DRAFT')")) fail('AI JE Workbench may create Draft JEs only.');
if (moduleSource.includes("specFromItem(item, 'POSTED')")) fail('AI JE Workbench must never create a Posted JE.');
if (!moduleSource.includes('createAIReviewOutcomeRepository')) fail('AI JE Workbench must persist canonical human review outcomes.');
if (!moduleSource.includes("decision:'APPROVE'") || !moduleSource.includes("decision:'REJECT'")) fail('AI JE Workbench must retain explicit human approve/reject decisions.');
if (!moduleSource.includes("item.workflow !== 'APPROVED'")) fail('AI JE Workbench must block Draft creation until a retained approval outcome exists.');

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

console.log('ai-je-workbench: route, human review, balanced candidates, source blockers, Draft-only creation and no posting path passed');
