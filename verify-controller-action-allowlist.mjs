import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./src/legacy-demo-app.jsx', import.meta.url), 'utf8');
const start = app.indexOf('function Approvals({ctx})');
const end = app.indexOf('\nexport { App,', start);
assert.ok(start >= 0 && end > start, 'Controller Action Required workspace must be statically locatable.');
const actionQueue = app.slice(start, end);

// This gate intentionally scopes only the Controller action queue. Controlled JE/AP
// workflow pages have their own role, SoD and transition tests and are not false positives here.
const enabledButtons = [...actionQueue.matchAll(/<button\b/g)];
const enabledActionLabels = [...actionQueue.matchAll(/>([^<{}]+)<\/button>/g)]
  .map(match => match[1].trim())
  .filter(Boolean);
assert.equal(enabledButtons.length, enabledActionLabels.length,
  'Every Controller action must have a static, auditable text label.');
assert.deepEqual(enabledActionLabels.sort(), ['Open JE evidence', 'Open bill evidence'].sort(),
  `Controller action queue exposes a non-allowlisted enabled action: ${enabledActionLabels.join(', ')}`);

const forbiddenMutations = [
  /\b(?:Fix|Apply|Accept|Approve|Reject|Post|Pay|Refund|Delete|Create|Connect|Import|Export|Match|Categorize|Sign[- ]?off)\b/i,
  /\bauto[- ]?post\b/i,
  /actions\.(?:advanceJE|approveBill|post|pay|match|create|delete|refund)/,
];
for (const pattern of forbiddenMutations) {
  assert.doesNotMatch(actionQueue, pattern, `Controller action queue contains prohibited mutation surface: ${pattern}`);
}

assert.match(actionQueue, /goto\('je',\{jeNumber:j\.je_number,actionQueueReturn:\{route:'approvals'\}\}\)/,
  'JE evidence drill must retain the exact journal and Action Required return context.');
assert.match(actionQueue, /goto\('ap',\{route:'ap',tab:'Bills',billId:b\.bill_id,actionQueueReturn:\{route:'approvals'\}\}\)/,
  'Bill evidence drill must retain the exact bill and Action Required return context.');
assert.match(actionQueue, /posting_status/, 'JE action rows must expose workflow status context.');
assert.match(actionQueue, /b\.status/, 'Bill action rows must expose workflow status context.');
assert.match(actionQueue, /Approval and posting remain in their controlled accounting workflows/,
  'The read-only action boundary must be visible to Controllers.');

const journal = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');
const bills = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
assert.match(journal, /returnToActionQueue[\s\S]*Back to Action Required/,
  'JE detail must consume Action Required return context.');
assert.match(bills, /actionQueueReturn\?\.route === 'approvals'[\s\S]*Back to Action Required/,
  'Bill detail must consume Action Required return context.');

console.log('PASS: Controller Action Required is evidence-only with exact JE/Bill drills and no mutation handlers.');
