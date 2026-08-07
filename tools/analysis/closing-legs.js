// H-5 measurement - does a home closing carry the legs a settlement statement
// actually has: Cash AND receivable, revenue, cost of sales, title withholding
// and selling costs?
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/closing-legs.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// A closing that books the whole contract price to cash and nothing else says
// the seller received every dollar the buyer paid, owed no commission, paid no
// title company and withheld no tax. Reported margin is the whole difference
// between price and construction cost.
import { POSTED, drOf, crOf, fmt } from './_ledger.js';

const c = (n) => Math.round((Number(n) || 0) * 100);
const SALE_REVENUE = ['491800', '490100', '490101'];
const CASH = ['111000'];
const RECEIVABLE = ['121011', '125001', '120200', '123700'];
const TITLE_WITHHOLDING = ['220205'];
const SELLING_COST = ['510100', '682500', '778002', '684000'];
const COGS = ['510000', '510001'];

const out = []; const P = (s) => out.push(s);
const failures = [];

// A closing is a posted journal that credits unit sale revenue.
const closings = POSTED.filter((j) => (j.lines || []).some((l) => SALE_REVENUE.includes(l.account_code) && c(crOf(l)) > 0));

let gross = 0, cash = 0, receivable = 0, withholding = 0, selling = 0;
let withReceivable = 0, withWithholding = 0, withSelling = 0;
closings.forEach((j) => {
  let g = 0, ca = 0, ar = 0, wh = 0, sc = 0;
  (j.lines || []).forEach((l) => {
    if (SALE_REVENUE.includes(l.account_code)) g += c(crOf(l)) - c(drOf(l));
    if (CASH.includes(l.account_code)) ca += c(drOf(l)) - c(crOf(l));
    if (RECEIVABLE.includes(l.account_code)) ar += c(drOf(l)) - c(crOf(l));
    if (TITLE_WITHHOLDING.includes(l.account_code)) wh += c(crOf(l)) - c(drOf(l));
    if (SELLING_COST.includes(l.account_code)) sc += c(drOf(l)) - c(crOf(l));
  });
  gross += g; cash += ca; receivable += ar; withholding += wh; selling += sc;
  if (ar > 0) withReceivable++;
  if (wh > 0) withWithholding++;
  if (sc > 0) withSelling++;
});

P('== H-5 · HOME CLOSINGS: THE LEGS OF A SETTLEMENT STATEMENT ==');
P(`  closings (journals crediting ${SALE_REVENUE.join('/')}): ${closings.length}`);
P(`  gross contract price recognised:            ${fmt(gross / 100)}`);
P('');
P(`  closings carrying a RECEIVABLE leg:         ${withReceivable} of ${closings.length}   ${fmt(receivable / 100)}`);
P(`  closings carrying TITLE WITHHOLDING (220205): ${withWithholding} of ${closings.length}   ${fmt(withholding / 100)}`);
P(`  closings carrying SELLING COSTS (${SELLING_COST.join('/')}): ${withSelling} of ${closings.length}   ${fmt(selling / 100)}`);
P(`  cash debited at closing:                    ${fmt(cash / 100)}`);

// Group-wide balances on the accounts a closing is supposed to touch.
const bal = {};
POSTED.forEach((j) => (j.lines || []).forEach((l) => {
  bal[l.account_code] = bal[l.account_code] || {dr: 0, cr: 0, n: 0};
  bal[l.account_code].dr += c(drOf(l)); bal[l.account_code].cr += c(crOf(l)); bal[l.account_code].n++;
}));
P('');
P('== GROUP BALANCES ON THE CLOSING ACCOUNTS ==');
[...TITLE_WITHHOLDING, ...SELLING_COST, ...COGS, ...SALE_REVENUE].forEach((a) => {
  const b = bal[a] || {dr: 0, cr: 0, n: 0};
  P(`  ${a}: lines=${String(b.n).padStart(4)}  debit ${fmt(b.dr / 100).padStart(16)}  credit ${fmt(b.cr / 100).padStart(16)}`);
});

// Gross margin as reported.
const cogsTotal = COGS.reduce((s, a) => s + ((bal[a] || {dr: 0}).dr - (bal[a] || {cr: 0}).cr), 0);
const revTotal = SALE_REVENUE.reduce((s, a) => s + ((bal[a] || {cr: 0}).cr - (bal[a] || {dr: 0}).dr), 0);
const sellTotal = SELLING_COST.reduce((s, a) => s + ((bal[a] || {dr: 0}).dr - (bal[a] || {cr: 0}).cr), 0);
P('');
P(`  unit sale revenue      ${fmt(revTotal / 100)}`);
P(`  cost of sales          ${fmt(cogsTotal / 100)}`);
P(`  selling costs          ${fmt(sellTotal / 100)}`);
P(`  gross margin           ${fmt((revTotal - cogsTotal) / 100)}  (${revTotal ? ((revTotal - cogsTotal) / revTotal * 100).toFixed(1) : '0.0'}%)`);
P(`  margin after selling   ${fmt((revTotal - cogsTotal - sellTotal) / 100)}  (${revTotal ? ((revTotal - cogsTotal - sellTotal) / revTotal * 100).toFixed(1) : '0.0'}%)`);

if (withWithholding !== closings.length) failures.push(`${closings.length - withWithholding} closing(s) carry no title withholding`);
if (withSelling !== closings.length) failures.push(`${closings.length - withSelling} closing(s) carry no selling cost`);
if (withReceivable !== closings.length) failures.push(`${closings.length - withReceivable} closing(s) settle entirely in cash with no receivable`);

P('');
P(`closing-legs: closings=${closings.length} gross=${(gross / 100).toFixed(2)} withholding=${(withholding / 100).toFixed(2)} `
  + `selling=${(selling / 100).toFixed(2)} receivable=${(receivable / 100).toFixed(2)} failures=${failures.length}`);
console.log(out.join('\n'));
if (failures.length) { failures.forEach((f) => console.error('FAIL', f)); process.exitCode = 1; }
