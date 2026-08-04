import assert from 'node:assert/strict';
import { localReportControlEvidence } from './src/report-control-evidence.js';
const journals = [
  {posting_status:'POSTED',entity_id:2,period_code:'2026-07',lines:[{account_code:'111000',debit_amount:100},{account_code:'380104',credit_amount:100}]},
  {posting_status:'POSTED',entity_id:2,period_code:'2026-07',lines:[{account_code:'112000',debit_amount:30},{account_code:'220200',credit_amount:30}]},
  {posting_status:'DRAFT',entity_id:2,period_code:'2026-07',lines:[{account_code:'111000',debit_amount:999},{account_code:'380104',credit_amount:999}]},
];
const proof = localReportControlEvidence({periodJournals:journals.filter(j=>j.posting_status==='POSTED'),asOfJournals:journals.filter(j=>j.posting_status==='POSTED'),entityId:2,toPeriod:'2026-07',cashFlow:{closingCash:100}});
assert.equal(proof.tbBalanced, true); assert.equal(proof.glTbTied, true); assert.equal(proof.bsBalanced, true);
assert.equal(proof.totalCash, 130); assert.equal(proof.operatingCash, 100); assert.equal(proof.restrictedCash, 30);
assert.equal(proof.cashGroupsTied, true); assert.equal(proof.cashFlowOperatingTied, true);
console.log('report controls: TB/GL/BS and separated cash scopes are locally tied');
