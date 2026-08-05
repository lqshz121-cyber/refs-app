import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const source = read('./src/module-banktx.jsx');
const styles = read('./index.html');

const requiredSource = [
  "{h:'Bank activity'",
  "{h:'Amount'",
  "{h:'Local evidence'",
  "{h:'Status'",
  "{h:'Evidence'",
  'bank-row-primary',
  'bank-amount',
  'bank-evidence-stack',
  'bank-status-stack',
  'Open detail',
  'Back to reconciliation history',
  'Local bank transaction evidence detail',
  'Retained local bank evidence is read-only',
  'bank-queue-empty',
];

for (const text of requiredSource) {
  assert.ok(source.includes(text), `Bank transaction layout is missing: ${text}`);
}

const forbiddenSource = [
  'type="checkbox"',
  'Local posted-bank trace',
  'selectedPostedTxn',
  'selectedPostedTrace',
];

for (const text of forbiddenSource) {
  assert.ok(!source.includes(text), `Bank transaction queue still contains overloaded or unused UI: ${text}`);
}

const columnBlock = source.match(/const cols = \[([\s\S]*?)\n  \];/u)?.[1] || '';
const forbiddenPrimaryColumns = [
  "{h:'Spent'",
  "{h:'Received'",
  "{h:'From / To'",
  "{h:'Proof state'",
  "{h:'Lifecycle'",
  "{h:'Candidate evidence'",
  "{h:'Review candidate'",
];

for (const text of forbiddenPrimaryColumns) {
  assert.ok(!columnBlock.includes(text), `Primary bank queue still contains an overloaded column: ${text}`);
}

assert.equal((columnBlock.match(/\{h:/gu) || []).length, 6, 'The primary bank queue must remain a six-column review table');

for (const text of [
  '.bank-table .tbl{width:100%;min-width:880px;table-layout:fixed}',
  '.bank-row-primary,.bank-amount,.bank-evidence-stack,.bank-status-stack',
  '.bank-status-stack .badge',
  '@media(max-width:1280px)',
  '.bank-table .table-wrap,.bank-table .tbl{min-width:820px}',
]) {
  assert.ok(styles.includes(text), `Responsive bank layout CSS is missing: ${text}`);
}

console.log('PASS: Bank transactions uses a readable six-column, read-only evidence layout with responsive hierarchy and no unused selection UI');
