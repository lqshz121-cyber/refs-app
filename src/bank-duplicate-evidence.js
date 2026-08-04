const keyFor = (txn, master) => `${master?.entity_id||'?'}|${txn.bank_account_code||'?'}|${txn.external_id||''}`;

// Deduplication evidence only: retains all bank rows and never deletes,
// reverses, posts, or matches a transaction.
export function localBankDuplicateEvidence({bankTransactions = [], journals = [], bankAccounts = []} = {}) {
  return bankTransactions.map(txn => {
    const master=bankAccounts.find(row=>row.bank_account_code===txn.bank_account_code)||null;
    const key=keyFor(txn,master);
    const peers=bankTransactions.filter(row=>row!==txn && keyFor(row,bankAccounts.find(masterRow=>masterRow.bank_account_code===row.bank_account_code)||null)===key);
    const postedPeers=peers.filter(row=>{const journal=journals.find(item=>item.je_number===row.matched_je||item.je_number===row.record_je_number);return journal?.posting_status==='POSTED';});
    const state=!txn.external_id?'IDENTIFIER_MISSING_REVIEW':postedPeers.length?'SUSPECTED_DUPLICATE_BLOCKED':'UNIQUE_LOCAL_IDENTIFIER';
    return {transaction:txn,master,peers,postedPeers,state};
  });
}
