// Defect 1 measurement - Land/CWIP -> Finished inventory -> COGS on a unit.
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/unit-cost-cogs.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// Every figure is accumulated in integer cents. Nothing here reads a rate, a
// ratio or a sale price: cost is what was capitalised to the unit, and relief
// is what was taken off it. Exit code is 1 if any assertion fails.
import { POSTED, ENT, drOf, crOf, fmt } from './_ledger.js';

const CWIP = ['161000','162000','163000','164000','164100','164200','164400','164500'];
const INVENTORY = ['165100'];
const COGS = ['510000','510001'];
const c = n => Math.round(n*100);

const out = []; const P = s => out.push(s);
const failures = [];

// (entity|unit) -> cost capitalised, moved to inventory, relieved to COGS
const unit = {};
const at = k => (unit[k] = unit[k] || {capitalised:0, cwipCredited:0, toInventory:0, invCredited:0, cogs:0, sales:0, saleMonths:new Set()});

POSTED.forEach(j => j.lines.forEach(l => {
  const u = l.unit_code; if (!u) return;
  const k = `${j.entity_id}|${u}`; const r = at(k);
  if (CWIP.includes(l.account_code)) { r.capitalised += c(drOf(l)); r.cwipCredited += c(crOf(l)); }
  if (INVENTORY.includes(l.account_code)) { r.toInventory += c(drOf(l)); r.invCredited += c(crOf(l)); }
  if (COGS.includes(l.account_code)) r.cogs += c(drOf(l));
  if (l.account_code === '491800') { r.sales += c(crOf(l)); if (crOf(l) > 0) r.saleMonths.add(j.period_code); }
}));

const keys = Object.keys(unit).sort();
const relieved = keys.filter(k => unit[k].cogs > 0);

P('== UNIT COST LEDGER · Land/CWIP -> Finished inventory -> COGS ==');
P(`  units carrying any dimensioned activity: ${keys.length}`);
P(`  units with cost relieved to COGS:        ${relieved.length}`);

// 1. The single test that matters in for-sale homebuilding.
const overRelieved = relieved
  .map(k => ({k, cost:unit[k].capitalised, cogs:unit[k].cogs, over:unit[k].cogs - unit[k].capitalised}))
  .filter(r => r.over > 0)
  .sort((a,b) => b.over - a.over);
P('');
P(`  [1] units where cumulative COGS exceeds cumulative unit cost: ${overRelieved.length} of ${relieved.length}`);
P(`      total over-relief: ${fmt(overRelieved.reduce((s,r)=>s+r.over,0)/100)}`);
overRelieved.slice(0,8).forEach(r => P(`        ${r.k}: cost ${fmt(r.cost/100)} relieved ${fmt(r.cogs/100)} OVER by ${fmt(r.over/100)}`));
if (overRelieved.length) failures.push(`${overRelieved.length} unit(s) relieved more cost than they ever carried`);

// 2. COGS must come out of finished inventory, not straight off CWIP.
const notFromInventory = relieved.filter(k => unit[k].cogs > unit[k].toInventory);
P('');
P(`  [2] units relieved to COGS without an equal transfer into finished inventory: ${notFromInventory.length} of ${relieved.length}`);
notFromInventory.slice(0,5).forEach(k => P(`        ${k}: transferred ${fmt(unit[k].toInventory/100)} relieved ${fmt(unit[k].cogs/100)}`));
if (notFromInventory.length) failures.push(`${notFromInventory.length} unit(s) took COGS without a CWIP -> inventory transfer`);

// 3. The middle step has to exist as a real posting.
let transferJEs = 0;
POSTED.forEach(j => {
  const codes = j.lines.map(l => l.account_code);
  if (codes.some(x => INVENTORY.includes(x)) && codes.some(x => CWIP.includes(x))) transferJEs += 1;
});
P('');
P(`  [3] posted journals moving CWIP into finished inventory: ${transferJEs}`);
if (transferJEs === 0) failures.push('no CWIP -> finished inventory transfer entry exists');

// 4. No unit may carry a negative balance in CWIP or in inventory.
const negativeCarrying = keys.filter(k => unit[k].capitalised - unit[k].cwipCredited < 0 || unit[k].toInventory - unit[k].invCredited < 0);
P('');
P(`  [4] units with a negative CWIP or inventory carrying value: ${negativeCarrying.length}`);
negativeCarrying.slice(0,5).forEach(k => P(`        ${k}: CWIP ${fmt((unit[k].capitalised-unit[k].cwipCredited)/100)} inventory ${fmt((unit[k].toInventory-unit[k].invCredited)/100)}`));
if (negativeCarrying.length) failures.push(`${negativeCarrying.length} unit(s) carry a negative balance`);

// 5. A lot can only be sold once.
const soldTwice = keys.filter(k => unit[k].saleMonths.size > 1);
P('');
P(`  [5] units sold in more than one period: ${soldTwice.length}`);
soldTwice.slice(0,5).forEach(k => P(`        ${k}: sold in ${[...unit[k].saleMonths].join(', ')}`));
if (soldTwice.length) failures.push(`${soldTwice.length} unit(s) were sold more than once`);

// 6. Resulting margin. Reported, not targeted.
const revenue = keys.reduce((s,k) => s + unit[k].sales, 0);
const cost = keys.reduce((s,k) => s + unit[k].cogs, 0);
P('');
P('== RESULTING MARGIN ON UNIT CLOSINGS ==');
P(`  revenue 491800 on units: ${fmt(revenue/100)}`);
P(`  cost of sales on units:  ${fmt(cost/100)}`);
P(`  gross profit:            ${fmt((revenue-cost)/100)}  (${revenue ? (100*(revenue-cost)/revenue).toFixed(1) : '0.0'}%)`);
P('  A for-sale homebuilder reports roughly 15%-25% here. The number is whatever');
P('  the accumulated unit cost produces; nothing in the relief reads the price.');

// 7. Residual work in progress is real, unsold inventory.
const openWip = keys.reduce((s,k) => s + unit[k].capitalised - unit[k].cwipCredited, 0);
const openInv = keys.reduce((s,k) => s + unit[k].toInventory - unit[k].invCredited, 0);
P('');
P(`  work in progress still in CWIP at 2026-07: ${fmt(openWip/100)}`);
P(`  finished inventory unsold at 2026-07:      ${fmt(openInv/100)}`);

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`unit-cost-cogs: failures=${failures.length}`); }
else P('unit-cost-cogs: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
