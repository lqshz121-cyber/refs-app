// Defect 3 measurement - opening balances, equity, retained-earnings roll-forward.
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/opening-equity.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// Integer cents throughout. Exit code is 1 if any assertion fails.
import { POSTED, ENTITIES, ENT, drOf, crOf, fmt } from './_ledger.js';
import { acct, retainedEarningsRollForward, yearEndCloseLines } from '../../src/engine.js';

const FIRST_OPEN_PERIOD = '2026-01';
const EQUITY_PRIOR = '371000';       // Prior Years Retained Earnings
const EQUITY_CURRENT = '370300';     // Current Year Surplus(Deficit)
const c = n => Math.round(n*100);

const out = []; const P = s => out.push(s);
const failures = [];

const opening = POSTED.filter(j => String(j.period_code || '') < FIRST_OPEN_PERIOD);
const fy = POSTED.filter(j => String(j.period_code || '') >= FIRST_OPEN_PERIOD);

P('== OPENING POSITION ==');
P(`  posted journals dated before ${FIRST_OPEN_PERIOD}: ${opening.length}`);
P(`  earliest posted period: ${POSTED.map(j=>j.period_code).sort()[0]}`);

// 1. Every entity has an opening trial balance and it balances on its own.
const openByEntity = {};
opening.forEach(j => {
  const r = openByEntity[j.entity_id] = openByEntity[j.entity_id] || {debit:0, credit:0, jes:0};
  r.jes += 1;
  j.lines.forEach(l => { r.debit += c(drOf(l)); r.credit += c(crOf(l)); });
});
const withOpening = ENTITIES.filter(e => openByEntity[e.entity_id]);
const unbalanced = withOpening.filter(e => openByEntity[e.entity_id].debit !== openByEntity[e.entity_id].credit);
P('');
P(`  [1] entities with an opening trial balance: ${withOpening.length} of ${ENTITIES.length}`);
P(`      opening trial balances that do NOT balance: ${unbalanced.length}`);
unbalanced.slice(0,5).forEach(e => P(`        ${e.entity_code}: dr ${fmt(openByEntity[e.entity_id].debit/100)} cr ${fmt(openByEntity[e.entity_id].credit/100)}`));
if (withOpening.length !== ENTITIES.length) failures.push(`${ENTITIES.length - withOpening.length} entity/entities have no opening trial balance`);
if (unbalanced.length) failures.push(`${unbalanced.length} opening trial balance(s) do not balance`);

// 2. Equity actually exists.
const equityLines = {};
POSTED.forEach(j => j.lines.forEach(l => {
  if (acct(l.account_code).account_type !== 'EQUITY') return;
  const r = equityLines[l.account_code] = equityLines[l.account_code] || {lines:0, net:0};
  r.lines += 1; r.net += c(crOf(l)) - c(drOf(l));
}));
const equityTotal = Object.values(equityLines).reduce((s,r) => s + r.net, 0);
const entitiesWithEquity = new Set();
POSTED.forEach(j => j.lines.forEach(l => { if (acct(l.account_code).account_type === 'EQUITY') entitiesWithEquity.add(j.entity_id); }));
P('');
P(`  [2] equity accounts posted: ${Object.keys(equityLines).length}; total equity postings: ${Object.values(equityLines).reduce((s,r)=>s+r.lines,0)} lines`);
Object.keys(equityLines).sort().forEach(k => P(`        ${k} ${acct(k).account_name.slice(0,38).padEnd(38)} lines=${String(equityLines[k].lines).padStart(4)} balance ${fmt(equityLines[k].net/100)}`));
P(`      entities carrying any equity: ${entitiesWithEquity.size} of ${ENTITIES.length}`);
P(`      total group equity: ${fmt(equityTotal/100)}`);
if (entitiesWithEquity.size !== ENTITIES.length) failures.push(`${ENTITIES.length - entitiesWithEquity.size} entity/entities carry no equity`);

// 3. Retained earnings carry forward: prior-year result must have left current
//    earnings and landed in equity.
const priorNet = (equityLines[EQUITY_PRIOR] || {net:0}).net;
const currentSurplusNet = (equityLines[EQUITY_CURRENT] || {net:0}).net;
P('');
P(`  [3] ${EQUITY_PRIOR} Prior Years Retained Earnings: ${fmt(priorNet/100)}`);
P(`      ${EQUITY_CURRENT} Current Year Surplus after the FY2025 close: ${fmt(currentSurplusNet/100)}`);
if (priorNet === 0) failures.push('no prior-years retained earnings exist');
if (currentSurplusNet !== 0) failures.push(`current year surplus did not roll forward: ${fmt(currentSurplusNet/100)} left behind`);

// 4. The roll-forward is a routine, not a one-off. Run it on FY2026 and prove
//    it moves the whole result into equity and leaves nothing behind.
const groupRoll = retainedEarningsRollForward(POSTED, {throughPeriod:'2026-07', fiscalYear:'2026'});
const closeLines = yearEndCloseLines(groupRoll.current_year_earnings);
const closeDr = closeLines.reduce((s,l) => s + c(l.debit_amount || 0), 0);
const closeCr = closeLines.reduce((s,l) => s + c(l.credit_amount || 0), 0);
P('');
P('  [4] retainedEarningsRollForward() over the whole group as of 2026-07:');
P(`        equity already booked         ${fmt(groupRoll.equity)}`);
P(`        earnings from prior years     ${fmt(groupRoll.prior_year_earnings)}`);
P(`        FY2026 current-year earnings  ${fmt(groupRoll.current_year_earnings)}`);
P(`        retained earnings carried fwd ${fmt(groupRoll.retained_earnings_carried_forward)}`);
P(`      yearEndCloseLines(FY2026 result) -> ${closeLines.length} lines, dr ${fmt(closeDr/100)} cr ${fmt(closeCr/100)}, balanced=${closeDr === closeCr}`);
if (closeDr !== closeCr) failures.push('the year-end close journal does not balance');
if (groupRoll.prior_year_earnings !== 0) failures.push(`${fmt(groupRoll.prior_year_earnings)} of prior-year earnings is still sitting in revenue/expense`);

// 5. Balance-sheet identity, per entity and in total.
const identity = {};
POSTED.forEach(j => j.lines.forEach(l => {
  const t = acct(l.account_code).account_type;
  const r = identity[j.entity_id] = identity[j.entity_id] || {ASSET:0, LIABILITY:0, EQUITY:0, REVENUE:0, EXPENSE:0};
  r[t] = (r[t] || 0) + c(drOf(l)) - c(crOf(l));
}));
const offBalance = [];
let TA = 0, TL = 0, TE = 0, TR = 0, TX = 0;
Object.entries(identity).forEach(([e, r]) => {
  const A = r.ASSET, L = -r.LIABILITY, E = -r.EQUITY, earn = -r.REVENUE - r.EXPENSE;
  TA += A; TL += L; TE += E; TR += -r.REVENUE; TX += r.EXPENSE;
  if (A !== L + E + earn) offBalance.push(`${ENT[e] ? ENT[e].entity_code : e}: A ${fmt(A/100)} vs L+E+earnings ${fmt((L+E+earn)/100)}`);
});
P('');
P(`  [5] entities where Assets != Liabilities + Equity + current earnings: ${offBalance.length} of ${Object.keys(identity).length}`);
offBalance.slice(0,5).forEach(x => P(`        ${x}`));
P(`      group: Assets ${fmt(TA/100)} = Liabilities ${fmt(TL/100)} + Equity ${fmt(TE/100)} + earnings ${fmt((TR-TX)/100)} -> ${fmt((TL+TE+TR-TX)/100)}`);
if (offBalance.length) failures.push(`${offBalance.length} entity balance sheet(s) do not tie`);
if (TA !== TL + TE + TR - TX) failures.push('the group balance sheet does not tie');

// 6. An opening balance sheet that lets an entity overdraw its bank is its own
//    defect. Walk cash chronologically for every entity.
const cashRuns = {}; const lows = {};
POSTED.slice().sort((a,b) => String(a.je_date).localeCompare(String(b.je_date)) || a.je_id - b.je_id)
  .forEach(j => j.lines.forEach(l => {
    if (l.account_code !== '111000') return;
    cashRuns[j.entity_id] = (cashRuns[j.entity_id] || 0) + c(drOf(l)) - c(crOf(l));
    if (cashRuns[j.entity_id] < (lows[j.entity_id] || 0)) lows[j.entity_id] = cashRuns[j.entity_id];
  }));
const overdrawn = Object.entries(lows).filter(([, v]) => v < 0);
P('');
P(`  [6] entities that go cash-negative at any point in FY2026: ${overdrawn.length}`);
overdrawn.slice(0,5).forEach(([e,v]) => P(`        ${ENT[e] ? ENT[e].entity_code : e}: low water ${fmt(v/100)}`));
if (overdrawn.length) failures.push(`${overdrawn.length} entity/entities overdraw their operating cash`);

// 7. audit.js accepts any journal inside a 0.005 float tolerance while the
//    Postgres side is numeric(20,4). Measure the stricter thing: how many
//    posted journals balance only because of that tolerance, in integer cents.
const tolerant = [];
POSTED.forEach(j => {
  const dr = j.lines.reduce((s,l) => s + c(drOf(l)), 0);
  const cr = j.lines.reduce((s,l) => s + c(crOf(l)), 0);
  if (dr !== cr) tolerant.push(`${j.je_number} e${j.entity_id} out by ${fmt((dr-cr)/100)}`);
});
P('');
P(`  [7] posted journals that do not balance to the cent (audit.js allows |diff| < 0.005): ${tolerant.length} of ${POSTED.length}`);
tolerant.slice(0,5).forEach(x => P(`        ${x}`));
if (tolerant.length) failures.push(`${tolerant.length} posted journal(s) balance only inside the float tolerance`);

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`opening-equity: failures=${failures.length}`); }
else P('opening-equity: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
