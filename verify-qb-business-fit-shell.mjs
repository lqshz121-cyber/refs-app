import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');

const checks = [
  {
    file: './src/module-ap.jsx',
    absent: [
      'Purchase notifications',
      'Print Checks',
      '+ New transaction',
      'Export to Excel',
      'Pay selected',
      'Pay vendors',
      'New vendor',
      'Create local bill',
      'Explore payroll',
      'Intuit Expert Assisted',
    ],
    present: [
      'Payment readiness review',
      'Open bill evidence',
      'Vendor evidence detail',
      'payment evidence read-only',
    ],
  },
  {
    file: './src/module-coa.jsx',
    absent: [
      'Batch actions',
      'Batch edit',
      'Export chart of accounts',
      '+ New account unavailable',
      '>Print<',
    ],
    present: [
      'Local chart-of-accounts evidence',
      'Register/GL drills are functional',
      'Account creation, activation changes, batch edits',
    ],
  },
  {
    file: './src/module-banktx.jsx',
    absent: [
      'Update accounts',
      'Link account',
      'Upload receipts',
      'Export CSV',
      'Report now',
      'Fix now',
      'Disconnect',
      'Batch decision unavailable',
      '鈫',
      '鈥',
      ' 路 ',
    ],
    present: [
      'Retained local receipt evidence',
      'Bank connection actions are outside REFS',
      'Drill path: report to detail ledger to source-ready bank evidence',
    ],
  },
];

for (const check of checks) {
  const source = read(check.file);
  for (const text of check.absent) {
    assert.ok(!source.includes(text), `${check.file} still exposes unsupported shell text: ${text}`);
  }
  for (const text of check.present) {
    assert.ok(source.includes(text), `${check.file} missing retained-evidence shell text: ${text}`);
  }
}

console.log('PASS: QB business-fit shell excludes unsupported QBO/payment/feed/export actions');
