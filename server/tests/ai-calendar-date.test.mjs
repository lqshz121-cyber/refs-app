import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {isStrictCalendarDate} from '../runtime/ai-calendar-date.mjs';

test('accepts real Gregorian dates including leap day',()=>{
  for(const value of ['2026-01-01','2026-12-31','2024-02-29'])assert.equal(isStrictCalendarDate(value),true,value);
});

test('rejects normalized, impossible, or noncanonical dates',()=>{
  for(const value of ['2026-02-29','2026-02-30','2026-04-31','2026-13-01','2026-00-10','2026-01-00','2026-1-01','2026-01-01T00:00:00Z',null])assert.equal(isStrictCalendarDate(value),false,String(value));
});

test('AP, vendor, bank, and property-management analyzers share the strict calendar boundary',()=>{
  for(const file of ['ai-ap-invoice-cutoff-review.mjs','ai-bank-payee-vendor-mismatch.mjs','ai-new-vendor-material-invoice-review.mjs','ai-property-management-charge-classifier.mjs','ai-vendor-invoice-amount-anomaly.mjs','ai-vendor-invoice-amount-drop-anomaly.mjs','ai-vendor-invoice-frequency-anomaly.mjs','ai-vendor-invoice-near-duplicate.mjs']){
    const source=readFileSync(new URL(`../runtime/${file}`,import.meta.url),'utf8');
    assert.match(source,/import \{isStrictCalendarDate\} from '\.\/ai-calendar-date\.mjs'/,file);
    assert.doesNotMatch(source,/!Number\.isNaN\(Date\.parse\(`\$\{value\}T00:00:00Z`\)\)/,file);
  }
});
