import React from 'react';
import { Icon } from './ui.jsx';

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

const workspaces = [
  { route: 'payables', title: 'Expenses', detail: 'Bills, retained evidence, and payable aging' },
  { route: 'receivables', title: 'Receivables', detail: 'Invoices, receipts, and receivable aging' },
  { route: 'bank', title: 'Bank evidence', detail: 'Source records and exact match evidence' },
  { route: 'reconciliation', title: 'Reconciliation', detail: 'Statement evidence and authorised worksheet' },
  { route: 'journals', title: 'Journal review', detail: 'Immutable journal evidence and review queue' },
  { route: 'reports', title: 'Financial statements', detail: 'Posted accounting evidence and report drill' },
];

// This is deliberately a presentation-only adaptation of the product home
// layout. All values and available destinations remain owned by the signed-in
// parent read model: it has no storage, network, seed, or local accounting
// state of its own.
export function AuthoritativeOverview({ counts = {}, onNavigate, state = 'ready', detail, scope = {} }) {
  const cards = overviewCards(counts);
  const navigate = route => { if (typeof onNavigate === 'function') onNavigate(route); };
  const entity = scope.entityId || 'Configured entity';
  const period = scope.periodId || 'Configured period';

  if (state === 'loading') return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title" aria-busy="true">
    <div className="qbo-home-hero authoritative-home-state-head"><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Loading accounting overview</h1><p className="qb-greet-sub">Authoritative evidence is loading for the current signed-in scope.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-loading"><h2>Loading authoritative accounting evidence</h2><p>Totals and workspace links remain unavailable until the signed-in API reads complete.</p></div>
  </section>;

  if (state === 'blocked') return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero authoritative-home-state-head"><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Accounting control overview</h1><p className="qb-greet-sub">The current signed-in scope could not provide an authoritative overview read.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-blocked"><span className="badge badge-warning">BLOCKED</span><h2>Authoritative overview unavailable</h2><p>{detail || 'The signed-in accounting API did not provide an authoritative overview read. No browser data is shown in its place.'}</p></div>
  </section>;

  const allEmpty = cards.every(card => card.value === 0);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero">
      <div className="qb-greet">
        <p className="authoritative-eyebrow">Control center</p>
        <h1 className="qb-greeting" id="authoritative-overview-title">Accounting control overview</h1>
        <p className="qb-greet-sub">The retained work in scope, your authoritative accounting position, and direct paths back to source evidence.</p>
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

    <section className="authoritative-overview-scope authoritative-overview-scope-compact" aria-label="Current authoritative overview scope">
      <span className="authoritative-overview-scope-mark" aria-hidden="true">S</span>
      <div><small>Entity scope</small><strong>{entity}</strong></div>
      <div><small>Accounting period</small><strong>{period}</strong></div>
      <p><b>API-backed.</b> This overview shows only the current OIDC-authorised server scope.</p>
    </section>

    <div className="qb-actionhead"><h2 className="qb-sec">Business at a glance</h2><span className="muted sm">{total} retained records returned by the authenticated API</span></div>
    <div className="qbo-grid authoritative-overview-demo-grid" aria-label="Authoritative accounting totals">
      {cards.map(card => <button type="button" className="qbo-card authoritative-overview-card" key={card.label} onClick={() => navigate(card.route)}>
        <span className="authoritative-overview-card-eyebrow">{card.eyebrow}</span><h3>{card.label}</h3><strong className="qbo-big">{card.value}</strong><span className="qbo-sub">{card.hint}</span>
      </button>)}
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reports')}>
        <span className="authoritative-overview-card-eyebrow">Reporting</span><h3>Financial statements</h3><strong className="qbo-big">{total}</strong><span className="qbo-sub">Posted evidence available for report review</span>
      </button>
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reconciliation')}>
        <span className="authoritative-overview-card-eyebrow">Control</span><h3>Reconciliation evidence</h3><strong className="qbo-big">{allEmpty ? '—' : 'Read'}</strong><span className="qbo-sub">Open the authorised statement workspace</span>
      </button>
    </div>
    {allEmpty && <div className="authoritative-overview-empty" role="status"><strong>No retained records were returned for this scope.</strong><span>Use a workspace below to inspect an authoritative empty result or access boundary.</span></div>}

    <div className="qb-actionhead authoritative-overview-workspace-head"><h2 className="qb-sec">Open a workspace</h2><span className="muted sm">Every destination stays API-backed and read-scoped.</span></div>
    <div className="authoritative-overview-workspace-grid">{workspaces.map(workspace => <button type="button" key={workspace.route} className="authoritative-overview-workspace" onClick={() => navigate(workspace.route)}><span><strong>{workspace.title}</strong><small>{workspace.detail}</small></span><span aria-hidden="true">→</span></button>)}</div>

    <p className="authoritative-page-note">No creation, approval, posting, payment, provider, or browser-stored accounting control is present here. Missing API data is shown as loading, blocked, or empty rather than being replaced.</p>
  </section>;
}
