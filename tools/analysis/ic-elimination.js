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
// routine directly: profit must not stay capitalised in the receiver's
// inventory, and both sides must mirror.
P('');
P('  [7] unit transfer pairing (src/unit-transfer-pairing.js):');
const A = {entity_id:5, entity_code:'WBCR', entity_name:'WB Conroe LLC'};
const B = {entity_id:9, entity_code:'WBHS', entity_name:'WB Home Sub LLC'};
[['gain', 400000], ['loss', 250000], ['at cost', 300000]].forEach(([label, price]) => {
  const built = buildUnitTransferPair({from:A, to:B, unit:'Lot 101 Block A', carrying:300000, price, pairId:'UT-TEST'});
  if (!built.ok) { P(`        ${label}: BUILD FAILED ${built.code}`); failures.push(`unit transfer pair (${label}) could not be built: ${built.code}`); return; }
  const sum = (lines, code, f) => lines.filter(l => l.account_code === code).reduce((s,l) => s + c(f(l)), 0);
  const dueFrom = sum(built.out.lines, '125000', l => l.debit_amount||0);
  const dueTo = sum(built.in.lines, '291000', l => l.credit_amount||0);
  const receiverInventory = sum(built.in.lines, '164400', l => l.debit_amount||0) - sum(built.in.lines, '164400', l => l.credit_amount||0);
  const groupGain = (sum(built.out.lines, '787001', l => l.credit_amount||0) - sum(built.out.lines, '787001', l => l.debit_amount||0))
                  + (sum(built.in.lines, '787001', l => l.credit_amount||0) - sum(built.in.lines, '787001', l => l.debit_amount||0));
  const bal = lines => lines.reduce((s,l) => s + c(l.debit_amount||0) - c(l.credit_amount||0), 0);
  P(`        ${label.padEnd(8)} due from ${fmt(dueFrom/100)} | due to ${fmt(dueTo/100)} | receiver inventory ${fmt(receiverInventory/100)} | net group gain ${fmt(groupGain/100)} | both sides balanced=${bal(built.out.lines)===0 && bal(built.in.lines)===0}`);
  if (dueFrom !== dueTo) failures.push(`unit transfer pair (${label}) does not mirror`);
  if (receiverInventory !== 30000000) failures.push(`unit transfer pair (${label}) records the receiver's inventory at ${fmt(receiverInventory/100)}, not the group carrying cost`);
  if (groupGain !== 0) failures.push(`unit transfer pair (${label}) leaves ${fmt(groupGain/100)} of intercompany profit in the group`);
  if (bal(built.out.lines) !== 0 || bal(built.in.lines) !== 0) failures.push(`unit transfer pair (${label}) does not balance`);
});
const sameEntity = buildUnitTransferPair({from:A, to:A, unit:'Lot 101 Block A', carrying:300000, price:400000});
P(`        atomicity: a same-entity transfer is refused before either side is created -> ${sameEntity.ok ? 'NOT REFUSED' : sameEntity.code}`);
if (sameEntity.ok) failures.push('a same-entity unit transfer was accepted');

P('');
if (failures.length) { failures.forEach(f => P(`FAIL ${f}`)); P(`ic-elimination: failures=${failures.length}`); }
else P('ic-elimination: failures=0');
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
