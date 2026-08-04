import assert from 'node:assert/strict';
import { localPaymentEvidenceDrill } from './src/payment-evidence-drill.js';

const journals = [{ je_number: 'PAY-1', posting_status: 'POSTED' }, { je_number: 'PAY-2', posting_status: 'DRAFT' }];
assert.deepEqual(localPaymentEvidenceDrill({ status: 'PAID', pay_je_number: 'PAY-1' }, journals), { eligible: true, reason: null, journalNumber: 'PAY-1' });
assert.equal(localPaymentEvidenceDrill({ status: 'PAID', pay_je_number: 'PAY-2' }, journals).reason, 'PAYMENT_JOURNAL_NOT_POSTED');
assert.equal(localPaymentEvidenceDrill({ status: 'APPROVED' }, journals).reason, 'MISSING_PAYMENT_EVIDENCE');
console.log('payment evidence drill: posted payment JE eligibility verified');
