// This trace reads retained local evidence only. It does not create a source
// document, approve a bill, post a journal, or call QuickBooks.
export function localBillEvidenceTrace(bill, journals = []) {
  if (!bill) return { bill: null, apJournal: null, paymentJournal: null, sourceDocId: null, canOpenSourceDocument: false };
  const apJournal = journals.find(journal => journal.je_number === bill.je_number) || null;
  const paymentJournal = journals.find(journal => journal.je_number === bill.pay_je_number) || null;
  const sourceDocId = apJournal?.source_doc_id || null;
  return {
    bill,
    apJournal,
    paymentJournal,
    sourceDocId,
    canOpenSourceDocument: Boolean(sourceDocId),
    apJournalPosted: apJournal?.posting_status === 'POSTED',
    paymentJournalPosted: paymentJournal?.posting_status === 'POSTED',
  };
}
