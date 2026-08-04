const amount = value => +(value || 0);
const total = (journal, accountCode, field) => (journal?.lines || []).filter(line => line.account_code === accountCode).reduce((sum, line) => sum + amount(line[field]), 0);

// Read-only local proof for bill/payment UI. No posting, payment, matching,
// reversal, or bank connection happens in this module.
export function localBillPaymentEvidence(bill, journals = [], bankTransactions = []) {
  const apJournal = journals.find(journal => journal.je_number === bill?.je_number) || null;
  const apExpense = total(apJournal, bill?.account_code, 'debit_amount');
  const apLiability = total(apJournal, '291001', 'credit_amount');
  const billState = !bill?.je_number ? (bill?.status === 'APPROVED' ? 'MISSING_AP_JE' : 'NOT_POSTED_TO_AP')
    : !apJournal ? 'MISSING_AP_JE'
    : apJournal.posting_status !== 'POSTED' ? 'AP_JE_NOT_POSTED'
    : Math.abs(apExpense - amount(bill.amount)) >= 0.005 || Math.abs(apLiability - amount(bill.amount)) >= 0.005 ? 'AP_AMOUNT_MISMATCH'
    : 'VALID_POSTED_AP';
  const paymentJournal = bill?.pay_je_number ? journals.find(journal => journal.je_number === bill.pay_je_number) || null : null;
  const paymentAp = total(paymentJournal, '291001', 'debit_amount');
  const paymentCash = total(paymentJournal, '111000', 'credit_amount');
  const paymentState = !bill?.pay_je_number ? 'NO_LOCAL_PAYMENT'
    : !paymentJournal ? 'MISSING_PAYMENT_JE'
    : paymentJournal.posting_status !== 'POSTED' ? 'PAYMENT_JE_NOT_POSTED'
    : paymentJournal.entity_id !== apJournal?.entity_id ? 'CROSS_ENTITY_PAYMENT'
    : Math.abs(paymentAp - amount(bill.amount)) >= 0.005 || Math.abs(paymentCash - amount(bill.amount)) >= 0.005 ? 'PARTIAL_OR_AMOUNT_MISMATCH'
    : 'VALID_POSTED_PAYMENT';
  const exactBankDebits = paymentState === 'VALID_POSTED_PAYMENT' ? bankTransactions.filter(transaction => transaction.match_status === 'MATCHED'
    && transaction.direction === 'DEBIT'
    && transaction.matched_je === paymentJournal.je_number
    && Math.abs(amount(transaction.amount) - paymentCash) < 0.005) : [];
  const bankState = paymentState === 'VALID_POSTED_PAYMENT' ? (exactBankDebits.length ? 'BANK_MATCHED' : 'POSTED_UNMATCHED') : paymentState;
  return { apJournal, paymentJournal, billState, paymentState, bankState, exactBankDebits, paymentAllowed:bill?.status === 'APPROVED' && billState === 'VALID_POSTED_AP' };
}
