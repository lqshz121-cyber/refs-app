import assert from 'node:assert/strict';
import { localReceiptBankEvidence, receiptEvidenceForView } from './src/receipt-bank-evidence.js';

const journals = [
  { je_id: 1, je_number: 'JE-1', source_system: 'PM', posting_status: 'POSTED', je_date: '2026-07-06', description: 'Rent receipt', lines: [{ account_code: '111000', debit_amount: 46000, credit_amount: 0 }] },
  { je_id: 2, je_number: 'JE-2', source_system: 'PM', posting_status: 'PENDING_REVIEW', je_date: '2026-07-07', description: 'Rent receipt', lines: [{ account_code: '111000', debit_amount: 200, credit_amount: 0 }] },
];
const bankTransactions = [{ bank_txn_id: 11, bank_account_code: 'BA-003', external_id: 'BANK-11', direction: 'CREDIT', amount:46000, match_status:'MATCHED', matched_je: 'JE-1' }];
const receipts = localReceiptBankEvidence(journals, bankTransactions,{entityId:null,asOfDate:'2026-07-31'});
assert.equal(receipts.length, 1, 'only posted cash receipt evidence is visible');
assert.deepEqual(receipts[0].bank_matches, [{ bank_txn_id: 11, bank_account_code: 'BA-003', external_id: 'BANK-11' }], 'bridge uses retained matched-bank evidence only');
assert.equal(receipts[0].view, 'Reviewed');
assert.equal(receiptEvidenceForView(receipts, 'Reviewed').length, 1);
assert.equal(receiptEvidenceForView(receipts, 'For review').length, 0);
assert.equal(receipts[0].state,'BANK_EVIDENCE_RETAINED');
assert.equal(receipts[0].supporting_evidence,'NOT_RETAINED');
console.log('receipt bank evidence: retained posted receipt and explicit matched-bank bridge verified');
