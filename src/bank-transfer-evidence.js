const amount = value => +(value || 0);
const EPSILON = 0.005;

// Identifies only retained, already-posted internal-transfer evidence. It
// never pairs, matches, posts, or changes either bank transaction.
export function localBankTransferEvidence({bankTransactions = [], journals = [], bankAccounts = []} = {}) {
  const rows = bankTransactions.filter(txn => txn.match_status === 'MATCHED').map(txn => ({txn, master:bankAccounts.find(row=>row.bank_account_code===txn.bank_account_code)||null}));
  const result=[];
  rows.filter(row=>row.txn.direction==='DEBIT').forEach(from => {
    const pairs=rows.filter(to=>to.txn.direction==='CREDIT' && to.master && from.master
      && to.master.entity_id===from.master.entity_id && to.master.bank_account_code!==from.master.bank_account_code
      && Math.abs(amount(to.txn.amount)-amount(from.txn.amount))<EPSILON && to.txn.matched_je===from.txn.matched_je);
    const journal=journals.find(row=>row.je_number===from.txn.matched_je) || null;
    const transferPosted=journal?.posting_status==='POSTED' && (journal.source_system==='TRANSFER'||journal.je_type==='INTERNAL_TRANSFER');
    const state=!from.master?'HELD_MISSING_FROM_MASTER'
      : from.master.cash_scope!=='Operating'?'HELD_NON_OPERATING_SCOPE'
      : pairs.length!==1?'HELD_UNPAIRED_OR_AMBIGUOUS'
      : !transferPosted?'HELD_TRANSFER_JE_UNPROVEN'
      : 'CONFIRMED_LOCAL_TRANSFER_EVIDENCE';
    result.push({from,to:pairs.length===1?pairs[0]:null,journal,candidateCount:pairs.length,state,entityId:from.master?.entity_id||null,amount:amount(from.txn.amount),fromScope:from.master?.cash_scope||null,toScope:pairs[0]?.master?.cash_scope||null});
  });
  return result;
}
