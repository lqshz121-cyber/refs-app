// ---------------------------------------------------------------------------
// Construction / mortgage loan roll-forward, built from the general ledger.
//
// The roll-forward that shipped before this file derived every column from the
// loan master alone - beginning principal was `current_principal - draws +
// repayments` off the staging table, so ending principal was current_principal
// by construction. It tied to itself and could never show a break against the
// books. A $7,070,000 difference between the ledger and the master sat
// unreported behind it.
//
// This routine reads the ledger. The loan master contributes exactly one
// column, `master_principal`, and the difference between the two is reported as
// a reconciling item rather than absorbed into a beginning balance.
//
// Money is accumulated in integer cents throughout. Nothing here compares
// floats.
// ---------------------------------------------------------------------------

// Loan principal accounts in the WBS master chart. Interest accruals (220410,
// 220451) are not principal and are deliberately absent.
export const LOAN_PAYABLE_ACCOUNTS = new Set([
  '260100', '260101', '260200', '260300', '260700', '260701', '260702', '260703', '260704',
  '270100', '270101', '270200', '270700', '270701', '270702', '289500', '227303',
]);

const cents = (n) => Math.round((Number(n) || 0) * 100);
const inRange = (period, from, to) => (!from || String(period || '') >= from) && (!to || String(period || '') <= to);

// Which loan a principal line belongs to. An explicit loan_id on the line wins.
// Failing that, if the posting entity has exactly one loan in the master, the
// line is that loan's - a project company with one facility is the ordinary
// case. Anything else stays unattributed and is reported as such; the routine
// never guesses between two facilities.
export function attributeLoan(journal, line, loans) {
  if (line.loan_id != null) {
    const byId = loans.find((l) => l.loan_id === line.loan_id);
    if (byId) return byId;
  }
  const owned = loans.filter((l) => Number(l.entity_id) === Number(journal.entity_id));
  if (owned.length === 1) return owned[0];
  return null;
}

// Roll-forward rows, one per loan in the master, plus the unattributed residual.
//
//   gl_beginning   net credit balance on the loan's principal accounts in every
//                  period strictly before `fromPeriod`
//   gl_draws       credits inside the window (principal advanced)
//   gl_repayments  debits inside the window (principal repaid)
//   gl_ending      beginning + draws - repayments, i.e. what the books say
//   master_principal   what the loan master says
//   difference     master - ending. Non-zero is an exception, never a plug.
export function loanRollForward({journals = [], loans = [], fromPeriod = '', toPeriod = ''} = {}) {
  const acc = new Map();
  const at = (id) => {
    if (!acc.has(id)) acc.set(id, {beginning: 0, draws: 0, repayments: 0, refs: []});
    return acc.get(id);
  };
  let unattributed = {beginning: 0, draws: 0, repayments: 0, refs: []};

  for (const je of journals) {
    if (je.posting_status && je.posting_status !== 'POSTED') continue;
    for (const line of je.lines || []) {
      if (!LOAN_PAYABLE_ACCOUNTS.has(line.account_code)) continue;
      const loan = attributeLoan(je, line, loans);
      const bucket = loan ? at(loan.loan_id) : unattributed;
      const dr = cents(line.debit_amount), cr = cents(line.credit_amount);
      const period = String(je.period_code || '');
      if (fromPeriod && period < fromPeriod) {
        bucket.beginning += cr - dr;
      } else if (inRange(period, fromPeriod, toPeriod)) {
        bucket.draws += cr;
        bucket.repayments += dr;
        if (bucket.refs.length < 6 && (cr || dr)) bucket.refs.push(je.je_number || String(je.je_id));
      }
    }
  }

  const rows = loans.map((loan) => {
    const b = acc.get(loan.loan_id) || {beginning: 0, draws: 0, repayments: 0, refs: []};
    const endingCents = b.beginning + b.draws - b.repayments;
    const masterCents = cents(loan.current_principal);
    return {
      loan_id: loan.loan_id,
      loan_code: loan.loan_code,
      lender_name: loan.lender_name,
      entity_id: loan.entity_id,
      project_id: loan.project_id,
      interest_rate: loan.interest_rate,
      gl_beginning: b.beginning / 100,
      gl_draws: b.draws / 100,
      gl_repayments: b.repayments / 100,
      gl_ending: endingCents / 100,
      master_principal: masterCents / 100,
      difference: (masterCents - endingCents) / 100,
      difference_cents: masterCents - endingCents,
      available_commitment: (cents(loan.commitment_amount) - endingCents) / 100,
      je_refs: b.refs,
    };
  });

  return Object.assign(rows, {
    unattributed: {
      gl_beginning: unattributed.beginning / 100,
      gl_draws: unattributed.draws / 100,
      gl_repayments: unattributed.repayments / 100,
      gl_ending: (unattributed.beginning + unattributed.draws - unattributed.repayments) / 100,
      je_refs: unattributed.refs,
    },
  });
}

// The reconciling items a close would raise off the roll-forward. One row per
// loan whose ledger balance does not agree with the master, plus one for any
// loan-payable movement that names no loan at all.
export function loanReconcilingItems(rows) {
  const items = [];
  for (const r of rows) {
    if (r.difference_cents === 0) continue;
    items.push({
      loan_code: r.loan_code,
      entity_id: r.entity_id,
      amount: r.difference,
      severity: 'HIGH',
      message: `Loan ${r.loan_code}: the general ledger carries ${r.gl_ending.toFixed(2)} of principal and the loan master says ${r.master_principal.toFixed(2)}. `
        + `The books and the lender record differ by ${Math.abs(r.difference).toFixed(2)}; the difference has to be identified and posted, not carried in a beginning balance.`,
    });
  }
  const u = rows.unattributed;
  if (u && Math.round(u.gl_ending * 100) !== 0) {
    items.push({
      loan_code: '(unattributed)',
      entity_id: null,
      amount: u.gl_ending,
      severity: 'HIGH',
      message: `${u.gl_ending.toFixed(2)} of loan principal in the ledger names no loan in the master, so it cannot be reconciled to any lender statement.`,
    });
  }
  return items;
}
