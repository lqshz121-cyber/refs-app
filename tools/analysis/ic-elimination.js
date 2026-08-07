// Defect 2 measurement - does intercompany mirror, and does it eliminate?
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/ic-elimination.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// A pair mirrors when A's balance against B is exactly the negative of B's
// balance against A, in the same period, on symmetric accounts (125000 Due from
// on the creditor, 291xxx Due to/from on the debtor). Integer cents throughout.
// Exit code is 1 if any assertion fails.
import { POSTED, ENTITIES, ENT, memberOf, drOf, crOf, fmt } from './_ledger.js';
import { buildUnitTransferPair } from '../../src/unit-transfer-pairing.js';
import { buildConsolidation } from '../../src/consolidation.js';
import { TOP_GROUP_CODE } from '../../src/consolidation-groups.js';

const DUE_FROM = ['125000'];
const DUE_TO = ['291000','291001','291002','291003','291004','291005','291006','291007','291031'];
const IC = [...DUE_FROM, ...DUE_TO];
const c = n => Math.round(n*100);

const out = []; const P = s => out.push(s);
const failures = [];
const groupNames = new Set(ENTITIES.map(e => e.entity_name));

const byAccount = {};
const pairPeriod = {};   // "A|B|period" -> net cents on A's books against B
const pairTotal = {};    // "A|B"        -> net cents
const external = {};     // non-group counterparty -> net cents
let icLines = 0, missingMember = 0;

POSTED.forEach(j => j.lines.forEach(l => {
  if (!IC.includes(l.account_code)) return;
  icLines += 1;
  const net = c(drOf(l)) - c(crOf(l));
  byAccount[l.account_code] = (byAccount[l.account_code] || 0) + net;
  const me = ENT[j.entity_id] ? ENT[j.entity_id].entity_name : `entity ${j.entity_id}`;
  const other = memberOf(l);
  if (!other) { missingMember += 1; return; }
  if (!groupNames.has(other)) { external[other] = (external[other] || 0) + net; return; }
  pairPeriod[`${me}|${other}|${j.period_code}`] = (pairPeriod[`${me}|${other}|${j.period_code}`] || 0) + net;
  pairTotal[`${me}|${other}`] = (pairTotal[`${me}|${other}`] || 0) + net;
}));

P('== INTERCOMPANY ELIMINATION ==');
P(`  intercompany ledger lines: ${icLines}`);
Object.keys(byAccount).sort().forEach(k => P(`    ${k}: ${fmt(byAccount[k]/100)}`));
const residual = Object.values(byAccount).reduce((s,v) => s + v, 0);
P('');
P(`  [1] consolidated intercompany residual (${IC.join(' + ')}): ${fmt(residual/100)}`);
if (residual !== 0) failures.push(`consolidated intercompany residual is ${fmt(residual/100)}, not 0.00`);

// Every intercompany line must name who it is with.
P('');
P(`  [2] intercompany lines with no counterparty member: ${missingMember}`);
if (missingMember) failures.push(`${missingMember} intercompany line(s) carry no member`);

// A due-to/from account may only hold a group counterparty. A payable to a
// third party is a trade payable, and it will never eliminate.
const externalNet = Object.values(external).reduce((s,v) => s + v, 0);
P('');
P(`  [3] intercompany balances against a counterparty that is NOT a group entity: ${Object.keys(external).length} counterpart(ies), net ${fmt(externalNet/100)}`);
Object.entries(external).sort((a,b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0,12)
  .forEach(([k,v]) => P(`        ${k.padEnd(42)} ${fmt(v/100)}`));
if (Object.keys(external).length) failures.push(`${Object.keys(external).length} non-group counterpart(ies) sit in an intercompany account`);

// Mirror test, per pair and per pair-and-period.
const mirrorCheck = (map, label, key) => {
  const seen = new Set(); let mirrored = 0; const broken = [];
  Object.entries(map).forEach(([k,v]) => {
    const parts = k.split('|');
    const reverseKey = key === 'period' ? `${parts[1]}|${parts[0]}|${parts[2]}` : `${parts[1]}|${parts[0]}`;
    const id = [k, reverseKey].sort().join('::');
    if (seen.has(id)) return; seen.add(id);
    const reverse = map[reverseKey];
    if (reverse !== undefined && reverse === -v) mirrored += 1;
    else broken.push(`${k}: ${fmt(v/100)} | reverse ${reverse === undefined ? 'DOES NOT EXIST' : fmt(reverse/100)}`);
  });
  P('');
  P(`  ${label}: ${mirrored} mirrored, ${broken.length} one-sided (of ${mirrored + broken.length} eliminable relationships)`);
  broken.slice(0,10).forEach(x => P(`        ${x}`));
  if (broken.length) failures.push(`${broken.length} ${label} do not mirror`);
};
mirrorCheck(pairTotal, '[4] pair mirror (cumulative)', 'total');
mirrorCheck(pairPeriod, '[5] pair mirror (per period)', 'period');

// Symmetric accounts: the creditor side must be an asset Due from and the
// debtor side a liability Due to/from, so a consolidation nets them by code.
let asymmetric = 0;
POSTED.forEach(j => j.lines.forEach(l => {
  if (!IC.includes(l.account_code)) return;
  const net = c(drOf(l)) - c(crOf(l));
  if (DUE_FROM.includes(l.account_code) && net < 0) return;   // a due-from being collected
  if (DUE_TO.includes(l.account_code) && net > 0) return;     // a due-to being settled
}));
P('');
P(`  [6] due-from account family: ${DUE_FROM.join(', ')} (asset) · due-to family: ${DUE_TO.slice(0,3).join(', ')}... (liability)`);
P(`      net due from ${fmt(DUE_FROM.reduce((s,k)=>s+(byAccount[k]||0),0)/100)} + net due to ${fmt(DUE_TO.reduce((s,k)=>s+(byAccount[k]||0),0)/100)} = ${fmt(residual/100)}`);

// The unit-transfer path is a UI action, not seed data, so exercise the pairing
// routine directly.
//
// This test used to assert that the RECEIVER's own ledger carried the unit at
// the group's carrying cost - that is, that the consolidation entry had been
// pushed down into a separate company's books. It was checking the wrong ledger.
// A company that pays 400,000 for a lot carries a 400,000 asset; the group's
// margin is removed on CONSOLIDATION, not on the buyer's balance sheet. So the
// separate-company facts are checked here, and the group fact is checked where
// it belongs - by running the pair through the real consolidation engine and
// measuring the consolidated inventory and the consolidated gain. That is a
// stricter test than the one it replaces: it exercises the elimination code.
P('');
P('  [7] unit transfer pairing (src/unit-transfer-pairing.js) and its consolidation:');
const A = ENTITIES.find(e => e.entity_id === 5);
const B = ENTITIES.find(e => e.entity_id === 9);
const CARRYING = 300000;
[['gain', 400000], ['loss', 250000], ['at cost', 300000]].forEach(([label, price], idx) => {
  const pairId = `UT-TEST-${idx}`;
  const built = buildUnitTransferPair({from:A, to:B, unit:'Lot 101 Block A', carrying:CARRYING, price, pairId});
  if (!built.ok) { P(`        ${label}: BUILD FAILED ${built.code}`); failures.push(`unit transfer pair (${label}) could not be built: ${built.code}`); return; }
  const sum = (lines, code, f) => lines.filter(l => l.account_code === code).reduce((s,l) => s + c(f(l)), 0);
  const dueFrom = sum(built.out.lines, '125000', l => l.debit_amount||0);
  const dueTo = sum(built.in.lines, '291000', l => l.credit_amount||0);
  const receiverInventory = sum(built.in.lines, '164400', l => l.debit_amount||0) - sum(built.in.lines, '164400', l => l.credit_amount||0);
  const sellerGain = sum(built.out.lines, '787001', l => l.credit_amount||0) - sum(built.out.lines, '787001', l => l.debit_amount||0);
  const bal = lines => lines.reduce((s,l) => s + c(l.debit_amount||0) - c(l.credit_amount||0), 0);
  // Post the pair into a ledger of its own and consolidate it.
  const asPosted = (side, id) => ({...side, je_id:id, je_number:`${pairId}-${id}`, period_code:'2026-07',
    je_date:'2026-07-31', posting_status:'POSTED', ic_pair_id:pairId});
  const ledger = [asPosted(built.out, 9001), asPosted(built.in, 9002)];
  const consolidated = buildConsolidation({journals:ledger, groupCode:TOP_GROUP_CODE, throughPeriod:'2026-07'});
  const at = code => consolidated.trialBalance.rows.find(r => r.account_code === code);
  const consInventory = at('164400') ? at('164400').consolidated_balance_cents : 0;
  const consGain = at('787001') ? -at('787001').consolidated_balance_cents : 0;
  const consIc = ['125000','291000'].reduce((s,code) => s + (at(code) ? Math.abs(at(code).consolidated_balance_cents) : 0), 0);
  P(`        ${label.padEnd(8)} due from ${fmt(dueFrom/100)} | due to ${fmt(dueTo/100)} | receiver inventory ${fmt(receiverInventory/100)} | seller gain ${fmt(sellerGain/100)} | balanced=${bal(built.out.lines)===0 && bal(built.in.lines)===0}`);
  const impairmentWarnings = consolidated.elimination.warnings.filter(w => /BELOW group carrying cost/.test(w));
  P(`                 consolidated: inventory movement ${fmt(consInventory/100)} | transfer gain ${fmt(consGain/100)} | intercompany left ${fmt(consIc/100)} | impairment notices ${impairmentWarnings.length}`);
  if (dueFrom !== dueTo) failures.push(`unit transfer pair (${label}) does not mirror`);
  if (receiverInventory !== c(price)) failures.push(`unit transfer pair (${label}) records the receiver's inventory at ${fmt(receiverInventory/100)}, not the ${fmt(price)} it paid`);
  if (sellerGain !== c(price) - c(CARRYING)) failures.push(`unit transfer pair (${label}) records a seller gain of ${fmt(sellerGain/100)} against a price of ${fmt(price)} on a carrying cost of ${fmt(CARRYING)}`);
  if (bal(built.out.lines) !== 0 || bal(built.in.lines) !== 0) failures.push(`unit transfer pair (${label}) does not balance`);
  // A transfer inside the group moves nothing in or out of the group, so after
  // consolidation it may not ADD to group inventory or to the group result.
  // Moving an asset at below its group carrying cost is left in and reported as
  // an impairment indicator (src/consolidation.js), so the test is one-sided.
  if (consInventory > 0) failures.push(`consolidating unit transfer pair (${label}) leaves ${fmt(consInventory/100)} of intercompany margin in group inventory`);
  if (consGain > 0) failures.push(`consolidating unit transfer pair (${label}) leaves ${fmt(consGain/100)} of unrealised intercompany profit in the group result`);
  if (consInventory !== consGain) failures.push(`consolidating unit transfer pair (${label}) changes group inventory by ${fmt(consInventory/100)} and the group result by ${fmt(consGain/100)}; an internal transfer must move both by the same amount or neither`);
  if (consIc !== 0) failures.push(`consolidating unit transfer pair (${label}) leaves ${fmt(consIc/100)} of intercompany balance on the group balance sheet`);
  if (price < CARRYING && !impairmentWarnings.length) failures.push(`a unit transferred below group carrying cost raised no impairment notice`);
  if (price >= CARRYING && impairmentWarnings.length) failures.push(`a unit transferred at or above group carrying cost raised an impairment notice`);
});
const sameEntity = buildUnitTransferPair({from:A, to:A, unit:'Lot 101 Block A', carrying:300000, price:400000});
P(`        atomicity: a same-entity transfer is refused before either side is created -> ${sameEntity.ok ? 'NOT REFUSED' : sameEntity.code}`);
if (sameEntity.ok) failures.push('a same-entity unit transfer was accepted');

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`ic-elimination: failures=${failures.length}`); }
else P('ic-elimination: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
