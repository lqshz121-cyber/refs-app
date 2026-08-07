// ---------------------------------------------------------------------------
// Before/after evidence for the audit-gate hardening.
//
// Re-implements the PREVIOUS audit.js content check EXACTLY as it stood at
// ed27d74 (46 lines, 0.005 float tolerance, four rules), then runs every
// injection in the mutation catalogue through it. The result is the "before"
// column of the table in docs/AUDIT-GATE-HARDENING.md, measured rather than
// remembered. The "after" column comes from the mutation harness, which runs
// the real hardened gate.
//
//   ./node_modules/.bin/esbuild tools/analysis/audit-before-after.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/ba.cjs && node /tmp/ba.cjs
// ---------------------------------------------------------------------------
import { COA, ENTITIES } from '../../src/data.js';
import { WBS_COA_MAP } from '../../src/coa-wbs.js';
import { JOURNAL_ENTRIES, FY2026 } from '../../src/seed.js';
import { jeTotals, validateJE } from '../../src/engine.js';
import { PERIOD_CLOSED, PERIOD_NOT_CONFIGURED } from '../../src/period-control.js';
import { INJECTIONS } from './audit-mutations.js';

const PERIOD_AUTHORIZATION_CODES = new Set([PERIOD_CLOSED, PERIOD_NOT_CONFIGURED, 'JE_PERIOD_UNIDENTIFIED']);
const knownAccounts = new Set([...COA.map(a => a.account_code), ...Object.keys(WBS_COA_MAP)]);

// ---- audit.js as it was at ed27d74 -----------------------------------------
function oldGate(jes) {
  const failures = [];
  const fail = (ref, message) => failures.push(`${ref}: ${message}`);
  for (const je of jes) {
    const ref = je.je_number || je.je_id;
    const totals = jeTotals(je);
    if (Math.abs(totals.debit - totals.credit) >= 0.005 || totals.debit <= 0) fail(ref, 'unbalanced or empty');
    for (const line of je.lines) if (!knownAccounts.has(line.account_code)) fail(ref, `unknown account ${line.account_code}`);
    for (const err of validateJE(je)) {
      if (PERIOD_AUTHORIZATION_CODES.has(err.code)) continue;
      if (je.posting_status === 'POSTED') fail(ref, `${err.code} ${err.msg}`);
    }
    if (je.je_type === 'AUTO' && (!je.source_doc_id || !je.rule_code)) fail(ref, 'automatic JE missing source_doc_id/rule_code');
  }
  const covered = new Set(FY2026.map(j => j.entity_id));
  for (const entity of ENTITIES) if (!covered.has(entity.entity_id)) fail(entity.entity_code, 'entity has no FY2026 ledger coverage');
  return failures;
}

const base = [...JOURNAL_ENTRIES, ...FY2026];
const baseline = oldGate(base);
const out = [];
out.push(`previous gate on the shipped seed: fails=${baseline.length}`);
out.push('');
out.push('injection                                  rule          previous gate');
out.push('-----------------------------------------  ------------  -------------');
let caught = 0;
const rows = [];
for (const [name, inj] of Object.entries(INJECTIONS)) {
  let n = 0, sample = '';
  try {
    const mutated = inj.apply(base.slice());
    const f = oldGate(mutated);
    n = f.length - baseline.length;
    sample = n > 0 ? (f.find(x => !baseline.includes(x)) || '') : '';
  } catch (e) { sample = `harness error: ${e.message}`; }
  if (n > 0) caught += 1;
  rows.push({name, rule: inj.rule, caught: n > 0, sample});
  out.push(`${name.padEnd(42)} ${inj.rule.padEnd(13)} ${n > 0 ? 'CAUGHT      ' : 'NOT CAUGHT  '}${n > 0 ? ' ' + sample.slice(0, 70) : ''}`);
}
out.push('');
out.push(`previous gate caught ${caught} of ${rows.length} injected defect classes; the other ${rows.length - caught} passed straight through.`);
console.log(out.join('\n'));
