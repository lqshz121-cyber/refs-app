// ---------------------------------------------------------------------------
// Period lifecycle regression gate.
//
// Period control was made fail-closed and immediately made the product
// unusable, because nothing could open a period. The fix was to build the
// missing commands, not to relax the control. This file exists so that neither
// half can quietly regress:
//
//   1. Absence is never permission - no code path, seed or command turns a
//      missing period record into permission to post.
//   2. Reopen is a separate, more privileged command that demands a substantive
//      reason and writes an auditable event.
//   3. Closing is refused while the application can still see unresolved work
//      in that entity and that period.
//   4. Posted evidence is immutable across every one of these commands.
//   5. Authorization is read from the application's own role model. This branch
//      widened no role.
//   6. The seed grants only the authority somebody actually exercised.
//
// Run: node verify-period-lifecycle.mjs   (auto-discovered by tools/run-verifiers.mjs)
// ---------------------------------------------------------------------------
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { PERIODS, PERIOD_EVENTS, ENTITIES, CURRENT_PERIOD_CODE } from './src/data.js';
import { JOURNAL_ENTRIES, FY2026 } from './src/seed.js';
import { periodControlExceptions, resolvePostingPeriod } from './src/period-control.js';
import {
  PERIOD_EVENT_CLOSED, PERIOD_EVENT_OPENED, PERIOD_EVENT_REOPENED,
  PERIOD_PERMISSION_DENIED, PERIOD_REASON_REQUIRED, PERIOD_RECORD_MISSING,
  PERIOD_STATE_CLOSED, PERIOD_STATE_OPEN, PERIOD_UNRESOLVED_WORK,
  PERM_PERIOD_CLOSE, PERM_PERIOD_OPEN, PERM_PERIOD_REOPEN,
  REASON_MIN_LENGTH, REOPEN_REASON_MIN_LENGTH,
  bankItemsByEntity, closePeriodCommand, openPeriodCommand, periodGrid, periodGridTotals,
  reopenPeriodCommand, runPeriodCommand, unresolvedWork,
} from './src/period-lifecycle.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
// The comments in these files quote the defect they removed - the frozen legacy shell says
// in prose that there is deliberately no `|| {status:'OPEN'}` fallback. A gate
// that read prose would fail on the explanation of its own rule, so code checks
// run against the source with comments stripped.
const codeOnly = text => text
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
const app = read('./src/legacy-demo-app.jsx');
const surface = read('./src/module-periods.jsx');
const lifecycle = read('./src/period-lifecycle.js');
const control = read('./src/period-control.js');
const data = read('./src/data.js');

const ALLOW = () => true;
const DENY = () => false;
const AT = '2026-08-07 11:22:33';
const ACTOR = 'ricky';
const master = Object.freeze([
  Object.freeze({period_id: 1, entity_id: 2, period_code: '2026-06', status: PERIOD_STATE_CLOSED}),
  Object.freeze({period_id: 2, entity_id: 2, period_code: '2026-07', status: PERIOD_STATE_OPEN}),
]);
const openReason = 'Opened to record the July property pickup for this entity.';
const closeReason = 'July month-end close signed off.';
const reopenReason = 'Reopened to book the audit-agreed accrual reversal for June.';

// ---------------------------------------------------------------------------
// 1. Absence is never permission.
// ---------------------------------------------------------------------------
{
  const missing = resolvePostingPeriod([], {entity_id: 2, period_code: '2026-07'});
  assert.equal(missing.ok, false, 'an empty period master must refuse posting, not permit it');
  assert.equal(missing.period.status, 'NOT_CONFIGURED');
  assert.equal(missing.period.configured, false);

  // No command may produce "no record" as an outcome. Closing amends, it does
  // not delete: a period that vanished from the master would still refuse, but
  // it would refuse with the wrong fact and would silently discard the close
  // event's subject.
  const closed = closePeriodCommand({
    periods: master, events: [], entityId: 2, periodCode: '2026-07',
    actor: ACTOR, at: AT, reason: closeReason, can: ALLOW,
  });
  assert.equal(closed.ok, true);
  assert.equal(closed.periods.length, master.length, 'closing a period must not remove its record');
  assert.ok(closed.periods.some(p => p.entity_id === 2 && p.period_code === '2026-07' && p.status === PERIOD_STATE_CLOSED));

  // The resolver, not the lifecycle module, is the fail-closed gate, and it is
  // still the only thing the application asks. No synthesised OPEN anywhere.
  assert.ok(!/\|\|\s*\{\s*[^}]*status\s*:\s*'OPEN'/.test(codeOnly(app)),
    'the frozen legacy demo shell must never fall back to a synthesised OPEN period');
  assert.ok(!/\|\|\s*\{\s*[^}]*status\s*:\s*'OPEN'/.test(codeOnly(surface)),
    'the period surface must never synthesise an OPEN period');
  assert.ok(app.includes("useState(()=>load('periods',PERIODS))"),
    'the live period master must be seeded from the authored master in src/data.js');
  assert.ok(app.includes('resolvePostingPeriod(periods, target)'),
    'every posting path must resolve against the live period master');
  assert.ok(control.includes('PERIOD_STATUS_NOT_CONFIGURED'),
    'the resolver must keep naming the unconfigured state rather than defaulting it away');

  // A record whose status is neither OPEN nor a known state still refuses.
  const nonsense = resolvePostingPeriod([{entity_id: 2, period_code: '2026-07', status: 'PENDING'}], {entity_id: 2, period_code: '2026-07'});
  assert.equal(nonsense.ok, false, 'any status other than OPEN must refuse posting');
}

// ---------------------------------------------------------------------------
// 2. Reopen is separate, more privileged, reasoned and audited.
// ---------------------------------------------------------------------------
{
  // A role that may close may not therefore reopen.
  const closerOnly = reopenPeriodCommand({
    periods: master, events: [], entityId: 2, periodCode: '2026-06',
    actor: ACTOR, at: AT, reason: reopenReason, can: perm => perm === PERM_PERIOD_CLOSE,
  });
  assert.equal(closerOnly.ok, false);
  assert.equal(closerOnly.code, PERIOD_PERMISSION_DENIED);
  assert.ok(closerOnly.message.includes(PERM_PERIOD_REOPEN));

  // No reason, no reopen - and no event.
  for (const reason of [undefined, '', '   ', 'fix', 'wrong period']) {
    const refused = reopenPeriodCommand({
      periods: master, events: [], entityId: 2, periodCode: '2026-06',
      actor: ACTOR, at: AT, reason, can: ALLOW,
    });
    assert.equal(refused.ok, false, `reopen must refuse the reason ${JSON.stringify(reason)}`);
    assert.equal(refused.code, PERIOD_REASON_REQUIRED);
    assert.equal(refused.events.length, 0, 'a refused reopen must write no event');
    assert.equal(refused.event, null);
    assert.equal(refused.periods, master, 'a refused reopen must leave the master untouched');
  }
  assert.ok(REOPEN_REASON_MIN_LENGTH > REASON_MIN_LENGTH,
    'reopening must demand a longer reason than opening or closing');

  const reopened = reopenPeriodCommand({
    periods: master, events: [], entityId: 2, periodCode: '2026-06',
    actor: ACTOR, at: AT, reason: reopenReason, can: ALLOW,
  });
  assert.equal(reopened.ok, true);
  assert.equal(reopened.record.status, PERIOD_STATE_OPEN);
  assert.equal(reopened.record.reopened_count, 1);
  assert.equal(reopened.events.length, 1);
  assert.deepEqual(
    {
      event_type: reopened.event.event_type, actor: reopened.event.actor, at: reopened.event.at,
      entity_id: reopened.event.entity_id, period_code: reopened.event.period_code,
      prior_status: reopened.event.prior_status, reason: reopened.event.reason,
    },
    {
      event_type: PERIOD_EVENT_REOPENED, actor: ACTOR, at: AT,
      entity_id: 2, period_code: '2026-06',
      prior_status: PERIOD_STATE_CLOSED, reason: reopenReason,
    },
    'a reopen event must carry actor, timestamp, entity, period, prior state and reason',
  );

  // Reopen is not a toggle: it only applies to a CLOSED period, and reopening
  // something that was never opened is refused rather than treated as an open.
  assert.equal(reopenPeriodCommand({periods: master, events: [], entityId: 2, periodCode: '2026-07', actor: ACTOR, at: AT, reason: reopenReason, can: ALLOW}).code, 'PERIOD_NOT_CLOSED');
  assert.equal(reopenPeriodCommand({periods: master, events: [], entityId: 77, periodCode: '2026-07', actor: ACTOR, at: AT, reason: reopenReason, can: ALLOW}).code, PERIOD_RECORD_MISSING);
}

// ---------------------------------------------------------------------------
// 3. Every accepted transition is an attributed, reasoned, dated event.
// ---------------------------------------------------------------------------
{
  const cases = [
    [openPeriodCommand, {entityId: 9, periodCode: '2026-07', reason: openReason}, PERIOD_EVENT_OPENED],
    [closePeriodCommand, {entityId: 2, periodCode: '2026-07', reason: closeReason}, PERIOD_EVENT_CLOSED],
    [reopenPeriodCommand, {entityId: 2, periodCode: '2026-06', reason: reopenReason}, PERIOD_EVENT_REOPENED],
  ];
  for (const [command, args, expectedType] of cases) {
    const accepted = command({periods: master, events: [], actor: ACTOR, at: AT, can: ALLOW, ...args});
    assert.equal(accepted.ok, true, `${expectedType} must be accepted for a valid target`);
    assert.equal(accepted.event.event_type, expectedType);
    for (const field of ['actor', 'at', 'entity_id', 'period_code', 'reason']) {
      assert.ok(accepted.event[field] !== null && accepted.event[field] !== undefined && accepted.event[field] !== '',
        `${expectedType} must record ${field}`);
    }
    // An unattributed or undated transition is not an authorisation.
    assert.equal(command({periods: master, events: [], actor: '', at: AT, can: ALLOW, ...args}).ok, false);
    assert.equal(command({periods: master, events: [], actor: ACTOR, at: '', can: ALLOW, ...args}).ok, false);
  }

  // Event identity is monotonic, so a later event never overwrites an earlier one.
  const first = openPeriodCommand({periods: master, events: [], entityId: 9, periodCode: '2026-07', actor: ACTOR, at: AT, reason: openReason, can: ALLOW});
  const second = openPeriodCommand({periods: first.periods, events: first.events, entityId: 10, periodCode: '2026-07', actor: ACTOR, at: AT, reason: openReason, can: ALLOW});
  assert.equal(second.events.length, 2);
  assert.ok(second.events[1].event_id > second.events[0].event_id, 'period event ids must increase');
}

// ---------------------------------------------------------------------------
// 4. Closing is blocked by unresolved work the application can actually see.
// ---------------------------------------------------------------------------
{
  const base = {periods: master, events: [], entityId: 2, periodCode: '2026-07', actor: ACTOR, at: AT, reason: closeReason, can: ALLOW};
  const blockers = [
    ['JOURNALS_IN_WORKFLOW', {journals: [{je_id: 1, je_number: 'JE-D', entity_id: 2, period_code: '2026-07', posting_status: 'DRAFT'}]}],
    ['JOURNALS_IN_WORKFLOW', {journals: [{je_id: 2, je_number: 'JE-R', entity_id: 2, period_code: '2026-07', posting_status: 'PENDING_REVIEW'}]}],
    ['JOURNALS_IN_WORKFLOW', {journals: [{je_id: 3, je_number: 'JE-A', entity_id: 2, period_code: '2026-07', posting_status: 'PENDING_APPROVAL'}]}],
    ['JOURNALS_IN_WORKFLOW', {journals: [{je_id: 4, je_number: 'JE-V', entity_id: 2, period_code: '2026-07', posting_status: 'APPROVED'}]}],
    ['OPEN_EXCEPTIONS', {exceptions: [{exception_id: 1, entity_id: 2, occurred_date: '2026-07-14', status: 'OPEN', object_ref: 'EXC-1'}]}],
    ['OPEN_EXCEPTIONS', {exceptions: [{exception_id: 2, entity_id: 2, occurred_date: '2026-07-14', status: 'IN_PROGRESS', object_ref: 'EXC-2'}]}],
    ['UNRECONCILED_BANK', {bankItems: [{entity_id: 2, txn_date: '2026-07-31', match_status: 'UNMATCHED', reference: 'ACH'}]}],
  ];
  for (const [code, extra] of blockers) {
    const refused = closePeriodCommand({...base, ...extra});
    assert.equal(refused.ok, false, `close must be refused by ${code}`);
    assert.equal(refused.code, PERIOD_UNRESOLVED_WORK);
    assert.equal(refused.periods, master, 'a refused close must leave the master untouched');
    assert.equal(refused.events.length, 0, 'a refused close must write no event');
    const work = unresolvedWork({entityId: 2, periodCode: '2026-07', ...extra});
    assert.ok(work.items.some(item => item.code === code), `unresolvedWork must name ${code}`);
  }

  // The blockers are scoped. Another entity's draft, another period's draft,
  // and a resolved exception are not this period's problem.
  const notBlocking = [
    {journals: [{je_id: 5, entity_id: 3, period_code: '2026-07', posting_status: 'DRAFT'}]},
    {journals: [{je_id: 6, entity_id: 2, period_code: '2026-06', posting_status: 'DRAFT'}]},
    {journals: [{je_id: 7, entity_id: 2, period_code: '2026-07', posting_status: 'POSTED'}]},
    {journals: [{je_id: 8, entity_id: 2, period_code: '2026-07', posting_status: 'REVERSED'}]},
    {exceptions: [{exception_id: 3, entity_id: 2, occurred_date: '2026-07-14', status: 'CLOSED'}]},
    {exceptions: [{exception_id: 4, entity_id: 2, occurred_date: '2026-06-14', status: 'OPEN'}]},
    {bankItems: [{entity_id: 2, txn_date: '2026-07-31', match_status: 'MATCHED'}]},
    {bankItems: [{entity_id: 2, txn_date: '2026-06-30', match_status: 'UNMATCHED'}]},
  ];
  for (const extra of notBlocking) {
    assert.equal(closePeriodCommand({...base, ...extra}).ok, true,
      `close must not be blocked by out-of-scope work: ${JSON.stringify(extra)}`);
  }

  // The month-end checklist is not smuggled in as a scoping fiction.
  assert.ok(!/closeTasks/.test(codeOnly(lifecycle)),
    'CLOSE_TASKS carries no entity_id and no period_code, so it must not be used as a per-entity close condition');
  assert.ok(surface.includes('carries') && surface.includes('no entity and no period'),
    'the period surface must say plainly why the close checklist is context and not a condition');
}

// ---------------------------------------------------------------------------
// 5. Posted evidence is immutable across every command.
// ---------------------------------------------------------------------------
{
  const posted = [
    {je_id: 1, je_number: 'JE-A', entity_id: 2, period_code: '2026-07', je_date: '2026-07-31', posting_status: 'POSTED', lines: [{account_code: '111000', debit_amount: 100, credit_amount: 0}]},
    {je_id: 2, je_number: 'JE-B', entity_id: 2, period_code: '2026-06', je_date: '2026-06-30', posting_status: 'POSTED', lines: [{account_code: '111000', debit_amount: 0, credit_amount: 100}]},
  ];
  const before = JSON.stringify(posted);
  closePeriodCommand({periods: master, events: [], entityId: 2, periodCode: '2026-07', actor: ACTOR, at: AT, reason: closeReason, can: ALLOW, journals: posted});
  reopenPeriodCommand({periods: master, events: [], entityId: 2, periodCode: '2026-06', actor: ACTOR, at: AT, reason: reopenReason, can: ALLOW});
  openPeriodCommand({periods: master, events: [], entityId: 9, periodCode: '2026-07', actor: ACTOR, at: AT, reason: openReason, can: ALLOW});
  assert.equal(JSON.stringify(posted), before, 'no period command may re-date, rewrite or delete posted evidence');

  // Nothing in the lifecycle module or the surface can write to a journal.
  for (const [name, text] of [['src/period-lifecycle.js', codeOnly(lifecycle)], ['src/module-periods.jsx', codeOnly(surface)]]) {
    for (const forbidden of [/posting_status\s*[:=]\s*['"]/, /\bje_date\s*[:=]/, /\.splice\(/, /setJes\b/, /actions\.(?:advanceJE|reverseJE|updateJE|newJE)\b/]) {
      assert.doesNotMatch(text, forbidden, `${name} must not mutate journal evidence (${forbidden})`);
    }
  }

  // A journal already posted into a period that is not OPEN stays a reported
  // exception. Closing a period does not make its history disappear.
  const journals = [...JOURNAL_ENTRIES, ...FY2026];
  const evidence = periodControlExceptions({journals, periods: PERIODS});
  assert.ok(evidence.totals.closedPeriodJournals > 0,
    'the pre-existing closed-period postings must remain visible as exceptions');
  assert.ok(evidence.totals.unconfiguredCombinations > 0,
    'entity periods that were never opened must remain visible as a control gap');
  assert.equal(evidence.state, 'PERIOD_CONTROL_EXCEPTIONS_FOUND');
  for (const row of evidence.closedPeriodPostings) {
    const je = journals.find(j => j.je_number === row.je_number);
    assert.equal(je.posting_status, 'POSTED');
    assert.equal(je.period_code, row.period_code);
    assert.equal(String(je.je_date).slice(0, 7), row.period_code,
      'a breaching journal must keep the date it was posted with, never be re-dated into an open period');
  }
}

// ---------------------------------------------------------------------------
// 6. Authorization comes from the application's own role model, unwidened.
// ---------------------------------------------------------------------------
{
  const rolePerms = /const ROLE_PERMS = \{([\s\S]*?)\n\};/.exec(app);
  assert.ok(rolePerms, 'ROLE_PERMS must remain statically locatable in the frozen legacy demo shell');
  const table = rolePerms[1];
  assert.ok(table.includes("CONTROLLER: '*'"), 'CONTROLLER must keep its wildcard');
  assert.ok(table.includes(`'${PERM_PERIOD_CLOSE}'`),
    'PERIOD.PERIOD.CLOSE is the pre-existing close permission and must stay wired to its existing holders');
  // The two new codes widen nobody: no enumerated role lists them, so only the
  // CONTROLLER wildcard satisfies them. Opening and reopening grant posting
  // authority; closing withdraws it.
  assert.ok(!table.includes(PERM_PERIOD_OPEN),
    'PERIOD.PERIOD.OPEN must not be granted to an enumerated role by this branch');
  assert.ok(!table.includes(PERM_PERIOD_REOPEN),
    'PERIOD.PERIOD.REOPEN must not be granted to an enumerated role by this branch');
  assert.ok(!/ROLE_PERMS|role_code\s*===/.test(codeOnly(lifecycle)),
    'the lifecycle module must ask ctx.can(), never define a parallel role table');
  assert.ok(!/ROLE_PERMS/.test(codeOnly(surface)),
    'the period surface must ask ctx.can(), never define a parallel role table');
  assert.equal(openPeriodCommand({periods: master, events: [], entityId: 9, periodCode: '2026-07', actor: ACTOR, at: AT, reason: openReason, can: DENY}).code, PERIOD_PERMISSION_DENIED);
  assert.equal(closePeriodCommand({periods: master, events: [], entityId: 2, periodCode: '2026-07', actor: ACTOR, at: AT, reason: closeReason, can: DENY}).code, PERIOD_PERMISSION_DENIED);
  assert.equal(reopenPeriodCommand({periods: master, events: [], entityId: 2, periodCode: '2026-06', actor: ACTOR, at: AT, reason: reopenReason, can: DENY}).code, PERIOD_PERMISSION_DENIED);

  // Bulk is the same command in a loop, not a looser second path.
  const bulk = runPeriodCommand('open', {
    targets: [{entityId: 9, periodCode: '2026-07'}, {entityId: 10, periodCode: '2026-07'}],
    periods: master, events: [], actor: ACTOR, at: AT, reason: openReason, can: DENY,
  });
  assert.equal(bulk.applied.length, 0, 'bulk must not bypass the permission check');
  assert.equal(bulk.refused.length, 2, 'bulk must itemise every refusal');
  assert.equal(bulk.periods, master);
  const mixed = runPeriodCommand('open', {
    targets: [{entityId: 9, periodCode: '2026-07'}, {entityId: 2, periodCode: '2026-07'}],
    periods: master, events: [], actor: ACTOR, at: AT, reason: openReason, can: ALLOW,
  });
  assert.equal(mixed.applied.length, 1, 'a refusal in a batch must not stop the rest');
  assert.equal(mixed.refused.length, 1);
  assert.equal(mixed.refused[0].code, 'PERIOD_ALREADY_CONFIGURED');
  assert.ok(mixed.message.includes('refused'), 'a partial batch must report its refusals to the reader');
}

// ---------------------------------------------------------------------------
// 7. The seed grants only the authority somebody actually exercised.
// ---------------------------------------------------------------------------
{
  const journals = [...JOURNAL_ENTRIES, ...FY2026].filter(je => je.posting_status === 'POSTED');
  const activePairs = new Set(journals.map(je => `${Number(je.entity_id)}|${je.period_code}`));
  const configured = new Set(PERIODS.map(p => `${Number(p.entity_id)}|${p.period_code}`));

  assert.equal(PERIODS.length, ENTITIES.length + 1,
    'the seeded master must hold exactly one row per entity for the current period, plus the pre-existing closed June');
  const open = PERIODS.filter(p => p.status === PERIOD_STATE_OPEN);
  assert.equal(open.length, ENTITIES.length);
  assert.ok(open.every(p => p.period_code === CURRENT_PERIOD_CODE),
    'no period other than the current one may be seeded OPEN: back-dated posting authority nobody granted is the fail-open defect relocated into the seed');
  assert.ok(PERIODS.length < activePairs.size,
    'the seed must not blanket-configure every entity/period pair that happens to carry journals');
  assert.ok([...activePairs].some(pair => !configured.has(pair)),
    'the pre-existing control gaps must be left visible, not papered over by the seed');

  // Every seeded row is attributable, and every seeded row has an event behind it.
  for (const record of PERIODS) {
    assert.ok(record.opened_by && record.opened_at && record.open_reason,
      `period ${record.entity_id}/${record.period_code} must record who opened it, when and why`);
    const events = PERIOD_EVENTS.filter(e => e.entity_id === record.entity_id && e.period_code === record.period_code);
    assert.ok(events.some(e => e.event_type === PERIOD_EVENT_OPENED),
      `period ${record.entity_id}/${record.period_code} must have an opening event`);
    if (record.status === PERIOD_STATE_CLOSED) {
      assert.ok(record.closed_by && record.closed_at && record.close_reason);
      assert.ok(events.some(e => e.event_type === PERIOD_EVENT_CLOSED));
    }
  }
  for (const event of PERIOD_EVENTS) {
    for (const field of ['event_id', 'event_type', 'entity_id', 'period_code', 'actor', 'at', 'reason']) {
      assert.ok(event[field] !== null && event[field] !== undefined && event[field] !== '',
        `seeded period event ${event.event_id} must record ${field}`);
    }
  }
  assert.ok(data.includes('a period master row is an AUTHORIZATION record') ||
    data.includes('A period master row is an AUTHORIZATION record'),
    'the seeding decision must be stated where the seed is written');

  // The demo has to be usable: the current period is postable for the whole group.
  const postable = ENTITIES.filter(entity =>
    resolvePostingPeriod(PERIODS, {entity_id: entity.entity_id, period_code: CURRENT_PERIOD_CODE}).ok);
  assert.equal(postable.length, ENTITIES.length,
    'every entity must be able to post into the current period, or the product is unusable');
  // ...and nothing outside it is.
  const priorPostable = ENTITIES.filter(entity =>
    resolvePostingPeriod(PERIODS, {entity_id: entity.entity_id, period_code: '2026-05'}).ok);
  assert.equal(priorPostable.length, 0, 'a prior period must not be postable without an explicit open');

  assert.ok(/const SEED_V='v(1[2-9]|[2-9]\d)'/.test(app),
    'changing the seeded period master requires SEED_V to be incremented past v11 so retained demo stores are invalidated');
  assert.ok(app.includes("'periods','periodevents'"),
    'the seed-version reset and the demo reset must both clear the retained period master');
}

// ---------------------------------------------------------------------------
// 8. The surface offers no control it cannot execute.
// ---------------------------------------------------------------------------
{
  // A hard-disabled button (bare `disabled`, no expression) can never become
  // clickable and must not exist here.
  assert.doesNotMatch(codeOnly(surface), /<(?:button|Btn)\b[^>]*\sdisabled(?!\s*=)[\s>]/,
    'the period surface must not render a permanently disabled control');
  // The surface takes the three permission codes from the lifecycle module and
  // names the missing one back to the reader. (mtest.jsx asserts the rendered
  // text, "Your role does not hold PERIOD.PERIOD.OPEN", against real markup.)
  for (const symbol of ['PERM_PERIOD_OPEN', 'PERM_PERIOD_CLOSE', 'PERM_PERIOD_REOPEN']) {
    assert.ok(codeOnly(surface).includes(symbol), `the period surface must wire ${symbol} through ctx.can()`);
  }
  assert.ok(/Your role does not hold \$\{spec\.perm\}/.test(surface),
    'a refused command must name the permission the role is missing');
  assert.ok(surface.includes('<Unavailable'),
    'a command the role can never execute must render as an Unavailable statement, not a control');
  for (const forbidden of [/\bExport\b/, /auto[- ]?post/i, /\bSign[- ]?off\b/i, /\bDelete\b/, /\bPromote\b/]) {
    assert.doesNotMatch(codeOnly(surface), forbidden, `the period surface must not offer ${forbidden}`);
  }
  assert.ok(surface.includes('tabular') || surface.includes('className="num"'),
    'figures on the period surface must use the tabular-nums figure style');

  // The grid read model has to keep showing the pairs that have no record.
  const rows = periodGrid({
    entities: ENTITIES, periodCodes: ['2026-05'], periods: PERIODS, events: PERIOD_EVENTS,
    journals: [...JOURNAL_ENTRIES, ...FY2026], exceptions: [], bankItems: [],
  });
  const totals = periodGridTotals(rows);
  assert.equal(rows.length, ENTITIES.length);
  assert.equal(totals.open, 0);
  assert.equal(totals.notConfigured, ENTITIES.length,
    'an entity/period pair with no record must be a visible row, not an absent one');
  assert.ok(totals.breaches > 0,
    'the surface must show, next to the command that fixes it, where posted journals sit in a period that is not open');

  // Bank items are resolved to an entity through the bank account master, never guessed.
  const items = bankItemsByEntity({accounts: {'BA-003': {txns: [{bank_txn_id: 1, txn_date: '2026-07-06', match_status: 'UNMATCHED'}]}, 'BA-UNKNOWN': {txns: [{bank_txn_id: 2, txn_date: '2026-07-06', match_status: 'UNMATCHED'}]}}},
    [{bank_account_code: 'BA-003', entity_id: 4}]);
  assert.deepEqual(items.map(item => item.entity_id), [4],
    'a bank account whose entity cannot be resolved must be dropped, not attributed by guesswork');
}

console.log('PASS period lifecycle: absence is never permission; reopen is privileged, reasoned and audited; close is blocked by observable unresolved work; posted evidence is immutable; the seed grants only exercised authority.');
