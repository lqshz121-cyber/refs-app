// ---------------------------------------------------------------------------
// Period control.
//
// A period master row is an authorization record: it exists because somebody
// with period authority opened that entity's period. Its ABSENCE therefore
// means the opposite of permission - nobody has opened the period, so nothing
// may be posted into it. Reading a missing row as OPEN (the previous
// `|| {status:'OPEN'}` fallback in src/app.jsx) inverted the control and let
// journals post into periods that were never opened, including two that the
// master explicitly marks CLOSED.
//
// This module is the single browser-side resolver. It never synthesises a
// record, never mutates one, and never re-dates or deletes a journal entry.
// It only answers "may this entity/period be posted into, and if not, why".
// Read-only reporting does not call it: viewing history is always allowed.
// ---------------------------------------------------------------------------

export const PERIOD_STATUS_NOT_CONFIGURED = 'NOT_CONFIGURED';

export const PERIOD_CODE_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

// Same code the browser JE workflow already raises (src/je-workflow.js) and the
// same meaning as the server's PERIOD_NOT_CONFIGURED (server/api/je-policy.mjs).
export const PERIOD_NOT_CONFIGURED = 'JE_PERIOD_NOT_CONFIGURED';
// 4005 is the existing catalogued closed-period block code.
export const PERIOD_CLOSED = '4005';
export const PERIOD_UNIDENTIFIED = 'JE_PERIOD_UNIDENTIFIED';

const asEntityId = value => (value === null || value === undefined || value === '' ? null : Number(value));

function unconfiguredPeriod(entityId, periodCode) {
  return {entity_id: entityId, period_code: periodCode, status: PERIOD_STATUS_NOT_CONFIGURED, configured: false};
}

// Resolves the period control record that OWNS a posting - that is, the record
// for the journal entry's own entity and its own period_code. It is never the
// period of whichever entity the screen happens to have selected.
export function resolvePostingPeriod(periods, target) {
  const entityId = asEntityId(target?.entity_id);
  const periodCode = target?.period_code ? String(target.period_code) : '';
  if (entityId === null || Number.isNaN(entityId) || !PERIOD_CODE_PATTERN.test(periodCode)) {
    return {
      ok: false,
      code: PERIOD_UNIDENTIFIED,
      message: `Posting is blocked: this entry does not name a valid entity and accounting period (entity ${target?.entity_id ?? 'not set'}, period ${target?.period_code || 'not set'}).`,
      period: unconfiguredPeriod(entityId, periodCode || null),
    };
  }
  const record = (periods || []).find(p => asEntityId(p?.entity_id) === entityId && String(p?.period_code) === periodCode);
  if (!record) {
    return {
      ok: false,
      code: PERIOD_NOT_CONFIGURED,
      message: `Posting is blocked: entity ${entityId} has no period control record for ${periodCode}. A missing period record is not an open period - the period must be opened by period administration before anything can post into it.`,
      period: unconfiguredPeriod(entityId, periodCode),
    };
  }
  const period = {...record, configured: true};
  if (record.status !== 'OPEN') {
    return {
      ok: false,
      code: PERIOD_CLOSED,
      message: `Posting is blocked: period ${periodCode} is ${record.status} for entity ${entityId}. A closed period is corrected by reversal in an open period, never by posting into the closed one.`,
      period,
    };
  }
  return {ok: true, code: null, message: '', period};
}

// Convenience for screens that only need the object to display.
export function postingPeriodFor(periods, target) {
  return resolvePostingPeriod(periods, target).period;
}

export function periodStatusLabel(period) {
  if (!period) return PERIOD_STATUS_NOT_CONFIGURED;
  return period.configured === false ? PERIOD_STATUS_NOT_CONFIGURED : String(period.status || PERIOD_STATUS_NOT_CONFIGURED);
}

// ---------------------------------------------------------------------------
// Detection of postings that already violate period control.
//
// This is a read-only detector. Posted evidence is immutable: nothing here
// deletes, re-dates or rewrites a journal entry. It reports the exceptions so
// that a human can decide the correction, which for a Posted entry is a
// reversal booked in an open period.
// ---------------------------------------------------------------------------
export function periodControlExceptions({journals = [], periods = []} = {}) {
  const closedRows = [];
  const unconfigured = new Map();
  for (const je of journals) {
    if (je?.posting_status !== 'POSTED') continue;
    const resolved = resolvePostingPeriod(periods, je);
    if (resolved.ok) continue;
    const amount = (je.lines || []).reduce((total, line) => total + (Number(line?.debit_amount) || 0), 0);
    if (resolved.code === PERIOD_CLOSED) {
      closedRows.push({
        exception_id: `PERIOD-CLOSED:${je.je_number || je.je_id}`,
        exception_type: 'POSTED_INTO_CLOSED_PERIOD',
        severity: 'HIGH',
        object_type: 'JE',
        object_ref: je.je_number || `#${je.je_id}`,
        je_id: je.je_id ?? null,
        je_number: je.je_number || null,
        entity_id: asEntityId(je.entity_id),
        period_code: je.period_code || null,
        period_status: resolved.period.status,
        je_date: je.je_date || null,
        source_system: je.source_system || null,
        description: je.description || '',
        amount,
        journal_count: 1,
        owner: 'CONTROLLER',
        status: 'OPEN',
        root_cause: `Journal ${je.je_number || je.je_id} is POSTED in ${je.period_code}, which the period master marks ${resolved.period.status} for entity ${asEntityId(je.entity_id)}.`,
        required_action: 'Posted evidence is immutable. Resolve by reversing this entry in an open period, or by documenting an authorised period reopen. REFS will not re-date or delete it.',
      });
      continue;
    }
    const key = `${asEntityId(je.entity_id)}|${je.period_code || 'unknown'}`;
    const existing = unconfigured.get(key);
    if (existing) {
      existing.journal_count += 1;
      existing.amount += amount;
      if (existing.journal_refs.length < 5) existing.journal_refs.push(je.je_number || `#${je.je_id}`);
      continue;
    }
    unconfigured.set(key, {
      exception_id: `PERIOD-UNCONFIGURED:${key}`,
      exception_type: 'POSTED_INTO_UNCONFIGURED_PERIOD',
      severity: 'HIGH',
      object_type: 'PERIOD',
      object_ref: `E${asEntityId(je.entity_id)} · ${je.period_code || 'unknown period'}`,
      entity_id: asEntityId(je.entity_id),
      period_code: je.period_code || null,
      period_status: PERIOD_STATUS_NOT_CONFIGURED,
      journal_count: 1,
      journal_refs: [je.je_number || `#${je.je_id}`],
      amount,
      owner: 'CONTROLLER',
      status: 'OPEN',
      root_cause: `Entity ${asEntityId(je.entity_id)} carries POSTED journals in ${je.period_code} but the period master holds no record for that entity and period, so no period was ever opened for them.`,
      required_action: 'Open a period control record for this entity and period, or reverse the entries into a period that is open. REFS will not treat the missing record as permission to post.',
    });
  }
  const unconfiguredRows = [...unconfigured.values()].sort((a, b) => (a.entity_id - b.entity_id) || String(a.period_code).localeCompare(String(b.period_code)));
  return {
    closedPeriodPostings: closedRows,
    unconfiguredPeriodPostings: unconfiguredRows,
    totals: {
      closedPeriodJournals: closedRows.length,
      unconfiguredCombinations: unconfiguredRows.length,
      unconfiguredJournals: unconfiguredRows.reduce((total, row) => total + row.journal_count, 0),
    },
    state: closedRows.length || unconfiguredRows.length ? 'PERIOD_CONTROL_EXCEPTIONS_FOUND' : 'PERIOD_CONTROL_CLEAN',
  };
}
