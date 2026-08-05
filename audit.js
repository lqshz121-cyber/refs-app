import { COA, ENTITIES } from './src/data.js';
import { WBS_COA_MAP } from './src/coa-wbs.js';
import { JOURNAL_ENTRIES, FY2026 } from './src/seed.js';
import { jeTotals, validateJE } from './src/engine.js';

const jes = [...JOURNAL_ENTRIES, ...FY2026];
const knownAccounts = new Set([...COA.map(a=>a.account_code), ...Object.keys(WBS_COA_MAP)]);
const failures = [];
const fail = (ref, message) => failures.push(`${ref}: ${message}`);

for (const je of jes) {
  const ref = je.je_number || je.je_id;
  const totals = jeTotals(je);
  if (Math.abs(totals.debit-totals.credit) >= 0.005 || totals.debit <= 0) fail(ref, 'unbalanced or empty');
  for (const line of je.lines) if (!knownAccounts.has(line.account_code)) fail(ref, `unknown account ${line.account_code}`);
  for (const err of validateJE(je)) {
    if (je.posting_status==='POSTED') fail(ref, `${err.code} ${err.msg}`);
  }
  if (je.je_type==='AUTO' && (!je.source_doc_id || !je.rule_code)) fail(ref, 'automatic JE missing source_doc_id/rule_code');
}

const covered = new Set(FY2026.map(j=>j.entity_id));
for (const entity of ENTITIES) if (!covered.has(entity.entity_id)) fail(entity.entity_code, 'entity has no FY2026 ledger coverage');

console.log(`audit entities=${covered.size}/${ENTITIES.length} jes=${jes.length} fails=${failures.length}`);
failures.slice(0,50).forEach(x=>console.error('FAIL',x));
if (failures.length) process.exitCode = 1;
