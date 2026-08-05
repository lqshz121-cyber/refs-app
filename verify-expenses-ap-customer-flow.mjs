import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');

const required = [
  "<Tabs tabs={['Bills','Payments','AP Aging','Vendors']}",
  'Bill review queues',
  'Open bill evidence',
  'Open credit evidence',
  'Open payment evidence',
  'Open GL',
  'Open Trial Balance',
  'Open bank evidence',
  'Payment readiness review',
  'Back to Expenses',
  'Back to Bill payments',
  'Back returns to this queue with its filters intact',
  'This queue is evidence review only',
];

const prohibited = [
  'Observed QuickBooks Expenses navigation',
  'Observed QBO Expenses navigation shell',
  'Observed QuickBooks Bills queues',
  'Observed QBO shell:',
  'Recurring bills are not established by local evidence',
  'Delivery method <select disabled>',
  'Any — unverified',
  "['Class',null]",
  'Rows <select disabled',
  '>Details</Btn>',
  '>GL</Btn>',
  '>TB</Btn>',
  '>Bank</Btn>',
  'Pay selected',
  'Pay vendors',
  'Print Checks',
  '+ New transaction',
  'Export to Excel',
];

for (const text of required) {
  assert.ok(source.includes(text), `Expenses/AP flow is missing required customer-facing contract: ${text}`);
}

for (const text of prohibited) {
  assert.ok(!source.includes(text), `Expenses/AP flow still exposes duplicate, ambiguous, or unsupported scaffolding: ${text}`);
}

assert.match(source, /row\.kind==='BILL'\?'Open bill evidence':'Open credit evidence'/, 'Unified expense rows must expose an explicit evidence action');
assert.match(source, /features=\{\{exportable:false\}\} cols=\{\[/, 'Vendor evidence table must remain non-exporting');
assert.ok(!source.includes('const [checked, setChecked]'), 'Read-only payment review must not retain payment-selection state');

console.log('PASS: Expenses/AP customer flow is focused, explicit, read-only, and scope-restoring');
