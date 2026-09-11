import React,{useMemo} from 'react';
import {AuthoritativeAiAccountingDecisionWorkbench} from './authoritative-ai-accounting-decision-workbench.jsx';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {formatAuthoritativeDate} from './authoritative-scope-presentation.js';
import {StateBlock} from './ui.jsx';

const ACTIONABLE_JOURNAL_STATUSES=Object.freeze(['DRAFT','PENDING_REVIEW','PENDING_APPROVAL','APPROVED']);
const JOURNAL_STATUS_PRIORITY=Object.freeze({PENDING_APPROVAL:0,PENDING_REVIEW:1,APPROVED:2,DRAFT:3});

export const actionRequiredJournals=journals=>(Array.isArray(journals)?journals:[])
  .filter(row=>ACTIONABLE_JOURNAL_STATUSES.includes(row?.status)&&typeof row?.journal_entry_id==='string'&&row.journal_entry_id)
  .sort((left,right)=>(JOURNAL_STATUS_PRIORITY[left.status]??99)-(JOURNAL_STATUS_PRIORITY[right.status]??99)
    ||String(left.journal_date||'').localeCompare(String(right.journal_date||''))
    ||String(left.journal_number||'').localeCompare(String(right.journal_number||'')));

export function AuthoritativeActionRequiredWorkspace({journals=[],config,fetcher=globalThis.fetch,onAccountingRefresh,onOpenJournalWorkflow}){
  const rows=useMemo(()=>actionRequiredJournals(journals),[journals]);
  return <AuthoritativeWorkspaceView area="Action required">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - ACCOUNTING CONTROL CENTER" title="Action required" description="Review current Journal workflow items and retained AI accounting decisions for this company and period." status="HUMAN WORKFLOW"/>
    <section className="card" aria-label="Journal entries requiring action">
      <div className="card-head"><div><h2>Journal workflow queue</h2><p className="muted sm">Open an entry to re-read its current server state and your exact workflow capabilities before any action is offered.</p></div><span className="badge badge-muted">{rows.length} WAITING</span></div>
      <p className="muted sm" aria-label="Journal workflow authority boundary">CURRENT API EVIDENCE | SERVER-READ PERMISSIONS | EXPLICIT HUMAN ACTION</p>
      {rows.length===0?<StateBlock tone="cleared" title="No Journal entries are waiting for workflow action">The current Journal register contains no Draft, review, approval, or posting queue item. This does not prove that the period is complete or ready to close.</StateBlock>:<div className="table-wrap" role="region" tabIndex={0} aria-label="Journal workflow queue; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Journal</th><th>Date</th><th>Description</th><th>Type</th><th>Status</th><th>Revision</th><th>Workflow</th></tr></thead><tbody>{rows.map(row=><tr key={row.journal_entry_id}><td><b>{row.journal_number||'Number unavailable'}</b></td><td>{formatAuthoritativeDate(row.journal_date)}</td><td>{row.description||'No description returned'}</td><td>{row.journal_type||'Type unavailable'}</td><td><span className="badge">{row.status}</span></td><td>{Number.isSafeInteger(row.revision)?row.revision:'Unavailable'}</td><td><button type="button" className="btn btn-sm" onClick={()=>onOpenJournalWorkflow?.(row)}>Open Journal workflow</button></td></tr>)}</tbody></table></div>}
    </section>
    <AuthoritativeAiAccountingDecisionWorkbench config={config} fetcher={fetcher} onAccountingRefresh={onAccountingRefresh} onOpenJournalWorkflow={onOpenJournalWorkflow}/>
  </AuthoritativeWorkspaceView>;
}
