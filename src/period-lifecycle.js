// ---------------------------------------------------------------------------
// Period lifecycle commands.
//
// src/period-control.js answers "may this entity/period be posted into". It is
// deliberately read-only and it fails closed: a missing period master row is
// never read as permission. That left one hole - nothing in the product could
// CREATE or CHANGE a period master row, so 117 of 119 entities could not post
// and the only remedy was hand-editing src/data.js.
//
// This module closes that hole and nothing else. It owns three commands:
//
//   openPeriodCommand    (no record) -> OPEN
//   closePeriodCommand   OPEN        -> CLOSED
//   reopenPeriodCommand  CLOSED      -> OPEN     (separate, more privileged)
//
// Design commitments, each of which has a test in verify-period-lifecycle.mjs:
//
//   * Absence is never permission. Closing does not delete a record, and no
//     command ever produces "no record" as an outcome. The only way a pair
//     becomes postable is an explicit, attributed open event.
//   * Every accepted transition appends an event carrying actor, timestamp,
//     entity, period, prior status and reason. There is no silent toggle.
//   * Reopen is a distinct command with a distinct permission and a mandatory
//     substantive reason. It is not "close" with a flipped argument.
//   * Posted evidence is untouched. These commands take no journal array they
//     could mutate; unresolved-work detection reads journals but only counts
//     them. Closing never re-dates, rewrites or deletes anything.
//   * Pure. No Date.now, no randomness, no storage, no React. The caller
//     supplies the actor and the timestamp, which is what makes the resulting
//     event auditable rather than self-asserted.
//
// There is deliberately NO `LOCKED` state. See docs/PERIOD-MANAGEMENT.md for
// the reasoning: a permanently sealed state would be indistinguishable from
// CLOSED at the posting gate (both refuse), REFS has no statutory-filing or
// archival event in its data model that could justify sealing a period, and an
// unreachable-from-anywhere terminal state is exactly the dead control this
// codebase has been removing. Irreversibility is bought with an audit trail
// and a privileged reopen, not with a state nobody can leave.
// ---------------------------------------------------------------------------

import { PERIOD_CODE_PATTERN } from './period-control.js';

export const PERIOD_STATE_OPEN = 'OPEN';
export const PERIOD_STATE_CLOSED = 'CLOSED';
export const PERIOD_STATES = [PERIOD_STATE_OPEN, PERIOD_STATE_CLOSED];

// Permission codes. These are wired to the application's existing ROLE_PERMS /
// ctx.can model; this module never decides who holds what. PERIOD.PERIOD.CLOSE
// already existed and is already held by ACCT_MANAGER. OPEN and REOPEN are new
// codes that widen nobody: no enumerated role lists them, so only CONTROLLER
// satisfies them through its '*' wildcard. Closing narrows what may be posted;
// opening and reopening widen it, and widening posting authority is the
// Controller's alone.
export const PERM_PERIOD_OPEN = 'PERIOD.PERIOD.OPEN';
export const PERM_PERIOD_CLOSE = 'PERIOD.PERIOD.CLOSE';
export const PERM_PERIOD_REOPEN = 'PERIOD.PERIOD.REOPEN';

export const PERIOD_EVENT_OPENED = 'PERIOD_OPENED';
export const PERIOD_EVENT_CLOSED = 'PERIOD_CLOSED';
export const PERIOD_EVENT_REOPENED = 'PERIOD_REOPENED';

// Failure codes. Named so a toast can quote them the way the posting guard
// quotes JE_PERIOD_NOT_CONFIGURED and 4005.
export const PERIOD_PERMISSION_DENIED = 'PERIOD_PERMISSION_DENIED';
export const PERIOD_TARGET_INVALID = 'PERIOD_TARGET_INVALID';
export const PERIOD_ALREADY_CONFIGURED = 'PERIOD_ALREADY_CONFIGURED';
export const PERIOD_RECORD_MISSING = 'PERIOD_RECORD_MISSING';
export const PERIOD_NOT_OPEN = 'PERIOD_NOT_OPEN';
export const PERIOD_NOT_CLOSED = 'PERIOD_NOT_CLOSED';
export const PERIOD_REASON_REQUIRED = 'PERIOD_REASON_REQUIRED';
export const PERIOD_UNRESOLVED_WORK = 'PERIOD_UNRESOLVED_WORK';

// A reason is a sentence a reviewer can act on, not a keystroke. Reopening a
// closed period is the one command that can put posting authority back over
// history somebody already signed off, so it asks for more.
export const REASON_MIN_LENGTH = 8;
export const REOPEN_REASON_MIN_LENGTH = 20;

// A journal in one of these states is finished with: closing the period around
// it strands nothing. Anything else is still in the Draft -> Review -> Approve
// -> Post workflow and would be frozen mid-flight by a close, because period
// control refuses every forward move once the period is not OPEN.
export const TERMINAL_POSTING_STATUSES = ['POSTED', 'REVERSED', 'VOID', 'REJECTED', 'CANCELLED'];
const RESOLVED_EXCEPTION_STATUSES = ['CLOSED', 'WAIVED'];

const asEntityId = value => (value === null || value === undefined || value === '' ? null : Number(value));
const asCode = value => (value ? String(value) : '');
const periodOf = value => String(value || '').slice(0, 7);
const trimmed = value => String(value === null || value === undefined ? '' : value).trim();

export function findPeriodRecord(periods, entityId, periodCode) {
  const id = asEntityId(entityId);
  const code = asCode(periodCode);
  return (periods || []).find(p => asEntityId(p?.entity_id) === id && asCode(p?.period_code) === code) || null;
}

export function periodEventsFor(events, entityId, periodCode) {
  const id = asEntityId(entityId);
  const code = asCode(periodCode);
  return (events || [])
    .filter(e => asEntityId(e?.entity_id) === id && asCode(e?.period_code) === code)
    .slice()
    .sort((a, b) => (Number(a?.event_id) || 0) - (Number(b?.event_id) || 0));
}

function nextEventId(events) {
  return (events || []).reduce((highest, event) => Math.max(highest, Number(event?.event_id) || 0), 0) + 1;
}

function nextPeriodId(periods) {
  return (periods || []).reduce((highest, period) => Math.max(highest, Number(period?.period_id) || 0), 0) + 1;
}

// ---------------------------------------------------------------------------
// Unresolved work.
//
// Only facts the application can actually observe for ONE entity and ONE
// period are counted here. Each of the three is derivable from records the
// browser already holds; none of them is inferred from a field the data does
// not carry.
//
//   JOURNALS_IN_WORKFLOW   a journal of this entity, in this period, that has
//                          not reached a terminal posting state. Closing the
//                          period makes it unfinishable, because every forward
//                          workflow move re-checks period control.
//   OPEN_EXCEPTIONS        an exception raised against this entity whose
//                          occurred_date falls inside this period and which is
//                          neither CLOSED nor WAIVED.
//   UNRECONCILED_BANK      a bank item belonging to this entity, dated in this
//                          period, that is not MATCHED.
//
// The month-end CLOSE_TASKS checklist is deliberately NOT a blocker. Those rows
// carry no entity_id and no period_code, so scoping them to one entity/period
// would be a check the data cannot support. The period surface shows the
// checklist as context and says so; it does not pretend it is scoped.
// ---------------------------------------------------------------------------
export function unresolvedWork({entityId, periodCode, journals = [], exceptions = [], bankItems = []} = {}) {
  const id = asEntityId(entityId);
  const code = asCode(periodCode);
  const workflowJournals = (journals || []).filter(je =>
    asEntityId(je?.entity_id) === id &&
    asCode(je?.period_code) === code &&
    !TERMINAL_POSTING_STATUSES.includes(String(je?.posting_status || '')));
  const openExceptions = (exceptions || []).filter(exception =>
    asEntityId(exception?.entity_id) === id &&
    periodOf(exception?.occurred_date) === code &&
    !RESOLVED_EXCEPTION_STATUSES.includes(String(exception?.status || '')));
  const unreconciled = (bankItems || []).filter(item =>
    asEntityId(item?.entity_id) === id &&
    periodOf(item?.txn_date) === code &&
    String(item?.match_status || '') !== 'MATCHED');
  const items = [];
  if (workflowJournals.length) items.push({
    code: 'JOURNALS_IN_WORKFLOW',
    count: workflowJournals.length,
    label: `${workflowJournals.length} journal ${workflowJournals.length === 1 ? 'entry is' : 'entries are'} still in the Draft to Post workflow`,
    refs: workflowJournals.slice(0, 5).map(je => je.je_number || `#${je.je_id}`),
    detail: 'Closing the period would freeze them: every forward workflow move re-checks period control, so they could never be posted or rejected.',
  });
  if (openExceptions.length) items.push({
    code: 'OPEN_EXCEPTIONS',
    count: openExceptions.length,
    label: `${openExceptions.length} exception${openExceptions.length === 1 ? '' : 's'} raised in this period ${openExceptions.length === 1 ? 'is' : 'are'} still open`,
    refs: openExceptions.slice(0, 5).map(exception => exception.object_ref || `#${exception.exception_id}`),
    detail: 'An exception open at close is an unexplained difference carried into a signed-off period.',
  });
  if (unreconciled.length) items.push({
    code: 'UNRECONCILED_BANK',
    count: unreconciled.length,
    label: `${unreconciled.length} bank item${unreconciled.length === 1 ? '' : 's'} dated in this period ${unreconciled.length === 1 ? 'is' : 'are'} not matched`,
    refs: unreconciled.slice(0, 5).map(item => item.reference || item.external_id || `#${item.bank_txn_id}`),
    detail: 'Cash is not proven for the period until every statement line is matched or explained.',
  });
  const total = items.reduce((sum, item) => sum + item.count, 0);
  return {
    entity_id: id,
    period_code: code,
    items,
    total,
    blocking: items.length > 0,
    counts: {
      journalsInWorkflow: workflowJournals.length,
      openExceptions: openExceptions.length,
      unreconciledBankItems: unreconciled.length,
    },
  };
}

export function unresolvedWorkSummary(work) {
  if (!work || !work.blocking) return 'No unresolved work is observable for this entity and period.';
  return work.items.map(item => item.label).join('; ') + '.';
}

// ---------------------------------------------------------------------------
// Commands.
//
// Every command returns the same shape. On refusal the returned `periods` and
// `events` are the caller's own arrays, unchanged and by reference, so a caller
// that ignores `ok` still cannot accidentally commit a refused transition.
// ---------------------------------------------------------------------------
function refuse(code, message, periods, events) {
  return {ok: false, code, message, periods, events, event: null, record: null};
}

function accept(periods, events, event, record) {
  return {ok: true, code: null, message: '', periods, events, event, record};
}

function validateTarget(entityId, periodCode, entityIds) {
  const id = asEntityId(entityId);
  const code = asCode(periodCode);
  if (id === null || !Number.isFinite(id)) {
    return `This command names no entity, so there is nothing whose period could be opened or closed.`;
  }
  if (!PERIOD_CODE_PATTERN.test(code)) {
    return `'${code || 'not set'}' is not an accounting period. A period code is YYYY-MM with a month of 01 to 12.`;
  }
  if (entityIds && !entityIds.has(id)) {
    return `Entity ${id} is not in the entity master, so no period can be opened for it.`;
  }
  return null;
}

function validateReason(reason, minLength, what) {
  const text = trimmed(reason);
  if (text.length < minLength) {
    return `${what} must record a reason of at least ${minLength} characters. The reason is written into the audit event and is the only explanation a later reader will have.`;
  }
  return null;
}

function makeEvent(events, eventType, {entityId, periodCode, actor, at, reason, priorStatus, nextStatus}) {
  return {
    event_id: nextEventId(events),
    event_type: eventType,
    entity_id: asEntityId(entityId),
    period_code: asCode(periodCode),
    prior_status: priorStatus,
    next_status: nextStatus,
    actor: trimmed(actor) || 'unknown',
    at: trimmed(at),
    reason: trimmed(reason),
  };
}

function requireActorAndTime(actor, at, periods, events) {
  if (!trimmed(actor)) {
    return refuse(PERIOD_PERMISSION_DENIED,
      'This command names no actor. A period transition that cannot be attributed to a person is not an authorisation and is refused.',
      periods, events);
  }
  if (!trimmed(at)) {
    return refuse(PERIOD_TARGET_INVALID,
      'This command carries no timestamp. Every period event is dated, so an undated transition is refused.',
      periods, events);
  }
  return null;
}

export function openPeriodCommand({
  periods = [], events = [], entityId, periodCode, actor, at, reason, entityIds = null, can = () => false,
} = {}) {
  if (!can(PERM_PERIOD_OPEN)) {
    return refuse(PERIOD_PERMISSION_DENIED,
      `Opening a period is refused: your role does not hold ${PERM_PERIOD_OPEN}. Opening a period grants posting authority over it.`,
      periods, events);
  }
  const badTarget = validateTarget(entityId, periodCode, entityIds);
  if (badTarget) return refuse(PERIOD_TARGET_INVALID, `Opening a period is refused: ${badTarget}`, periods, events);
  const missing = requireActorAndTime(actor, at, periods, events);
  if (missing) return missing;
  const badReason = validateReason(reason, REASON_MIN_LENGTH, 'Opening a period');
  if (badReason) return refuse(PERIOD_REASON_REQUIRED, `Opening a period is refused: ${badReason}`, periods, events);
  const existing = findPeriodRecord(periods, entityId, periodCode);
  if (existing) {
    return refuse(PERIOD_ALREADY_CONFIGURED,
      `Opening a period is refused: entity ${asEntityId(entityId)} already has a period record for ${asCode(periodCode)} with status ${existing.status}. A closed period is reopened by the reopen command, which records its own reason; it is not silently re-opened here.`,
      periods, events);
  }
  const event = makeEvent(events, PERIOD_EVENT_OPENED, {
    entityId, periodCode, actor, at, reason, priorStatus: null, nextStatus: PERIOD_STATE_OPEN,
  });
  const record = {
    period_id: nextPeriodId(periods),
    entity_id: asEntityId(entityId),
    period_code: asCode(periodCode),
    status: PERIOD_STATE_OPEN,
    opened_by: event.actor,
    opened_at: event.at,
    open_reason: event.reason,
    closed_by: null,
    closed_at: null,
    close_reason: null,
    reopened_count: 0,
    reopened_by: null,
    reopened_at: null,
    reopen_reason: null,
  };
  return accept([...periods, record], [...events, event], event, record);
}

export function closePeriodCommand({
  periods = [], events = [], entityId, periodCode, actor, at, reason,
  journals = [], exceptions = [], bankItems = [], can = () => false, work = null,
} = {}) {
  if (!can(PERM_PERIOD_CLOSE)) {
    return refuse(PERIOD_PERMISSION_DENIED,
      `Closing a period is refused: your role does not hold ${PERM_PERIOD_CLOSE}.`,
      periods, events);
  }
  const badTarget = validateTarget(entityId, periodCode, null);
  if (badTarget) return refuse(PERIOD_TARGET_INVALID, `Closing a period is refused: ${badTarget}`, periods, events);
  const missing = requireActorAndTime(actor, at, periods, events);
  if (missing) return missing;
  const badReason = validateReason(reason, REASON_MIN_LENGTH, 'Closing a period');
  if (badReason) return refuse(PERIOD_REASON_REQUIRED, `Closing a period is refused: ${badReason}`, periods, events);
  const existing = findPeriodRecord(periods, entityId, periodCode);
  if (!existing) {
    return refuse(PERIOD_RECORD_MISSING,
      `Closing a period is refused: entity ${asEntityId(entityId)} has no period record for ${asCode(periodCode)}. A period that was never opened cannot be closed, and its absence already blocks posting.`,
      periods, events);
  }
  if (String(existing.status) !== PERIOD_STATE_OPEN) {
    return refuse(PERIOD_NOT_OPEN,
      `Closing a period is refused: entity ${asEntityId(entityId)} period ${asCode(periodCode)} is already ${existing.status}.`,
      periods, events);
  }
  const outstanding = work || unresolvedWork({entityId, periodCode, journals, exceptions, bankItems});
  if (outstanding.blocking) {
    return refuse(PERIOD_UNRESOLVED_WORK,
      `Closing a period is refused: ${unresolvedWorkSummary(outstanding)} Resolve or explain this work first. REFS will not close a period over work it can still see.`,
      periods, events);
  }
  const event = makeEvent(events, PERIOD_EVENT_CLOSED, {
    entityId, periodCode, actor, at, reason, priorStatus: PERIOD_STATE_OPEN, nextStatus: PERIOD_STATE_CLOSED,
  });
  // The record is amended, never removed. A closed period that vanished from
  // the master would read as NOT_CONFIGURED, which is the same refusal but a
  // different and less honest fact.
  const record = {
    ...existing,
    status: PERIOD_STATE_CLOSED,
    closed_by: event.actor,
    closed_at: event.at,
    close_reason: event.reason,
  };
  return accept(periods.map(p => (p === existing ? record : p)), [...events, event], event, record);
}

export function reopenPeriodCommand({
  periods = [], events = [], entityId, periodCode, actor, at, reason, can = () => false,
} = {}) {
  if (!can(PERM_PERIOD_REOPEN)) {
    return refuse(PERIOD_PERMISSION_DENIED,
      `Reopening a period is refused: your role does not hold ${PERM_PERIOD_REOPEN}. Reopening returns posting authority over a period somebody already closed, which is a more privileged act than closing it.`,
      periods, events);
  }
  const badTarget = validateTarget(entityId, periodCode, null);
  if (badTarget) return refuse(PERIOD_TARGET_INVALID, `Reopening a period is refused: ${badTarget}`, periods, events);
  const missing = requireActorAndTime(actor, at, periods, events);
  if (missing) return missing;
  const badReason = validateReason(reason, REOPEN_REASON_MIN_LENGTH, 'Reopening a period');
  if (badReason) return refuse(PERIOD_REASON_REQUIRED, `Reopening a period is refused: ${badReason}`, periods, events);
  const existing = findPeriodRecord(periods, entityId, periodCode);
  if (!existing) {
    return refuse(PERIOD_RECORD_MISSING,
      `Reopening a period is refused: entity ${asEntityId(entityId)} has no period record for ${asCode(periodCode)}. There is nothing to reopen; opening it for the first time is the open command.`,
      periods, events);
  }
  if (String(existing.status) !== PERIOD_STATE_CLOSED) {
    return refuse(PERIOD_NOT_CLOSED,
      `Reopening a period is refused: entity ${asEntityId(entityId)} period ${asCode(periodCode)} is ${existing.status}, not ${PERIOD_STATE_CLOSED}.`,
      periods, events);
  }
  const event = makeEvent(events, PERIOD_EVENT_REOPENED, {
    entityId, periodCode, actor, at, reason, priorStatus: PERIOD_STATE_CLOSED, nextStatus: PERIOD_STATE_OPEN,
  });
  const record = {
    ...existing,
    status: PERIOD_STATE_OPEN,
    reopened_count: (Number(existing.reopened_count) || 0) + 1,
    reopened_by: event.actor,
    reopened_at: event.at,
    reopen_reason: event.reason,
  };
  return accept(periods.map(p => (p === existing ? record : p)), [...events, event], event, record);
}

export const PERIOD_COMMANDS = {
  open: openPeriodCommand,
  close: closePeriodCommand,
  reopen: reopenPeriodCommand,
};

export const PERIOD_COMMAND_PERMISSION = {
  open: PERM_PERIOD_OPEN,
  close: PERM_PERIOD_CLOSE,
  reopen: PERM_PERIOD_REOPEN,
};

// ---------------------------------------------------------------------------
// Bulk application.
//
// 119 entities times 12 periods is a lot of clicking, so the surface offers
// selection. Bulk is a loop over the SAME single-target command - it is not a
// second, looser path. Each target is authorised, validated and checked for
// unresolved work individually, each accepted target writes its own event, and
// a refusal in the middle stops nothing and hides nothing: refusals come back
// itemised so the reader sees exactly which entity refused and why.
// ---------------------------------------------------------------------------
export function runPeriodCommand(kind, {targets = [], periods = [], events = [], ...rest} = {}) {
  const command = PERIOD_COMMANDS[kind];
  if (!command) {
    return {
      ok: false, kind, periods, events, applied: [], refused: [],
      message: `Unknown period command '${kind}'.`,
    };
  }
  let nextPeriods = periods;
  let nextEvents = events;
  const applied = [];
  const refused = [];
  for (const target of targets) {
    const result = command({
      ...rest,
      periods: nextPeriods,
      events: nextEvents,
      entityId: target?.entityId ?? target?.entity_id,
      periodCode: target?.periodCode ?? target?.period_code,
    });
    if (result.ok) {
      nextPeriods = result.periods;
      nextEvents = result.events;
      applied.push({
        entity_id: result.event.entity_id,
        period_code: result.event.period_code,
        event: result.event,
      });
      continue;
    }
    refused.push({
      entity_id: asEntityId(target?.entityId ?? target?.entity_id),
      period_code: asCode(target?.periodCode ?? target?.period_code),
      code: result.code,
      message: result.message,
    });
  }
  return {
    ok: applied.length > 0 && refused.length === 0,
    kind,
    periods: nextPeriods,
    events: nextEvents,
    applied,
    refused,
    message: describeBulkOutcome(kind, applied, refused),
  };
}

const COMMAND_PAST_TENSE = {open: 'opened', close: 'closed', reopen: 'reopened'};

export function describeBulkOutcome(kind, applied, refused) {
  const verb = COMMAND_PAST_TENSE[kind] || kind;
  if (!applied.length && !refused.length) return 'No entity and period was selected, so nothing changed.';
  if (!refused.length) return `${applied.length} period${applied.length === 1 ? '' : 's'} ${verb}.`;
  if (!applied.length) {
    const first = refused[0];
    return refused.length === 1
      ? first.message
      : `Nothing was ${verb}: all ${refused.length} selected periods were refused. First refusal - ${first.message}`;
  }
  return `${applied.length} period${applied.length === 1 ? '' : 's'} ${verb}; ${refused.length} refused. First refusal - ${refused[0].message}`;
}

// ---------------------------------------------------------------------------
// Read models for the period management surface.
// ---------------------------------------------------------------------------

// The full entity x period grid for one period code, including the pairs that
// have no record at all. NOT_CONFIGURED has to be a visible row: it is the
// state 943 of 946 entity/period pairs are actually in, and a surface that
// only listed existing records would hide the whole problem.
export function periodGrid({
  entities = [], periodCodes = [], periods = [], events = [], journals = [], exceptions = [], bankItems = [],
} = {}) {
  const postedCounts = new Map();
  const workflowCounts = new Map();
  for (const je of journals) {
    const key = `${asEntityId(je?.entity_id)}|${asCode(je?.period_code)}`;
    if (String(je?.posting_status) === 'POSTED') postedCounts.set(key, (postedCounts.get(key) || 0) + 1);
    else if (!TERMINAL_POSTING_STATUSES.includes(String(je?.posting_status || ''))) {
      workflowCounts.set(key, (workflowCounts.get(key) || 0) + 1);
    }
  }
  const rows = [];
  for (const periodCode of periodCodes) {
    for (const entity of entities) {
      const entityId = asEntityId(entity.entity_id);
      const key = `${entityId}|${periodCode}`;
      const record = findPeriodRecord(periods, entityId, periodCode);
      const history = periodEventsFor(events, entityId, periodCode);
      const work = unresolvedWork({entityId, periodCode, journals, exceptions, bankItems});
      const postedJournals = postedCounts.get(key) || 0;
      rows.push({
        row_id: key,
        entity_id: entityId,
        entity_code: entity.entity_code,
        entity_name: entity.entity_name,
        period_code: periodCode,
        state: record ? String(record.status) : 'NOT_CONFIGURED',
        configured: !!record,
        record,
        posted_journals: postedJournals,
        workflow_journals: workflowCounts.get(key) || 0,
        unresolved: work,
        unresolved_total: work.total,
        // A posted journal sitting in a pair that is not OPEN is the existing
        // period-control breach, surfaced here as well as in the Exception
        // Center so the person who can act on it sees it where they act.
        breach: postedJournals > 0 && (!record || String(record.status) !== PERIOD_STATE_OPEN),
        events: history,
        last_event: history.length ? history[history.length - 1] : null,
      });
    }
  }
  return rows;
}

export function periodGridTotals(rows) {
  const totals = {rows: rows.length, open: 0, closed: 0, notConfigured: 0, breaches: 0, postedJournals: 0};
  for (const row of rows) {
    if (row.state === PERIOD_STATE_OPEN) totals.open += 1;
    else if (row.state === PERIOD_STATE_CLOSED) totals.closed += 1;
    else totals.notConfigured += 1;
    if (row.breach) totals.breaches += 1;
    totals.postedJournals += row.posted_journals;
  }
  return totals;
}

// Bank items arrive as a per-account map in the demo store. Reconciliation is
// an entity-level fact, so the account has to be resolved to its entity through
// the bank account master. An account whose entity cannot be resolved is
// dropped rather than guessed at.
export function bankItemsByEntity(bankState, bankAccounts = []) {
  const entityOf = new Map((bankAccounts || []).map(account => [String(account.bank_account_code), asEntityId(account.entity_id)]));
  const items = [];
  for (const [code, account] of Object.entries(bankState?.accounts || {})) {
    const entityId = entityOf.get(String(code));
    if (entityId === null || entityId === undefined) continue;
    for (const txn of account?.txns || []) {
      items.push({
        entity_id: entityId,
        bank_account_code: code,
        bank_txn_id: txn.bank_txn_id,
        external_id: txn.external_id,
        reference: txn.reference,
        txn_date: txn.txn_date,
        match_status: txn.ui_status === 'Excluded' ? 'MATCHED' : txn.match_status,
      });
    }
  }
  return items;
}
