import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { accountingApiConfig, refreshAuthoritativeDocuments, refreshAuthoritativeJournalEntries, transitionAuthoritativeJournal } from './accounting-api.js';
import { BrowserOidcClient, oidcRuntimeConfig } from './oidc-client.js';
import { nextAuthoritativeWorkflowAction } from './authoritative-workflow.js';
import { AuthoritativeBankWorkspace, AuthoritativeReconciliationWorkspace } from './authoritative-bank-workspace.jsx';
import { AuthoritativeReportsWorkspace } from './authoritative-reports-workspace.jsx';
import {
  AuthoritativeAdjustmentSummary,
  AuthoritativeDocumentTable,
  AuthoritativeDraftForm,
  AuthoritativeRuntimeLock,
  AuthoritativeWorkflowAdjustmentTable,
  AuthoritativeWorkflowTable,
} from './authoritative-workspace.jsx';

export const authoritativeRuntimeConfigured = (environment = globalThis) =>
  Boolean(accountingApiConfig(environment) && oidcRuntimeConfig(environment));

const NAV_ITEMS = Object.freeze([
  ['overview', 'Overview', 'home'], ['payables', 'Payables', 'payables'],
  ['receivables', 'Receivables', 'receivables'], ['bank', 'Banking', 'bank'],
  ['reconciliation', 'Reconcile', 'reconcile'], ['reports', 'Reports', 'reports'],
  ['journals', 'Journal entries', 'journal'], ['drafts', 'New journal entry', 'plus'],
]);

const NavIcon = ({ name }) => {
  const common = { viewBox:'0 0 24 24', width:'18', height:'18', fill:'none', stroke:'currentColor', strokeWidth:'1.8', strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true };
  const paths = {
    home:<><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M9 21v-7h6v7"/></>,
    payables:<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></>,
    receivables:<><path d="M3 7h18v11H3z"/><path d="M3 10h18M7 15h3"/></>,
    bank:<><rect x="3" y="9" width="18" height="11" rx="1"/><path d="M2 9 12 3l10 6M7 14h.01M17 14h.01"/></>,
    reconcile:<><path d="M20 7V4m0 0h-3m3 0-4 4a7 7 0 1 0 1.4 6"/><path d="m9 13 2 2 4-5"/></>,
    reports:<><path d="M4 20V10m6 10V4m6 16v-7m4 7H2"/></>,
    journal:<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 3v4h6V3M8 12h8M8 16h5"/></>,
    plus:<><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></>,
  };
  return <svg {...common}>{paths[name] || paths.home}</svg>;
};

const ErrorState = ({ code, message, onRetry }) => <section className="empty" role="alert">
  <h2>{code || 'AUTHORITATIVE_RUNTIME_UNAVAILABLE'}</h2>
  <p>{message || 'The authoritative accounting service could not be loaded.'}</p>
  {onRetry && <button type="button" className="btn btn-primary" onClick={onRetry}>Retry</button>}
</section>;

const JournalTable = ({ journals, workingJournalIds, onWorkflow }) => <section aria-label="Authoritative journal entries">
  <h2>Journal entries</h2>
  <table className="tbl">
    <thead><tr><th>Journal</th><th>Date</th><th>Type</th><th>Status</th><th>Revision</th><th>Ledger lines</th><th>Action</th></tr></thead>
    <tbody>{journals.map(row => {
      const action = nextAuthoritativeWorkflowAction(row.status);
      return <tr key={row.journal_entry_id}>
        <td>{row.journal_number}</td><td>{row.journal_date}</td><td>{row.journal_type}</td><td>{row.status}</td>
        <td>{row.revision}</td><td>{row.ledger_line_count}</td>
        <td>{action ? <button type="button" className="btn btn-sm" disabled={workingJournalIds.has(row.journal_entry_id)} onClick={() => onWorkflow(row, action)}>{action}</button> : 'Complete'}</td>
      </tr>;
    })}</tbody>
  </table>
  {!journals.length && <div className="empty">No authoritative journal entries are available for this entity.</div>}
</section>;

export function AuthoritativeApp({ environment = globalThis, fetcher = globalThis.fetch }) {
  const configured = authoritativeRuntimeConfigured(environment);
  const [phase, setPhase] = useState(configured ? 'CHECKING_IDENTITY' : 'CONFIGURATION_REQUIRED');
  const [route, setRoute] = useState('overview');
  const [data, setData] = useState({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] });
  const [error, setError] = useState(null);
  const [workingJournalIds, setWorkingJournalIds] = useState(new Set());
  const oidcClient = useMemo(() => configured ? new BrowserOidcClient({ environment, fetcher }) : null, [configured, environment, fetcher]);
  const config = useMemo(() => configured ? accountingApiConfig(environment) : null, [configured, environment, phase]);

  const refresh = useCallback(async () => {
    if (!config) return;
    setPhase('LOADING_ACCOUNTING'); setError(null);
    const [documents, journals] = await Promise.all([
      refreshAuthoritativeDocuments({ config, fetcher }),
      refreshAuthoritativeJournalEntries({ config, fetcher }),
    ]);
    if (!documents.ok || !journals.ok) {
      const failure = !documents.ok ? documents : journals;
      setError(failure); setPhase(failure.code === 'AUTHENTICATION_REQUIRED' ? 'LOGIN_REQUIRED' : 'LOAD_FAILED');
      return;
    }
    setData({ ap:documents.ap, ar:documents.ar, journals:journals.journals });
    setPhase('READY');
  }, [config, fetcher]);

  useEffect(() => {
    if (!configured || !oidcClient || typeof environment?.document === 'undefined') return;
    let active = true;
    environment.refsOidcClient = oidcClient;
    oidcClient.completeRedirect().then(result => {
      if (!active) return;
      if (!result.ok) { setPhase(result.code === 'OIDC_LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'IDENTITY_FAILED'); setError(result); return; }
      setPhase('AUTHENTICATED');
    });
    return () => { active = false; };
  }, [configured, environment, oidcClient]);

  useEffect(() => { if (phase === 'AUTHENTICATED') refresh(); }, [phase, refresh]);

  const startLogin = async () => {
    setError(null);
    try { await oidcClient.startLogin(); }
    catch { setError({ code:'OIDC_CONFIGURATION_REQUIRED', message:'The configured OIDC provider could not start a secure PKCE login.' }); setPhase('IDENTITY_FAILED'); }
  };
  const logout = () => { oidcClient?.logout(); setData({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] }); setPhase('LOGIN_REQUIRED'); };
  const workflow = async (row, action) => {
    const journalEntryId = row.journal_entry_id;
    if (!journalEntryId || workingJournalIds.has(journalEntryId)) return;
    setWorkingJournalIds(current => new Set(current).add(journalEntryId)); setError(null);
    const result = await transitionAuthoritativeJournal({ config, journalEntryId, revision:Number(row.journal_revision ?? row.revision), action, fetcher });
    setWorkingJournalIds(current => { const next = new Set(current); next.delete(journalEntryId); return next; });
    if (!result.ok) { setError(result); return; }
    await refresh();
  };

  if (!configured) return <AuthoritativeRuntimeLock/>;
  if (typeof environment?.document === 'undefined') return <main className="login-shell"><section className="login-card"><h1>REFS Finance</h1><p>Preparing your secure finance workspace.</p></section></main>;
  if (phase === 'CHECKING_IDENTITY') return <main className="login-shell"><section className="login-card"><h1>Verifying identity</h1><p>Checking the configured OIDC session before loading accounting data.</p></section></main>;
  if (phase === 'LOGIN_REQUIRED' || phase === 'IDENTITY_FAILED') return <main className="login-shell"><section className="login-card">
    <h1>Sign in to REFS Finance</h1><p>Sign in securely to view your company's financial records.</p>
    {error && <p role="alert">{error.code || 'OIDC_LOGIN_REQUIRED'}</p>}
    <button type="button" className="btn btn-primary login-btn" onClick={startLogin}>Continue with secure sign-in</button>
  </section></main>;

  const counts = { bills:data.ap.bills.length, invoices:data.ar.invoices.length, adjustments:data.ap.adjustments.length + data.ar.adjustments.length, journals:data.journals.length };
  return <div className="app authoritative-app">
    <aside className="sidebar">
      <div className="brand"><span className="logo"><NavIcon name="home"/></span> REFS<span className="brand-sub">Finance workspace</span></div>
      <nav aria-label="Finance navigation">
        <div className="nav-group"><div className="nav-group-h"><span className="nav-ic"><NavIcon name="home"/></span>Finance</div>
        {NAV_ITEMS.map(([item,label,icon]) => <button type="button" key={item} aria-current={route===item?'page':undefined} className={`nav-item nav-sub ${route === item ? 'nav-on' : ''}`} onClick={() => setRoute(item)}><span className="nav-ic"><NavIcon name={icon}/></span><span>{label}</span></button>)}</div>
      </nav>
    </aside>
    <div className="main">
      <header className="topbar"><div><b>REFS Finance</b><span className="muted sm"> · Secure workspace</span></div><div className="row-acts"><button type="button" className="btn btn-sm" onClick={refresh}>Refresh</button><button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button></div></header>
      <main className="content">
        {error && <ErrorState code={error.code} message={error.message} onRetry={refresh}/>} 
        {phase === 'LOADING_ACCOUNTING' && <div className="empty">Loading financial records…</div>}
        {phase === 'READY' && route === 'overview' && <><h1>Financial overview</h1><p className="page-subtitle">Review the financial records available for your company in one place.</p><div className="qbo-toolgrid"><span><i>Supplier bills</i><b>{counts.bills}</b></span><span><i>Customer invoices</i><b>{counts.invoices}</b></span><span><i>Adjustments</i><b>{counts.adjustments}</b></span><span><i>Journal entries</i><b>{counts.journals}</b></span></div></>}
        {phase === 'READY' && route === 'payables' && <><AuthoritativeDocumentTable title="AP bills" documents={data.ap.bills} kind="AP"/><AuthoritativeAdjustmentSummary title="AP adjustments" adjustments={data.ap.adjustments}/><AuthoritativeWorkflowTable title="AP journal workflow" documents={data.ap.bills} kind="AP" onWorkflow={workflow} workingJournalIds={workingJournalIds}/><AuthoritativeWorkflowAdjustmentTable title="AP adjustment workflow" adjustments={data.ap.adjustments} onWorkflow={workflow} workingJournalIds={workingJournalIds}/></>}
        {phase === 'READY' && route === 'receivables' && <><AuthoritativeDocumentTable title="AR invoices" documents={data.ar.invoices} kind="AR"/><AuthoritativeAdjustmentSummary title="AR adjustments" adjustments={data.ar.adjustments}/><AuthoritativeWorkflowTable title="AR journal workflow" documents={data.ar.invoices} kind="AR" onWorkflow={workflow} workingJournalIds={workingJournalIds}/><AuthoritativeWorkflowAdjustmentTable title="AR adjustment workflow" adjustments={data.ar.adjustments} onWorkflow={workflow} workingJournalIds={workingJournalIds}/></>}
        {phase === 'READY' && route === 'bank' && <AuthoritativeBankWorkspace config={config} fetcher={fetcher}/>}
        {phase === 'READY' && route === 'reconciliation' && <AuthoritativeReconciliationWorkspace config={config} fetcher={fetcher}/>}
        {phase === 'READY' && route === 'reports' && <AuthoritativeReportsWorkspace config={config} fetcher={fetcher}/>}
        {phase === 'READY' && route === 'journals' && <JournalTable journals={data.journals} workingJournalIds={workingJournalIds} onWorkflow={workflow}/>} 
        {phase === 'READY' && route === 'drafts' && <AuthoritativeDraftForm/>}
      </main>
    </div>
  </div>;
}
