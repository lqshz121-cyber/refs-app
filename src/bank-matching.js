// Frontend-only bank-match eligibility. It deliberately selects existing posted
// evidence and never manufactures a journal entry for a Match action.
export const cashImpact = (journal) => (journal.lines||[])
  .filter(line=>line.account_code==='111000')
  .reduce((total,line)=>total+(line.debit_amount||0)-(line.credit_amount||0),0);

export const eligibleBankMatchCandidates = (journals, bankTxn) => {
  if (!bankTxn) return [];
  const expectedCash = bankTxn.direction==='CREDIT' ? +bankTxn.amount : -(+bankTxn.amount);
  return journals
    .filter(journal=>journal.posting_status==='POSTED' && Math.abs(cashImpact(journal)-expectedCash)<0.005)
    .sort((a,b)=>String(b.je_date).localeCompare(String(a.je_date)));
};

// UI-only trace for retained, already-posted local evidence. It never creates,
// posts, matches, or changes a journal; callers use it to expose the GL/TB drill path.
export const localBankPostingTrace = (bankTxn, journals = []) => {
  const journalNumber = bankTxn?.record_je_number || bankTxn?.match_je_number || bankTxn?.matched_je || null;
  const journal = journals.find(item => item.je_number === journalNumber && item.posting_status === 'POSTED') || null;
  return {
    journalNumber: journal?.je_number || null,
    isPosted: Boolean(journal),
    canDrillGL: Boolean(journal),
    canDrillTB: Boolean(journal),
    status: journal ? 'POSTED_LOCAL_EVIDENCE' : 'NO_POSTED_LOCAL_EVIDENCE',
  };
};
