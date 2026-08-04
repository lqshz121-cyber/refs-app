function journalCashReceiptAmount(journal) {
  return (journal.lines || []).filter(line => line.account_code === '111000').reduce((total, line) => total + Number(line.debit_amount || 0) - Number(line.credit_amount || 0), 0);
}

export function localReceiptBankEvidence(journals = [], bankTransactions = [], {entityId = null, asOfDate = ''} = {}) {
  return journals
    .filter(journal => journal.posting_status === 'POSTED'
      && (!entityId || journal.entity_id === entityId)
      && (!asOfDate || !journal.je_date || journal.je_date <= asOfDate)
      && (journal.source_system === 'PM' || journal.source_system === 'AR' || /rent receipt/i.test(journal.description || '')))
    .map(journal => {
      const amount = journalCashReceiptAmount(journal);
      const bankMatches = bankTransactions.filter(transaction => transaction.matched_je === journal.je_number && transaction.direction === 'CREDIT' && transaction.match_status === 'MATCHED' && Math.abs(Number(transaction.amount || 0) - amount) < 0.005);
      const dimensions = (journal.lines || []).reduce((current,line) => ({property_id:current.property_id || line.property_id || null,project_id:current.project_id || line.project_id || null}),{property_id:journal.property_id || null,project_id:journal.project_id || null});
      const sourceRef = journal.source_doc_id || null;
      const state = bankMatches.length ? 'BANK_EVIDENCE_RETAINED'
        : !sourceRef ? 'MISSING_SOURCE'
        : !dimensions.property_id && !dimensions.project_id ? 'REVIEW_REQUIRED'
        : 'EVIDENCE_LINKED';
      return {
        receipt_id: `JE-${journal.je_id}`,
        view: bankMatches.length ? 'Reviewed' : 'For review',
        date: journal.je_date,
        vendor: 'Tenant / owner receipt evidence',
        amount,
        journal_number: journal.je_number,
        description: journal.description,
        receipt_type: journal.source_system === 'AR' ? 'Local AR receipt' : 'Local property receipt',
        bank_matches: bankMatches.map(transaction => ({ bank_txn_id: transaction.bank_txn_id, bank_account_code: transaction.bank_account_code, external_id: transaction.external_id })),
        entity_id:journal.entity_id || null,
        dimensions,
        source_ref:sourceRef,
        supporting_evidence:sourceRef ? 'REFERENCE_RETAINED' : 'NOT_RETAINED',
        state,
        created_by:journal.created_by || journal.source_system || 'LOCAL',
        payment_account:bankMatches[0]?.bank_account_code || 'Not retained',
        category:journal.source_system === 'AR' ? 'Tenant / customer receipt' : 'Property receipt',
      };
    })
    .filter(receipt => receipt.amount > 0);
}

export function receiptEvidenceForView(receipts = [], view = 'For review') {
  return receipts.filter(receipt => receipt.view === view);
}
