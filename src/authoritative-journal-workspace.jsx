import React, { useEffect, useState } from 'react';
import { StateBlock } from './ui.jsx';
import {AuthoritativeScopeEmpty} from './authoritative-read-state.jsx';
import {readAuthoritativeJournalEntryDetail,readAuthoritativeJournalWorkflowCapabilities,refreshAuthoritativeJournalEntries,transitionAuthoritativeJournal} from './accounting-api.js';
import {AuthoritativeJournalView} from './authoritative-journal-view.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';
import {AuthoritativeSecondaryDisclosure} from './authoritative-secondary-disclosure.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';
import {formatAuthoritativeDate} from './authoritative-scope-presentation.js';
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

const JOURNAL_WORKFLOW_BY_STATUS=Object.freeze({
  DRAFT:Object.freeze({action:'SUBMIT',capability:'can_submit',label:'Submit'}),
  PENDING_REVIEW:Object.freeze({action:'REVIEW',capability:'can_review',label:'Review'}),
  PENDING_APPROVAL:Object.freeze({action:'APPROVE',capability:'can_approve',label:'Approve'}),
  APPROVED:Object.freeze({action:'POST',capability:'can_post',label:'Post'}),
});

export const nextAuthoritativeJournalWorkflowAction=(journal,capabilities,entityId)=>{
  const candidate=JOURNAL_WORKFLOW_BY_STATUS[journal?.status];
  return candidate&&capabilities?.entity_id===entityId&&capabilities[candidate.capability]===true?candidate:null;
};

export async function runAuthoritativeJournalWorkflow({journal,config,fetcher=globalThis.fetch,environment=globalThis}={}){
  const capabilityRead=await readAuthoritativeJournalWorkflowCapabilities({config,fetcher});
  if(!capabilityRead.ok)return capabilityRead;
  const next=nextAuthoritativeJournalWorkflowAction(journal,capabilityRead.capabilities,config?.entityId);
  if(!next)return {ok:false,code:'JOURNAL_WORKFLOW_NOT_AUTHORIZED',message:'The current authenticated actor is not authorized for this Journal status.'};
  if(typeof environment?.confirm!=='function')return {ok:false,code:'JOURNAL_WORKFLOW_CONFIRMATION_UNAVAILABLE',message:'An explicit browser confirmation is required before a Journal workflow command.'};
  if(!environment.confirm(`${next.label} Journal ${journal.journal_number} at revision ${journal.revision}?`))return {ok:false,cancelled:true,code:'JOURNAL_WORKFLOW_CANCELLED',message:'Journal workflow action cancelled.'};
  const result=await transitionAuthoritativeJournal({config,journalEntryId:journal.journal_entry_id,revision:journal.revision,action:next.action,fetcher});
  if(!result.ok)return result;
  const refreshed=await refreshAuthoritativeJournalEntries({config,fetcher});
  if(!refreshed.ok)return {ok:false,commandCommitted:true,code:'JOURNAL_WORKFLOW_REFRESH_REQUIRED',message:'The workflow command completed, but the authoritative Journal register could not be re-read. Refresh before taking another action.'};
  return {ok:true,action:next.action,journals:refreshed.journals};
}

// Captured presentation context only; never reconstruct scope from the
// rendered journal row.
const journalReturnScope = (entityId, journal, context) => [
  'Configured entity',
  `detail period ${context?.periodLabel || 'Unavailable'}`,
  `authoritative list revision ${journal.revision}`,
  `search ${context?.view?.query || 'All'}`,
  `status ${context?.view?.status === 'ALL' || !context?.view?.status ? 'All statuses' : context.view.status}`,
  `from ${context?.view?.from ? formatAuthoritativeDate(context.view.from) : 'Any date'}`,
  `through ${context?.view?.through ? formatAuthoritativeDate(context.view.through) : 'Any date'}`,
  `page ${context?.view?.page || 1}`,
].join(' | ');

const journalMatchesReturnContext = (journal, entityId, context) => Boolean(
  journal?.journal_entry_id
  && Number.isSafeInteger(journal?.revision)
  && context?.entityId === entityId
  && context?.journalId === journal.journal_entry_id
  && context?.journalRevision === journal.revision
  && context?.periodId === journal.period_id
  && context?.journalCurrency === journal.currency
);

export function AuthoritativeJournalTable({ journals = [], entityId=null, view = DEFAULT_AUTHORITATIVE_LIST_VIEW, onViewChange, onOpen, capabilities=null, onWorkflowAction, workflowState=null }) {
  const filtered=filterAuthoritativeRows(journals,view,'journal_date');
  const page=paginateAuthoritativeRows(filtered,view);
  const statuses=[...new Set(journals.map(row=>row.status).filter(Boolean))].sort();
  const queueCounts=journalQueueCounts(journals);
  const change=patch=>onViewChange?.({...view,...patch,page:patch.page??1});
  const setQueue=status=>change({status});
  return <AuthoritativeJournalView>
    <div className="authoritative-workbench-rail" aria-label="Journal workspace structure">
      <span><b>1</b> Register</span><span><b>2</b> Scoped evidence</span><span><b>3</b> Exact Back</span>
    </div>
    <section className="authoritative-journal-summary" aria-label="Journal entry queue summary">
      <button type="button" className={`journal-summary-card ${view.status==='ALL'?'journal-summary-card-on':''}`} aria-pressed={view.status==='ALL'} onClick={()=>setQueue('ALL')}><span>Entity register</span><b>{queueCounts.all}</b><small>All retained journals for this entity</small></button>
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
    {!page.total ? journals.length?<StateBlock tone="empty" title="No journal entries match these presentation filters">Change a presentation filter to see retained list facts. A local no-match is not evidence of zero ledger activity.</StateBlock>:<AuthoritativeScopeEmpty subject="Journal entries" requiresPosted/> : <div className="table-wrap authoritative-journal-table" tabIndex={0} aria-label="Journal entry list; scroll horizontally to view every column"><table className="tbl">
      <thead><tr><th>Journal</th><th>Date</th><th>Memo / description</th><th>Type</th><th>Currency</th><th>Status</th><th>Ledger lines</th><th>Evidence</th><th>Workflow</th></tr></thead>
      <tbody>{page.rows.map(row => {const next=nextAuthoritativeJournalWorkflowAction(row,capabilities,entityId),busy=workflowState?.journalEntryId===row.journal_entry_id&&workflowState.phase==='RUNNING';return <tr key={row.journal_entry_id}>
        <td><b>{row.journal_number}</b><small className="journal-row-revision">Revision {row.revision}</small></td><td>{formatAuthoritativeDate(row.journal_date)}</td><td className="journal-row-description">{row.description||'No description returned'}</td><td>{row.journal_type}</td><td>{row.currency}</td><td><span className="badge">{row.status}</span></td>
        <td>{row.ledger_line_count}</td><td><button id={`authoritative-journal-${row.journal_entry_id}`} type="button" className="btn btn-sm" onClick={() => onOpen(row,`authoritative-journal-${row.journal_entry_id}`)}>Open evidence</button></td>
        <td>{next?<button type="button" className="btn btn-sm" disabled={busy} aria-disabled={busy} onClick={()=>onWorkflowAction?.(row,next)}>{busy?`${next.label}...`:next.label}</button>:<span className="muted sm">Not available</span>}</td>
      </tr>;})}</tbody>
    </table></div>}
    {page.pageCount>1&&<nav className="pagination" aria-label="Journal entry pages"><button type="button" disabled={page.page===1} onClick={()=>change({page:page.page-1})}>Previous</button><span>Page {page.page} of {page.pageCount}</span><button type="button" disabled={page.page===page.pageCount} onClick={()=>change({page:page.page+1})}>Next</button></nav>}
  </AuthoritativeJournalView>;
}

export function AuthoritativeJournalDetail({journal,entityId,returnContext,onBack}) {
  const scopeMatches=journalMatchesReturnContext(journal,entityId,returnContext);
  const lines=Array.isArray(journal?.lines)?journal.lines:[];
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-journal-detail" aria-label="Journal entry evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><details className="authoritative-return-context"><summary>List filters retained</summary><span>{journalReturnScope(entityId,journal,returnContext)}</span></details></div>
    <header className="journal-evidence-header"><div><div className="authoritative-eyebrow">GENERAL LEDGER | EXACT READ EVIDENCE</div><h1>Journal entry {journal.journal_number}</h1><p className="page-subtitle">GET-only facts returned for the frozen entity, period, Journal Entry identity, revision, and currency.</p></div><span className={`badge ${scopeMatches?'journal-detail-status':'badge-danger'}`}>{scopeMatches?journal.status:'BLOCKED'}</span></header>
    {!scopeMatches?<StateBlock tone="blocked" title="BLOCKED - immutable Journal scope mismatch">The detail does not match the entity, period, Journal ID, revision, and currency frozen in its parent return context. No line, ledger, or source evidence is asserted.</StateBlock>:<>
      <section className="journal-evidence-scope" aria-label="Journal evidence scope"><span><b>Entity</b>Configured entity</span><span><b>Period</b>{returnContext?.periodLabel||'Period unavailable'}</span><span><b>Currency</b>{journal.currency}</span><span><b>Revision</b>{journal.revision}</span><span><b>Journal date</b>{formatAuthoritativeDate(journal.journal_date)}</span></section><details className="authoritative-scope-identifiers"><summary>Scope identifiers</summary><dl><div><dt>Entity ID</dt><dd>{entityId}</dd></div><div><dt>Period ID</dt><dd>{journal.period_id}</dd></div></dl></details>
      <dl className="evidence-grid journal-evidence-grid"><div><dt>Journal</dt><dd>{journal.journal_number}</dd></div><div><dt>Journal ID</dt><dd>{journal.journal_entry_id}</dd></div><div><dt>Date</dt><dd>{formatAuthoritativeDate(journal.journal_date)}</dd></div><div><dt>Type</dt><dd>{journal.journal_type}</dd></div><div><dt>Status</dt><dd>{journal.status}</dd></div><div><dt>Revision</dt><dd>{journal.revision}</dd></div><div><dt>Journal line count</dt><dd>{lines.length}</dd></div><div><dt>Created</dt><dd>{formatAuthoritativeDate(journal.created_at)}</dd></div><div><dt>Posted</dt><dd>{journal.posted_at?formatAuthoritativeDate(journal.posted_at):'Not posted'}</dd></div><div><dt>Description</dt><dd>{journal.description||'No description returned'}</dd></div></dl>
      <section className="authoritative-journal-line-evidence" aria-label="Authoritative journal line evidence"><div className="authoritative-section-heading"><div><div className="authoritative-eyebrow">EXACT API LINE FACTS</div><h2>Journal lines</h2><p className="page-subtitle">Ordered Journal Line facts. Ledger Line IDs appear only for actually posted lines.</p></div><span className="badge">{lines.length} retained lines</span></div>
        <div className="table-wrap authoritative-journal-line-table" tabIndex={0} aria-label="Journal line evidence; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Line</th><th>Account</th><th>Debit</th><th>Credit</th><th>Member</th><th>Dimensions</th><th>Description</th><th>Journal line ID</th><th>Ledger line ID</th><th>Source document IDs</th></tr></thead><tbody>{lines.map(line=><tr key={line.journal_line_id}><td>{line.line_no}</td><td>{line.account_code}</td><td>{line.debit_amount}</td><td>{line.credit_amount}</td><td>{line.member_ref||'None returned'}</td><td>{Object.keys(line.dimensions).length?JSON.stringify(line.dimensions):'None returned'}</td><td>{line.description||'None returned'}</td><td>{line.journal_line_id}</td><td>{line.ledger_line_id||'Not posted'}</td><td>{line.source_document_ids.length?line.source_document_ids.join(', '):'None returned'}</td></tr>)}</tbody></table></div>
      </section><StateBlock tone="blocked" title="No write or inferred drill authority">This evidence view cannot create, edit, submit, review, approve, post, reverse, or reconstruct a source link.</StateBlock>
    </>}
  </section>;
}

const JournalDetailReadState=({detail,entityId,config,fetcher,onBack})=>{
  if(detail.phase==='READY')return <AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'JOURNAL',journal:detail.evidence,context:{entityId:config.entityId,periodId:config.periodId,journalId:detail.evidence.journal_entry_id,journalRevision:detail.evidence.revision,journalCurrency:detail.evidence.currency}}} onExit={onBack}/>;
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-journal-detail" aria-label="Journal entry evidence"><div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Journal entries</button><details className="authoritative-return-context"><summary>List filters retained</summary><span>{journalReturnScope(entityId,detail.journal,detail.returnContext)}</span></details></div><StateBlock tone={detail.phase==='LOADING'?'loading':'blocked'} title={detail.phase==='LOADING'?'Loading exact Journal evidence':'Authoritative Journal detail unavailable'}>{detail.phase==='LOADING'?'Reading the exact entity, period, and Journal Entry scope.':detail.error?.message||'The exact read failed closed; no list facts are promoted to line evidence.'}</StateBlock></section>;
};

export function AuthoritativeJournalWorkspace({ journals, config, fetcher=globalThis.fetch, environment=globalThis }) {
  const [detail, setDetail] = useState(null);
  const [view,setView] = useState({...DEFAULT_AUTHORITATIVE_LIST_VIEW});
  const [rows,setRows]=useState(journals||[]);
  const [capabilityState,setCapabilityState]=useState({phase:'LOADING',data:null,error:null});
  const [workflowState,setWorkflowState]=useState(null);
  useEffect(()=>setRows(journals||[]),[journals]);
  useEffect(()=>{let current=true;setCapabilityState({phase:'LOADING',data:null,error:null});readAuthoritativeJournalWorkflowCapabilities({config,fetcher}).then(result=>{if(current)setCapabilityState(result.ok?{phase:'READY',data:result.capabilities,error:null}:{phase:'BLOCKED',data:null,error:result});});return()=>{current=false;};},[config,fetcher]);
  const runWorkflow=async(journal,next)=>{
    setWorkflowState({phase:'RUNNING',journalEntryId:journal.journal_entry_id,action:next.action});
    const result=await runAuthoritativeJournalWorkflow({journal,config,fetcher,environment});
    if(result.cancelled){setWorkflowState(null);return;}
    if(!result.ok){setWorkflowState({phase:'ERROR',journalEntryId:journal.journal_entry_id,message:result.message});return;}
    setRows(result.journals);setWorkflowState({phase:'DONE',journalEntryId:journal.journal_entry_id,action:result.action});
  };
  const openEvidence=async(journal,focusId)=>{
    const returnContext=createAuthoritativeReturnContext({config,view,focusId,scrollY:Number(environment?.scrollY)||0});
    if(!returnContext)return;
    const frozenContext={...returnContext,periodLabel:config?.scopePresentation?.periodLabel||'Period unavailable',journalId:journal.journal_entry_id,journalRevision:journal.revision,journalCurrency:journal.currency};
    setDetail({phase:'LOADING',journal,returnContext:frozenContext});
    const result=await readAuthoritativeJournalEntryDetail({config,journalEntryId:journal.journal_entry_id,fetcher});
    setDetail(result.ok?{phase:'READY',journal,evidence:result.journal,returnContext:frozenContext}:{phase:'ERROR',journal,error:result,returnContext:frozenContext});
  };
  if (detail) return <JournalDetailReadState detail={detail} entityId={config.entityId} config={config} fetcher={fetcher} onBack={() => { setView(detail.returnContext.view); setDetail(null); restoreAuthoritativeReturnContext(environment,config,detail.returnContext); }}/>;
  return <div className="stack authoritative-journal-workspace">{capabilityState.phase==='LOADING'&&<StateBlock tone="loading" title="Checking Journal workflow access">Reading the current actor's fixed entity-scoped permissions. No action is available while this read is pending.</StateBlock>}{capabilityState.phase==='BLOCKED'&&<StateBlock tone="blocked" title="Journal workflow access unavailable">{capabilityState.error?.message||'The capability read failed closed. No Journal workflow action is available.'}</StateBlock>}<AuthoritativeJournalTable journals={rows} entityId={config.entityId} view={view} onViewChange={setView} onOpen={openEvidence} capabilities={capabilityState.phase==='READY'?capabilityState.data:null} onWorkflowAction={runWorkflow} workflowState={workflowState}/>{workflowState?.phase==='ERROR'&&<StateBlock tone="blocked" title="Journal workflow action unavailable">{workflowState.message}</StateBlock>}{workflowState?.phase==='DONE'&&<StateBlock tone="empty" title="Authoritative Journal register refreshed">{workflowState.action} completed and the entity-scoped Journal register was re-read.</StateBlock>}<AuthoritativeSecondaryDisclosure label="External WBS evidence"><AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.journal} title="External WBS journal observations"/></AuthoritativeSecondaryDisclosure></div>;
}
