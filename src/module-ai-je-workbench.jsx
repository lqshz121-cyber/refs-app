import { useMemo, useState } from 'react';
import { KPI, Btn, Badge, Table, Tabs, StateBlock } from './ui.jsx';
import { money, sum } from './engine.js';
import { repo } from './repo.js';
import {
  buildAccountingEvents,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';
import { createAIReviewOutcomeRepository } from './ai-accounting.js';

const riskTone = risk => risk === 'HIGH' ? 'bad' : risk === 'MEDIUM' ? 'warn' : 'muted';
const stableKey = item => `${item.finding_id}:${item.suggested_je?.je_id || 'NO_JE'}`;
const journalDebit = je => sum(je?.lines || [], line => line.debit_amount || 0);
const journalCredit = je => sum(je?.lines || [], line => line.credit_amount || 0);

function workbenchItems() {
  const snapshot = createWbsMockDataset();
  const events = buildAccountingEvents(snapshot);
  return runDeterministicAccountingRules(snapshot, events)
    .filter(finding => finding.suggested_je)
    .map(finding => ({
      key: stableKey(finding),
      finding,
      je: finding.suggested_je,
      risk: finding.risk_level,
      rule: finding.rule_id,
      reason: finding.reason,
      action: finding.suggested_action,
      confidence: finding.confidence_score,
      sourceRefs: finding.source_refs || [],
      entity_id: finding.suggested_je.entity_id,
      project_id: finding.suggested_je.project_id,
      property_id: finding.suggested_je.property_id,
      period: finding.suggested_je.accounting_period,
      debit: journalDebit(finding.suggested_je),
      credit: journalCredit(finding.suggested_je),
      balanced: Math.abs(journalDebit(finding.suggested_je) - journalCredit(finding.suggested_je)) < 0.005,
      hasSource: Boolean(finding.suggested_je.source_document_id),
      auditTrail: finding.audit_trail || [],
    }));
}

function specFromItem(item, status = 'DRAFT') {
  return {
    entity_id: item.je.entity_id || 2,
    project_id: item.je.project_id,
    property_id: item.je.property_id,
    period_code: item.je.accounting_period,
    je_date: item.je.je_date,
    posting_status: status,
    review_status: status === 'POSTED' ? 'POSTED' : 'DRAFT',
    je_type: 'AUTO',
    source_system: 'AI_RULE_ENGINE',
    source_doc_id: item.je.source_document_id,
    source_document_id: item.je.source_document_id,
    description: `AI JE Workbench: ${item.rule} / ${item.finding.object_id}`,
    ai_proposed: true,
    ai_proposal_id: item.je.je_id,
    ai_finding_id: item.finding.finding_id,
    ai_rule_id: item.rule,
    ai_confidence: item.confidence,
    ai_evidence: {
      reason: item.reason,
      suggested_action: item.action,
      source_refs: item.sourceRefs,
    },
    has_attachment: Boolean(item.je.source_document_id),
    lines: item.je.lines.map(line => ({ ...line, description: item.reason })),
  };
}

function reviewDraftFromItem(item) {
  const draft=specFromItem(item,'DRAFT');
  return {...draft,je_id:item.je.je_id,accounting_period:item.period,idempotency_key:`AI-DRAFT:${item.je.source_document_id}:${item.rule}:${item.je.je_id}`,member_trace:{entity_id:draft.entity_id,project_id:draft.project_id||null,property_id:draft.property_id||null}};
}

export function AIJEWorkbench({ ctx }) {
  const { actions, toast, goto, user } = ctx;
  const [tab, setTab] = useState('Ready');
  const [selectedKey, setSelectedKey] = useState(null);
  const [state, setState] = useState(() => repo.load('ai_je_workbench_state', {}));
  const [note, setNote] = useState('');
  const reviewRepository = useMemo(() => createAIReviewOutcomeRepository(repo), []);
  const items = useMemo(() => workbenchItems(), []);
  const enriched = items.map(item => ({ ...item, workflow: state[item.key]?.status || 'READY', note: state[item.key]?.note || '' }));
  const selected = enriched.find(item => item.key === selectedKey) || enriched[0];
  const update = (item, patch) => {
    const next = { ...state, [item.key]: { ...(state[item.key] || {}), ...patch, at: new Date().toISOString().slice(0, 19), by: user.user_id } };
    setState(next);
    repo.save('ai_je_workbench_state', next);
  };
  const audit = (action, item, detail = '') => repo.audit(user.user_id, action, 'AI_JE_CANDIDATE', item.key, detail || item.rule);
  const approve = item => {
    if (!item.balanced || !item.hasSource) {
      toast('Cannot approve: debit/credit and source-document controls must pass.', 'bad');
      return;
    }
    const revision=(Number(state[item.key]?.review_revision)||0)+1;
    const result=reviewRepository.apply({draft:reviewDraftFromItem(item),outcome:{decision:'APPROVE',idempotency_key:`AI-REVIEW:${item.key}:${revision}`,reason:note||'Approved for Draft preparation',review_metadata:{source_refs:item.sourceRefs}},actor:user.user_id});
    update(item, { status: 'APPROVED', note: note || item.note, review_revision: result.draft.ai_review_revision, review_outcome_id: result.draft.ai_review_outcome_id });
    audit('AI_JE_APPROVED', item);
    toast('AI JE candidate approved for Draft creation.');
  };
  const reject = item => {
    const revision=(Number(state[item.key]?.review_revision)||0)+1;
    const result=reviewRepository.apply({draft:reviewDraftFromItem(item),outcome:{decision:'REJECT',idempotency_key:`AI-REVIEW:${item.key}:${revision}`,reason:note||'Rejected by reviewer',review_metadata:{source_refs:item.sourceRefs}},actor:user.user_id});
    update(item, { status: 'REJECTED', note: note || 'Rejected by reviewer', review_revision: result.draft.ai_review_revision, review_outcome_id: result.draft.ai_review_outcome_id });
    audit('AI_JE_REJECTED', item, note);
    toast('AI JE candidate rejected.', 'warn');
  };
  const createDraft = item => {
    if (item.workflow !== 'APPROVED') {
      toast('Draft blocked: a retained human approval outcome is required first.', 'bad');
      return;
    }
    if (!item.balanced || !item.hasSource) {
      toast('Draft blocked: candidate must be balanced and source-backed.', 'bad');
      return;
    }
    const jeId = actions.newJEFromRule(specFromItem(item, 'DRAFT'));
    update(item, { status: 'DRAFT_CREATED', je_id: jeId, note: note || item.note });
    audit('AI_JE_DRAFT_CREATED', item, `JE ${jeId}`);
    toast('Draft JE created from AI candidate.');
    goto('je');
  };
  const filtered = enriched.filter(item => {
    if (tab === 'Ready') return item.workflow === 'READY';
    if (tab === 'Approved') return item.workflow === 'APPROVED';
    if (tab === 'Drafted') return item.workflow === 'DRAFT_CREATED';
    if (tab === 'Rejected') return item.workflow === 'REJECTED';
    if (tab === 'Blocked') return item.workflow === 'BLOCKED' || !item.balanced || !item.hasSource;
    return true;
  });
  const high = enriched.filter(item => item.risk === 'HIGH').length;
  const approved = enriched.filter(item => item.workflow === 'APPROVED').length;

  return <div className="full-bleed">
    <h2 className="page-h">AI JE Workbench</h2>
    <div className="filter-bar"><span className="muted sm">WBS mock sources become deterministic AI journal candidates. Every candidate keeps source, rule, reason, confidence and audit trail; posting is blocked when controls fail.</span></div>
    <div className="kpi-row">
      <KPI label="AI candidates" value={enriched.length} />
      <KPI label="High risk" value={high} tone={high ? 'bad' : 'ok'} />
      <KPI label="Approved" value={approved} />
      <KPI label="Posting from workbench" value="Disabled" tone="muted" />
    </div>
    <Tabs tabs={['Ready', 'Approved', 'Drafted', 'Rejected', 'Blocked', 'All']} active={tab} onChange={setTab} />
    <div className="split two">
      <Table
        pageSize={18}
        cols={[
          { h: 'Risk', render: row => <Badge tone={riskTone(row.risk)}>{row.risk}</Badge>, csv: row => row.risk },
          { h: 'Rule', render: row => <span className="acct-code">{row.rule}</span>, csv: row => row.rule },
          { h: 'Entity / project / property', render: row => <span>{row.entity_id} / {row.project_id} / {row.property_id}</span>, csv: row => `${row.entity_id}/${row.project_id}/${row.property_id}` },
          { h: 'Source', render: row => row.sourceRefs.join(' / '), csv: row => row.sourceRefs.join('|') },
          { h: 'Debit preview', num: true, render: row => money(row.debit), csv: row => row.debit },
          { h: 'Credit preview', num: true, render: row => money(row.credit), csv: row => row.credit },
          { h: 'Controls', render: row => <span className="row-acts"><Badge tone={row.balanced ? 'ok' : 'bad'}>{row.balanced ? 'Balanced' : 'Out of balance'}</Badge><Badge tone={row.hasSource ? 'ok' : 'bad'}>{row.hasSource ? 'Source retained' : 'Missing source'}</Badge></span>, csv: row => `${row.balanced}/${row.hasSource}` },
          { h: 'Confidence', render: row => `${(row.confidence * 100).toFixed(0)}%`, csv: row => row.confidence },
          { h: 'Status', render: row => <Badge tone={row.workflow === 'POSTED' ? 'ok' : row.workflow === 'REJECTED' || row.workflow === 'BLOCKED' ? 'bad' : row.workflow === 'APPROVED' ? 'warn' : 'muted'}>{row.workflow}</Badge>, csv: row => row.workflow },
        ]}
        rows={filtered}
        onRow={row => { setSelectedKey(row.key); setNote(row.note || ''); }}
        empty="No AI JE candidates in this queue."
      />
      <div className="card sticky-card">
        <div className="card-h">Candidate detail</div>
        {selected ? <>
          <h3 style={{ margin: '8px 0 6px' }}>{selected.rule}</h3>
          <p>{selected.reason}</p>
          <div className="kv-grid">
            <div><span>Source document</span><b>{selected.je.source_document_id}</b></div>
            <div><span>Period</span><b>{selected.period}</b></div>
            <div><span>Debit</span><b>{money(selected.debit)}</b></div>
            <div><span>Credit</span><b>{money(selected.credit)}</b></div>
            <div><span>Balanced</span><b>{selected.balanced ? 'Yes' : 'No'}</b></div>
            <div><span>Source retained</span><b>{selected.hasSource ? 'Yes' : 'No'}</b></div>
          </div>
          <h4>Lines</h4>
          <table className="mini-table"><tbody>{selected.je.lines.map((line, index) => <tr key={`${line.account_code}-${index}`}><td>{line.account_code}</td><td>{money(line.debit_amount || 0)}</td><td>{money(line.credit_amount || 0)}</td></tr>)}</tbody></table>
          <h4>Suggested action</h4>
          <div className="muted sm">{selected.action}</div>
          <h4>Review note</h4>
          <textarea className="input" rows={3} value={note} onChange={event => setNote(event.target.value)} placeholder="Add reviewer note before approve/reject/post" />
          <div className="row-acts" style={{ marginTop: 14 }}>
            <Btn variant="primary" onClick={() => approve(selected)}>Approve</Btn>
            <Btn onClick={() => createDraft(selected)} disabled={selected.workflow !== 'APPROVED'} title={selected.workflow === 'APPROVED' ? 'Create a Draft JE through the application action boundary' : 'Retain a human approval outcome first'}>Create Draft JE</Btn>
            <Btn variant="danger" onClick={() => reject(selected)}>Reject</Btn>
          </div>
          <p className="muted sm">This workbench records human review and can create a Draft JE only. Review, approval, and posting remain in the controlled Journal Entry workflow.</p>
          <h4>Audit trail</h4>
          <ul className="mini-list">
            {selected.auditTrail.map((entry, index) => <li key={index}>{entry.action} <span className="muted">by {entry.actor || 'system'} at {entry.at || 'runtime'}</span></li>)}
            {state[selected.key] && <li>{state[selected.key].status} <span className="muted">by {state[selected.key].by} at {state[selected.key].at}</span></li>}
            {state[selected.key]?.review_outcome_id && <li>Review outcome {state[selected.key].review_outcome_id} <span className="muted">revision {state[selected.key].review_revision}</span></li>}
          </ul>
        </> : <StateBlock tone="empty" title="No candidate selected">Select an AI journal candidate to review.</StateBlock>}
      </div>
    </div>
  </div>;
}
