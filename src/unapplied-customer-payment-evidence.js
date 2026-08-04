const amount = value => Number(value || 0);
const lineAmount = (journal, accountCode, side) => (journal?.lines || []).filter(line => line.account_code === accountCode).reduce((sum,line) => sum + amount(line[side]), 0);

// Read-only candidate queue for retained customer cash receipts. It never
// allocates a payment, chooses an invoice, or changes AR/prepayment liability.
export function localUnappliedCustomerPayments(invoices = [], journals = [], bankTransactions = []) {
  return journals.filter(journal => journal.posting_status === 'POSTED' && journal.source_system === 'AR')
    .map(journal => {
      const cash = lineAmount(journal, '111000', 'debit_amount');
      const arCredit = lineAmount(journal, '120200', 'credit_amount');
      const prepaymentCredit = lineAmount(journal, '225000', 'credit_amount');
      if (cash <= 0 || (arCredit <= 0 && prepaymentCredit <= 0)) return null;
      const linkedInvoices = invoices.filter(invoice => invoice.pay_je_number === journal.je_number);
      const linkedInvoice = linkedInvoices.length === 1 ? linkedInvoices[0] : null;
      const expected = linkedInvoice ? amount(linkedInvoice.amount) : 0;
      const applied = linkedInvoice ? Math.min(arCredit, expected) : 0;
      const state = linkedInvoice && Math.abs(cash - expected) < 0.005 && Math.abs(arCredit - expected) < 0.005 ? 'ALLOCATED'
        : linkedInvoice ? 'PARTIALLY_ALLOCATED_REVIEW'
        : prepaymentCredit > 0 ? 'UNAPPLIED_PREPAYMENT_REVIEW'
        : 'UNAPPLIED_AR_CASH_REVIEW';
      const bankMatches = bankTransactions.filter(transaction => transaction.match_status === 'MATCHED'
        && transaction.direction === 'CREDIT'
        && transaction.matched_je === journal.je_number
        && Math.abs(amount(transaction.amount) - cash) < 0.005);
      return {
        payment_id:'AR-CASH-' + journal.je_number,
        journal_number:journal.je_number,
        entity_id:journal.entity_id,
        date:journal.je_date,
        cash_amount:cash,
        ar_credit:arCredit,
        prepayment_credit:prepaymentCredit,
        invoice_id:linkedInvoice?.inv_id || null,
        invoice_no:linkedInvoice?.inv_no || null,
        counterparty:linkedInvoice?.customer_name || journal.customer_name || journal.payee || 'Unidentified local counterparty',
        applied_amount:applied,
        unapplied_amount:+(cash - applied).toFixed(2),
        state,
        bank_matches:bankMatches,
      };
    })
    .filter(Boolean);
}

export function localUnappliedPaymentView(rows = [], view = 'All') {
  if (view === 'Unapplied') return rows.filter(row => row.state.startsWith('UNAPPLIED'));
  if (view === 'Partial review') return rows.filter(row => row.state === 'PARTIALLY_ALLOCATED_REVIEW');
  if (view === 'Allocated') return rows.filter(row => row.state === 'ALLOCATED');
  return rows;
}
