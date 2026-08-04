import { localInvoiceReceiptEvidence } from './invoice-receipt-evidence.js';

// This is a read model over retained invoices and JEs. It intentionally does
// not create payments, allocations, bank matches, or accounting entries.
export function localCustomerPaymentRows(invoices = [], journals = [], bankTransactions = []) {
  return invoices
    .map(invoice => {
      const evidence = localInvoiceReceiptEvidence(invoice, journals, bankTransactions);
      const journal = evidence.paymentJournal;
      if (!journal) return null;
      return {
        payment_id: 'AR-' + invoice.inv_id + '-' + journal.je_number,
        invoice_id: invoice.inv_id,
        invoice_no: invoice.inv_no,
        customer_id: invoice.customer_id,
        customer_name: invoice.customer_name,
        entity_id: evidence.sourceJournal?.entity_id ?? null,
        received_date: journal.je_date,
        amount: Number(invoice.amount || 0),
        payment_journal: journal.je_number,
        state: evidence.receiptState,
        exact_bank_credits: evidence.exactBankCredits,
      };
    })
    .filter(Boolean);
}

export function localCustomerPaymentView(rows = [], view = 'All') {
  if (view === 'Bank matched') return rows.filter(row => row.state === 'BANK_MATCHED');
  if (view === 'Posted unmatched') return rows.filter(row => row.state === 'POSTED_UNMATCHED');
  if (view === 'Review') return rows.filter(row => !['BANK_MATCHED', 'POSTED_UNMATCHED'].includes(row.state));
  return rows;
}
