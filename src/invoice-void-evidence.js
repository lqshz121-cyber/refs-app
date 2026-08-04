const amount = value => +(value || 0);
const hasReversalOf = (journal, target) => journal?.je_type === 'REVERSAL' && ((journal?.history || []).some(item => String(item.a || '').includes(`REVERSAL of ${target}`)) || String(journal?.description || '').includes(target));

// Evidence-only void/reversal boundary. It neither requests nor writes a
// reversal; original invoice/payment records remain retained.
export function localInvoiceVoidEvidence(invoice, journals = [], bankTransactions = []) {
  const source = journals.find(journal => journal.je_number === invoice?.je_number) || null;
  const payment = invoice?.pay_je_number ? journals.find(journal => journal.je_number === invoice.pay_je_number) || null : null;
  const sourceReversals = source ? journals.filter(journal => journal.posting_status === 'POSTED' && hasReversalOf(journal, source.je_number)) : [];
  const paymentReversals = payment ? journals.filter(journal => journal.posting_status === 'POSTED' && hasReversalOf(journal, payment.je_number)) : [];
  const bankLinked = payment ? bankTransactions.filter(transaction => transaction.match_status === 'MATCHED' && transaction.matched_je === payment.je_number) : [];
  const originalPosted = source?.posting_status === 'POSTED';
  const state = !source ? 'VOID_BLOCKED_MISSING_SOURCE'
    : !originalPosted ? 'VOID_BLOCKED_SOURCE_NOT_POSTED'
    : sourceReversals.length !== 1 ? (sourceReversals.length > 1 ? 'VOID_REVIEW_AMBIGUOUS_REVERSAL' : (payment || bankLinked.length ? 'VOID_BLOCKED_RECEIPT_OR_BANK' : 'VOID_ELIGIBLE_REVIEW'))
    : payment && paymentReversals.length !== 1 ? 'VOID_REVIEW_PAYMENT_REVERSAL_REQUIRED'
    : 'VOID_EVIDENCE_RETAINED';
  return { source, payment, sourceReversals, paymentReversals, bankLinked, state, entityId:source?.entity_id || null, canRequest:state === 'VOID_ELIGIBLE_REVIEW' };
}
