import React, { useState } from 'react';
import { StateBlock } from './ui.jsx';
import {
  DEFAULT_AUTHORITATIVE_LIST_VIEW,
  createAuthoritativeReturnContext,
  filterAuthoritativeRows,
  paginateAuthoritativeRows,
  restoreAuthoritativeReturnContext,
} from './authoritative-list-context.js';

export function AuthoritativeJournalTable({ journals, view=DEFAULT_AUTHORITATIVE_LIST_VIEW, onViewChange, onOpen }) {
  const filtered=filterAuthoritativeRows(journals,view,'journal_date');
  const page=paginateAuthoritativeRows(filtered,view);
  const statuses=[...new Set((journals||[]).map(row=>row.status).filter(Boolean))].sort();
  const change=patch=>onViewChange?.({...view,...patch,page:patch.page??1});
  return <section aria-label="Authoritative journal entries">
    <h1>Journal entries</h1>
    <p className="page-subtitle">Read-only list facts returned by the authoritative accounting API.</p>
    <div className="filter-bar authoritative-list-filters" role="search" aria-label="Journal entry presentation filters">
      <label>Search <input value={view.query||''} onChange={event=>change({query:event.target.value})} placeholder="Journal number or description"/></label>
      <label>Status <select value={view.status||'ALL'} onChange={event=>change({status:event.target.value})}><option value="ALL">All statuses</option>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>
      <label>From <input type="date" value={view.from||''} onChange={event=>change({from:event.target.value})}/></label>
      <label>Through <input type="date" value={view.through||''} onChange={event=>change({through:event.target.value})}/></label>
      <span className="result-count" aria-live="polite">{page.total} journal entries</span>
    </div>
    {!page.total ? <StateBlock tone="empty" title={journals.length?'No journal entries match these presentation filters':'No authoritative journal entries in this scope'}>
      {journals.length?'Change a presentation filter to see retained list facts. A local no-match is not evidence of zero ledger activity.':'No journal entries were returned for this entity. A scoped empty list is not evidence of zero ledger activity.'}
    </StateBlock> : <div className="table-scroll"><table className="tbl">
      <thead><tr><th>Journal</th><th>Date</th><th>Type</th><th>Currency</th><th>Status</th><th>Revision</th><th>Ledger lines</th><th>Evidence</th></tr></thead>
      <tbody>{page.rows.map(row => <tr key={row.journal_entry_id}>
        <td>{row.journal_number}</td><td>{row.journal_date}</td><td>{row.journal_type}</td><td>{row.currency}</td><td>{row.status}</td>
        <td>{row.revision}</td><td>{row.ledger_line_count}</td><td><button id={`authoritative-journal-${row.journal_entry_id}`} type="button" className="btn btn-sm" onClick={() => onOpen(row,`authoritative-journal-${row.journal_entry_id}`)}>Open evidence</button></td>
      </tr>)}</tbody>
    </table></div>}
    {page.pageCount>1&&<nav className="pagination" aria-label="Journal entry pages"><button type="button" disabled={page.page===1} onClick={()=>change({page:page.page-1})}>Previous</button><span>Page {page.page} of {page.pageCount}</span><button type="button" disabled={page.page===page.pageCount} onClick={()=>change({page:page.page+1})}>Next</button></nav>}
  </section>;
}

export function AuthoritativeJournalDetail({ journal, entityId, returnContext, onBack }) {
  return <section className="full-bleed qbo-transaction-report" aria-label="Journal entry evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><span>{entityId} · list revision {journal.revision} · query {returnContext?.view?.query||'All'} · page {returnContext?.view?.page||1}</span></div>
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

export function AuthoritativeJournalWorkspace({ journals, config, environment=globalThis }) {
  const [detail, setDetail] = useState(null);
  const [view,setView] = useState({...DEFAULT_AUTHORITATIVE_LIST_VIEW});
  const openEvidence=(journal,focusId)=>{
    const returnContext=createAuthoritativeReturnContext({config,view,focusId,scrollY:Number(environment?.scrollY)||0});
    if(returnContext)setDetail({journal,returnContext});
  };
  if (detail) return <AuthoritativeJournalDetail journal={detail.journal} entityId={config.entityId} returnContext={detail.returnContext} onBack={() => { setView(detail.returnContext.view); setDetail(null); restoreAuthoritativeReturnContext(environment,config,detail.returnContext); }}/>;
  return <AuthoritativeJournalTable journals={journals} view={view} onViewChange={setView} onOpen={openEvidence}/>;
}
