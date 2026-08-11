import React from 'react';

const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

const overviewCards = counts => [
  { label: 'Bills & expenses', value: number(counts.bills), route: 'payables', eyebrow: 'Payables', hint: 'Review retained AP evidence' },
  { label: 'Invoices & receipts', value: number(counts.invoices), route: 'receivables', eyebrow: 'Receivables', hint: 'Review retained AR evidence' },
  { label: 'Adjustments', value: number(counts.adjustments), route: 'journals', eyebrow: 'Accounting', hint: 'Inspect journal evidence' },
  { label: 'Journal entries', value: number(counts.journals), route: 'journals', eyebrow: 'Accounting', hint: 'Open the journal queue' },
];

const workspaces = [
  { route: 'payables', title: 'Expenses', detail: 'Bills, retained evidence, and payable aging' },
  { route: 'receivables', title: 'Receivables', detail: 'Invoices, receipts, and receivable aging' },
  { route: 'bank', title: 'Bank evidence', detail: 'Source records and exact match evidence' },
  { route: 'reconciliation', title: 'Reconciliation', detail: 'Statement evidence and authorised worksheet' },
  { route: 'journals', title: 'Journal review', detail: 'Immutable journal evidence and review queue' },
  { route: 'reports', title: 'Financial statements', detail: 'Posted accounting evidence and report drill' },
];

// Presentation only: all figures arrive from the authenticated parent read
// model. This component owns no storage, network access, or accounting state.
// `state` is intentionally display-only: it makes unavailable/ongoing reads
// explicit rather than substituting demo values while the parent resolves them.
export function AuthoritativeOverview({ counts = {}, onNavigate, state = 'ready', detail }) {
  const cards = overviewCards(counts);
  const navigate = route => { if (typeof onNavigate === 'function') onNavigate(route); };

  if (state === 'loading') return <section className="authoritative-page authoritative-overview" aria-labelledby="authoritative-overview-title" aria-busy="true">
    <header className="authoritative-page-header"><div><p className="authoritative-eyebrow">Control center</p><h1 id="authoritative-overview-title">Accounting control overview</h1></div><span className="badge badge-muted">LOADING</span></header>
    <div className="authoritative-overview-state authoritative-overview-state-loading"><h2>Loading authoritative accounting evidence</h2><p>Totals and workspace links remain unavailable until the signed-in API reads complete.</p></div>
  </section>;

  if (state === 'blocked') return <section className="authoritative-page authoritative-overview" aria-labelledby="authoritative-overview-title">
    <header className="authoritative-page-header"><div><p className="authoritative-eyebrow">Control center</p><h1 id="authoritative-overview-title">Accounting control overview</h1></div><span className="badge badge-warning">BLOCKED</span></header>
    <div className="authoritative-overview-state authoritative-overview-state-blocked"><h2>Authoritative overview unavailable</h2><p>{detail || 'The signed-in accounting API did not provide an authoritative overview read. No browser data or demonstration totals are shown in its place.'}</p></div>
  </section>;

  const allEmpty = cards.every(card => card.value === 0);
  return <section className="authoritative-page authoritative-overview" aria-labelledby="authoritative-overview-title">
    <header className="authoritative-overview-hero">
      <div>
        <p className="authoritative-eyebrow">Control center</p>
        <h1 id="authoritative-overview-title">Accounting control overview</h1>
        <p className="page-subtitle">A single, signed-in view of the retained accounting evidence available for this entity and period.</p>
      </div>
      <div className="authoritative-overview-hero-status"><span className="badge badge-muted">API-BACKED</span><span className="authoritative-overview-hero-note">Scoped to your current access</span></div>
    </header>

    <section className="authoritative-overview-summary" aria-label="Authoritative overview summary">
      <div><span className="authoritative-overview-summary-kicker">Live accounting evidence</span><strong>{cards.reduce((total, card) => total + card.value, 0)}</strong><span>retained records in the current overview</span></div>
      <p>Counts are returned by the authenticated API. They are not balance totals, and a zero never implies activity outside this entity, period, or access scope.</p>
    </section>

    <section aria-labelledby="authoritative-overview-metrics"><div className="authoritative-overview-section-heading"><div><p className="authoritative-eyebrow">At a glance</p><h2 id="authoritative-overview-metrics">Evidence in scope</h2></div><span className="muted sm">Open a workspace for detail</span></div>
      <div className="authoritative-overview-grid" aria-label="Authoritative accounting totals">
        {cards.map(card => <button type="button" className="authoritative-overview-card" key={card.label} onClick={() => navigate(card.route)}>
          <span className="authoritative-overview-card-eyebrow">{card.eyebrow}</span><span className="authoritative-overview-card-label">{card.label}</span><strong>{card.value}</strong><span className="authoritative-overview-card-hint">{card.hint} <span aria-hidden="true">→</span></span>
        </button>)}
      </div>
      {allEmpty && <div className="authoritative-overview-empty" role="status"><strong>No retained records were returned for this scope.</strong><span>Use the workspaces below to refine evidence, review access, or inspect an authoritative empty result.</span></div>}
    </section>

    <section className="authoritative-overview-workspaces" aria-labelledby="authoritative-overview-workspaces-title"><div className="authoritative-overview-section-heading"><div><p className="authoritative-eyebrow">Workspaces</p><h2 id="authoritative-overview-workspaces-title">Continue with authoritative evidence</h2></div></div>
      <div className="authoritative-overview-workspace-grid">{workspaces.map(workspace => <button type="button" key={workspace.route} className="authoritative-overview-workspace" onClick={() => navigate(workspace.route)}><span><strong>{workspace.title}</strong><small>{workspace.detail}</small></span><span aria-hidden="true">→</span></button>)}</div>
    </section>

    <p className="authoritative-page-note">This dashboard contains no creation, approval, posting, payment, provider, or browser-stored accounting controls. A missing API read is shown as loading, blocked, or empty—not as demonstration data.</p>
  </section>;
}
