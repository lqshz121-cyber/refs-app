import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { accountingApiConfig, activateAuthoritativeReadAccess, refreshAuthoritativeChartOfAccounts, refreshAuthoritativeDocuments, refreshAuthoritativeJournalEntries, refreshAuthoritativeScope, refreshCurrentActorAccess } from './accounting-api.js';
import { AuthoritativeSourceDocumentsWorkspace } from './authoritative-source-documents-workspace.jsx';
import { BrowserOidcClient, RENEWAL_MIN_INTERVAL_MS, oidcRuntimeConfig, silentRenewalSchedule } from './oidc-client.js';
import { AuthoritativeBankWorkspace, AuthoritativeReconciliationWorkspace } from './authoritative-bank-workspace.jsx';
import { AuthoritativeBankBatchPipelineWorkspace } from './authoritative-bank-batch-pipeline-workspace.jsx';
import { StateBlock } from './ui.jsx';
import { focusFirstControl, navDrawerAttributes, readOffCanvas, restoreFocus, watchOffCanvas } from './nav-drawer.js';
import { RuntimeErrorPage, RuntimeErrorPanel } from './runtime-error-page.jsx';
import { verifyAuthoritativeApiRelease } from './authoritative-release-gate.js';
import { AuthoritativeReportsWorkspace, DEFAULT_AUTHORITATIVE_REPORTS_CATALOG } from './authoritative-reports-workspace.jsx';
import { AuthoritativeAgingWorkspace } from './authoritative-aging-workspace.jsx';
import { AuthoritativeJournalWorkspace } from './authoritative-journal-workspace.jsx';
import { AuthoritativeChartOfAccountsWorkspace } from './authoritative-coa-register-workspace.jsx';
import { AuthoritativeGeneralLedgerWorkspace } from './authoritative-general-ledger-workspace.jsx';
import { AuthoritativeWbsTransitionWorkspace } from './authoritative-wbs-transition-workspace.jsx';
import { AuthoritativeWbsPayableReviewWorkspace } from './authoritative-wbs-payable-review-workspace.jsx';
import { AuthoritativeAiAuditWorkspace } from './authoritative-ai-audit-workspace.jsx';
import { AuthoritativeAiJeWorkspace } from './authoritative-ai-je-workspace.jsx';
import { AuthoritativeAccrualWorkspace } from './authoritative-accrual-workspace.jsx';
import { AuthoritativeAmortizationWorkspace } from './authoritative-amortization-workspace.jsx';
import { AuthoritativePropertyRentWorkspace } from './authoritative-property-rent-workspace.jsx';
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
import { AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES, navigationItemForRoute } from './authoritative-navigation.js';
import { AuthoritativeOverview } from './authoritative-overview.jsx';
import { AuthoritativeNavigationShell } from './authoritative-navigation-shell.jsx';
import { AuthoritativeTopbar } from './authoritative-topbar.jsx';
import { AuthoritativeUnavailableWorkspace } from './authoritative-unavailable-workspace.jsx';
import {authoritativeScopePresentation} from './authoritative-scope-presentation.js';
import {AuthoritativeAccessStatus} from './authoritative-access-status.jsx';

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
const SHARED_ACCOUNTING_BOOTSTRAP_ROUTES = new Set(['overview', 'payables', 'receivables', 'journals']);

// These four workspaces consume the shared AP/AR/Journal bundle held by this
// component. Every other authoritative workspace owns a smaller scoped reader
// and must be allowed to mount before that unrelated bundle is requested. In
// particular, a slow AP or Journal request must never hold a direct Bank or
// Reconciliation reload in a global Loading screen.
export const routeRequiresSharedAccountingBootstrap = route =>
  SHARED_ACCOUNTING_BOOTSTRAP_ROUTES.has(route);

export const readRetainedRoute = (environment = globalThis) => {
  const fragment = String((environment && environment.location && environment.location.hash) || '').replace(/^#\/?/, '');
  if (ROUTES.includes(fragment)) return fragment;
  try {
    const stored = environment && environment.sessionStorage && environment.sessionStorage.getItem(ROUTE_KEY);
    if (ROUTES.includes(stored)) return stored;
  } catch { /* a browser that refuses session storage simply starts at the default page */ }
  return 'overview';
};

const readHashRoute = environment => {
  const fragment = String((environment && environment.location && environment.location.hash) || '').replace(/^#\/?/, '');
  return ROUTES.includes(fragment) ? fragment : null;
};

export const watchRetainedRoute = (environment, onRoute) => {
  if (typeof environment?.addEventListener !== 'function' || typeof onRoute !== 'function') return () => {};
  const onHashChange = () => {
    const next = readHashRoute(environment);
    if (next) onRoute(next);
  };
  environment.addEventListener('hashchange', onHashChange);
  return () => environment?.removeEventListener?.('hashchange', onHashChange);
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
  const [phase, setPhase] = useState(configured ? 'CHECKING_RELEASE' : 'CONFIGURATION_REQUIRED');
  const [route, setRouteState] = useState(() => readRetainedRoute(environment));
  const [data, setData] = useState({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] });
  const [documentDetail, setDocumentDetail] = useState(null);
  const [adjustmentDetail, setAdjustmentDetail] = useState(null);
  const [agingDetail, setAgingDetail] = useState(null);
  const [reportAgingDetail, setReportAgingDetail] = useState(null);
  const [reportCatalogReturn, setReportCatalogReturn] = useState(null);
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
  const [sharedAccountingLoaded, setSharedAccountingLoaded] = useState(false);
  const [scopeRows,setScopeRows]=useState([]);
  const [scopeMetadata,setScopeMetadata]=useState(null);
  const [accessState,setAccessState]=useState({status:'LOADING'});
  // A direct selection of Reports is an explicit catalog entry, not a
  // continuation of the last report drill. React preserves a mounted route
  // when a user selects its already-active navigation item, so keep a small
  // route-local revision to remount the GET-only reports workspace and restore
  // its documented default catalog in that case.
  const [reportsNavigationVersion, setReportsNavigationVersion] = useState(0);
  // Same off-canvas drawer contract as the demonstration shell: below 1024px the
  // sidebar is pushed out of the viewport by transform alone, so without `inert`
  // its eight route buttons stay in the tab order while invisible. This surface
  // previously had no opener at all, which made the navigation unreachable on a
  // tablet as well as untabbable - both are fixed by the same three pieces.
  const [navOpen, setNavOpen] = useState(false);
  const [expandedNavigationGroups, setExpandedNavigationGroups] = useState(() => {
    const initial = AUTHORITATIVE_NAVIGATION.find(group => group.items.some(item => item.route === readRetainedRoute(environment)))?.label;
    return initial ? [initial] : [];
  });
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

  // This public, credential-free call is deliberately ahead of OIDC and every
  // accounting reader. A green readiness response alone is not evidence that
  // the independent API Render service was promoted with this static build.
  useEffect(() => {
    if (!configured || !config || phase !== 'CHECKING_RELEASE' || typeof environment?.document === 'undefined') return undefined;
    let active = true;
    void verifyAuthoritativeApiRelease({ environment, config, fetcher:boundFetcher }).then(result => {
      if (!active) return;
      if (result.ok) { setError(null); setPhase('CHECKING_IDENTITY'); return; }
      setError(result); setPhase('LOAD_FAILED');
    });
    return () => { active = false; };
  }, [configured, config, environment, boundFetcher, phase]);

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

  const openAgingEvidence = useCallback((side, focusId, origin = 'RECEIVABLES') => {
    const returnContext=createAuthoritativeReturnContext({config,view:listViews[side],focusId,scrollY:Number(environment?.scrollY)||0});
    if (!returnContext) return;
    setAgingDetail({side,returnContext:{...returnContext,agingSide:String(side).toUpperCase(),agingOrigin:origin}});
  }, [config, environment, listViews]);

  const closeAgingEvidence = useCallback(() => {
    const context=agingDetail?.returnContext;
    if (context) updateListView(agingDetail.side,context.view);
    setAgingDetail(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  }, [agingDetail, updateListView, environment, config]);

  const openReportAgingEvidence = useCallback((focusId, catalog) => {
    const returnContext=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if (!returnContext) return;
    setReportAgingDetail({returnContext:{...returnContext,agingSide:'AR',agingOrigin:'REPORTS'},catalog});
    setRouteState('receivables');
    retainRoute(environment, 'receivables');
  }, [config, environment]);

  const closeReportAgingEvidence = useCallback(() => {
    const context=reportAgingDetail?.returnContext;
    setReportCatalogReturn(reportAgingDetail?.catalog || null);
    setReportAgingDetail(null);
    setRouteState('reports');
    retainRoute(environment, 'reports');
    restoreAuthoritativeReturnContext(environment,config,context);
  }, [reportAgingDetail, environment, config]);

  const setRoute = useCallback(next => {
    setDocumentDetail(null); setAdjustmentDetail(null); setAgingDetail(null); setReportAgingDetail(null); setReportCatalogReturn(null);
    if (next === 'reports') setReportsNavigationVersion(current => current + 1);
    setRouteState(next); retainRoute(environment, next);
  }, [environment]);
  useEffect(() => watchRetainedRoute(environment, next => {
    setDocumentDetail(null); setAdjustmentDetail(null); setAgingDetail(null); setReportAgingDetail(null); setReportCatalogReturn(null);
    if (next === 'reports') setReportsNavigationVersion(current => current + 1);
    setRouteState(next);
    retainRoute(environment, next);
    const group = AUTHORITATIVE_NAVIGATION.find(entry => entry.items.some(item => item.route === next));
    if (group) setExpandedNavigationGroups(current => current.includes(group.label) ? current : [...current, group.label]);
    setNavOpen(false);
  }), [environment]);
  const selectNavigationGroup = useCallback(group => {
    // The rail is a workspace switcher, matching the compact QBO pattern.
    // Selecting a workspace always opens its first available page and replaces
    // the previous secondary menu instead of retaining several expanded trees.
    setExpandedNavigationGroups([group.label]);
    if (group.items?.[0]?.route) setRoute(group.items[0].route);
    setNavOpen(false);
  }, [setRoute]);

  const selectNavigationItem = useCallback(next => {
    const group = AUTHORITATIVE_NAVIGATION.find(entry => entry.items.some(item => item.route === next));
    if (group) setExpandedNavigationGroups(current => current.includes(group.label) ? current : [...current, group.label]);
    setRoute(next); setNavOpen(false);
  }, [setRoute]);

  const refresh = useCallback(async () => {
    if (!config) return;
    setDocumentDetail(null); setAdjustmentDetail(null);
    if (!routeRequiresSharedAccountingBootstrap(route)) {
      setError(null);
      setWorkspaceRefreshVersion(current => current + 1);
      setPhase('READY');
      return;
    }
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
    setSharedAccountingLoaded(true);
    setWorkspaceRefreshVersion(current => current + 1);
    setPhase('READY');
  }, [config, boundFetcher, route]);

  const refreshAfterControlledTestWorkflow = useCallback(async () => {
    if (!config) return;
    const [documents, journals] = await Promise.all([
      refreshAuthoritativeDocuments({config,fetcher:boundFetcher}),
      refreshAuthoritativeJournalEntries({config,fetcher:boundFetcher}),
    ]);
    if (documents.ok && journals.ok) {
      setData({ap:documents.ap,ar:documents.ar,journals:journals.journals});
      setSharedAccountingLoaded(true);setError(null);
    } else setError(!documents.ok?documents:journals);
    // GL, reports and Source Documents own their GET state and remount on the
    // next visit; the revision also refreshes either AI launch surface now.
    setWorkspaceRefreshVersion(current=>current+1);
  },[config,boundFetcher]);

  useEffect(() => {
    if (!configured || !oidcClient || phase !== 'CHECKING_IDENTITY' || typeof environment?.document === 'undefined') return;
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
  }, [configured, environment, oidcClient, phase]);

  useEffect(() => { if (phase === 'AUTHENTICATED') refresh(); }, [phase, refresh]);

  // A session can first open a self-loading workspace and navigate to a shared
  // AP/AR/Journal page later. Fetch that bundle exactly when it becomes needed;
  // the loaded flag prevents READY from retriggering the same read forever.
  useEffect(() => {
    if (phase === 'READY' && routeRequiresSharedAccountingBootstrap(route) && !sharedAccountingLoaded) void refresh();
  }, [phase, route, sharedAccountingLoaded, refresh]);

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
  const activateReadAccess = async () => {
    if(!config) return;
    setError(null);
    const idempotencyKey=`reader-activation-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`;
    const result=await activateAuthoritativeReadAccess({config,fetcher:boundFetcher,idempotencyKey});
    if(result.ok){ setPhase('AUTHENTICATED'); return; }
    setError(result);
  };
  const logout = () => { oidcClient?.logout(); setData({ ap:{ bills:[], adjustments:[] }, ar:{ invoices:[], adjustments:[] }, journals:[] }); setDocumentDetail(null); setAdjustmentDetail(null); setListViews({AP:{...DEFAULT_AUTHORITATIVE_LIST_VIEW},AR:{...DEFAULT_AUTHORITATIVE_LIST_VIEW}}); setError(null); setRenewalFailure(null); setSessionExpired(false); setPhase('LOGIN_REQUIRED'); };
  useEffect(()=>{let current=true;if(phase!=='READY')return()=>{current=false;};refreshAuthoritativeChartOfAccounts({config,fetcher:boundFetcher}).then(result=>{if(current)setScopeRows(result.ok?result.rows:[]);});return()=>{current=false;};},[phase,config,boundFetcher,workspaceRefreshVersion]);
  useEffect(()=>{let current=true;if(phase!=='READY')return()=>{current=false;};refreshAuthoritativeScope({config,fetcher:boundFetcher}).then(result=>{if(current)setScopeMetadata(result.ok?result.row:null);});return()=>{current=false;};},[phase,config,boundFetcher,workspaceRefreshVersion]);
  useEffect(()=>{let current=true;if(phase!=='READY')return()=>{current=false;};setAccessState({status:'LOADING'});refreshCurrentActorAccess({config,fetcher:boundFetcher}).then(result=>{if(current)setAccessState(result.ok?{status:'READY',row:result.row}:{status:'ERROR',code:result.code,message:result.message});});return()=>{current=false;};},[phase,config,boundFetcher,workspaceRefreshVersion]);
  const scopePresentation=useMemo(()=>authoritativeScopePresentation(config,scopeRows,scopeMetadata),[config,scopeRows,scopeMetadata]);
  const displayConfig=useMemo(()=>({...config,scopePresentation}),[config,scopePresentation]);
  if (!configured) return <RuntimeErrorPage code="CONFIGURATION_REQUIRED"/>;
  if (typeof environment?.document === 'undefined') return <main className="login-shell"><section className="login-card"><h1>Authoritative accounting</h1><p>Secure OIDC session verification is in progress.</p></section></main>;
  if (phase === 'CHECKING_RELEASE') return <main className="login-shell"><section className="login-card"><h1>Verifying deployment</h1><p>Checking that the authoritative API and this client carry the same release stamp before loading accounting data.</p></section></main>;
  if (phase === 'CHECKING_IDENTITY') return <main className="login-shell"><section className="login-card"><h1>Verifying identity</h1><p>Checking the configured OIDC session before loading accounting data.</p></section></main>;
  if (phase === 'LOGIN_REQUIRED' || phase === 'IDENTITY_FAILED') return <main className="login-shell"><section className="login-card">
    <h1>Sign in to authoritative accounting</h1><p>Use the configured OIDC provider. Accounting records are read only from the authenticated API in this mode.</p>
    <RuntimeErrorPanel code={error?.code || 'OIDC_LOGIN_REQUIRED'} detail={error?.message} onSignIn={startLogin}/>
    <button type="button" className="btn btn-primary login-btn" onClick={startLogin}>Continue with secure sign-in</button>
  </section></main>;
  // An authenticated principal that this entity refuses is not a sign-in
  // problem, so it does not offer a sign-in retry. Switching identity is the
  // only action that could change the outcome, and it is offered as itself.
  if (phase === 'ACCESS_DENIED') return <RuntimeErrorPage code="AUTHORIZATION_DENIED" detail={error?.message}
    extraActions={<><button type="button" className="btn btn-sm btn-primary" onClick={activateReadAccess}>Activate read access</button><button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button></>}/>;
  if (phase === 'LOAD_FAILED' && !data.journals.length && !data.ap.bills.length && !data.ar.invoices.length) {
    return <RuntimeErrorPage code={error?.code} detail={error?.message} onRetry={refresh} onSignIn={startLogin}
      extraActions={<button type="button" className="btn btn-sm btn-ghost" onClick={logout}>Sign out</button>}/>;
  }
  const counts = { bills:data.ap.bills.length, invoices:data.ar.invoices.length, adjustments:data.ap.adjustments.length + data.ar.adjustments.length, journals:data.journals.length };
  return <div className="app authoritative-app">
    <AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route={route} expandedGroups={expandedNavigationGroups}
      onSelectGroup={selectNavigationGroup} onSelectItem={selectNavigationItem} navOpen={navOpen}
      navDrawerRef={navDrawerRef} drawerAttributes={navDrawerAttributes(navOffCanvas, navOpen)} onClose={() => setNavOpen(false)}/>
    {false && <aside id="authoritative-navigation" ref={navDrawerRef} className={`sidebar ${navOpen ? 'mobile-open' : ''}`}
      {...navDrawerAttributes(navOffCanvas, navOpen)}>
      <div className="brand"><span className="logo">REFS</span><span className="brand-sub">Authoritative</span></div>
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
              onClick={() => selectNavigationGroup(group)}><span className="nav-ic" aria-hidden="true">-</span>{group.label}</button>
            {multiple && expanded && <div id={panelId} className="nav-group-items">{group.items.map(({ route: item, label }) => <button type="button" key={item} aria-current={route===item?'page':undefined} className={`nav-item nav-sub ${route === item ? 'nav-on' : ''}`} onClick={() => { setRoute(item); setNavOpen(false); }}>{label}</button>)}</div>}
          </div>;
        })}
      </nav>
    </aside>}
    {navOpen && <button type="button" className="mobile-nav-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setNavOpen(false)}/>}
    <div className="main">
      {false && <header className="topbar authoritative-topbar">
        <button ref={navOpenerRef} type="button" className="mobile-nav-btn" aria-label="Open navigation" aria-controls="authoritative-navigation" aria-expanded={navOpen} onClick={() => setNavOpen(true)}>Menu</button>
        <div className="authoritative-entity-chip" aria-label={`Authoritative entity ${config.entityId}`}>
          <span className="authoritative-top-label">Entity</span><strong>{config.entityId}</strong>
        </div>
        <div className="period-chip authoritative-period-chip" aria-label={`Authoritative period ${config.periodId}`}>
          <span className="period-label">Period</span><b>{config.periodId}</b><span className="badge badge-ok">API read</span>
        </div>
        <div className="top-right authoritative-top-actions">
          <button type="button" className="icon-btn" aria-label="Refresh authoritative accounting evidence" title="Refresh authoritative accounting evidence" onClick={refresh}><span aria-hidden="true">↻</span></button>
          <button type="button" className="icon-btn" aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} aria-pressed={theme === 'dark'} title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'} onClick={toggleTheme}><span aria-hidden="true">{theme === 'dark' ? '☀' : '☾'}</span></button>
          <span className="authoritative-mode-chip">Authoritative</span>
          <span className="user-chip authoritative-user-chip" aria-label="Authenticated OIDC session"><span className="user-av" aria-hidden="true">A</span><span className="user-nm">Authenticated</span></span>
          <button type="button" className="btn btn-sm btn-ghost authoritative-signout" onClick={logout}>Sign out</button>
        </div>
      </header>}
      <AuthoritativeTopbar navOpenerRef={navOpenerRef} navOpen={navOpen} onOpenNavigation={() => setNavOpen(true)} entityLabel={scopePresentation.entityLabel} periodLabel={scopePresentation.periodLabel} theme={theme} onToggleTheme={toggleTheme} onRefresh={refresh} onSignOut={logout}/>
      <main className="content">
        <section className="authoritative-scope-bar" aria-label="Authoritative accounting scope">
          <span title={`${scopePresentation.entityHint ? `${scopePresentation.entityHint} ` : ''}Entity ID: ${scopePresentation.entityDetail}`}><b>Entity</b> {scopePresentation.entityLabel}{scopePresentation.entityHint&&<small className="muted sm"> — display name not returned by API</small>}</span>
          <span title={`${scopePresentation.periodHint ? `${scopePresentation.periodHint} ` : ''}${scopePresentation.periodDetail}`}><b>Period</b> {scopePresentation.periodLabel}{scopePresentation.periodHint&&<small className="muted sm"> — period details not returned by API</small>}</span>
          {config.cashAccountCode&&<span><b>Cash account</b> {scopePresentation.cashAccountLabel}</span>}
          <AuthoritativeAccessStatus state={accessState}/>
          {(documentDetail?.returnContext||adjustmentDetail?.returnContext)&&<span><b>Return context</b> Query {(documentDetail?.returnContext||adjustmentDetail?.returnContext).view.query||'All'} | Page {(documentDetail?.returnContext||adjustmentDetail?.returnContext).view.page}</span>}
        </section>
        {(sessionExpired || renewalFailure) && <RuntimeErrorPanel
          code={sessionExpired ? 'OIDC_SESSION_EXPIRED' : 'OIDC_SESSION_EXPIRING'}
          detail={renewalFailure ? `${renewalFailure.code}: ${renewalFailure.message}` : undefined}
          onSignIn={startLogin}/>}
        {error && <RuntimeErrorPanel code={error.code} detail={error.message} onRetry={refresh} onSignIn={startLogin}/>}
        {phase === 'LOADING_ACCOUNTING' && <StateBlock tone="loading">Loading authoritative accounting records...</StateBlock>}
        {phase === 'READY' && route === 'overview' && <AuthoritativeOverview counts={counts} onNavigate={setRoute} scope={{entityId:config.entityId,periodId:config.periodId}} config={displayConfig} fetcher={boundFetcher}/>}
        {phase === 'READY' && route === 'payables' && (agingDetail?.side==='AP'?<AuthoritativeAgingWorkspace config={displayConfig} side="ap" fetcher={boundFetcher} onBack={closeAgingEvidence} backLabel="Back to bills & expenses" returnContext={agingDetail.returnContext} expectedOrigin="PAYABLES"/>:documentDetail?.kind==='AP'?<AuthoritativeDocumentDetail document={documentDetail.row} kind="AP" entityId={config.entityId} config={displayConfig} returnContext={documentDetail.returnContext} onBack={closeDocumentEvidence}/>:adjustmentDetail?.side==='AP'?<AuthoritativeAdjustmentDetail adjustment={adjustmentDetail.row} side="AP" entityId={config.entityId} config={displayConfig} onBack={closeAdjustmentEvidence}/>:<AuthoritativeDocumentWorkspace kind="AP" documents={data.ap.bills} adjustments={data.ap.adjustments} view={listViews.AP} onViewChange={view=>updateListView('AP',view)} onOpenDocument={(row,focusId)=>openDocumentEvidence('AP',row,focusId)} onOpenAdjustment={(row,focusId)=>openAdjustmentEvidence('AP',row,focusId)} onOpenAging={()=>openAgingEvidence('AP','authoritative-ap-aging-launch','PAYABLES')} config={displayConfig} fetcher={boundFetcher}/>)}
        {phase === 'READY' && route === 'receivables' && (reportAgingDetail?<AuthoritativeAgingWorkspace config={displayConfig} side="ar" fetcher={boundFetcher} onBack={closeReportAgingEvidence} backLabel="Back to Reports" returnContext={reportAgingDetail.returnContext} expectedOrigin="REPORTS"/>:agingDetail?.side==='AR'?<AuthoritativeAgingWorkspace config={displayConfig} side="ar" fetcher={boundFetcher} onBack={closeAgingEvidence} returnContext={agingDetail.returnContext} expectedOrigin="RECEIVABLES"/>:documentDetail?.kind==='AR'?<AuthoritativeDocumentDetail document={documentDetail.row} kind="AR" entityId={config.entityId} config={displayConfig} returnContext={documentDetail.returnContext} onBack={closeDocumentEvidence}/>:adjustmentDetail?.side==='AR'?<AuthoritativeAdjustmentDetail adjustment={adjustmentDetail.row} side="AR" entityId={config.entityId} config={displayConfig} onBack={closeAdjustmentEvidence}/>:<AuthoritativeDocumentWorkspace kind="AR" documents={data.ar.invoices} adjustments={data.ar.adjustments} view={listViews.AR} onViewChange={view=>updateListView('AR',view)} onOpenDocument={(row,focusId)=>openDocumentEvidence('AR',row,focusId)} onOpenAdjustment={(row,focusId)=>openAdjustmentEvidence('AR',row,focusId)} onOpenAging={()=>openAgingEvidence('AR','authoritative-ar-aging-launch','RECEIVABLES')}/>) }
        {phase === 'READY' && route === 'bank-batch-pipeline' && <AuthoritativeBankBatchPipelineWorkspace key={`bank-batch-pipeline-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'bank' && <AuthoritativeBankWorkspace key={`bank-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'reconciliation' && <AuthoritativeReconciliationWorkspace key={`reconciliation-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'wbs-payable-review' && <AuthoritativeWbsPayableReviewWorkspace key={`wbs-payable-review-${workspaceRefreshVersion}`} config={config} fetcher={boundFetcher}/>}
        {phase === 'READY' && route === 'ai-audit' && <AuthoritativeAiAuditWorkspace key={`ai-audit-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} onAccountingRefresh={refreshAfterControlledTestWorkflow}/>}
        {phase === 'READY' && route === 'ai-je-workbench' && <AuthoritativeAiJeWorkspace key={`ai-je-workbench-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} onAccountingRefresh={refreshAfterControlledTestWorkflow}/>}
        {phase === 'READY' && route === 'accruals' && <AuthoritativeAccrualWorkspace key={`accruals-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher}/>}
        {phase === 'READY' && route === 'wbs-autorec-evidence' && <AuthoritativeWbsTransitionWorkspace key={`wbs-autorec-evidence-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} onAccountingRefresh={async()=>{const [documents,journals]=await Promise.all([refreshAuthoritativeDocuments({config,fetcher:boundFetcher}),refreshAuthoritativeJournalEntries({config,fetcher:boundFetcher})]);if(documents.ok&&journals.ok){setData({ap:documents.ap,ar:documents.ar,journals:journals.journals});setSharedAccountingLoaded(true);}}}/>}
        {phase === 'READY' && route === 'reports' && <AuthoritativeReportsWorkspace key={`reports-${workspaceRefreshVersion}-${reportsNavigationVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={reportCatalogReturn||DEFAULT_AUTHORITATIVE_REPORTS_CATALOG} onOpenArAging={openReportAgingEvidence}/>}
        {phase === 'READY' && route === 'project-cost-cwip' && <AuthoritativeReportsWorkspace key={`project-cost-cwip-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={{category:'OPERATING_ANALYSIS',query:'',preview:'TRIAL_BALANCE'}} initialDimensionType="PROJECT" workspaceEyebrow="AUTHORITATIVE - ACCOUNTING OPERATIONS" workspaceTitle="Project Cost & CWIP" workspaceDescription="Project profitability, CWIP rollforward, construction-loan, prepaid, and budget evidence are read from existing OIDC-authenticated accounting APIs. Cost-code, vendor, and project transaction registers remain unavailable until their own server read contracts exist."/>}
        {phase === 'READY' && route === 'unit-cost-ledger' && <AuthoritativeReportsWorkspace key={`unit-cost-ledger-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={{category:'OPERATING_ANALYSIS',query:'',preview:'TRIAL_BALANCE'}} initialDimensionType="UNIT" workspaceEyebrow="AUTHORITATIVE - ACCOUNTING OPERATIONS" workspaceTitle="Unit / Lot profitability" workspaceDescription="Unit and lot profitability reads only exact Unit dimensions retained on same-entity, same-period POSTED ledger lines. Select a canonical Unit reference to load its report, then drill back through the retained evidence. Unit transfer, pricing, and browser-side allocation workflows remain unavailable."/>}
        {phase === 'READY' && route === 'property-ops-pickup' && <AuthoritativePropertyRentWorkspace key={`property-ops-pickup-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} propertyPnlTitle="Property operating P&amp;L" onBack={()=>setRoute('overview')}/>}
        {phase === 'READY' && route === 'construction-loan' && <AuthoritativeReportsWorkspace key={`construction-loan-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={{category:'CASH_AND_CAPITAL',query:'',preview:'TRIAL_BALANCE'}} workspaceEyebrow="AUTHORITATIVE - ACCOUNTING OPERATIONS" workspaceTitle="Construction Loan" workspaceDescription="Construction-loan rollforward evidence is read from the existing OIDC-authenticated accounting API and requires approved mappings plus POSTED ledger evidence. Loan register, lender, commitment, and draw-management workflows remain unavailable until server contracts exist."/>}
        {phase === 'READY' && route === 'amortization' && <AuthoritativeAmortizationWorkspace key={`amortization-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} onBack={()=>setRoute('overview')}/>}
        {phase === 'READY' && route === 'intercompany' && <AuthoritativeReportsWorkspace key={`intercompany-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={{category:'GROUP_AND_COMPARISON',query:'',preview:'TRIAL_BALANCE'}} workspaceEyebrow="AUTHORITATIVE - ACCOUNTING OPERATIONS" workspaceTitle="Intercompany" workspaceDescription="Intercompany reconciliation reads existing OIDC-authenticated, aligned-period evidence for two explicitly scoped entities. Elimination, adjustment, and intercompany posting workflows remain unavailable until server contracts exist."/>}
        {phase === 'READY' && route === 'consolidation' && <AuthoritativeReportsWorkspace key={`consolidation-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher} environment={environment} initialCatalog={{category:'GROUP_AND_COMPARISON',query:'',preview:'TRIAL_BALANCE'}} workspaceEyebrow="AUTHORITATIVE - GENERAL LEDGER" workspaceTitle="Consolidation" workspaceDescription="Consolidation evidence is read from existing OIDC-authenticated approved group snapshots and POSTED ledger evidence. Elimination creation, group maintenance, and browser-side consolidation workbooks remain unavailable until server contracts exist."/>}
        {phase === 'READY' && route === 'journals' && <AuthoritativeJournalWorkspace journals={data.journals} config={displayConfig} fetcher={boundFetcher} environment={environment}/>}
        {phase === 'READY' && route === 'source-documents' && <AuthoritativeSourceDocumentsWorkspace key={`source-documents-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher}/>}
        {phase === 'READY' && ['chart-of-accounts','account-inquiry'].includes(route) && <AuthoritativeChartOfAccountsWorkspace key={`coa-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher}/>}
        {phase === 'READY' && route === 'general-ledger' && <AuthoritativeGeneralLedgerWorkspace key={`general-ledger-${workspaceRefreshVersion}`} config={displayConfig} fetcher={boundFetcher}/>}
        {phase === 'READY' && !['overview','payables','receivables','bank-batch-pipeline','bank','reconciliation','wbs-payable-review','ai-audit','ai-je-workbench','wbs-autorec-evidence','reports','project-cost-cwip','unit-cost-ledger','property-ops-pickup','construction-loan','amortization','intercompany','consolidation','journals','source-documents','chart-of-accounts','account-inquiry','general-ledger','accruals'].includes(route) && <AuthoritativeUnavailableWorkspace item={navigationItemForRoute(route)} config={config}/>}
      </main>
    </div>
  </div>;
}

export { AuthoritativeRuntimeLock };
