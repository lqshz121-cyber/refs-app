// H-3 measurement - interest accrued on the loan master, and the capitalise /
// expense split.
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/interest-accrual.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// Two independent expectations are computed and both are printed:
//
//   flat benchmark   principal outstanding per the master x rate x months/12.
//                    This is the figure the close review quoted ($409,736.25).
//                    It ignores that principal moves during the year.
//   ledger schedule  the month-by-month accrual on the principal the LEDGER
//                    carried at the start of each month. This is what the books
//                    should contain once the ledger and the master agree.
//
// ASC 835-20: interest on borrowings that finance an asset under construction
// is a cost of that asset (164500); once the asset is complete and in use the
// interest is period expense (795000). The split is read off the financed
// project's construction_status, never assumed.
import { POSTED, LOANS, PROJECTS, ENT, drOf, crOf, fmt } from './_ledger.js';
import { loanRollForward, LOAN_PAYABLE_ACCOUNTS } from '../../src/loan-rollforward.js';

const c = (n) => Math.round((Number(n) || 0) * 100);
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const CAPITALISED = new Set(['164500', '164501']);
const EXPENSED = new Set(['795000', '661000', '772450']);
const ACCRUAL_LIABILITY = new Set(['220410', '220451', '220310']);
const PROJECT_BY_ID = Object.fromEntries(PROJECTS.map((p) => [p.project_id, p]));

const out = []; const P = (s) => out.push(s);
const failures = [];

P('== H-3 · INTEREST ACCRUAL, FY2026 (2026-01 .. 2026-07) ==');

// --- expectation A: the flat benchmark the close review quoted --------------
let flat = 0;
LOANS.forEach((l) => { flat += Math.round(c(l.current_principal) * l.interest_rate * MONTHS.length / 12); });
P(`  flat benchmark  (master principal x rate x ${MONTHS.length}/12):  ${fmt(flat / 100)}`);

// --- expectation B: month-by-month on the principal the ledger carried ------
let scheduled = 0;
const perLoanExpected = {};
LOANS.forEach((loan) => {
  const project = PROJECT_BY_ID[loan.project_id];
  const capitalise = project && project.construction_status === 'UNDER_CONSTRUCTION';
  let loanExpected = 0;
  const detail = [];
  MONTHS.forEach((period) => {
    // principal at the START of the month = roll-forward ending one month back
    const priorRows = loanRollForward({journals: POSTED, loans: LOANS, fromPeriod: '2026-01', toPeriod: prevPeriod(period)});
    const row = priorRows.find((r) => r.loan_id === loan.loan_id);
    const opening = c(row ? row.gl_ending : 0);
    const interest = Math.round(opening * loan.interest_rate / 12);
    loanExpected += interest;
    detail.push(`${period} opening ${fmt(opening / 100)} -> interest ${fmt(interest / 100)}`);
  });
  perLoanExpected[loan.loan_id] = {expected: loanExpected, capitalise, project, detail};
  scheduled += loanExpected;
});
P(`  ledger schedule (opening GL principal x rate / 12, monthly): ${fmt(scheduled / 100)}`);

function prevPeriod(period) {
  const [y, m] = period.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
}

// --- what the ledger actually contains --------------------------------------
let accruedCents = 0, capCents = 0, expCents = 0, accrualLines = 0;
const byAccount = {};
POSTED.filter((j) => MONTHS.includes(j.period_code)).forEach((j) => j.lines.forEach((l) => {
  if (ACCRUAL_LIABILITY.has(l.account_code)) { accruedCents += c(crOf(l)) - c(drOf(l)); accrualLines++; }
  if (CAPITALISED.has(l.account_code)) capCents += c(drOf(l)) - c(crOf(l));
  if (EXPENSED.has(l.account_code)) { expCents += c(drOf(l)) - c(crOf(l)); byAccount[l.account_code] = (byAccount[l.account_code] || 0) + c(drOf(l)) - c(crOf(l)); }
}));
P('');
P('== WHAT THE LEDGER CONTAINS ==');
P(`  220410/220451/220310 accrued interest liability movement: ${fmt(accruedCents / 100)} across ${accrualLines} line(s)`);
P(`  164500/164501 capitalised interest:                       ${fmt(capCents / 100)}`);
P(`  795000/661000/772450 interest expense:                    ${fmt(expCents / 100)}`);
Object.keys(byAccount).sort().forEach((a) => P(`      ${a}: ${fmt(byAccount[a] / 100)}`));

// --- per loan -----------------------------------------------------------------
P('');
P('== PER LOAN: EXPECTED vs POSTED, AND THE CAPITALISE / EXPENSE SPLIT ==');
LOANS.forEach((loan) => {
  const e = perLoanExpected[loan.loan_id];
  const status = e.project ? e.project.construction_status : 'UNKNOWN';
  const target = e.capitalise ? '164500 (capitalised)' : '795000 (expensed)';
  // Interest actually ACCRUED against this loan. Accrual is the credit to the
  // interest payable account on an accrual journal; a debit to the same account
  // on a payment journal settles the liability and is not negative interest, so
  // payments and accrual reversals are counted separately.
  let posted = 0, paid = 0, reversed = 0;
  POSTED.filter((j) => MONTHS.includes(j.period_code)).forEach((j) => j.lines.forEach((l) => {
    if (!ACCRUAL_LIABILITY.has(l.account_code)) return;
    if (l.loan_id !== loan.loan_id) return;
    if (c(crOf(l)) > 0) posted += c(crOf(l));
    else if (String(j.rule_code || '').endsWith('R')) { reversed += c(drOf(l)); posted -= c(drOf(l)); }
    else paid += c(drOf(l));
  }));
  P(`  ${loan.loan_code}  ${ENT[loan.entity_id] ? ENT[loan.entity_id].entity_code : '?'}  principal ${fmt(loan.current_principal)} @ ${(loan.interest_rate * 100).toFixed(2)}%`);
  P(`     financed project ${e.project ? e.project.project_code : '?'} is ${status} -> interest belongs in ${target}`);
  P(`     expected FY2026 accrual (ledger schedule): ${fmt(e.expected / 100)}`);
  P(`     accrued in the ledger against this loan:   ${fmt(posted / 100)}   (of which reversed to the schedule: ${fmt(reversed / 100)})`);
  P(`     interest paid in the period:               ${fmt(paid / 100)}`);
  P(`     SHORTFALL:                                 ${fmt((e.expected - posted) / 100)}`);
  if (e.expected !== posted) failures.push(`${loan.loan_code} accrual shortfall ${fmt((e.expected - posted) / 100)}`);
});

// --- the split is enforced, not assumed ---------------------------------------
P('');
const inServiceLoans = LOANS.filter((l) => { const p = PROJECT_BY_ID[l.project_id]; return p && p.construction_status !== 'UNDER_CONSTRUCTION'; });
inServiceLoans.forEach((l) => {
  let expensedForLoan = 0;
  POSTED.forEach((j) => j.lines.forEach((line) => { if (EXPENSED.has(line.account_code) && line.loan_id === l.loan_id) expensedForLoan += c(drOf(line)); }));
  P(`  loan ${l.loan_code} finances an IN_SERVICE project: interest expensed in the ledger = ${fmt(expensedForLoan / 100)}`);
  if (expensedForLoan === 0) failures.push(`${l.loan_code} finances an in-service project and has no interest expense at all`);
});

P('');
P(`interest-accrual: flat_benchmark=${(flat / 100).toFixed(2)} scheduled=${(scheduled / 100).toFixed(2)} `
  + `capitalised=${(capCents / 100).toFixed(2)} expensed=${(expCents / 100).toFixed(2)} failures=${failures.length}`);
console.log(out.join('\n'));
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exitCode = 1; }
