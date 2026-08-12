import React, { useState } from 'react';
import { StateBlock } from './ui.jsx';
import {AuthoritativeDemoJournalView} from './authoritative-demo-journal-view.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';
import {
  DEFAULT_AUTHORITATIVE_LIST_VIEW,
  createAuthoritativeReturnContext,
  filterAuthoritativeRows,
  paginateAuthoritativeRows,
  restoreAuthoritativeReturnContext,
} from './authoritative-list-context.js';

const journalQueueCounts = journals => ({
  all:(journals || []).length,
  draft:(journals || []).filter(row => row.status === 'DRAFT').length,
  review:(journals || []).filter(row => ['PENDING_REVIEW', 'PENDING_APPROVAL'].includes(row.status)).length,
  posted:(journals || []).filter(row => row.status === 'POSTED').length,
});

// Captured presentation context only; never reconstruct scope from the
// rendered journal row.
const journalReturnScope = (entityId, journal, view) => [
  `Entity ${entityId}`,
  `authoritative list revision ${journal.revision}`,
  `search ${view?.query || 'All'}`,
  `status ${view?.status === 'ALL' || !view?.status ? 'All statuses' : view.status}`,
  `from ${view?.from || 'Any date'}`,
  `through ${view?.through || 'Any date'}`,
  `page ${view?.page || 1}`,
].join(' | ');

const journalMatchesReturnContext = (journal, entityId, context) => Boolean(
  journal?.journal_entry_id
  && Number.isSafeInteger(journal?.revision)
  && context?.entityId === entityId
  && context?.journalId === journal.journal_entry_id
  && context?.journalRevision === journal.revision,
);

export function AuthoritativeJournalTable({ journals = [], view = DEFAULT_AUTHORITATIVE_LIST_VIEW, onViewChange, onOpen }) {
  const filtered=filterAuthoritativeRows(journals,view,'journal_date');
  const page=paginateAuthoritativeRows(filtered,view);
  const statuses=[...new Set(journals.map(row=>row.status).filter(Boolean))].sort();
  const queueCounts=journalQueueCounts(journals);
  const change=patch=>onViewChange?.({...view,...patch,page:patch.page??1});
  const setQueue=status=>change({status});
  return <AuthoritativeDemoJournalView>
    <div className="authoritative-workbench-rail" aria-label="Journal workspace structure">
      <span><b>1</b> Register</span><span><b>2</b> Scoped evidence</span><span><b>3</b> Exact Back</span>
    </div>
    <section className="authoritative-journal-summary" aria-label="Journal entry queue summary">
      <button type="button" className={`journal-summary-card ${view.status==='ALL'?'journal-summary-card-on':''}`} aria-pressed={view.status==='ALL'} onClick={()=>setQueue('ALL')}><span>In scope</span><b>{queueCounts.all}</b><small>All retained journals</small></button>
      <button type="button" className={`journal-summary-card ${view.status==='DRAFT'?'journal-summary-card-on':''}`} aria-pressed={view.status==='DRAFT'} onClick={()=>setQueue('DRAFT')}><span>Draft</span><b>{queueCounts.draft}</b><small>Not posted</small></button>
      <button type="button" className={`journal-summary-card ${view.status==='REVIEW_REQUIRED'?'journal-summary-card-on':''}`} aria-pressed={view.status==='REVIEW_REQUIRED'} onClick={()=>setQueue('REVIEW_REQUIRED')}><span>Needs review</span><b>{queueCounts.review}</b><small>Retained status only</small></button>
      <button type="button" className={`journal-summary-card ${view.status==='POSTED'?'journal-summary-card-on':''}`} aria-pressed={view.status==='POSTED'} onClick={()=>setQueue('POSTED')}><span>Posted</span><b>{queueCounts.posted}</b><small>API list status</small></button>
    </section>
    <div className="filter-bar authoritative-list-filters" role="search" aria-label="Journal entry presentation filters">
      <label>Search <input value={view.query||''} onChange={event=>change({query:event.target.value})} placeholder="Journal number or description"/></label>
      <label>Status <select value={view.status||'ALL'} onChange={event=>change({status:event.target.value})}><option value="ALL">All statuses</option><option value="REVIEW_REQUIRED">Needs review</option>{statuses.map(status=><option key={status} value={status}>{status}</option>)}</select></label>
      <label>From <input type="date" value={view.from||''} onChange={event=>change({from:event.target.value})}/></label>
      <label>Through <input type="date" value={view.through||''} onChange={event=>change({through:event.target.value})}/></label>
      <span className="result-count" aria-live="polite">{page.total} matching journal entries</span>
      <button type="button" className="btn btn-sm btn-ghost" onClick={()=>onViewChange?.({...DEFAULT_AUTHORITATIVE_LIST_VIEW})}>Clear filters</button>
    </div>
    {!page.total ? <StateBlock tone="empty" title={journals.length?'No journal entries match these presentation filters':'No authoritative journal entries in this scope'}>
      {journals.length?'Change a presentation filter to see retained list facts. A local no-match is not evidence of zero ledger activity.':'No journal entries were returned for this entity. A scoped empty list is not evidence of zero ledger activity.'}
    </StateBlock> : <div className="table-wrap authoritative-journal-table" tabIndex={0} aria-label="Journal entry list; scroll horizontally to view every column"><table className="tbl">
      <thead><tr><th>Journal</th><th>Date</th><th>Memo / description</th><th>Type</th><th>Currency</th><th>Status</th><th>Ledger lines</th><th>Evidence</th></tr></thead>
      <tbody>{page.rows.map(row => <tr key={row.journal_entry_id}>
        <td><b>{row.journal_number}</b><small className="journal-row-revision">Revision {row.revision}</small></td><td>{row.journal_date}</td><td className="journal-row-description">{row.description||'No description returned'}</td><td>{row.journal_type}</td><td>{row.currency}</td><td><span className="badge">{row.status}</span></td>
        <td>{row.ledger_line_count}</td><td><button id={`authoritative-journal-${row.journal_entry_id}`} type="button" className="btn btn-sm" onClick={() => onOpen(row,`authoritative-journal-${row.journal_entry_id}`)}>Open evidence</button></td>
      </tr>)}</tbody>
    </table></div>}
    {page.pageCount>1&&<nav className="pagination" aria-label="Journal entry pages"><button type="button" disabled={page.page===1} onClick={()=>change({page:page.page-1})}>Previous</button><span>Page {page.page} of {page.pageCount}</span><button type="button" disabled={page.page===page.pageCount} onClick={()=>change({page:page.page+1})}>Next</button></nav>}
  </AuthoritativeDemoJournalView>;
}

export function AuthoritativeJournalDetail({ journal, entityId, returnContext, onBack }) {
  const scopeMatches = journalMatchesReturnContext(journal, entityId, returnContext);
  const lineEvidence=Array.isArray(journal.line_evidence)?journal.line_evidence:null;
  if (!scopeMatches) return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-journal-detail" aria-label="Journal entry evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><span>{journalReturnScope(entityId, journal, returnContext?.view)}</span></div>
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER | RETAINED EVIDENCE</div><h1>Journal entry {journal.journal_number}</h1><p className="page-subtitle">Read-only facts returned by the authoritative Journal Entry list API.</p></div><span className="badge badge-danger">BLOCKED</span></header>
    <StateBlock tone="blocked" title="BLOCKED — immutable Journal scope mismatch">The journal row does not match the entity, Journal ID, and revision retained in its parent return context. It remains visible for review, but cannot support a line, ledger, source, or workflow drill.</StateBlock>
  </section>;
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-journal-detail" aria-label="Journal entry evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><span>{journalReturnScope(entityId, journal, returnContext?.view)}</span></div>
    <header className="journal-evidence-header">
      <div><div className="authoritative-eyebrow">GENERAL LEDGER | RETAINED EVIDENCE</div><h1>Journal entry {journal.journal_number}</h1><p className="page-subtitle">Read-only facts returned by the authoritative Journal Entry list API.</p></div>
      <span className="badge journal-detail-status">{journal.status}</span>
    </header>
    <section className="journal-evidence-scope" aria-label="Journal evidence scope"><span><b>Entity</b>{entityId}</span><span><b>Currency</b>{journal.currency}</span><span><b>List revision</b>{journal.revision}</span><span><b>Scope date</b>{journal.journal_date}</span></section>
    <dl className="evidence-grid journal-evidence-grid">
      <div><dt>Journal</dt><dd>{journal.journal_number}</dd></div><div><dt>Journal ID</dt><dd>{journal.journal_entry_id}</dd></div><div><dt>Date</dt><dd>{journal.journal_date}</dd></div>
      <div><dt>Type</dt><dd>{journal.journal_type}</dd></div><div><dt>Currency</dt><dd>{journal.currency}</dd></div>
      <div><dt>Status</dt><dd>{journal.status}</dd></div><div><dt>Revision</dt><dd>{journal.revision}</dd></div>
      <div><dt>Ledger line count</dt><dd>{journal.ledger_line_count}</dd></div><div><dt>Created</dt><dd>{journal.created_at}</dd></div>
      <div><dt>Posted</dt><dd>{journal.posted_at || 'Not posted'}</dd></div><div><dt>Description</dt><dd>{journal.description || 'No description returned'}</dd></div>
    </dl>
    {lineEvidence ? <section className="authoritative-journal-line-evidence" aria-label="Authoritative journal line evidence">
      <div className="authoritative-section-heading"><div><div className="authoritative-eyebrow">EXACT API LINE FACTS</div><h2>Journal lines</h2><p className="page-subtitle">Only immutable line and ledger identifiers returned by the same authoritative Journal Entry read are shown.</p></div><span className="badge">{lineEvidence.length} retained lines</span></div>
      <div className="table-wrap authoritative-journal-line-table" tabIndex={0} aria-label="Journal line evidence; scroll horizontally to view every column"><table className="tbl">
        <thead><tr><th>Line</th><th>Account</th><th>Debit</th><th>Credit</th><th>Member reference</th><th>Description</th><th>Journal line ID</th><th>Ledger line ID</th><th>Source documents</th></tr></thead>
        <tbody>{lineEvidence.map(line=><tr key={line.journal_line_id}><td>{line.line_no}</td><td>{line.account_code}</td><td>{line.debit_amount}</td><td>{line.credit_amount}</td><td>{line.member_ref||'—'}</td><td>{line.description||'—'}</td><td>{line.journal_line_id}</td><td>{line.ledger_line_id}</td><td>{line.source_document_ids.length?line.source_document_ids.join(', '):'None returned'}</td></tr>)}</tbody>
      </table></div>
    </section> : <StateBlock tone="blocked" title="Authoritative journal line evidence unavailable">
      This Journal Entry list response does not carry exact Journal Lines, Ledger Line IDs, or Source Document IDs. No line values, account mappings, or source links are reconstructed from browser state.
    </StateBlock>}
    <StateBlock tone="blocked" title="Authoritative lineage unavailable">
      This read model does not return mapping decisions or audit events. It cannot create, edit, submit, review, approve, post, reverse, attach, print, export, or synchronize a journal.
    </StateBlock>
  </section>;
}

export function AuthoritativeJournalWorkspace({ journals, config, fetcher=globalThis.fetch, environment=globalThis }) {
  const [detail, setDetail] = useState(null);
  const [view,setView] = useState({...DEFAULT_AUTHORITATIVE_LIST_VIEW});
  const openEvidence=(journal,focusId)=>{
    const returnContext=createAuthoritativeReturnContext({config,view,focusId,scrollY:Number(environment?.scrollY)||0});
    if(returnContext)setDetail({journal,returnContext:{...returnContext,journalId:journal.journal_entry_id,journalRevision:journal.revision}});
  };
  if (detail) return <AuthoritativeJournalDetail journal={detail.journal} entityId={config.entityId} returnContext={detail.returnContext} onBack={() => { setView(detail.returnContext.view); setDetail(null); restoreAuthoritativeReturnContext(environment,config,detail.returnContext); }}/>;
  return <div className="stack authoritative-journal-workspace"><AuthoritativeJournalTable journals={journals} view={view} onViewChange={setView} onOpen={openEvidence}/><AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.journal} title="External WBS journal observations"/></div>;
}
