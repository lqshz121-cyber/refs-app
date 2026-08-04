import { localInvoiceReceiptEvidence } from './invoice-receipt-evidence.js';

// Read-only lifecycle projection. Invoice posting, receipt posting, allocation,
// and bank matching are separate facts; no stage is inferred from another.
export function localInvoicePaymentLifecycle(invoice, journals = [], bankTransactions = []) {
  const evidence = localInvoiceReceiptEvidence(invoice, journals, bankTransactions);
  const invoiceStatus = String(invoice?.status || 'UNKNOWN').toUpperCase();
  const invoiceState = evidence.sourceState === 'VALID_POSTED_AR_SOURCE'
    ? (invoiceStatus === 'PAID' ? 'POSTED_PAID' : invoiceStatus === 'OPEN' ? 'POSTED_OPEN' : `POSTED_${invoiceStatus}`)
    : `REVIEW_${evidence.sourceState}`;
  const paymentState = evidence.paymentState === 'NO_LOCAL_RECEIPT' ? 'NO_RETAINED_PAYMENT'
    : evidence.paymentState === 'VALID_POSTED_RECEIPT' ? 'RECORDED_POSTED'
    : `REVIEW_${evidence.paymentState}`;
  const bankState = evidence.receiptState === 'BANK_MATCHED' ? 'BANK_MATCHED'
    : evidence.receiptState === 'POSTED_UNMATCHED' ? 'BANK_UNMATCHED'
    : 'NO_EXACT_BANK_CREDIT';
  return { invoiceState, paymentState, bankState, evidence };
}
