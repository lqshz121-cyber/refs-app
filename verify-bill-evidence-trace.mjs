import assert from 'node:assert/strict';
import { localBillEvidenceTrace } from './src/bill-evidence-trace.js';

const journals = [
  { je_number: 'AP-1', posting_status: 'POSTED', source_doc_id: 'DOC-1' },
  { je_number: 'PAY-1', posting_status: 'POSTED' },
];
const trace = localBillEvidenceTrace({ bill_no: 'BILL-1', je_number: 'AP-1', pay_je_number: 'PAY-1' }, journals);
assert.equal(trace.apJournalPosted, true);
assert.equal(trace.paymentJournalPosted, true);
assert.equal(trace.sourceDocId, 'DOC-1');
assert.equal(trace.canOpenSourceDocument, true);
const missing = localBillEvidenceTrace({ bill_no: 'BILL-2', je_number: 'MISSING' }, journals);
assert.equal(missing.apJournal, null);
assert.equal(missing.canOpenSourceDocument, false);
console.log('bill evidence trace: retained AP/payment/source evidence gates verified');
