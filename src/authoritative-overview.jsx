import React from 'react';
import { Icon } from './ui.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';

const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

const overviewCards = counts => [
  { label: 'Bills & expenses', value: number(counts.bills), route: 'payables', eyebrow: 'Payables', hint: 'Open retained AP evidence' },
  { label: 'Invoices & receipts', value: number(counts.invoices), route: 'receivables', eyebrow: 'Receivables', hint: 'Open retained AR evidence' },
  { label: 'Adjustments', value: number(counts.adjustments), route: 'journals', eyebrow: 'Accounting', hint: 'Review adjustment evidence' },
  { label: 'Journal entries', value: number(counts.journals), route: 'journals', eyebrow: 'Accounting', hint: 'Open the journal queue' },
];

const quickLinks = [
  { label: 'Accounting', route: 'journals', glyph: 'book' },
  { label: 'Expenses & Pay Bills', route: 'payables', glyph: 'wallet' },
  { label: 'Banking', route: 'bank', glyph: 'bank' },
  { label: 'Reports', route: 'reports', glyph: 'bars' },
  { label: 'Close', route: 'reconciliation', glyph: 'check' },
];

// Uses the existing product-home presentation classes verbatim. Only the
// data/controller boundary differs: all facts arrive from the parent OIDC/API
// read model, and every affordance below is a real route navigation.
export function AuthoritativeOverview({ counts = {}, onNavigate, state = 'ready', detail, scope = {}, config, fetcher=globalThis.fetch }) {
  const cards = overviewCards(counts);
  const navigate = route => { if (typeof onNavigate === 'function') onNavigate(route); };
  const scopePresentation=config?.scopePresentation||{};
  const entity=scopePresentation.entityLabel||'Configured entity';
  const period=scopePresentation.periodLabel||'Configured period';
  const entityDetail=scopePresentation.entityDetail||scope.entityId||'';
  const periodDetail=scopePresentation.periodDetail||scope.periodId||'';

  if (state === 'loading') return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title" aria-busy="true">
    <div className="qbo-home-hero"><div className="qb-greet-spacer" aria-hidden="true"/><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Loading accounting overview</h1><p className="qb-greet-sub">Authoritative evidence is loading for the current signed-in scope.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-loading"><h2>Loading authoritative accounting evidence</h2><p>Totals and workspace links remain unavailable until the signed-in API reads complete.</p></div>
  </section>;

  if (state === 'blocked') return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero"><div className="qb-greet-spacer" aria-hidden="true"/><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Accounting control overview</h1><p className="qb-greet-sub">The current signed-in scope could not provide an authoritative overview read.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-blocked"><span className="badge badge-warning">BLOCKED</span><h2>Authoritative overview unavailable</h2><p>{detail || 'The signed-in accounting API did not provide an authoritative overview read. No browser data is shown in its place.'}</p></div>
  </section>;

  const allEmpty = cards.every(card => card.value === 0);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero">
      <div className="qb-greet-spacer" aria-hidden="true"/>
      <div className="qb-greet">
        <h1 className="qb-greeting" id="authoritative-overview-title">Accounting control overview</h1>
        <p className="qb-greet-sub">The retained work in scope, your authoritative accounting position, and a direct path back to source evidence.</p>
      </div>
      <div className="qbo-home-actions" aria-label="Authoritative workspace actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('journals')}>Open journals</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('reports')}>Open reports</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('bank')}>See bank evidence</button>
      </div>
    </div>

    <div className="qbo-quicklinks" aria-label="Quick links">
      {quickLinks.map(link => <button key={link.route} type="button" onClick={() => navigate(link.route)}><i aria-hidden="true"><Icon name={link.glyph} size={18}/></i><span>{link.label}</span></button>)}
    </div>

    <div className="qb-actionhead"><h2 className="qb-sec">Business at a glance</h2><span className="muted sm"><span title={entityDetail||undefined}>{total} retained records returned by the authenticated API for {entity}</span><span aria-hidden="true">, </span><span title={periodDetail||undefined}>{period}</span></span></div>
    <div className="qbo-grid" aria-label="Authoritative accounting totals">
      {cards.map(card => <button type="button" className="qbo-card authoritative-overview-card" key={card.label} onClick={() => navigate(card.route)}>
        <h4>{card.eyebrow}</h4><strong className="qbo-big">{card.value}</strong><span className="qbo-sub">{card.label} - {card.hint}</span>
      </button>)}
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reports')}>
        <h4>Financial statements</h4><strong className="qbo-big">{total}</strong><span className="qbo-sub">Posted evidence available for report review</span>
      </button>
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reconciliation')}>
        <h4>Reconciliation evidence</h4><strong className="qbo-big">{allEmpty ? '--' : 'Read'}</strong><span className="qbo-sub">Open the authorised statement workspace</span>
      </button>
    </div>
    {allEmpty && <div className="authoritative-overview-empty" role="status"><strong>No retained records were returned for this scope.</strong><span>Use a workspace to inspect an authoritative empty result or access boundary.</span></div>}

    <AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard} title="External WBS observations" showRows={false}/>

    <p className="authoritative-page-note">No creation, approval, posting, payment, provider, or browser-stored accounting control is present here. Missing API data is shown as loading, blocked, or empty rather than being replaced.</p>
  </section>;
}
