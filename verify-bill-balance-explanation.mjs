import assert from 'node:assert/strict';
import { localBillBalanceExplanation } from './src/bill-balance-explanation.js';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./src/module-ap.jsx', import.meta.url), 'utf8');
for (const required of ['AP balance explanation', 'Original bill − effective POSTED payments − applied vendor credits = open AP.', 'Open AP as of date', 'localBillBalanceExplanation']) {
  assert.ok(source.includes(required), `missing Bill explanation contract: ${required}`);
}
const noEvidence = localBillBalanceExplanation({bill:{bill_id:1,amount:100,status:'APPROVED'},asOfDate:'2026-07-31'});
assert.equal(noEvidence.originalAmount, 100);
assert.equal(noEvidence.effectivePayments, 0);
assert.equal(noEvidence.appliedCredits, 0);
assert.equal(noEvidence.openAmount, 100);
assert.equal(noEvidence.state, 'REVIEW_REQUIRED');
console.log('PASS: Bill balance explanation keeps unproven reductions in Review.');
