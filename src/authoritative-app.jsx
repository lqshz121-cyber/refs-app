import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountingApiConfig, refreshAuthoritativeDocuments, refreshAuthoritativeJournalEntries } from './accounting-api.js';
import { BrowserOidcClient, RENEWAL_MIN_INTERVAL_MS, oidcRuntimeConfig, silentRenewalSchedule } from './oidc-client.js';
import { AuthoritativeBankWorkspace, AuthoritativeReconciliationWorkspace } from './authoritative-bank-workspace.jsx';
import { StateBlock } from './ui.jsx';
import { focusFirstControl, navDrawerAttributes, readOffCanvas, restoreFocus, watchOffCanvas } from './nav-drawer.js';
import { RuntimeErrorPage, RuntimeErrorPanel } from './runtime-error-page.jsx';
import { AuthoritativeReportsWorkspace } from './authoritative-reports-workspace.jsx';
import { AuthoritativeAgingWorkspace } from './authoritative-aging-workspace.jsx';
import { AuthoritativeJournalWorkspace } from './authoritative-journal-workspace.jsx';
import { resolveInitialTheme, watchOsTheme, writeStoredTheme } from './authoritative-theme-preference.js';
import {
  AuthoritativeAdjustmentDetail,
  AuthoritativeDocumentDetail,
  AuthoritativeDocumentWorkspace,
  AuthoritativeRuntimeLock,
} from './authoritative-workspace.jsx';
import {
  DEFAULT_AUTHORITATIVE_LIST_VIEW,
  createAuthoritativeReturnContext,
  restoreAuthoritativeReturnContext,
} from './authoritative-list-context.js';
import { AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES } from './authoritative-navigation.js';
import { AuthoritativeOverview } from './authoritative-overview.jsx';

export const authoritativeRuntimeConfigured = (environment = globalThis) =>
  Boolean(accountingApiConfig(environment) && oidcRuntimeConfig(environment));

export const bindAuthoritativeFetcher = (environment, fetcher) =>
  typeof fetcher === 'function'
    ? (url, options) => Reflect.apply(fetcher, environment, [url, options])
    : fetcher;

// ---------------------------------------------------------------------------
// Route retention.
//
// A page refresh must return the reader to the page they were on. The route is
// presentation state - which workspace is on screen - and never an accounting
// record, so it is held in sessionStorage for the tab and mirrored into the URL
// fragment. Identity itself is held by the OIDC client in the same tab session,
// so a refresh keeps both the signed-in principal and the current page.
//
// The fragment is authoritative when it names a known route, because that is
// what survives a link or a manual reload; sessionStorage covers the case where
// the OIDC redirect completion rewrote the URL.
// ---------------------------------------------------------------------------
const ROUTES = AUTHORITATIVE_ROUTES;
const ROUTE_KEY = 'refs_authoritative_route';

export const readRetainedRoute = (environment = globalThis) => {
  const fragment = String((environment && environment.location && environment.location.hash) || '').replace(/^#\/?/, '');
  if (ROUTES.includes(fragment)) return fragment;
  try {
    const stored = environment && environment.sessionStorage && environment.sessionStorage.getItem(ROUTE_KEY);
    if (ROUTES.includes(stored)) return stored;
  } catch { /* a browser that refuses session storage simply starts at the default page */ }
  return 'overview';
};

export const retainRoute = (environment, route) => {
  if (!ROUTES.includes(route)) return;
  try { environment?.sessionStorage?.setItem(ROUTE_KEY, route); } catch { /* non-fatal */ }
  try {
    const location = environment?.location;
    if (location && environment?.history?.replaceState) {
      environment.history.replaceState(environment.history.state ?? null, '', `${location.pathname || ''}${location.search || ''}#/${route}`);
    }
  } catch { /* non-fatal */ }
};

// A failure that arrives before any workspace has rendered decides which screen
// the reader gets. These three outcomes are kept apart on purpose: a signed-out
// session, an authenticated session that this entity refuses, and everything
// else. They are not interchangeable and must not be described as one another.
const phaseForFailure = failure =>
  failure?.code === 'AUTHENTICATION_REQUIRED' ? 'LOGIN_REQUIRED'
    : failure?.code === 'AUTHORIZATION_DENIED' ? 'ACCESS_DENIED'
      : 'LOAD_FAILED';

const RENEWAL_WATCH_PHASES = new Set(['AUTHENTICATED', 'LOADING_ACCOUNTING', 'READY', 'LOAD_FAILED']);
const RENEWAL_MAX_SLEEP_MS = 300000;

export function AuthoritativeApp({ environment = globalThis, fetcher = globalThis.fetch }) {
  const configured = authoritativeRuntimeConfigured(environment);
  const boundFetcher = useMemo(() => bindAuthoritativeFetcher(environment, fetcher), [environment, fetcher]);
  const [phase, setPhase] = useState(configured ? 'CHECKING_IDENTITY' : 'CONFIGURATION_REQUIRED');
  const [route, setRouteState] = useState(() => readRetainedRoute(environment));
  const [data, setData] = useState({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] });
  const [documentDetail, setDocumentDetail] = useState(null);
  const [adjustmentDetail, setAdjustmentDetail] = useState(null);
  const [listViews, setListViews] = useState(() => ({
    AP:{...DEFAULT_AUTHORITATIVE_LIST_VIEW},
    AR:{...DEFAULT_AUTHORITATIVE_LIST_VIEW},
  }));
  const [error, setError] = useState(null);
  const [renewalFailure, setRenewalFailure] = useState(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  // Theme is a presentation preference only.  It never changes accounting
  // scope, records, or the API client, and uses the same explicit body class
  // contract as the demonstration shell so an authoritative reader has a
  // reachable dark-mode choice at every viewport.
  const [theme, setTheme] = useState(() => resolveInitialTheme(environment));
  // Bank, reconciliation, and report workspaces own their scoped read state.
  // A successful header refresh remounts the active one after the shared AP/AR
  // and journal reads complete, so the visible workspace never keeps stale
  // evidence while the header claims that the reader refreshed the system.
  const [workspaceRefreshVersion, setWorkspaceRefreshVersion] = useState(0);
  // Same off-canvas drawer contract as the demonstration shell: below 1024px the
  // sidebar is pushed out of the viewport by transform alone, so without `inert`
  // its eight route buttons stay in the tab order while invisible. This surface
  // previously had no opener at all, which made the navigation unreachable on a
  // tablet as well as untabbable - both are fixed by the same three pieces.
  const [navOpen, setNavOpen] = useState(false);
  const [expandedNavigationGroup, setExpandedNavigationGroup] = useState(() =>
    AUTHORITATIVE_NAVIGATION.find(group => group.items.some(item => item.route === readRetainedRoute(environment)))?.label || null);
  const [navOffCanvas, setNavOffCanvas] = useState(() => readOffCanvas());
  const navDrawerRef = useRef(null);
  const navOpenerRef = useRef(null);
  const navWasOpen = useRef(false);
  useEffect(() => watchOffCanvas(null, setNavOffCanvas), []);
  useEffect(() => {
    const body = environment?.document?.body;
    if (body) body.className = theme;
  }, [environment, theme]);
  useEffect(() => watchOsTheme(environment, next => setTheme(next)), [environment]);
  const toggleTheme = useCallback(() => {
    const next = theme === 'dark' ? 'light' : 'dark';
    writeStoredTheme(next, environment);
    setTheme(next);
  }, [environment, theme]);
  useEffect(() => {
    if (navOpen && navOffCanvas) { navWasOpen.current = true; focusFirstControl(navDrawerRef.current); return; }
    if (navWasOpen.current) { navWasOpen.current = false; restoreFocus(navOpenerRef.current); }
  }, [navOpen, navOffCanvas]);
  useEffect(() => {
    if (!navOpen) return undefined;
    const onEscape = event => { if (event.key === 'Escape') setNavOpen(false); };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [navOpen]);
  const oidcClient = useMemo(() => configured ? new BrowserOidcClient({ environment, fetcher:boundFetcher }) : null, [configured, environment, boundFetcher]);
  const config = useMemo(() => configured ? accountingApiConfig(environment) : null, [configured, environment, phase]);

  const updateListView = useCallback((kind, view) => {
    setListViews(current => ({...current,[kind]:view}));
  }, []);

  const openDocumentEvidence = useCallback((kind, row, focusId) => {
    const returnContext=createAuthoritativeReturnContext({
      config,
      view:listViews[kind],
      focusId,
      scrollY:Number(environment?.scrollY)||0,
    });
    if (!returnContext) return;
    setDocumentDetail({kind,row,returnContext});
  }, [config, environment, listViews]);

  const openAdjustmentEvidence = useCallback((side, row, focusId) => {
    const returnContext=createAuthoritativeReturnContext({
      config,
      view:listViews[side],
      focusId,
      scrollY:Number(environment?.scrollY)||0,
    });
    if (!returnContext) return;
    setAdjustmentDetail({side,row,returnContext});
  }, [config, environment, listViews]);

  const closeDocumentEvidence = useCallback(() => {
    const context=documentDetail?.returnContext;
    if (context) updateListView(documentDetail.kind,context.view);
    setDocumentDetail(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  }, [documentDetail, updateListView, environment, config]);

  const closeAdjustmentEvidence = useCallback(() => {
    const context=adjustmentDetail?.returnContext;
    if (context) updateListView(adjustmentDetail.side,context.view);
    setAdjustmentDetail(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  }, [adjustmentDetail, updateListView, environment, config]);

  const setRoute = useCallback(next => { setDocumentDetail(null); setAdjustmentDetail(null); setRouteState(next); retainRoute(environment, next); }, [environment]);
  const selectNavigationGroup = useCallback(group => {
    const multiple = group.items.length > 1;
    setExpandedNavigationGroup(current => multiple && current === group.label ? null : group.label);
    setRoute(group.items[0].route);
    setNavOpen(false);
  }, [setRoute]);

  const refresh = useCallback(async () => {
    if (!config) return;
    setDocumentDetail(null); setAdjustmentDetail(null);
    setPhase('LOADING_ACCOUNTING'); setError(null);
    const [documents, journals] = await Promise.all([
      refreshAuthoritativeDocuments({ config, fetcher:boundFetcher }),
      refreshAuthoritativeJournalEntries({ config, fetcher:boundFetcher }),
    ]);
    if (!documents.ok || !journals.ok) {
      const failure = !documents.ok ? documents : journals;
      setError(failure); setPhase(phaseForFailure(failure));
      return;
    }
    setData({ ap:documents.ap, ar:documents.ar, journals:journals.journals });
    setWorkspaceRefreshVersion(current => current + 1);
    setPhase('READY');
  }, [config, boundFetcher]);

  useEffect(() => {
    if (!configured || !oidcClient || typeof environment?.document === 'undefined') return;
    let active = true;
    environment.refsOidcClient = oidcClient;
    const finishIdentity = result => {
      if (!active) return;
      if (!result.ok) { setPhase(result.code === 'OIDC_LOGIN_REQUIRED' ? 'LOGIN_REQUIRED' : 'IDENTITY_FAILED'); setError(result); return; }
      // The redirect completion rewrites the address bar, so the retained route
      // is re-applied here: an authenticated reload returns to the same page.
      setRouteState(readRetainedRoute(environment));
      retainRoute(environment, readRetainedRoute(environment));
      setPhase('AUTHENTICATED');
    };
    const restoreOrCompleteIdentity = async () => {
      const result = await oidcClient.completeRedirect();
      if (!active) return;
      // A top-level reload has no usable local token, but it may still have a
      // first-party provider SSO session. Use one PKCE prompt=none round trip
      // to restore it. It creates no durable credential beyond the same
      // validated session record an interactive sign-in would create. An IdP
      // refusal returns through completeRedirect and stops here; there is no
      // loop and no demo fallback.
      if (!result.ok && result.code === 'OIDC_LOGIN_REQUIRED') {
        try { await oidcClient.startLogin({prompt:'none'}); }
        catch { finishIdentity({ok:false,code:'OIDC_LOGIN_REQUIRED'}); }
        return;
      }
      finishIdentity(result);
    };
    void restoreOrCompleteIdentity();
    return () => { active = false; };
  }, [configured, environment, oidcClient]);

  useEffect(() => { if (phase === 'AUTHENTICATED') refresh(); }, [phase, refresh]);

  useEffect(() => {
    if (!oidcClient || typeof environment?.document === 'undefined' || typeof environment?.setTimeout !== 'function') return;
    if (!RENEWAL_WATCH_PHASES.has(phase)) return;
    let active = true;
    let timer = null;
    const sleep = (ms, next) => { timer = environment.setTimeout(() => { if (active) next(); }, Math.max(0, ms)); };
    const tick = async () => {
      if (!active) return;
      const expiresAt = oidcClient.sessionExpiresAt();
      if (expiresAt === null) return;
      const schedule = silentRenewalSchedule(expiresAt, Date.now());
      if (!schedule) return;
      if (schedule.expired) { setSessionExpired(true); return; }
      if (!schedule.due) { sleep(Math.min(schedule.delay, RENEWAL_MAX_SLEEP_MS), tick); return; }
      const result = await oidcClient.renewSilently();
      if (!active) return;
      if (result.ok) {
        setRenewalFailure(null); setSessionExpired(false);
        const next = silentRenewalSchedule(result.expiresAt, Date.now());
        sleep(Math.max(next ? Math.min(next.delay, RENEWAL_MAX_SLEEP_MS) : RENEWAL_MIN_INTERVAL_MS, RENEWAL_MIN_INTERVAL_MS), tick);
        return;
      }
      setRenewalFailure({ code: result.code, message: result.message });
      sleep(expiresAt - Date.now(), () => setSessionExpired(true));
    };
    tick();
    return () => { active = false; if (timer !== null) { try { environment.clearTimeout(timer); } catch { /* non-fatal */ } } };
  }, [oidcClient, phase, environment]);

  const startLogin = async () => {
    setError(null);
    try { await oidcClient.startLogin(); }
    catch { setError({ code:'OIDC_CONFIGURATION_REQUIRED', message:'The configured OIDC provider could not start a secure PKCE login.' }); setPhase('IDENTITY_FAILED'); }
  };
  const logout = () => { oidcClient?.logout(); setData({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] }); setDocumentDetail(null); setAdjustmentDetail(null); setListViews({AP:{...DEFAULT_AUTHORITATIVE_LIST_VIEW},AR:{...DEFAULT_AUTHORITATIVE_LIST_VIEW}}); setError(null); setRenewalFailure(null); setSessionExpired(false); setPhase('LOGIN_REQUIRED'); };
  if (!configured) return <RuntimeErrorPage code="CONFIGURATION_REQUIRED"/>;
  if (typeof environment?.document === 'undefined') return <main className="login-shell"><section className="login-card"><h1>Authoritative accounting</h1><p>Secure OIDC session verification is in progress.</p></section></main>;
  if (phase === 'CHECKING_IDENTITY') return <main className="login-shell"><section className="login-card"><h1>Verifying identity</h1><p>Checking the configured OIDC session before loading accounting data.</p></section></main>;
  if (phase === 'LOGIN_REQUIRED' || phase === 'IDENTITY_FAILED') return <main className="login-shell"><section className="login-card">
    <h1>Sign in to authoritative accounting</h1><p>Use the configured OIDC provider. No demo identity or browser accounting state is available in this mode.</p>
    <RuntimeErrorPanel code={error?.code || 'OIDC_LOGIN_REQUIRED'} detail={error?.message} onSignIn={startLogin}/>
    <button type="button" className="btn btn-primary login-btn" onClick={startLogin}>Continue with secure sign-in</button>
  </section></main>;
  // An authenticated principal that this entity refuses is not a sign-in
  // problem, so it does not offer a sign-in retry. Switching identity is the
  // only action that could change the outcome, and it is offered as itself.
  if (phase === 'ACCESS_DENIED') return <RuntimeErrorPage code="AUTHORIZATION_DENIED" detail={error?.message}
    extraActions={<button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button>}/>;
  if (phase === 'LOAD_FAILED' && !data.journals.length && !data.ap.bills.length && !data.ar.invoices.length) {
    return <RuntimeErrorPage code={error?.code} detail={error?.message} onRetry={refresh} onSignIn={startLogin}
      extraActions={<button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button>}/>;
  }

  const counts = { bills:data.ap.bills.length, invoices:data.ar.invoices.length, adjustments:data.ap.adjustments.length + data.ar.adjustments.length, journals:data.journals.length };
  return <div className="app authoritative-app">
    <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar ${navOpen ? 'mobile-open' : ''}`}
      {...navDrawerAttributes(navOffCanvas, navOpen)}>
      <div className="brand"><span className="logo">◇</span> REFS<span className="brand-sub">Authoritative</span></div>
      {navOpen && <button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={() => setNavOpen(false)}>Close</button>}
      <nav aria-label="Authoritative accounting navigation">
        {AUTHORITATIVE_NAVIGATION.map((group, index) => {
          const multiple = group.items.length > 1;
          const expanded = multiple && expandedNavigationGroup === group.label;
          const active = group.items.some(item => route === item.route);
          const panelId = `authoritative-navigation-group-${index}`;
          return <div className={`nav-group authoritative-nav-group nav-tone-${index} ${active ? 'nav-group-active' : ''}`} key={group.label}>
            <button type="button" className="nav-group-h" aria-current={!multiple && active ? 'page' : undefined}
              aria-expanded={multiple ? expanded : undefined} aria-controls={multiple ? panelId : undefined}
              onClick={() => selectNavigationGroup(group)}><span className="nav-ic">●</span>{group.label}</button>
            {multiple && expanded && <div id={panelId} className="nav-group-items">{group.items.map(({ route: item, label }) => <button type="button" key={item} aria-current={route===item?'page':undefined} className={`nav-item nav-sub ${route === item ? 'nav-on' : ''}`} onClick={() => { setRoute(item); setNavOpen(false); }}>{label}</button>)}</div>}
          </div>;
        })}
      </nav>
    </aside>
    {navOpen && <button type="button" className="mobile-nav-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setNavOpen(false)}/>}
    <div className="main">
      <header className="topbar"><button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>☰</button><div><b>Authoritative accounting</b><span className="muted sm"> · API and OIDC secured</span></div><div className="row-acts"><button type="button" className="btn btn-sm btn-ghost" aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</button><button type="button" className="btn btn-sm" onClick={refresh}>Refresh</button><button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button></div></header>
      <main className="content">
        <section className="authoritative-scope-bar" aria-label="Authoritative accounting scope">
          <span><b>Entity</b> {config.entityId}</span>
          <span><b>Period</b> {config.periodId}</span>
          {config.cashAccountCode&&<span><b>Cash account</b> {config.cashAccountCode}</span>}
          {(documentDetail?.returnContext||adjustmentDetail?.returnContext)&&<span><b>Return context</b> Query {(documentDetail?.returnContext||adjustmentDetail?.returnContext).view.query||'All'} · Page {(documentDetail?.returnContext||adjustmentDetail?.returnContext).view.page}</span>}
        </section>
        {(sessionExpired || renewalFailure) && <RuntimeErrorPanel
          code={sessionExpired ? 'OIDC_SESSION_EXPIRED' : 'OIDC_SESSION_EXPIRING'}
          detail={renewalFailure ? `${renewalFailure.code}: ${renewalFailure.message}` : undefined}
          onSignIn={startLogin}/>}
        {error && <RuntimeErrorPanel code={error.code} detail={error.message} onRetry={refresh} onSignIn={startLogin}/>}
        {phase === 'LOADING_ACCOUNTING' && <StateBlock tone="loading">Loading authoritative accounting records…</StateBlock>}
        {phase === 'READY' && route === 'overview' && <AuthoritativeOverview counts={counts} onNavigate={setRoute}/>}
        {phase === 'READY' && route === 'payables' && (documentDetail?.kind==='AP'?<AuthoritativeDocumentDetail document={documentDetail.row} kind="AP" entityId={config.entityId} onBack={closeDocumentEvidence}/>:adjustmentDetail?.side==='AP'?<AuthoritativeAdjustmentDetail adjustment={adjustmentDetail.row} side="AP" entityId={config.entityId} onBack={closeAdjustmentEvidence}/>:<><AuthoritativeDocumentWorkspace kind="AP" documents={data.ap.bills} adjustments={data.ap.adjustments} view={listViews.AP} onViewChange={view=>updateListView('AP',view)} onOpenDocument={(row,focusId)=>openDocumentEvidence('AP',row,focusId)} onOpenAdjustment={(row,focusId)=>openAdjustmentEvidence('AP',row,focusId)}/><AuthoritativeAgingWorkspace config={config} side="ap" fetcher={boundFetcher}/></>)}
        {phase === 'READY' && route === 'receivables' && (documentDetail?.kind==='AR'?<AuthoritativeDocumentDetail document={documentDetail.row} kind="AR" entityId={config.entityId} onBack={closeDocumentEvidence}/>:adjustmentDetail?.side==='AR'?<AuthoritativeAdjustmentDetail adjustment={adjustmentDetail.row} side="AR" entityId={config.entityId} onBack={closeAdjustmentEvidence}/>:<><AuthoritativeDocumentWorkspace kind="AR" documents={data.ar.invoices} adjustments={data.ar.adjustments} view={listViews.AR} onViewChange={view=>updateListView('AR',view)} onOpenDocument={(row,focusId)=>openDocumentEvidence('AR',row,focusId)} onOpenAdjustment={(row,focusId)=>openAdjustmentEvidence('AR',row,focusId)}/><AuthoritativeAgingWorkspace config={config} side="ar" fetcher={boundFetcher}/></>)}
        {phase === 'READY' && route === 'bank' && <AuthoritativeBankWorkspace key={`bank-${workspaceRefreshVersion}`} config={config} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'reconciliation' && <AuthoritativeReconciliationWorkspace key={`reconciliation-${workspaceRefreshVersion}`} config={config} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'reports' && <AuthoritativeReportsWorkspace key={`reports-${workspaceRefreshVersion}`} config={config} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'journals' && <AuthoritativeJournalWorkspace journals={data.journals} config={config} environment={environment}/>}
      </main>
    </div>
  </div>;
}

export { AuthoritativeRuntimeLock };
