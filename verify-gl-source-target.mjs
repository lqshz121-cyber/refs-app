import assert from 'node:assert/strict';
import { localGLSourceTarget } from './src/gl-source-target.js';

assert.equal(localGLSourceTarget({ je_number: 'AP-1' }, { apBills: [{ bill_id: 5, je_number: 'AP-1' }] }).route, 'ap');
assert.equal(localGLSourceTarget({ je_number: 'DOC-1', source_doc_id: 'DOC-A' }, { sourceDocuments: { 'DOC-A': { id: 'DOC-A' } } }).route, 'sourcedocs');
assert.equal(localGLSourceTarget({ je_number: 'DOC-MISSING', source_doc_id: 'MISSING', source_system: 'MAN' }, { sourceDocuments: {} }), null, 'unretained source-document ids do not open an empty workspace');
const ar = localGLSourceTarget({ je_number: 'AR-PAY' }, { arInvoices: [{ inv_id: 7, pay_je_number: 'AR-PAY' }] });
assert.deepEqual(ar, { route: 'ar', context: { route: 'ar', tab: 'Invoices', invoiceId: 7, jeNumber: 'AR-PAY' } });
assert.equal(localGLSourceTarget({ je_number: 'BANK-1' }, { bankAccounts: { BA: { txns: [{ bank_txn_id: 9, matched_je: 'BANK-1' }] } } }).route, 'banktx');
assert.equal(localGLSourceTarget({ je_number: 'UNKNOWN', source_system: 'MAN' }), null);
console.log('GL source target: AP, AR, bank, and unknown local routes verified');
