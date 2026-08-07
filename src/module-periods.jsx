// ---------------------------------------------------------------------------
// Period Management.
//
// The surface an accountant uses to see, per entity, which accounting periods
// exist, what state they are in, and to act on them. It is the only place in
// REFS where a period record is created or changed.
//
// Scale: 119 entities times 12 periods is 1,428 possible rows, so the default
// view is ONE period - the current one - filtered by state, searchable, sorted
// and paginated, with bulk selection for the common case of doing the same
// thing to many entities at once. The summary strip answers "how much of the
// group can post right now" without reading a single row.
//
// Controls: a command the signed-in role cannot ever execute is rendered as an
// <Unavailable> statement of fact, never as a disabled button. A command the
// role holds but which is unavailable for the current selection stays a real
// control and says why in its title, because that condition can change.
//
// This page renders no figure it did not derive from ctx, changes no journal,
// and offers no export, no automation and no sign-off.
// ---------------------------------------------------------------------------
import { useMemo, useState } from 'react';
import { Badge, Btn, Drawer, Field, Segmented, StateBlock, Table, Unavailable } from './ui.jsx';
import { BANK_ACCOUNTS, ENTITIES } from './data.js';
import {
  PERIOD_STATE_CLOSED, PERIOD_STATE_OPEN,
  PERM_PERIOD_CLOSE, PERM_PERIOD_OPEN, PERM_PERIOD_REOPEN,
  REASON_MIN_LENGTH, REOPEN_REASON_MIN_LENGTH,
  bankItemsByEntity, periodGrid, periodGridTotals, unresolvedWorkSummary,
} from './period-lifecycle.js';

const NOT_CONFIGURED = 'NOT_CONFIGURED';
const STATE_FILTERS = [
  {key:'ALL', label:'All'},
  {key:PERIOD_STATE_OPEN, label:'Open'},
  {key:PERIOD_STATE_CLOSED, label:'Closed'},
  {key:NOT_CONFIGURED, label:'Not configured'},
];

const COMMAND_SPEC = {
  open: {
    verb: 'Open',
    perm: PERM_PERIOD_OPEN,
    from: NOT_CONFIGURED,
    minReason: REASON_MIN_LENGTH,
    grants: 'Opening grants posting authority for that entity and period.',
  },
  close: {
    verb: 'Close',
    perm: PERM_PERIOD_CLOSE,
    from: PERIOD_STATE_OPEN,
    minReason: REASON_MIN_LENGTH,
    grants: 'Closing withdraws posting authority. Posted entries are untouched: correction is by reversal in an open period.',
  },
  reopen: {
    verb: 'Reopen',
    perm: PERM_PERIOD_REOPEN,
    from: PERIOD_STATE_CLOSED,
    minReason: REOPEN_REASON_MIN_LENGTH,
    grants: 'Reopening returns posting authority over a period somebody already closed. It is recorded as its own audit event with the reason given here.',
  },
};

const stateTone = state => (state === PERIOD_STATE_OPEN ? 'ok' : state === PERIOD_STATE_CLOSED ? 'muted' : 'bad');
const stateLabel = state => (state === NOT_CONFIGURED ? 'NOT CONFIGURED' : state);

// The period codes the reader may choose between: every code the ledger has
// activity in, plus every code the period master already knows about. Nothing
// is invented - a period that appears nowhere in the data is not offered.
function knownPeriodCodes({journals, periods, currentPeriod}) {
  const codes = new Set();
  for (const je of journals || []) if (je?.period_code) codes.add(String(je.period_code));
  for (const record of periods || []) if (record?.period_code) codes.add(String(record.period_code));
  if (currentPeriod) codes.add(String(currentPeriod));
  return [...codes].sort().reverse();
}

export function PeriodManagement({ctx}) {
  const {jes = [], exceptions = [], closeTasks = [], bank, periods = [], periodEvents = [], can, actions, entity} = ctx || {};
  const currentPeriod = ctx?.currentPeriod || '2026-07';
  const codes = knownPeriodCodes({journals: jes, periods, currentPeriod});
  const [periodCode, setPeriodCode] = useState(codes.includes(currentPeriod) ? currentPeriod : (codes[0] || currentPeriod));
  const [stateFilter, setStateFilter] = useState('ALL');
  const [entityType, setEntityType] = useState('ALL');
  const [selected, setSelected] = useState(() => new Set());
  const [reason, setReason] = useState('');
  const [detailId, setDetailId] = useState(null);

  const bankItems = useMemo(() => bankItemsByEntity(bank, BANK_ACCOUNTS), [bank]);
  const rows = useMemo(() => periodGrid({
    entities: ENTITIES, periodCodes: [periodCode], periods, events: periodEvents,
    journals: jes, exceptions, bankItems,
  }), [periodCode, periods, periodEvents, jes, exceptions, bankItems]);

  const totals = periodGridTotals(rows);
  const entityTypes = [...new Set(ENTITIES.map(e => e.entity_type))].sort();
  const scoped = rows.filter(row =>
    (entityType === 'ALL' || ENTITIES.find(e => e.entity_id === row.entity_id)?.entity_type === entityType) &&
    (!entity || row.entity_id === entity));
  const visible = scoped.filter(row => stateFilter === 'ALL' || row.state === stateFilter);
  const scopedTotals = periodGridTotals(scoped);

  const selectedRows = visible.filter(row => selected.has(row.row_id));
  const toggle = (rowId) => setSelected(current => {
    const next = new Set(current);
    if (next.has(rowId)) next.delete(rowId); else next.add(rowId);
    return next;
  });
  const selectAllVisible = () => setSelected(current => {
    const next = new Set(current);
    const allOn = visible.every(row => next.has(row.row_id));
    for (const row of visible) { if (allOn) next.delete(row.row_id); else next.add(row.row_id); }
    return next;
  });
  const detail = rows.find(row => row.row_id === detailId) || null;

  const run = (kind, targetRows) => {
    if (!actions?.periodCommand) return;
    const result = actions.periodCommand(kind, targetRows.map(row => ({entityId: row.entity_id, periodCode: row.period_code})), reason);
    if (result && result.applied.length) { setSelected(new Set()); setReason(''); setDetailId(null); }
  };

  // One command button. Three outcomes, and they are different facts:
  //   the role can never do this        -> a statement, not a control
  //   the role can, nothing is eligible -> a real control, disabled, says why
  //   the role can, something eligible  -> a real control
  const commandButton = (kind, targetRows, size) => {
    const spec = COMMAND_SPEC[kind];
    const eligible = targetRows.filter(row => row.state === spec.from);
    if (!can || !can(spec.perm)) {
      return <Unavailable key={kind} reason={`Your role does not hold ${spec.perm}`}>{spec.verb} period</Unavailable>;
    }
    const shortReason = reason.trim().length < spec.minReason;
    const disabled = eligible.length === 0 || shortReason;
    const title = targetRows.length === 0
      ? `Select one or more entity periods first, then ${spec.verb.toLowerCase()} them`
      : eligible.length === 0
      ? `Nothing selected is ${spec.from === NOT_CONFIGURED ? 'unconfigured' : spec.from.toLowerCase()}, so there is nothing to ${spec.verb.toLowerCase()}`
      : shortReason
        ? `Enter a reason of at least ${spec.minReason} characters. It is written into the audit event.`
        : `${spec.verb} ${eligible.length} period${eligible.length === 1 ? '' : 's'}. ${spec.grants}`;
    return <Btn key={kind} size={size} variant={kind === 'reopen' ? 'ghost' : 'primary'} disabled={disabled} title={title}
      onClick={()=>run(kind, eligible)}>{spec.verb} {eligible.length} selected</Btn>;
  };

  const cols = [
    {h:'Select', w:70, render:r=>
      <label className="muted sm" onClick={e=>e.stopPropagation()} style={{display:'inline-flex',gap:6,alignItems:'center'}}>
        <input type="checkbox" checked={selected.has(r.row_id)} onChange={()=>toggle(r.row_id)}
          aria-label={`Select ${r.entity_code} ${r.period_code}`}/>
      </label>},
    {h:'Entity', render:r=><span>{r.entity_code} <span className="muted sm">{r.entity_name}</span></span>, sortVal:r=>r.entity_code},
    {h:'Period', k:'period_code'},
    {h:'State', render:r=><Badge tone={stateTone(r.state)}>{stateLabel(r.state)}</Badge>, sortVal:r=>r.state},
    {h:'Posted journals', num:true, render:r=><span className="num">{r.posted_journals}</span>, sortVal:r=>r.posted_journals},
    {h:'Unresolved work', num:true, render:r=><span className="num">{r.unresolved_total}</span>, sortVal:r=>r.unresolved_total},
    {h:'Control', render:r=>r.breach
      ? <Badge tone="bad">POSTED IN A PERIOD THAT IS NOT OPEN</Badge>
      : r.state === PERIOD_STATE_OPEN ? <span className="muted sm">Posting permitted</span>
      : <span className="muted sm">Posting blocked</span>},
    {h:'Last event', render:r=>r.last_event
      ? <span className="muted sm">{r.last_event.event_type} · {r.last_event.actor} · {r.last_event.at}</span>
      : <span className="muted sm">No period event recorded</span>, sortVal:r=>r.last_event?.at || ''},
  ];

  const outstandingCloseTasks = (closeTasks || []).filter(task => !['DONE','SIGNED_OFF'].includes(task.status)).length;

  return <div className="full-bleed">
    <h2 className="page-h">Period Management</h2>
    <p className="page-subtitle">
      A period record is an authorization: it exists because somebody opened that entity and period. Where no record exists,
      nothing may post into it - a missing record is never read as permission. Opening, closing and reopening are recorded
      here as audit events with an actor, a timestamp and a reason.
    </p>

    <section className="report-workbench" aria-label="Period state summary" style={{marginBottom:12}}>
      <div className="report-workbench-head">
        <div><b>{periodCode} across {scoped.length} entit{scoped.length === 1 ? 'y' : 'ies'} in scope</b>
          <div className="page-subtitle">Posting is permitted only where the state is OPEN.</div></div>
        <Badge tone={scopedTotals.breaches ? 'bad' : 'ok'}>{scopedTotals.breaches ? 'PERIOD CONTROL BREACHES PRESENT' : 'NO PERIOD CONTROL BREACH IN SCOPE'}</Badge>
      </div>
      <div className="qbo-drill-summary">
        <span><i>Open - posting permitted</i><b>{scopedTotals.open}</b></span>
        <span><i>Closed</i><b>{scopedTotals.closed}</b></span>
        <span><i>No period record</i><b>{scopedTotals.notConfigured}</b></span>
        <span><i>Posted journals in this period</i><b>{scopedTotals.postedJournals}</b></span>
        <span><i>Entity periods holding posted journals but not open</i><b>{scopedTotals.breaches}</b></span>
      </div>
      <p className="muted sm">
        Across every period the master knows, {totals.open} of {rows.length} entity periods shown here are open.
        Month-end close checklist: {outstandingCloseTasks} of {(closeTasks || []).length} tasks outstanding. That checklist carries
        no entity and no period, so REFS reports it as context and does not treat it as a per-entity close condition.
      </p>
    </section>

    <div className="filter-bar">
      <Field label="Period">
        <select value={periodCode} onChange={e=>{setPeriodCode(e.target.value); setSelected(new Set());}} aria-label="Accounting period">
          {codes.map(code=><option key={code} value={code}>{code}{code === currentPeriod ? ' (current)' : ''}</option>)}
        </select>
      </Field>
      <Field label="Entity type">
        <select value={entityType} onChange={e=>{setEntityType(e.target.value); setSelected(new Set());}} aria-label="Entity type">
          <option value="ALL">All entity types</option>
          {entityTypes.map(type=><option key={type} value={type}>{type}</option>)}
        </select>
      </Field>
      <Field label="State">
        <Segmented label="Period state" value={stateFilter} onChange={setStateFilter} options={STATE_FILTERS.map(option=>({
          value: option.key,
          label: option.label,
          count: option.key === 'ALL' ? scoped.length : scoped.filter(row=>row.state === option.key).length,
        }))}/>
      </Field>
    </div>

    {entity ? <p className="muted sm">The top bar limits this page to the selected entity. Choose <b>All entities</b> there to act across the group.</p> : null}

    <div className="row-acts" style={{margin:'8px 0 12px',flexWrap:'wrap'}}>
      <Btn size="sm" variant="ghost" onClick={selectAllVisible} disabled={visible.length === 0}
        title={visible.length === 0 ? 'There is nothing in this view to select' : 'Select or clear every row currently listed'}>
        {visible.length && visible.every(row=>selected.has(row.row_id)) ? 'Clear' : 'Select'} {visible.length} listed
      </Btn>
      <span className="muted sm">{selectedRows.length} selected</span>
    </div>

    {/* The command panel is always on screen, even with nothing selected, so a
        reader can see up front which of the three commands their role holds at
        all and which it does not. A command the role can never execute is a
        statement here, not a greyed-out button. */}
    <section className="qbo-card" aria-label="Period commands" style={{marginBottom:12}}>
      <h4>{selectedRows.length === 0
        ? 'Select entity periods above to open, close or reopen them'
        : `Act on ${selectedRows.length} selected entity period${selectedRows.length === 1 ? '' : 's'}`}</h4>
      <Field label="Reason" required
        hint={`Written verbatim into the audit event for every period changed. Opening and closing need ${REASON_MIN_LENGTH} characters; reopening needs ${REOPEN_REASON_MIN_LENGTH}.`}>
        <textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}
          placeholder="Why this period is being opened, closed or reopened" aria-label="Reason for the period transition"/>
      </Field>
      <div className="row-acts" style={{flexWrap:'wrap'}}>
        {commandButton('open', selectedRows, 'sm')}
        {commandButton('close', selectedRows, 'sm')}
        {commandButton('reopen', selectedRows, 'sm')}
      </div>
      <p className="muted sm">
        Each selected entity period is authorised, validated and checked for unresolved work on its own. A refusal on one
        entity does not carry the others, and every refusal is reported with its reason.
      </p>
    </section>

    <Table cols={cols} rows={visible} rowKey="row_id" pageSize={25} exportName={undefined}
      features={{exportable:false}} onRow={r=>{setDetailId(r.row_id); setReason('');}}
      empty={`No entity period matches this view for ${periodCode}.`}/>

    <Drawer open={!!detail} onClose={()=>setDetailId(null)}
      title={detail ? `${detail.entity_code} · ${detail.period_code}` : ''} width={560}>
      {detail && <div className="exc-detail">
        <div className="kv"><span>Entity</span><b>{detail.entity_name}</b></div>
        <div className="kv"><span>State</span><Badge tone={stateTone(detail.state)}>{stateLabel(detail.state)}</Badge></div>
        <div className="kv"><span>Posted journals</span><b className="num">{detail.posted_journals}</b></div>
        <div className="kv"><span>Journals still in workflow</span><b className="num">{detail.workflow_journals}</b></div>
        {detail.state === NOT_CONFIGURED
          ? <p className="muted sm">No period record exists for this entity and period. Nothing may post into it. That is the fail-closed
              default and it is not an error condition to be worked around: it is corrected by opening the period, which is an
              authorised act with a recorded reason.</p>
          : <p className="muted sm">Posting is {detail.state === PERIOD_STATE_OPEN ? 'permitted' : 'blocked'} for this entity and period.</p>}
        {detail.breach && <StateBlock tone="error" title="Posted journals sit in a period that is not open">
          <div className="muted sm">{detail.posted_journals} POSTED journal(s) are recorded here while the period is {stateLabel(detail.state)}.
            Posted evidence is immutable: REFS reports this and will not re-date, rewrite or delete anything. Correction is a reversal
            in an open period, or a documented reopen.</div>
        </StateBlock>}

        <Field label="Unresolved work observed in this entity and period">
          <div className="ro-box">
            {detail.unresolved.blocking
              ? <ul style={{margin:0,paddingLeft:18}}>{detail.unresolved.items.map(item=>
                  <li key={item.code}><b>{item.label}.</b> {item.detail} {item.refs.length ? `Examples: ${item.refs.join(', ')}.` : ''}</li>)}</ul>
              : unresolvedWorkSummary(detail.unresolved)}
          </div>
        </Field>

        <Field label="Period events">
          <div className="ro-box">
            {detail.events.length === 0
              ? 'No period event has been recorded for this entity and period.'
              : <ul style={{margin:0,paddingLeft:18}}>{detail.events.map(event=>
                  <li key={event.event_id}><b>{event.event_type}</b> · {event.actor} · {event.at}
                    <div className="muted sm">{event.reason}</div></li>)}</ul>}
          </div>
        </Field>

        <Field label="Reason" required
          hint={`Recorded with the transition. Opening and closing need ${REASON_MIN_LENGTH} characters; reopening needs ${REOPEN_REASON_MIN_LENGTH}.`}>
          <textarea rows={2} value={reason} onChange={e=>setReason(e.target.value)}
            placeholder="Why this period is being opened, closed or reopened" aria-label="Reason for this period transition"/>
        </Field>
        <div className="row-acts" style={{flexWrap:'wrap'}}>
          {detail.state === NOT_CONFIGURED && commandButton('open', [detail], 'sm')}
          {detail.state === PERIOD_STATE_OPEN && commandButton('close', [detail], 'sm')}
          {detail.state === PERIOD_STATE_CLOSED && commandButton('reopen', [detail], 'sm')}
        </div>
      </div>}
    </Drawer>
  </div>;
}
