import { COA, ENTITIES, PERIODS } from './src/data.js';
import { WBS_COA_MAP } from './src/coa-wbs.js';
import { JOURNAL_ENTRIES, FY2026 } from './src/seed.js';
import { jeTotals, validateJE } from './src/engine.js';
import { periodControlExceptions, PERIOD_CLOSED, PERIOD_NOT_CONFIGURED } from './src/period-control.js';

// This script checks journal-entry CONTENT: balance, known accounts, line
// shape, subsidiary members and automatic-source trace. Posting authorization
// is a separate question with its own resolver, so the two period-control codes
// are excluded here and reported on their own line below instead of being
// silently mixed into the content failure count.
const PERIOD_AUTHORIZATION_CODES = new Set([PERIOD_CLOSED, PERIOD_NOT_CONFIGURED, 'JE_PERIOD_UNIDENTIFIED']);

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
    if (PERIOD_AUTHORIZATION_CODES.has(err.code)) continue;
    if (je.posting_status==='POSTED') fail(ref, `${err.code} ${err.msg}`);
  }
  if (je.je_type==='AUTO' && (!je.source_doc_id || !je.rule_code)) fail(ref, 'automatic JE missing source_doc_id/rule_code');
}

const covered = new Set(FY2026.map(j=>j.entity_id));
for (const entity of ENTITIES) if (!covered.has(entity.entity_id)) fail(entity.entity_code, 'entity has no FY2026 ledger coverage');

console.log(`audit entities=${covered.size}/${ENTITIES.length} jes=${jes.length} fails=${failures.length}`);
failures.slice(0,50).forEach(x=>console.error('FAIL',x));

// Period control is reported, never folded into `fails`. `fails` counts journal
// CONTENT defects; these are posting-AUTHORIZATION defects in already Posted,
// immutable evidence. They are exceptions for a human to resolve by reversal or
// by an authorised period action, and the same detector drives the Exception
// Center in the application.
const periodControl = periodControlExceptions({journals:jes, periods:PERIODS});
console.log(`period-control ${periodControl.state} closed_period_journals=${periodControl.totals.closedPeriodJournals} unconfigured_entity_periods=${periodControl.totals.unconfiguredCombinations} unconfigured_journals=${periodControl.totals.unconfiguredJournals}`);
periodControl.closedPeriodPostings.forEach(row=>console.error('PERIOD-CONTROL',`${row.object_ref}: POSTED in ${row.period_code} which entity ${row.entity_id}'s period master marks ${row.period_status}`));

if (failures.length) process.exitCode = 1;
