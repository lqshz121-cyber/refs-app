import React, { useEffect, useRef, useState } from 'react';
import { StateBlock } from './ui.jsx';

export function AuthoritativeJournalTable({ journals, onOpen, openerRefs }) {
  return <section aria-label="Authoritative journal entries">
    <h1>Journal entries</h1>
    <p className="page-subtitle">Read-only list facts returned by the authoritative accounting API.</p>
    {!journals.length ? <StateBlock tone="empty" title="No authoritative journal entries">
      No journal entries were returned for this entity. A scoped empty list is not evidence of zero ledger activity.
    </StateBlock> : <div className="table-scroll"><table className="tbl">
      <thead><tr><th>Journal</th><th>Date</th><th>Type</th><th>Currency</th><th>Status</th><th>Revision</th><th>Ledger lines</th><th>Evidence</th></tr></thead>
      <tbody>{journals.map(row => <tr key={row.journal_entry_id}>
        <td>{row.journal_number}</td><td>{row.journal_date}</td><td>{row.journal_type}</td><td>{row.currency}</td><td>{row.status}</td>
        <td>{row.revision}</td><td>{row.ledger_line_count}</td><td><button ref={node => { if (node) openerRefs.current.set(row.journal_entry_id, node); }} type="button" className="btn btn-sm" onClick={() => onOpen(row)}>Open evidence</button></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

export function AuthoritativeJournalDetail({ journal, entityId, onBack }) {
  return <section className="full-bleed qbo-transaction-report" aria-label="Journal entry evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><span>{entityId} · list revision {journal.revision}</span></div>
    <h1>Journal entry evidence</h1>
    <p className="page-subtitle">Read-only facts returned by the authoritative Journal Entry list API.</p>
    <dl className="evidence-grid">
      <div><dt>Journal</dt><dd>{journal.journal_number}</dd></div><div><dt>Date</dt><dd>{journal.journal_date}</dd></div>
      <div><dt>Type</dt><dd>{journal.journal_type}</dd></div><div><dt>Currency</dt><dd>{journal.currency}</dd></div>
      <div><dt>Status</dt><dd>{journal.status}</dd></div><div><dt>Revision</dt><dd>{journal.revision}</dd></div>
      <div><dt>Ledger line count</dt><dd>{journal.ledger_line_count}</dd></div><div><dt>Created</dt><dd>{journal.created_at}</dd></div>
      <div><dt>Posted</dt><dd>{journal.posted_at || 'Not posted'}</dd></div><div><dt>Description</dt><dd>{journal.description || 'No description returned'}</dd></div>
    </dl>
    <StateBlock tone="blocked" title="Blocked — authoritative lineage unavailable">
      This list read model does not return Journal Lines, Ledger Line IDs, Source Document IDs, mapping decisions, or audit events. It cannot create, edit, submit, review, approve, post, reverse, attach, print, export, or synchronize a journal.
    </StateBlock>
  </section>;
}

export function AuthoritativeJournalWorkspace({ journals, entityId }) {
  const [detail, setDetail] = useState(null);
  const openerRefs = useRef(new Map());
  const restoreId = useRef(null);
  useEffect(() => {
    if (!detail && restoreId.current) {
      openerRefs.current.get(restoreId.current)?.focus();
      restoreId.current = null;
    }
  }, [detail]);
  if (detail) return <AuthoritativeJournalDetail journal={detail} entityId={entityId} onBack={() => { restoreId.current = detail.journal_entry_id; setDetail(null); }}/>;
  return <AuthoritativeJournalTable journals={journals} openerRefs={openerRefs} onOpen={setDetail}/>;
}
