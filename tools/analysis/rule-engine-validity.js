// H-1 measurement - does the rule engine emit journals its own validator accepts?
//
// Run:
//   ./node_modules/.bin/esbuild tools/analysis/rule-engine-validity.js --bundle \
//     --platform=node --format=cjs --outfile=/tmp/x.cjs && node /tmp/x.cjs
//
// A rule that generates an invalid entry is worse than no rule: the user gets a
// draft that cannot be posted and no explanation of why. Every draft the engine
// produces is run through validateJE with an affirmatively OPEN period, so the
// only errors that can surface are content errors - 4020 subsidiary member,
// VAL-00x line shape, 4006 balance.
import { loanRule, pmRule, validateJE } from '../../src/engine.js';
import { LOANS, PM_ROWS_SOURCE } from './_rule-fixtures.js';

const OPEN = {entity_id:2, period_code:'2026-07', status:'OPEN', configured:true};
const out = []; const P = (s) => out.push(s);
const failures = [];

const cases = [];
// Loan rule: every txn_type in the catalog, on both a construction loan and a
// mortgage on an in-service project.
for (const loan of LOANS) {
  for (const txn_type of ['DRAW', 'INTEREST_ACCRUAL', 'INTEREST_PAYMENT', 'REPAYMENT']) {
    cases.push({
      label: `loanRule ${txn_type} loan=${loan.loan_code}`,
      je: () => {
        const r = loanRule({txn_type, amount: 500000, loan_id: loan.loan_id,
          construction_status: loan.loan_id === 1 ? 'UNDER_CONSTRUCTION' : 'IN_SERVICE'});
        return r && {entity_id: loan.entity_id, period_code:'2026-07', je_type:'AUTO', lines: r.lines, rule_code: r.rule_code};
      },
    });
  }
}
// PM rule: every staged charge code, including the deliberately unmapped one.
for (const row of PM_ROWS_SOURCE) {
  cases.push({
    label: `pmRule ${row.charge_code} (${row.cash_accrual}) ${row.external_id}`,
    je: () => {
      const r = pmRule(row);
      if (!r || r.unmapped) return null;   // unmapped raises an exception by design
      return {entity_id: 4, period_code:'2026-07', je_type:'AUTO', lines: r.lines, rule_code: r.rule_code};
    },
  });
}

P('== H-1 · RULE ENGINE DRAFTS vs validateJE ==');
let generated = 0, invalid = 0, memberErrors = 0;
for (const c of cases) {
  const je = c.je();
  if (!je) { P(`  ${c.label.padEnd(46)} -> no journal generated (by design)`); continue; }
  generated++;
  const errs = validateJE(je, OPEN);
  if (!errs.length) { P(`  ${c.label.padEnd(46)} -> VALID   ${je.rule_code}`); continue; }
  invalid++;
  memberErrors += errs.filter((e) => e.code === '4020').length;
  P(`  ${c.label.padEnd(46)} -> INVALID ${je.rule_code}`);
  errs.forEach((e) => P(`      ${e.code} ${e.msg}`));
  failures.push(`${c.label}: ${errs.map((e) => e.code).join(',')}`);
}

P('');
P(`  drafts generated:                 ${generated}`);
P(`  drafts REJECTED by validateJE:    ${invalid}`);
P(`  4020 missing-member errors:       ${memberErrors}`);
P('');
P(`rule-engine-validity: drafts=${generated} invalid=${invalid} member_errors=${memberErrors} failures=${failures.length}`);
console.log(out.join('\n'));
if (failures.length) process.exitCode = 1;
