import { useMemo, useState } from 'react';
import { KPI, Btn, Badge, Table, Tabs, StateBlock } from './ui.jsx';
import { money, sum } from './engine.js';
import { subsidiaryOf, memberOf } from './coa-wbs.js';
import { repo } from './repo.js';
import {
  buildAccountingEvents,
  createAmortizationScheduleFromInsurance,
  createWbsMockDataset,
  runDeterministicAccountingRules,
} from './wbs-accounting-foundation.js';
import { buildWbsEndToEndFlowEvidence } from './wbs-e2e-flow-evidence.js';
import { buildWbsAccountingAnalysisReport } from './wbs-accounting-analysis-report.js';
import { buildWbsAccountingActionQueue } from './wbs-accounting-action-queue.js';
import { buildAIReviewOutcomeTrace } from './ai-accounting.js';
import { buildRentRollRevenueReview } from './ai-rent-roll-review.js';

const TAB_RULES = {
  'Critical Findings': finding => finding.risk === 'HIGH',
  'Accounting Logic': finding => ['Accounting Logic', 'Property-level Issues'].includes(finding.category),
  'Mapping Issues': finding => /SUB|MAPPING|DIMENSION/i.test(finding.rule),
  'Missing Source': finding => /SOURCE|WITHOUT_BILL|ACCRUAL/i.test(finding.rule),
  'Duplicate Risk': finding => /DUPLICATE/i.test(finding.rule),
  'Cutoff Risk': finding => /CUTOFF|POST_COMPLETION|PERIOD/i.test(finding.rule),
  Reconciliation: finding => /RECON|MATCH|BALANCE|BANK|RENT_ROLL/i.test(finding.rule),
  'Prepaid / Amortization': finding => /PREPAID|AMORT/i.test(finding.rule),
  Accruals: finding => /ACCRUAL/i.test(finding.rule),
  'Loan Accounting': finding => /LOAN|INTEREST/i.test(finding.rule),
  'Property-level Issues': finding => /RENT|PROPERTY|CWIP|CONSTRUCTION/i.test(finding.rule),
  Resolved: (finding, resolved) => Boolean(resolved[finding.key]),
  All: (finding, resolved) => !resolved[finding.key],
};

const riskTone = risk => risk === 'HIGH' ? 'bad' : risk === 'MEDIUM' ? 'warn' : 'muted';
const reviewOwner = risk => risk === 'HIGH' ? 'CONTROLLER' : risk === 'MEDIUM' ? 'SENIOR_ACCT' : 'ACCOUNTING_OPS';
const reviewDue = risk => risk === 'HIGH' ? '2026-08-06' : risk === 'MEDIUM' ? '2026-08-15' : '2026-08-31';

const convertWbsFinding = finding => ({
  id: finding.finding_id,
  key: finding.finding_id,
  category: categorizeFinding(finding.rule_id),
  risk: finding.risk_level,
  rule: finding.rule_id,
  object: finding.object_id,
  reason: finding.reason,
  action: finding.suggested_action,
  conf: finding.confidence_score,
  owner: finding.owner || reviewOwner(finding.risk_level),
  due: finding.due_date || reviewDue(finding.risk_level),
  needs_human: finding.risk_level !== 'LOW',
  sourceRefs: finding.source_refs || [],
  suggestedJe: finding.suggested_je || null,
  auditTrail: finding.audit_trail || [],
  source: 'WBS mock rule engine',
});

function categorizeFinding(ruleId) {
  if (/PREPAID|AMORT/i.test(ruleId)) return 'Prepaid / Amortization';
  if (/ACCRUAL/i.test(ruleId)) return 'Accruals';
  if (/LOAN|INTEREST/i.test(ruleId)) return 'Loan Accounting';
  if (/DUPLICATE/i.test(ruleId)) return 'Duplicate Risk';
  if (/SOURCE|WITHOUT_BILL/i.test(ruleId)) return 'Missing Source';
  if (/CUTOFF|CWIP|RENT/i.test(ruleId)) return 'Property-level Issues';
  if (/BALANCE|MATCH|BANK/i.test(ruleId)) return 'Reconciliation';
  return 'Accounting Logic';
}

function buildLedgerFindings({ jes = [], entity = 0 }) {
  const findings = [];
  const posted = jes.filter(je => je.posting_status === 'POSTED' && (!entity || je.entity_id === entity));
  const push = (risk, rule, object, reason, action, conf, patch = {}) => findings.push({
    id: `${rule}:${object}`,
    key: `${rule}:${object}`,
    category: patch.category || categorizeFinding(rule),
    risk,
    rule,
    object,
    reason,
    action,
    conf,
    owner: patch.owner || reviewOwner(risk),
    due: patch.due || reviewDue(risk),
    needs_human: risk !== 'LOW',
    sourceRefs: patch.sourceRefs || [object],
    suggestedJe: patch.suggestedJe || null,
    auditTrail: patch.auditTrail || [{ action: 'ledger_scan', at: 'runtime', actor: 'AI_AUDIT_CENTER' }],
    source: 'Posted ledger scan',
  });
  const seen = {};
  posted.forEach(je => {
    const debit = sum(je.lines, line => line.debit_amount || 0);
    const credit = sum(je.lines, line => line.credit_amount || 0);
    if (Math.abs(debit - credit) > 0.005) push('HIGH', 'LEDGER_JE_NOT_BALANCED', je.je_number, `Journal is unbalanced: Dr ${money(debit)} does not equal Cr ${money(credit)}.`, 'Block reporting and return the journal for correction.', 0.99);
    const duplicateKey = `${je.je_number}:${je.entity_id}`;
    if (seen[duplicateKey]) push('MEDIUM', 'DUPLICATE_JE_NUMBER', je.je_number, 'Duplicate journal number exists in the same entity.', 'Review posting history and source references before close.', 0.9);
    seen[duplicateKey] = true;
    je.lines.forEach((line, index) => {
      const subsidiary = subsidiaryOf(line.account_code);
      if (subsidiary && !memberOf(line)) push('HIGH', 'SUBSIDIARY_MEMBER_MISSING', `${je.je_number} line ${index + 1}`, `${line.account_code} requires ${subsidiary} subsidiary tracking but no member is attached.`, 'Add the required member through the controlled workflow before posting or reporting.', 0.97, { category: 'Mapping Issues' });
      if (line.account_code === '142000') push('MEDIUM', 'SUSPENSE_BALANCE_OPEN', je.je_number, 'Suspense balance remains open on a posted journal.', 'Identify the counterparty and prepare a reviewed reclass.', 0.8);
    });
    const sourceId = je.source_doc_id || je.source_document_id;
    if (je.je_type === 'AUTO' && ['PAYABLE', 'CLOSING'].includes(je.source_system) && !sourceId && !je.rule_code) push('MEDIUM', 'AUTO_JE_SOURCE_TRACE_MISSING', je.je_number, 'Automated journal has no source-document trace.', 'Trace the source in Integration Hub and attach evidence before close.', 0.85);
    if (je.je_date && je.period_code && je.je_date.slice(0, 7) !== je.period_code) push('MEDIUM', 'CUTOFF_PERIOD_MISMATCH', je.je_number, `Business date ${je.je_date} differs from accounting period ${je.period_code}.`, 'Confirm the accrual period or amend the accounting date.', 0.88);
    if (je.je_type === 'MANUAL' && je.has_attachment === false && Math.max(debit, credit) >= 10000) push('HIGH', 'MANUAL_JE_LARGE_NO_ATTACHMENT', je.je_number, 'Large manual journal entry has no attachment.', 'Require controller review, source support and audit trail before approval.', 0.98);
  });
  const dueToFrom = {};
  posted.forEach(je => je.lines.forEach(line => {
    if (line.account_code !== '291001') return;
    const member = memberOf(line) || 'Unassigned member';
    dueToFrom[member] = (dueToFrom[member] || 0) + (line.debit_amount || 0) - (line.credit_amount || 0);
  }));
  Object.entries(dueToFrom).forEach(([member, amount]) => {
    if (amount < -0.005 && Math.abs(amount) > 5000) push('LOW', 'DUE_TO_FROM_AGING', `291001 ${member}`, `Open net Due to/from balance for ${member}: ${money(amount)}.`, 'Check whether a retained bank-feed match or intercompany clearing entry is missing.', 0.7);
  });
  return findings;
}

function suggestedJeSummary(je) {
  if (!je) return 'No journal generated; action is review or blocker only.';
  const debit = sum(je.lines, line => line.debit_amount || 0);
  const credit = sum(je.lines, line => line.credit_amount || 0);
  return `${je.je_number}: Dr ${money(debit)} / Cr ${money(credit)} (${je.lines.map(line => line.account_code).join(' / ')})`;
}

function jeSpecFromSuggested(je, description) {
  return {
    entity_id: je.entity_id || 2,
    je_type: 'AUTO',
    source_system: 'AI_RULE_ENGINE',
    source_doc_id: je.source_document_id,
    source_document_id: je.source_document_id,
    description,
    ai_proposed: true,
    ai_rule_id: je.ai_rule_id,
    ai_confidence: je.ai_confidence,
    posting_status: 'DRAFT',
    has_attachment: Boolean(je.source_document_id),
    lines: je.lines.map(line => ({ ...line, description })),
  };
}

export function AIAudit({ ctx }) {
  const { jes, entity, goto, actions, toast, user } = ctx;
  const [runId, setRunId] = useState(1);
  const [tab, setTab] = useState('All');
  const [selectedId, setSelectedId] = useState(null);
  const [resolved, setResolved] = useState(() => repo.load('audit_resolved', {}));
  const reviewOutcomeTrace = useMemo(
    () => buildAIReviewOutcomeTrace(repo.load('ai_accounting_review_outcomes', { wals: [], drafts: [], events: [] })),
    [runId],
  );

  const model = useMemo(() => {
    const snapshot = createWbsMockDataset();
    const events = buildAccountingEvents(snapshot);
    const wbsFindings = runDeterministicAccountingRules(snapshot, events).map(convertWbsFinding);
    const ledgerFindings = buildLedgerFindings({ jes, entity });
    const findings = [...wbsFindings, ...ledgerFindings].sort((a, b) => (({ HIGH: 0, MEDIUM: 1, LOW: 2 }[a.risk] ?? 3) - ({ HIGH: 0, MEDIUM: 1, LOW: 2 }[b.risk] ?? 3)) || b.conf - a.conf);
    const insuranceInvoice = snapshot.payableInvoices.find(invoice => invoice.id === 'AP-INS-12MO');
    const amortizationSchedule = createAmortizationScheduleFromInsurance(insuranceInvoice);
    const e2eFlowEvidence = buildWbsEndToEndFlowEvidence(snapshot);
    const accountingAnalysisReport = buildWbsAccountingAnalysisReport(snapshot);
    const accountingActionQueue = buildWbsAccountingActionQueue(accountingAnalysisReport);
    const rentRollReview = buildRentRollRevenueReview({ snapshot, periodCode:'2026-07', reviewTrace:reviewOutcomeTrace });
    return { snapshot, events, findings, amortizationSchedule, e2eFlowEvidence, accountingAnalysisReport, accountingActionQueue, rentRollReview };
  }, [jes, entity, runId, reviewOutcomeTrace]);

  const resolve = finding => {
    const next = { ...resolved, [finding.key]: { by: user.user_id, at: new Date().toISOString().slice(0, 10), rule: finding.rule } };
    setResolved(next);
    repo.save('audit_resolved', next);
    repo.audit(user.user_id, 'AI_FINDING_RESOLVED', 'AI_FINDING', finding.key, finding.rule);
  };
  const selected = model.findings.find(finding => finding.id === selectedId) || model.findings[0];
  const visible = model.findings.filter(finding => (TAB_RULES[tab] || TAB_RULES.All)(finding, resolved));
  const high = model.findings.filter(finding => finding.risk === 'HIGH' && !resolved[finding.key]).length;
  const medium = model.findings.filter(finding => finding.risk === 'MEDIUM' && !resolved[finding.key]).length;
  const open = model.findings.filter(finding => !resolved[finding.key]).length;

  const createDraft = (finding, kind = 'Draft JE') => {
    if (!finding.suggestedJe) {
      toast('This finding is a blocker or review-only item; no journal was generated.', 'warn');
      return;
    }
    const jeId = actions.newJEFromRule(jeSpecFromSuggested(finding.suggestedJe, `${kind}: ${finding.rule} / ${finding.object}`));
    repo.audit(user.user_id, 'AI_DRAFT_CREATED', 'AI_FINDING', finding.key, `JE ${jeId}`);
    toast(`${kind} created for controller review.`);
    goto('je');
  };

  return (
    <div className="full-bleed">
      <h2 className="page-h">AI Audit Center</h2>
      <div className="filter-bar">
        <Btn variant="primary" onClick={() => setRunId(id => id + 1)}>Run rules again</Btn>
        <span className="muted sm">Deterministic WBS mock rules and posted-ledger controls. The AI layer proposes review work only; posting still requires the JE workflow.</span>
      </div>
      <div className="kpi-row">
        <KPI label="Open findings" value={open} tone={open ? 'warn' : 'ok'} />
        <KPI label="Critical" value={high} tone={high ? 'bad' : 'ok'} />
        <KPI label="Medium" value={medium} tone={medium ? 'warn' : 'ok'} />
        <KPI label="Accounting events" value={model.events.length} />
        <KPI label="Amortization lines" value={model.amortizationSchedule.lines.length} />
      </div>
      <section className="report-workbench ai-review-outcome-trace" aria-label="AI review outcome trace" style={{marginBottom:12}}>
        <div className="report-workbench-head">
          <div><b>Human review outcome trace</b><div className="page-subtitle">Read-only, secret-redacted evidence for controller decisions and WAL recovery. This trace cannot create, approve, or post a journal entry.</div></div>
          <Badge tone={reviewOutcomeTrace.some(row => row.evidence_state === 'INCOMPLETE') ? 'warn' : 'ok'}>READ_ONLY_AUDIT</Badge>
        </div>
        <div className="qbo-toolgrid">
          <span><i>Outcomes</i><b>{reviewOutcomeTrace.length}</b></span>
          <span><i>Committed</i><b>{reviewOutcomeTrace.filter(row => row.wal_state === 'COMMITTED').length}</b></span>
          <span><i>Recovered</i><b>{reviewOutcomeTrace.filter(row => row.recovery_state === 'RECOVERED').length}</b></span>
          <span><i>Incomplete evidence</i><b>{reviewOutcomeTrace.filter(row => row.evidence_state === 'INCOMPLETE').length}</b></span>
          <span><i>Draft creation</i><b>Disabled</b></span>
          <span><i>Approval / posting</i><b>Disabled</b></span>
        </div>
        <Table features={{exportable:false}} rowKey="trace_id" pageSize={8} cols={[
          {h:'Decision',render:row=><Badge tone={row.decision === 'REJECT' ? 'bad' : row.decision === 'EDIT' ? 'warn' : 'ok'}>{row.decision || 'UNKNOWN'}</Badge>,csv:row=>row.decision},
          {h:'Actor / time',render:row=><span>{row.actor || 'Unknown'} / {row.committed_at || row.prepared_at || 'Not recorded'}</span>,csv:row=>`${row.actor || ''} ${row.committed_at || row.prepared_at || ''}`},
          {h:'Revision',render:row=><span className="acct-code">R{row.revision}</span>,csv:row=>row.revision},
          {h:'WAL / recovery',render:row=><span>{row.wal_state} / {row.recovery_state}</span>,csv:row=>`${row.wal_state} ${row.recovery_state}`},
          {h:'Proposal / event',render:row=><span>{row.proposal_id || 'Missing proposal'} / {row.event_id || 'Missing event'}</span>,csv:row=>`${row.proposal_id || ''} ${row.event_id || ''}`},
          {h:'Draft state',render:row=><Badge tone={row.posting_status === 'DRAFT' ? 'ok' : 'bad'}>{row.posting_status || 'UNKNOWN'}</Badge>,csv:row=>row.posting_status},
          {h:'Evidence',render:row=><Badge tone={row.evidence_state === 'COMPLETE' ? 'ok' : 'warn'}>{row.evidence_state}</Badge>,csv:row=>row.evidence_state},
          {h:'Canonical redacted payload',render:row=><span className="mono sm" title={row.canonical_redacted_payload || ''}>{row.canonical_redacted_payload ? `${row.canonical_redacted_payload.slice(0, 120)}${row.canonical_redacted_payload.length > 120 ? '…' : ''}` : 'Missing'}</span>,csv:row=>row.canonical_redacted_payload || ''},
        ]} rows={reviewOutcomeTrace} empty="No human review outcomes have been retained."/>
      </section>
      <section className="report-workbench ai-rent-roll-review" aria-label="Rent roll revenue mismatch review" style={{marginBottom:12}}>
        <div className="report-workbench-head">
          <div><b>Rent roll revenue mismatch review</b><div className="page-subtitle">Difference-only, source-scoped Draft proposals. A retained human outcome is required before a non-dispatching standard JE Draft request can be prepared.</div></div>
          <Badge tone={model.rentRollReview.exceptions.length ? 'warn' : 'ok'}>{model.rentRollReview.mode}</Badge>
        </div>
        <div className="qbo-toolgrid">
          <span><i>Rent roll sources</i><b>{model.rentRollReview.summary.sources}</b></span>
          <span><i>Mismatches</i><b>{model.rentRollReview.summary.mismatches}</b></span>
          <span><i>Human review required</i><b>{model.rentRollReview.summary.human_review_required}</b></span>
          <span><i>Draft requests</i><b>{model.rentRollReview.summary.draft_requests}</b></span>
          <span><i>Exceptions</i><b>{model.rentRollReview.summary.exceptions}</b></span>
          <span><i>Posting</i><b>Disabled</b></span>
        </div>
        <Table features={{exportable:false}} rowKey="case_id" pageSize={8} cols={[
          {h:'Source',render:row=><span>{row.source_id} / {row.source_document_id}</span>,csv:row=>row.source_id},
          {h:'Scheduled rent',num:true,render:row=>money(row.scheduled_rent),csv:row=>row.scheduled_rent},
          {h:'Posted revenue',num:true,render:row=>money(row.posted_revenue),csv:row=>row.posted_revenue},
          {h:'Difference',num:true,render:row=>money(row.difference),csv:row=>row.difference},
          {h:'Review state',render:row=><Badge tone={row.state==='HUMAN_REVIEW_REQUIRED'?'warn':'ok'}>{row.state}</Badge>,csv:row=>row.state},
          {h:'Suggested JE',render:row=><span>{row.suggested_draft?.je_id||'Not required'} / {row.suggested_draft?.posting_status||'—'}</span>,csv:row=>row.suggested_draft?.je_id||''},
          {h:'Draft request',render:row=><Badge tone={row.draft_request?'ok':'warn'}>{row.draft_request?.state||'BLOCKED_PENDING_REVIEW'}</Badge>,csv:row=>row.draft_request?.state||''},
          {h:'Report impact',render:row=><span>AR {money(row.report_impact.ar_delta)} / Revenue {money(row.report_impact.revenue_delta)}</span>,csv:row=>row.report_impact.revenue_delta},
        ]} rows={model.rentRollReview.cases} empty="No source-scoped rent roll review case is available."/>
        <p className="muted sm" style={{margin:'10px 0 0'}}>This mock review never calls WBS, changes rent data, dispatches a journal command, approves, or posts. Scope conflicts and missing evidence remain exceptions.</p>
      </section>
      <section className="report-workbench wbs-accounting-analysis-report" aria-label="Accounting analysis report" style={{marginBottom:12}}>
        <div className="report-workbench-head">
          <div><b>Accounting analysis report</b><div className="page-subtitle">Findings, close controls, posted impact and workflow blockers from the WBS mock accounting pipeline.</div></div>
          <Badge tone={model.accountingAnalysisReport.summary.trial_balance_state === 'TIED' && model.accountingAnalysisReport.summary.balance_sheet_state === 'TIED' ? 'ok' : 'warn'}>{model.accountingAnalysisReport.mode}</Badge>
        </div>
        <div className="qbo-toolgrid">
          <span><i>High-risk open</i><b>{model.accountingAnalysisReport.summary.open_high_risk}</b></span>
          <span><i>Postable JEs</i><b>{model.accountingAnalysisReport.summary.postable_suggested_jes}/{model.accountingAnalysisReport.summary.suggested_jes}</b></span>
          <span><i>Blocked workflows</i><b>{model.accountingAnalysisReport.summary.blocked_or_review_flows}</b></span>
          <span><i>Controls tied</i><b>{model.accountingAnalysisReport.controlRows.filter(row=>row.state==='TIED').length}/{model.accountingAnalysisReport.controlRows.length}</b></span>
          <span><i>Net income</i><b>{money(model.accountingAnalysisReport.summary.net_income)}</b></span>
          <span><i>Closing cash</i><b>{money(model.accountingAnalysisReport.summary.closing_cash)}</b></span>
        </div>
        <Table features={{exportable:false}} rowKey="rule_id" pageSize={8} cols={[
          {h:'Rule',render:row=><span className="acct-code">{row.rule_id}</span>,csv:row=>row.rule_id},
          {h:'Risk',render:row=><Badge tone={riskTone(row.risk_level)}>{row.risk_level}</Badge>,csv:row=>row.risk_level},
          {h:'Object',k:'object_id'},
          {h:'Reason',k:'reason'},
          {h:'Action',k:'suggested_action'},
          {h:'Owner / due',render:row=><span>{row.owner} · {row.due_date}</span>,csv:row=>row.owner},
          {h:'Audit',render:row=><Badge tone={row.audit_trail_count?'ok':'warn'}>{row.audit_trail_count}</Badge>,csv:row=>row.audit_trail_count},
        ]} rows={model.accountingAnalysisReport.executiveFindings}/>
        <p className="muted sm" style={{margin:'10px 0 0'}}>This local report never calls production WBS, never exports report data, and never posts outside the guarded mock posting gate. Global release still requires real HTTPS/OIDC, provider S3/scanner, and signed WBS receipt evidence.</p>
      </section>
      <section className="report-workbench wbs-accounting-action-queue" aria-label="WBS accounting action queue" style={{marginBottom:12}}>
        <div className="report-workbench-head">
          <div><b>Accounting action queue</b><div className="page-subtitle">Controller-ready work items generated from AI findings, workflow blockers and source-backed suggested journals.</div></div>
          <Badge tone={model.accountingActionQueue.summary.no_post_without_review ? 'ok' : 'bad'}>{model.accountingActionQueue.mode}</Badge>
        </div>
        <div className="qbo-toolgrid">
          <span><i>Total actions</i><b>{model.accountingActionQueue.summary.total_actions}</b></span>
          <span><i>P0 actions</i><b>{model.accountingActionQueue.summary.p0_actions}</b></span>
          <span><i>Draft ready</i><b>{model.accountingActionQueue.summary.draft_ready}</b></span>
          <span><i>Review required</i><b>{model.accountingActionQueue.summary.review_required}</b></span>
          <span><i>Workflow blockers</i><b>{model.accountingActionQueue.summary.blocked_workflows}</b></span>
          <span><i>Posting disabled</i><b>Yes</b></span>
        </div>
        <Table features={{exportable:false}} rowKey="action_id" pageSize={10} cols={[
          {h:'Priority',render:row=><Badge tone={row.priority === 'P0' ? 'bad' : row.priority === 'P1' ? 'warn' : 'muted'}>{row.priority}</Badge>,csv:row=>row.priority},
          {h:'Action type',render:row=><span className="acct-code">{row.action_type}</span>,csv:row=>row.action_type},
          {h:'Source',render:row=><span>{row.source_type} / {row.source_id}</span>,csv:row=>row.source_id},
          {h:'Reason',k:'reason'},
          {h:'Next action',k:'next_action'},
          {h:'Owner / due',render:row=><span>{row.owner} / {row.due_date}</span>,csv:row=>`${row.owner} ${row.due_date}`},
          {h:'Readiness',render:row=><Badge tone={row.readiness === 'DRAFT_READY' ? 'ok' : 'warn'}>{row.readiness}</Badge>,csv:row=>row.readiness},
          {h:'JE gate',render:row=><Badge tone={row.draft_je_gate?.state === 'PASS' ? 'ok' : 'warn'}>{row.draft_je_gate?.state || 'NOT_AVAILABLE'}</Badge>,csv:row=>row.draft_je_gate?.state || ''},
          {h:'Draft JE',render:row=><span>{row.suggested_je_number || 'Review only'}</span>,csv:row=>row.suggested_je_number || ''},
        ]} rows={model.accountingActionQueue.actions}/>
        <p className="muted sm" style={{margin:'10px 0 0'}}>The queue can prepare Draft JE review work only when entity, period, date, type, source document, rule, idempotency, balanced lines, and member trace are complete. It never posts, exports, syncs, or calls production WBS.</p>
      </section>
      <section className="report-workbench wbs-e2e-flow-evidence" aria-label="WBS mock end-to-end accounting flow evidence" style={{marginBottom:12}}>
        <div className="report-workbench-head">
          <div><b>WBS mock end-to-end accounting flow evidence</b><div className="page-subtitle">Source data, accounting event, finding, suggested JE, review state, posted JE, GL impact, report impact, and audit trail are visible for each mock close workflow.</div></div>
          <Badge tone={model.e2eFlowEvidence.allFlowsTraceable ? 'ok' : 'warn'}>{model.e2eFlowEvidence.mode}</Badge>
        </div>
        <div className="qbo-toolgrid">
          <span><i>Mock flows</i><b>{model.e2eFlowEvidence.controls.total_flows}</b></span>
          <span><i>Source + event</i><b>{model.e2eFlowEvidence.controls.flows_with_event}</b></span>
          <span><i>JE or blocker</i><b>{model.e2eFlowEvidence.controls.flows_with_suggested_je_or_explicit_blocker}</b></span>
          <span><i>Audit trail</i><b>{model.e2eFlowEvidence.controls.flows_with_audit}</b></span>
        </div>
        <Table features={{exportable:false}} rowKey="id" pageSize={10} cols={[
          {h:'Workflow',k:'name'},
          {h:'Source',render:row=><span>{row.source_id} · {row.source_type}</span>,csv:row=>row.source_id},
          {h:'Event',render:row=><span>{row.event_type} · {row.event_id}</span>,csv:row=>row.event_id},
          {h:'Rule / review',render:row=><span><span className="acct-code">{row.rule_id}</span> · {row.review_status}</span>,csv:row=>row.rule_id},
          {h:'Suggested JE',k:'suggested_je_number'},
          {h:'Posted / report',render:row=><span>{row.posted_state} · GL {row.gl_line_count} · Report {row.report_impact_count}</span>,csv:row=>row.posted_state},
          {h:'Control',render:row=><Badge tone={/TIED|POSTED|READY|RETAINED/.test(row.control_state)?'ok':'warn'}>{row.control_state}</Badge>,csv:row=>row.control_state},
        ]} rows={model.e2eFlowEvidence.flows}/>
        <p className="muted sm" style={{margin:'10px 0 0'}}>This is a local simulation gate. Incomplete source evidence stays review-only; the screen does not call production WBS, create automatic postings, export, sync, or replace the external release gates.</p>
      </section>
      <Tabs tabs={Object.keys(TAB_RULES)} active={tab} onChange={setTab} />
      <div className="split two">
        <div>
          <Table
            pageSize={18}
            cols={[
              { h: 'Risk', render: row => <Badge tone={riskTone(row.risk)}>{row.risk}</Badge>, csv: row => row.risk },
              { h: 'Category', k: 'category' },
              { h: 'Rule', render: row => <span className="acct-code">{row.rule}</span>, csv: row => row.rule },
              { h: 'Object', k: 'object' },
              { h: 'Reason', k: 'reason' },
              { h: 'Suggested action', k: 'action' },
              { h: 'Confidence', render: row => `${(row.conf * 100).toFixed(0)}%`, csv: row => row.conf },
              { h: 'Owner', k: 'owner' },
              { h: 'Due', k: 'due' },
              { h: 'Status', render: row => resolved[row.key] ? <Badge tone="ok">Resolved</Badge> : <Badge tone="warn">Open</Badge>, csv: row => resolved[row.key] ? 'RESOLVED' : 'OPEN' },
              { h: 'Actions', render: row => <span className="row-acts">
                <Btn size="sm" variant="ghost" onClick={event => { event.stopPropagation(); setSelectedId(row.id); }}>Review</Btn>
                {row.suggestedJe && <Btn size="sm" variant="primary" onClick={event => { event.stopPropagation(); createDraft(row); }}>Create Draft JE</Btn>}
                {!resolved[row.key] && <Btn size="sm" variant="ghost" onClick={event => { event.stopPropagation(); resolve(row); }}>Resolve</Btn>}
              </span> },
            ]}
            rows={visible}
            onRow={row => setSelectedId(row.id)}
            empty="No findings in this category."
          />
        </div>
        <div className="card sticky-card">
          <div className="card-h">Finding review</div>
          {selected ? <>
            <div className="muted sm">Source: {selected.source}</div>
            <h3 style={{ margin: '8px 0 6px' }}>{selected.rule}</h3>
            <p>{selected.reason}</p>
            <div className="kv-grid">
              <div><span>Object</span><b>{selected.object}</b></div>
              <div><span>Risk</span><b>{selected.risk}</b></div>
              <div><span>Confidence</span><b>{(selected.conf * 100).toFixed(0)}%</b></div>
              <div><span>Owner</span><b>{selected.owner}</b></div>
              <div><span>Due date</span><b>{selected.due}</b></div>
              <div><span>Review required</span><b>{selected.needs_human ? 'Yes' : 'No'}</b></div>
            </div>
            <h4>Source data</h4>
            <div className="muted sm">{selected.sourceRefs.length ? selected.sourceRefs.join(' / ') : 'No source reference retained.'}</div>
            <h4>Suggested journal entry</h4>
            <div>{suggestedJeSummary(selected.suggestedJe)}</div>
            <h4>Audit trail</h4>
            <ul className="mini-list">
              {(selected.auditTrail || []).map((entry, index) => <li key={index}>{entry.action} <span className="muted">by {entry.actor || 'system'} at {entry.at || 'runtime'}</span></li>)}
            </ul>
            <div className="row-acts" style={{ marginTop: 14 }}>
              {selected.suggestedJe && <Btn variant="primary" onClick={() => createDraft(selected)}>Create Draft JE</Btn>}
              {selected.suggestedJe && /RECLASS|INTEREST|CWIP|CAPITALIZATION/i.test(selected.rule) && <Btn onClick={() => createDraft(selected, 'Draft reclass')}>Create reclass</Btn>}
              {selected.suggestedJe && /PREPAID/i.test(selected.rule) && <Btn onClick={() => { repo.audit(user.user_id, 'AMORTIZATION_REVIEW_OPENED', 'AI_FINDING', selected.key, model.amortizationSchedule.schedule_id); toast('Amortization schedule is ready for review.'); }}>Create amortization schedule</Btn>}
              {!resolved[selected.key] && <Btn variant="ghost" onClick={() => resolve(selected)}>Mark resolved</Btn>}
            </div>
          </> : <StateBlock tone="empty" title="No finding selected">Select a finding to review source data, rationale, suggested JE and audit trail.</StateBlock>}
        </div>
      </div>
    </div>
  );
}
