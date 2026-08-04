const amount = value => +(value || 0);
const lineTotal = (journal, accountCode, field) => (journal?.lines || []).filter(line => line.account_code === accountCode).reduce((sum, line) => sum + amount(line[field]), 0);

// Resolves retained local documents only. It never creates a receivable,
// receipt, bank match, payment, or journal entry.
export function localInvoiceReceiptEvidence(invoice, journals = [], bankTransactions = []) {
  const sourceJournal = journals.find(journal => journal.je_number === invoice?.je_number) || null;
  const sourceAr = lineTotal(sourceJournal, '120200', 'debit_amount');
  const sourceState = !sourceJournal ? 'MISSING_SOURCE_JE'
    : sourceJournal.posting_status !== 'POSTED' ? 'SOURCE_NOT_POSTED'
    : Math.abs(sourceAr - amount(invoice.amount)) >= 0.005 ? 'AR_AMOUNT_MISMATCH'
    : 'VALID_POSTED_AR_SOURCE';
  const paymentJournal = invoice?.pay_je_number ? journals.find(journal => journal.je_number === invoice.pay_je_number) || null : null;
  const receiptCash = lineTotal(paymentJournal, '111000', 'debit_amount');
  const receiptAr = lineTotal(paymentJournal, '120200', 'credit_amount');
  const paymentState = !invoice?.pay_je_number ? 'NO_LOCAL_RECEIPT'
    : !paymentJournal ? 'MISSING_RECEIPT_JE'
    : paymentJournal.posting_status !== 'POSTED' ? 'RECEIPT_NOT_POSTED'
    : paymentJournal.entity_id !== sourceJournal?.entity_id ? 'CROSS_ENTITY_RECEIPT'
    : Math.abs(receiptCash - amount(invoice.amount)) >= 0.005 || Math.abs(receiptAr - amount(invoice.amount)) >= 0.005 ? 'PARTIAL_OR_AMOUNT_MISMATCH'
    : 'VALID_POSTED_RECEIPT';
  const exactBankCredits = paymentState === 'VALID_POSTED_RECEIPT' ? bankTransactions.filter(transaction => transaction.match_status === 'MATCHED'
    && transaction.direction === 'CREDIT'
    && transaction.matched_je === paymentJournal.je_number
    && Math.abs(amount(transaction.amount) - receiptCash) < 0.005) : [];
  const receiptState = paymentState === 'VALID_POSTED_RECEIPT' ? (exactBankCredits.length ? 'BANK_MATCHED' : 'POSTED_UNMATCHED') : paymentState;
  return {
    sourceJournal, sourceState, paymentJournal, paymentState, receiptState,
    exactBankCredits, receivePaymentAllowed:sourceState === 'VALID_POSTED_AR_SOURCE' && invoice?.status === 'OPEN',
  };
}
