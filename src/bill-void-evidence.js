const hasReversalOf = (journal, target) => journal?.je_type === 'REVERSAL' && ((journal.history || []).some(item => String(item.a || '').includes(`REVERSAL of ${target}`)) || String(journal.description || '').includes(target));

// Read-only local proof boundary: no bill, payment, JE, or bank match is
// changed by this resolver.
export function localBillVoidEvidence(bill, journals = [], bankTransactions = []) {
  const ap = journals.find(journal => journal.je_number === bill?.je_number) || null;
  const payment = bill?.pay_je_number ? journals.find(journal => journal.je_number === bill.pay_je_number) || null : null;
  const apReversals = ap ? journals.filter(journal => journal.posting_status === 'POSTED' && hasReversalOf(journal, ap.je_number)) : [];
  const paymentReversals = payment ? journals.filter(journal => journal.posting_status === 'POSTED' && hasReversalOf(journal, payment.je_number)) : [];
  const bankLinked = payment ? bankTransactions.filter(transaction => transaction.match_status === 'MATCHED' && transaction.matched_je === payment.je_number) : [];
  const state = !ap ? 'VOID_BLOCKED_MISSING_AP_SOURCE'
    : ap.posting_status !== 'POSTED' ? 'VOID_BLOCKED_AP_NOT_POSTED'
    : apReversals.length !== 1 ? (apReversals.length > 1 ? 'VOID_REVIEW_AMBIGUOUS_REVERSAL' : (payment || bankLinked.length ? 'VOID_BLOCKED_PAYMENT_OR_BANK' : 'VOID_ELIGIBLE_REVIEW'))
    : payment && paymentReversals.length !== 1 ? 'VOID_REVIEW_PAYMENT_REVERSAL_REQUIRED'
    : 'VOID_EVIDENCE_RETAINED';
  return {ap,payment,apReversals,paymentReversals,bankLinked,state,entityId:ap?.entity_id || null,canRequest:state === 'VOID_ELIGIBLE_REVIEW'};
}
