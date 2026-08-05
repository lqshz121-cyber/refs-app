import { useMemo, useState } from 'react';
import { Badge, Btn, KPI, Table, Tabs } from './ui.jsx';
import { money, sum } from './engine.js';
import { repo } from './repo.js';
import {
  ACCOUNT_MAP,
  buildAccountingEvents,
  createAmortizationScheduleFromInsurance,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';

const toneForStatus = status => status === 'ACTIVE' || status === 'DRAFT_CREATED' ? 'ok' : status === 'BLOCKED' ? 'bad' : status === 'COMPLETED' ? 'muted' : 'warn';
const lineDebit = line => Number(line.debit_amount || 0);
const lineCredit = line => Number(line.credit_amount || 0);
const jeDebit = je => sum(je?.lines || [], lineDebit);
const jeCredit = je => sum(je?.lines || [], lineCredit);
const isBalanced = je => Math.abs(jeDebit(je) - jeCredit(je)) < 0.005;

function wbsModel() {
  const snapshot = createWbsMockDataset();
  const events = buildAccountingEvents(snapshot);
  const findings = runDeterministicAccountingRules(snapshot, events);
  const insuranceInvoice = snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO');
  const amortizationSchedule = createAmortizationScheduleFromInsurance(insuranceInvoice);
  const accrualFinding = findings.find(finding => finding.rule_id === 'ACCRUAL_CANDIDATE');
  return { snapshot, events, findings, insuranceInvoice, amortizationSchedule, accrualFinding };
}

function specFromSuggestedJE(je, description, patch = {}) {
  return {
    entity_id: patch.entity_id || je.entity_id || 2,
    project_id: je.project_id,
    property_id: je.property_id,
    je_type: 'AUTO',
    source_system: patch.source_system || 'AI_RULE_ENGINE',
    source_doc_id: je.source_document_id,
    source_document_id: je.source_document_id,
    description,
    posting_status: 'DRAFT',
    review_status: 'DRAFT',
    ai_proposed: true,
    ai_rule_id: je.ai_rule_id,
    ai_confidence: je.ai_confidence || 0.95,
    has_attachment: Boolean(je.source_document_id),
    period_code: je.accounting_period,
    je_date: je.je_date,
    lines: (je.lines || []).map(line => ({ ...line, description })),
  };
}

function reversalSpecFromJE(je, description) {
  return specFromSuggestedJE({
    ...je,
    je_id: `${je.je_id}-REVERSAL`,
    je_number: `${je.je_number}-REVERSAL`,
    je_date: '2026-08-01',
    accounting_period: '2026-08',
    lines: (je.lines || []).map(line => ({
      ...line,
      debit_amount: line.credit_amount || 0,
      credit_amount: line.debit_amount || 0,
    })),
  }, description, { source_system: 'AI_ACCRUAL_REVERSAL' });
}

function audit(userId, action, objectType, objectRef, detail) {
  repo.audit(userId || 'SYSTEM', action, objectType, objectRef, detail);
}

export function AmortizationCenter({ ctx }) {
  const { actions, toast, goto, user } = ctx;
  const model = useMemo(() => wbsModel(), []);
  const [state, setState] = useState(() => repo.load('amortization_center_state', {}));
  const [selectedPeriod, setSelectedPeriod] = useState(model.amortizationSchedule.lines[0]?.period);
  const selectedLine = model.amortizationSchedule.lines.find(line => line.period === selectedPeriod) || model.amortizationSchedule.lines[0];
  const createdPeriods = new Set(state.createdPeriods || []);
  const active = state.status === 'ACTIVE';
  const createdTotal = model.amortizationSchedule.lines
    .filter(line => createdPeriods.has(line.period))
    .reduce((total, line) => total + Number(line.amount || 0), 0);
  const total = model.amortizationSchedule.lines.reduce((acc, line) => acc + Number(line.amount || 0), 0);
  const remaining = total - createdTotal;
  const save = patch => {
    const next = { ...state, ...patch, updated_at: new Date().toISOString().slice(0, 19), updated_by: user.user_id };
    setState(next);
    repo.save('amortization_center_state', next);
  };
  const activate = () => {
    if (!model.insuranceInvoice.source_document_id) {
      toast('Schedule blocked: source document is required.', 'bad');
      return;
    }
    save({ status: 'ACTIVE' });
    audit(user.user_id, 'AMORTIZATION_SCHEDULE_ACTIVATED', 'AMORTIZATION_SCHEDULE', model.amortizationSchedule.schedule_id, model.insuranceInvoice.source_document_id);
    toast('Amortization schedule activated for monthly Draft JE review.');
  };
  const createDraft = line => {
    if (!active) {
      toast('Activate the schedule before creating monthly Draft JEs.', 'warn');
      return;
    }
    if (!line?.suggested_je || !isBalanced(line.suggested_je) || !line.suggested_je.source_document_id) {
      toast('Draft blocked: monthly JE must be balanced and source-backed.', 'bad');
      return;
    }
    const jeId = actions.newJEFromRule(specFromSuggestedJE(line.suggested_je, `Monthly prepaid insurance amortization ${line.period}`));
    const nextPeriods = Array.from(new Set([...(state.createdPeriods || []), line.period]));
    save({ status: nextPeriods.length === model.amortizationSchedule.lines.length ? 'COMPLETED' : 'ACTIVE', createdPeriods: nextPeriods, last_je_id: jeId });
    audit(user.user_id, 'AMORTIZATION_DRAFT_JE_CREATED', 'AMORTIZATION_PERIOD', line.period, `JE ${jeId}`);
    toast('Monthly amortization Draft JE created for review.');
    goto('je');
  };

  const rows = model.amortizationSchedule.lines.map(line => ({
    ...line,
    status: createdPeriods.has(line.period) ? 'DRAFT_CREATED' : active ? 'READY' : 'WAITING_FOR_ACTIVATION',
    debit: jeDebit(line.suggested_je),
    credit: jeCredit(line.suggested_je),
    balanced: isBalanced(line.suggested_je),
    source_document_id: line.suggested_je.source_document_id,
  }));

  return <div className="full-bleed">
    <h2 className="page-h">Amortization Center</h2>
    <div className="filter-bar"><span className="muted sm">WBS mock insurance evidence creates a Draft-only prepaid amortization schedule. Monthly journal entries are created only for human review.</span></div>
    <div className="kpi-row">
      <KPI label="Schedule status" value={state.status || 'DRAFT'} tone={toneForStatus(state.status || 'DRAFT')} />
      <KPI label="Coverage period" value={`${model.amortizationSchedule.coverage_start} to ${model.amortizationSchedule.coverage_end}`} />
      <KPI label="Monthly lines" value={model.amortizationSchedule.lines.length} />
      <KPI label="Recognized" value={money(createdTotal)} />
      <KPI label="Remaining balance" value={money(remaining)} tone={remaining ? 'warn' : 'ok'} />
    </div>
    <div className="split two">
      <div>
        <div className="card">
          <div className="card-h">Source evidence</div>
          <div className="kv-grid">
            <div><span>Source invoice</span><b>{model.insuranceInvoice.id}</b></div>
            <div><span>Source document</span><b>{model.insuranceInvoice.source_document_id}</b></div>
            <div><span>Vendor</span><b>{model.insuranceInvoice.vendor_id}</b></div>
            <div><span>Prepaid asset</span><b>{ACCOUNT_MAP.prepaidInsurance}</b></div>
            <div><span>Expense account</span><b>{ACCOUNT_MAP.insuranceExpense}</b></div>
            <div><span>Control</span><b>Draft-only monthly JE</b></div>
          </div>
          <div className="row-acts" style={{ marginTop: 14 }}>
            <Btn variant="primary" onClick={activate} disabled={active || state.status === 'COMPLETED'}>Activate schedule</Btn>
            <Btn onClick={() => createDraft(selectedLine)} disabled={!selectedLine || createdPeriods.has(selectedLine.period)}>Create selected monthly Draft JE</Btn>
          </div>
        </div>
        <Table
          pageSize={12}
          rows={rows}
          onRow={row => setSelectedPeriod(row.period)}
          cols={[
            { h: 'Period', k: 'period' },
            { h: 'Amount', num: true, render: row => money(row.amount), csv: row => row.amount },
            { h: 'Debit account', render: row => row.suggested_je.lines[0].account_code, csv: row => row.suggested_je.lines[0].account_code },
            { h: 'Credit account', render: row => row.suggested_je.lines[1].account_code, csv: row => row.suggested_je.lines[1].account_code },
            { h: 'Debit preview', num: true, render: row => money(row.debit), csv: row => row.debit },
            { h: 'Credit preview', num: true, render: row => money(row.credit), csv: row => row.credit },
            { h: 'Controls', render: row => <span className="row-acts"><Badge tone={row.balanced ? 'ok' : 'bad'}>{row.balanced ? 'Balanced' : 'Blocked'}</Badge><Badge tone={row.source_document_id ? 'ok' : 'bad'}>{row.source_document_id ? 'Source retained' : 'Missing source'}</Badge></span>, csv: row => `${row.balanced}/${row.source_document_id}` },
            { h: 'Status', render: row => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge>, csv: row => row.status },
          ]}
          empty="No amortization periods are available."
        />
      </div>
      <div className="card sticky-card">
        <div className="card-h">Selected monthly journal</div>
        {selectedLine ? <>
          <h3 style={{ margin: '8px 0 6px' }}>{selectedLine.period}</h3>
          <p className="muted">Recognize insurance expense and reduce prepaid insurance. This creates a Draft JE only.</p>
          <div className="kv-grid">
            <div><span>Source document</span><b>{selectedLine.suggested_je.source_document_id}</b></div>
            <div><span>JE date</span><b>{selectedLine.suggested_je.je_date}</b></div>
            <div><span>Balanced</span><b>{isBalanced(selectedLine.suggested_je) ? 'Yes' : 'No'}</b></div>
            <div><span>Draft status</span><b>{createdPeriods.has(selectedLine.period) ? 'Created' : 'Not created'}</b></div>
          </div>
          <table className="mini-table"><tbody>{selectedLine.suggested_je.lines.map((line, index) => <tr key={`${line.account_code}-${index}`}><td>{line.account_code}</td><td>{money(line.debit_amount || 0)}</td><td>{money(line.credit_amount || 0)}</td></tr>)}</tbody></table>
        </> : <div className="empty">Select a schedule line.</div>}
      </div>
    </div>
  </div>;
}

export function AccrualCenter({ ctx }) {
  const { actions, toast, goto, user } = ctx;
  const model = useMemo(() => wbsModel(), []);
  const [tab, setTab] = useState('Open');
  const [state, setState] = useState(() => repo.load('accrual_center_state', {}));
  const accrualFinding = model.accrualFinding;
  const suggested = accrualFinding?.suggested_je;
  const reversal = suggested ? reversalSpecFromJE(suggested, `Reversal: ${accrualFinding.rule_id} / ${accrualFinding.object_id}`) : null;
  const status = state.status || 'REVIEW_REQUIRED';
  const save = patch => {
    const next = { ...state, ...patch, updated_at: new Date().toISOString().slice(0, 19), updated_by: user.user_id };
    setState(next);
    repo.save('accrual_center_state', next);
  };
  const createAccrualDraft = () => {
    if (!suggested || !isBalanced(suggested) || !suggested.source_document_id) {
      toast('Accrual Draft blocked: source-backed balanced JE is required.', 'bad');
      save({ status: 'BLOCKED', block_reason: 'Missing source or balance control' });
      return;
    }
    const jeId = actions.newJEFromRule(specFromSuggestedJE(suggested, `Month-end accrual: ${accrualFinding.object_id}`, { source_system: 'AI_ACCRUAL' }));
    save({ status: 'ACCRUAL_DRAFT_CREATED', accrual_je_id: jeId });
    audit(user.user_id, 'ACCRUAL_DRAFT_JE_CREATED', 'ACCRUAL_CANDIDATE', accrualFinding.object_id, `JE ${jeId}`);
    toast('Accrual Draft JE created for controller review.');
    goto('je');
  };
  const createReversalDraft = () => {
    if (!state.accrual_je_id || !reversal) {
      toast('Create the accrual Draft before preparing the reversal.', 'warn');
      return;
    }
    const jeId = actions.newJEFromRule(reversal);
    save({ status: 'REVERSAL_DRAFT_CREATED', reversal_je_id: jeId });
    audit(user.user_id, 'ACCRUAL_REVERSAL_DRAFT_CREATED', 'ACCRUAL_CANDIDATE', accrualFinding.object_id, `JE ${jeId}`);
    toast('Reversal Draft JE created for review.');
    goto('je');
  };

  const checklist = [
    { key: 'source', label: 'Source document retained', pass: Boolean(suggested?.source_document_id), detail: suggested?.source_document_id || 'Missing source' },
    { key: 'period', label: 'Period is open in mock close calendar', pass: true, detail: suggested?.accounting_period || '2026-07' },
    { key: 'balance', label: 'Accrual JE is balanced', pass: Boolean(suggested && isBalanced(suggested)), detail: suggested ? `${money(jeDebit(suggested))} / ${money(jeCredit(suggested))}` : 'No suggestion' },
    { key: 'reversal', label: 'Reversal Draft can be prepared after accrual Draft', pass: Boolean(reversal), detail: 'Reversal date 2026-08-01' },
    { key: 'mutation', label: 'No automatic posting', pass: true, detail: 'Draft JE only; approval remains in Journal Entries' },
  ];
  const rows = accrualFinding ? [{
    key: accrualFinding.finding_id,
    risk: accrualFinding.risk_level,
    rule: accrualFinding.rule_id,
    object: accrualFinding.object_id,
    amount: Math.abs(Number(suggested?.lines?.[0]?.debit_amount || 0)),
    source: suggested?.source_document_id,
    debit: suggested?.lines?.[0]?.account_code,
    credit: suggested?.lines?.[1]?.account_code,
    balanced: suggested ? isBalanced(suggested) : false,
    status,
    reason: accrualFinding.reason,
    action: accrualFinding.suggested_action,
  }] : [];
  const visibleRows = tab === 'Open' ? rows.filter(row => !/DRAFT_CREATED|RESOLVED/.test(row.status)) : rows;

  return <div className="full-bleed">
    <h2 className="page-h">Accrual Center</h2>
    <div className="filter-bar"><span className="muted sm">Month-end accrual workbench for WBS mock payable evidence. It prepares accrual and reversal Draft JEs; it does not post or reverse accounting automatically.</span></div>
    <div className="kpi-row">
      <KPI label="Open accrual candidates" value={rows.length} tone={rows.length ? 'warn' : 'ok'} />
      <KPI label="Current status" value={status} tone={toneForStatus(status)} />
      <KPI label="Source-backed" value={suggested?.source_document_id ? 'Yes' : 'No'} tone={suggested?.source_document_id ? 'ok' : 'bad'} />
      <KPI label="Draft accrual amount" value={money(rows[0]?.amount || 0)} />
    </div>
    <Tabs tabs={['Open', 'Checklist', 'All']} active={tab} onChange={setTab} />
    {tab === 'Checklist' ? <div className="card">
      <div className="card-h">Month-end accrual checklist</div>
      <Table
        rows={checklist}
        cols={[
          { h: 'Gate', k: 'label' },
          { h: 'Result', render: row => <Badge tone={row.pass ? 'ok' : 'bad'}>{row.pass ? 'PASS' : 'BLOCKED'}</Badge>, csv: row => row.pass ? 'PASS' : 'BLOCKED' },
          { h: 'Evidence', k: 'detail' },
        ]}
        empty="No checklist gates are configured."
      />
    </div> : <div className="split two">
      <div>
        <Table
          pageSize={8}
          rows={visibleRows}
          cols={[
            { h: 'Risk', render: row => <Badge tone={row.risk === 'HIGH' ? 'bad' : 'warn'}>{row.risk}</Badge>, csv: row => row.risk },
            { h: 'Rule', render: row => <span className="acct-code">{row.rule}</span>, csv: row => row.rule },
            { h: 'Object', k: 'object' },
            { h: 'Amount', num: true, render: row => money(row.amount), csv: row => row.amount },
            { h: 'Source document', k: 'source' },
            { h: 'Debit / credit', render: row => `${row.debit} / ${row.credit}`, csv: row => `${row.debit}/${row.credit}` },
            { h: 'Controls', render: row => <span className="row-acts"><Badge tone={row.balanced ? 'ok' : 'bad'}>{row.balanced ? 'Balanced' : 'Blocked'}</Badge><Badge tone={row.source ? 'ok' : 'bad'}>{row.source ? 'Source retained' : 'Missing source'}</Badge></span>, csv: row => `${row.balanced}/${row.source}` },
            { h: 'Status', render: row => <Badge tone={toneForStatus(row.status)}>{row.status}</Badge>, csv: row => row.status },
          ]}
          empty="No accrual candidates are available."
        />
      </div>
      <div className="card sticky-card">
        <div className="card-h">Accrual review</div>
        {accrualFinding ? <>
          <h3 style={{ margin: '8px 0 6px' }}>{accrualFinding.rule_id}</h3>
          <p>{accrualFinding.reason}</p>
          <div className="kv-grid">
            <div><span>Source document</span><b>{suggested.source_document_id}</b></div>
            <div><span>Accrual period</span><b>{suggested.accounting_period}</b></div>
            <div><span>Reversal period</span><b>2026-08</b></div>
            <div><span>Amount</span><b>{money(rows[0]?.amount || 0)}</b></div>
            <div><span>Action</span><b>{accrualFinding.suggested_action}</b></div>
            <div><span>Confidence</span><b>{(accrualFinding.confidence_score * 100).toFixed(0)}%</b></div>
          </div>
          <h4>Draft JE preview</h4>
          <table className="mini-table"><tbody>{suggested.lines.map((line, index) => <tr key={`${line.account_code}-${index}`}><td>{line.account_code}</td><td>{money(line.debit_amount || 0)}</td><td>{money(line.credit_amount || 0)}</td></tr>)}</tbody></table>
          <h4>Reversing JE preview</h4>
          <table className="mini-table"><tbody>{reversal.lines.map((line, index) => <tr key={`${line.account_code}-${index}`}><td>{line.account_code}</td><td>{money(line.debit_amount || 0)}</td><td>{money(line.credit_amount || 0)}</td></tr>)}</tbody></table>
          <div className="row-acts" style={{ marginTop: 14 }}>
            <Btn variant="primary" onClick={createAccrualDraft} disabled={Boolean(state.accrual_je_id)}>Create accrual Draft JE</Btn>
            <Btn onClick={createReversalDraft} disabled={!state.accrual_je_id || Boolean(state.reversal_je_id)}>Create reversing Draft JE</Btn>
          </div>
        </> : <div className="empty">No accrual candidate was generated by the WBS mock rules.</div>}
      </div>
    </div>}
  </div>;
}
