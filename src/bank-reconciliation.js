const total = (items = []) => items.reduce((value, item) => value + (+item.amount || 0), 0);

// The functional layer owns only the reconciliation decision/status contract.
// It deliberately does not post, delete, or alter the underlying ledger.
export function reconciliationStatus(account, history = []) {
  if (!account) return { canSign: false, reason: 'MISSING_ACCOUNT', diff: 0, unmatched: [] };

  const unmatched = (account.txns || []).filter(txn => txn.match_status === 'UNMATCHED');
  const adjustedBank = (+account.stmt_end || 0) + total(account.deposits_in_transit) - total(account.outstanding_checks);
  const adjustedBook = (+account.gl_book_balance || 0) + (+account.recorded_adj || 0);
  const diff = +(adjustedBank - adjustedBook).toFixed(2);
  const signedHistory = history.find(entry => entry.account === account.account_code && entry.period === account.period && entry.stmt_date === account.stmt_date && entry.reopen_state !== 'REOPENED') || null;

  if (signedHistory) return { canSign: false, reason: 'ALREADY_SIGNED', diff, unmatched, signedHistory, adjustedBank, adjustedBook };
  if (unmatched.length) return { canSign: false, reason: 'UNMATCHED_ACTIVITY', diff, unmatched, adjustedBank, adjustedBook };
  if (Math.abs(diff) >= 0.005) return { canSign: false, reason: 'OUT_OF_BALANCE', diff, unmatched, adjustedBank, adjustedBook };
  return { canSign: true, reason: null, diff, unmatched, adjustedBank, adjustedBook };
}

// Presentation-only history contract. It does not sign off, mutate history, or
// infer any QuickBooks reconciliation report behavior.
export function reconciliationHistoryState(history = [], accountCode = null) {
  const entries = (history || []).filter(entry => !accountCode || entry.account === accountCode);
  return {
    entries,
    count: entries.length,
    isEmpty: entries.length === 0,
    emptyLabel: accountCode ? `No local reconciliation sign-offs for ${accountCode} yet.` : 'No local reconciliation sign-offs yet.',
  };
}

// A bank-to-reconciliation link is navigation only. It is available solely
// for a retained locally matched transaction and cannot change sign-off state.
export function reconciliationBankEvidence(account, bankTxnId) {
  const transaction = (account?.txns || []).find(item => String(item.bank_txn_id) === String(bankTxnId));
  if (!transaction) return { eligible: false, reason: 'MISSING_BANK_TRANSACTION', transaction: null };
  if (transaction.match_status !== 'MATCHED') return { eligible: false, reason: 'UNMATCHED_BANK_TRANSACTION', transaction };
  return { eligible: true, reason: null, transaction };
}
