// Payment reporting drills are navigation contracts over already-posted local
// payment evidence; they do not create or submit a bill payment.
export function localPaymentEvidenceDrill(bill, journals = []) {
  if (!bill || bill.status !== 'PAID' || !bill.pay_je_number) {
    return { eligible: false, reason: 'MISSING_PAYMENT_EVIDENCE', journalNumber: null };
  }
  const journal = journals.find(item => item.je_number === bill.pay_je_number) || null;
  if (!journal || journal.posting_status !== 'POSTED') {
    return { eligible: false, reason: 'PAYMENT_JOURNAL_NOT_POSTED', journalNumber: bill.pay_je_number };
  }
  return { eligible: true, reason: null, journalNumber: journal.je_number };
}
