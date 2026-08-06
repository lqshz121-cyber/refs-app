// Book / Bank / Difference presentation model for the reconciliation worksheet.
//
// This module performs no accounting. Book, bank and difference are supplied by
// the existing reconciliation calculation in module-bankrec.jsx and are passed
// through unchanged; the only work done here is grouping, counting uncleared
// items, and restating the sign-off precondition for display.
//
// The authoritative sign-off gate remains localReconciliationReadiness. This
// model never loosens it: it reports the same conjunction (difference is zero
// AND there are zero unresolved items) so a reader can see why sign-off is
// blocked, and the view combines it with the existing gate using AND.

const EPSILON = 0.005;
const amount = value => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function bankReconciliationSummary({
  bookBalance,
  bankBalance,
  difference,
  transactions = [],
  unverifiedMatchCount = 0,
} = {}) {
  const rows = Array.isArray(transactions) ? transactions : [];
  const uncleared = rows.filter(row => row?.cleared !== true);
  const cleared = rows.filter(row => row?.cleared === true);
  const unverified = Math.max(0, Math.trunc(Number(unverifiedMatchCount) || 0));
  const diff = amount(difference);
  const balanced = Math.abs(diff) < EPSILON;
  const unresolvedCount = uncleared.length + unverified;
  const blockers = [];
  if (!balanced) blockers.push('Difference is not zero');
  if (uncleared.length) blockers.push(`${uncleared.length} uncleared bank item(s)`);
  if (unverified) blockers.push(`${unverified} matched item(s) without verified local proof`);

  return {
    book: amount(bookBalance),
    bank: amount(bankBalance),
    difference: diff,
    balanced,
    clearedCount: cleared.length,
    unclearedCount: uncleared.length,
    unverifiedMatchCount: unverified,
    unresolvedCount,
    // Display-only restatement of the existing gate; never the gate itself.
    signOffPrecondition: balanced && unresolvedCount === 0 ? 'MET' : 'NOT_MET',
    signOffBlockers: blockers,
    uncleared: uncleared.map(row => ({
      bank_txn_id: row?.bank_txn_id,
      external_id: row?.external_id || row?.bank_txn_id,
      txn_date: row?.txn_date || '',
      direction: row?.direction || '',
      amount: amount(row?.amount),
      reference: row?.reference || 'Description not retained',
      match_status: row?.match_status || 'UNMATCHED',
      matched_je: row?.matched_je || '',
      reconcile_state: row?.reconcile_state || 'NOT_SIGNED_OFF',
    })),
  };
}
