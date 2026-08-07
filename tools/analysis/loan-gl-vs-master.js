// H-2 measurement - does the general ledger agree with the loan master, and can
// the roll-forward see it when it does not?
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/loan-gl-vs-master.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// Everything is accumulated in integer cents. The loan master is a memo record;
// the ledger is the accounting record. A difference between them is a
// reconciling item that has to be named, not absorbed.
import { POSTED, LOANS, ENT, drOf, crOf, fmt } from './_ledger.js';
import { loanRollForward, LOAN_PAYABLE_ACCOUNTS } from '../../src/loan-rollforward.js';

const c = (n) => Math.round((Number(n) || 0) * 100);
const out = []; const P = (s) => out.push(s);
const failures = [];

P('== H-2 · GL LOAN PAYABLE vs LOAN MASTER ==');
P(`  loan payable accounts read: ${[...LOAN_PAYABLE_ACCOUNTS].sort().join(', ')}`);

// --- 1. Raw GL balance across the whole group -------------------------------
let glCents = 0, glLines = 0;
POSTED.forEach((j) => j.lines.forEach((l) => {
  if (!LOAN_PAYABLE_ACCOUNTS.has(l.account_code)) return;
  glCents += c(crOf(l)) - c(drOf(l));
  glLines++;
}));
const masterCents = LOANS.reduce((s, l) => s + c(l.current_principal), 0);
P('');
P(`  GL loan payable (credit balance):  ${fmt(glCents / 100)}   across ${glLines} line(s)`);
P(`  LOANS master principal outstanding: ${fmt(masterCents / 100)}   across ${LOANS.length} loan(s)`);
P(`  DIFFERENCE (master - GL):          ${fmt((masterCents - glCents) / 100)}`);
if (glCents !== masterCents) failures.push(`group GL ${glCents} != master ${masterCents}`);

// --- 2. Roll-forward, read off the ledger -----------------------------------
P('');
P('== ROLL-FORWARD, BUILT FROM THE GENERAL LEDGER (through 2026-07) ==');
const rows = loanRollForward({journals: POSTED, loans: LOANS, fromPeriod: '2026-01', toPeriod: '2026-07'});
rows.forEach((r) => {
  P(`  ${r.loan_code} (${ENT[r.entity_id] ? ENT[r.entity_id].entity_code : '?'})`);
  P(`     GL beginning principal      ${fmt(r.gl_beginning)}`);
  P(`     + GL draws                  ${fmt(r.gl_draws)}`);
  P(`     - GL repayments             ${fmt(r.gl_repayments)}`);
  P(`     = GL ending principal       ${fmt(r.gl_ending)}`);
  P(`       loan master principal     ${fmt(r.master_principal)}`);
  P(`       UNRECONCILED DIFFERENCE   ${fmt(r.difference)}   ${r.difference_cents === 0 ? 'tie' : 'EXCEPTION'}`);
  if (r.difference_cents !== 0) failures.push(`${r.loan_code} difference ${fmt(r.difference)}`);
});
// Loan-payable movement the roll-forward could not attribute to any loan in the
// master is itself a reconciling item and must be reported, never dropped.
const attributedCents = rows.reduce((s, r) => s + c(r.gl_ending), 0);
P('');
P(`  GL loan payable attributed to a master loan: ${fmt(attributedCents / 100)}`);
P(`  GL loan payable NOT attributable:            ${fmt(c(rows.unattributed.gl_ending) / 100)}`);
if (c(rows.unattributed.gl_ending) !== 0) failures.push(`unattributed GL loan payable ${fmt(rows.unattributed.gl_ending)}`);

P('');
P(`loan-gl-vs-master: gl=${(glCents / 100).toFixed(2)} master=${(masterCents / 100).toFixed(2)} difference=${((masterCents - glCents) / 100).toFixed(2)} failures=${failures.length}`);
console.log(out.join('\n'));
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exitCode = 1; }
