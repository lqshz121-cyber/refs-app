import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { accountingApiConfig, refreshAuthoritativeDocuments, refreshAuthoritativeJournalEntries, transitionAuthoritativeJournal } from './accounting-api.js';
import { BrowserOidcClient, oidcRuntimeConfig } from './oidc-client.js';
import { nextAuthoritativeWorkflowAction } from './authoritative-workflow.js';
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
  if (typeof environment?.document === 'undefined') return <main className="login-shell"><section className="login-card"><h1>Authoritative accounting</h1><p>Secure OIDC session verification is in progress.</p></section></main>;
  if (phase === 'CHECKING_IDENTITY') return <main className="login-shell"><section className="login-card"><h1>Verifying identity</h1><p>Checking the configured OIDC session before loading accounting data.</p></section></main>;
  if (phase === 'LOGIN_REQUIRED' || phase === 'IDENTITY_FAILED') return <main className="login-shell"><section className="login-card">
    <h1>Sign in to authoritative accounting</h1><p>Use the configured OIDC provider. No demo identity or browser accounting state is available in this mode.</p>
    {error && <p role="alert">{error.code || 'OIDC_LOGIN_REQUIRED'}</p>}
    <button type="button" className="btn btn-primary login-btn" onClick={startLogin}>Continue with secure sign-in</button>
  </section></main>;

  const counts = { bills:data.ap.bills.length, invoices:data.ar.invoices.length, adjustments:data.ap.adjustments.length + data.ar.adjustments.length, journals:data.journals.length };
  return <div className="app authoritative-app">
    <aside className="sidebar">
      <div className="brand"><span className="logo">◇</span> REFS<span className="brand-sub">Authoritative</span></div>
      <nav aria-label="Authoritative accounting navigation">
        <div className="nav-group"><div className="nav-group-h"><span className="nav-ic">●</span>Accounting API</div>
        {['overview','payables','receivables','journals','drafts'].map(item => <button type="button" key={item} className={`nav-item nav-sub ${route === item ? 'nav-on' : ''}`} onClick={() => setRoute(item)}>{item === 'overview' ? 'Control overview' : item[0].toUpperCase()+item.slice(1)}</button>)}</div>
      </nav>
    </aside>
    <div className="main">
      <header className="topbar"><div><b>Authoritative accounting</b><span className="muted sm"> · API and OIDC secured</span></div><div className="row-acts"><button type="button" className="btn btn-sm" onClick={refresh}>Refresh</button><button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button></div></header>
      <main className="content">
        {error && <ErrorState code={error.code} message={error.message} onRetry={refresh}/>} 
        {phase === 'LOADING_ACCOUNTING' && <div className="empty">Loading authoritative accounting records…</div>}
        {phase === 'READY' && route === 'overview' && <><h1>Accounting control overview</h1><p className="page-subtitle">Live records are loaded from the configured accounting API. Browser seeds and localStorage are not accounting authority.</p><div className="qbo-toolgrid"><span><i>AP bills</i><b>{counts.bills}</b></span><span><i>AR invoices</i><b>{counts.invoices}</b></span><span><i>Adjustments</i><b>{counts.adjustments}</b></span><span><i>Journal entries</i><b>{counts.journals}</b></span></div></>}
        {phase === 'READY' && route === 'payables' && <><AuthoritativeDocumentTable title="AP bills" documents={data.ap.bills} kind="AP"/><AuthoritativeAdjustmentSummary title="AP adjustments" adjustments={data.ap.adjustments}/><AuthoritativeWorkflowTable title="AP journal workflow" documents={data.ap.bills} kind="AP" onWorkflow={workflow} workingJournalIds={workingJournalIds}/><AuthoritativeWorkflowAdjustmentTable title="AP adjustment workflow" adjustments={data.ap.adjustments} onWorkflow={workflow} workingJournalIds={workingJournalIds}/></>}
        {phase === 'READY' && route === 'receivables' && <><AuthoritativeDocumentTable title="AR invoices" documents={data.ar.invoices} kind="AR"/><AuthoritativeAdjustmentSummary title="AR adjustments" adjustments={data.ar.adjustments}/><AuthoritativeWorkflowTable title="AR journal workflow" documents={data.ar.invoices} kind="AR" onWorkflow={workflow} workingJournalIds={workingJournalIds}/><AuthoritativeWorkflowAdjustmentTable title="AR adjustment workflow" adjustments={data.ar.adjustments} onWorkflow={workflow} workingJournalIds={workingJournalIds}/></>}
        {phase === 'READY' && route === 'journals' && <JournalTable journals={data.journals} workingJournalIds={workingJournalIds} onWorkflow={workflow}/>} 
        {phase === 'READY' && route === 'drafts' && <AuthoritativeDraftForm/>}
      </main>
    </div>
  </div>;
}
