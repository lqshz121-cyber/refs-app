const amount = value => Number(value || 0);
const needsRealEstateDimension = code => ['112000','164100','164200','164400','164500'].includes(String(code || ''));

// Read-only JE evidence; this does not infer immutable audit history or
// create/reverse/correct a posting.
export function localJournalPostingEvidence(journal, sourceDocument = null) {
  const lines = journal?.lines || [];
  const debit = lines.reduce((sum, line) => sum + amount(line.debit_amount), 0);
  const credit = lines.reduce((sum, line) => sum + amount(line.credit_amount), 0);
  const balanced = debit > 0 && Math.abs(debit - credit) < 0.005;
  const missingDimensions = lines.filter(line => needsRealEstateDimension(line.account_code)
    && !line.property_id && !line.project_id && !line.loan_id);
  return {
    postingState: journal?.posting_status === 'POSTED' && balanced ? 'LOCAL_POSTED_BALANCED'
      : journal?.posting_status !== 'POSTED' ? 'NOT_POSTED' : 'OUT_OF_BALANCE',
    balanced,
    debit,
    credit,
    missingDimensions,
    dimensionState:missingDimensions.length ? 'DIMENSION_REVIEW_REQUIRED' : 'DIMENSION_EVIDENCE_PRESENT',
    sourceState:sourceDocument ? 'RETAINED_LOCAL_SOURCE' : (journal?.source_system === 'MAN' ? 'MANUAL_SOURCE_UNVERIFIED' : 'SOURCE_LINK_NOT_RETAINED'),
    historyState:Array.isArray(journal?.history) && journal.history.length ? 'LOCAL_HISTORY_PRESENT_UNVERIFIED' : 'NO_RETAINED_POSTING_HISTORY',
  };
}
