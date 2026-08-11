import React from 'react';

// Presentation only: all figures arrive from the authenticated parent read
// model. This component owns no storage, network access, or accounting state.
export function AuthoritativeOverview({ counts, onNavigate }) {
  const cards = [
    { label: 'Bills & expenses', value: counts.bills, route: 'payables', hint: 'Open retained AP evidence' },
    { label: 'Invoices & receipts', value: counts.invoices, route: 'receivables', hint: 'Open retained AR evidence' },
    { label: 'Adjustments', value: counts.adjustments, route: 'journals', hint: 'Review journal evidence' },
    { label: 'Journal entries', value: counts.journals, route: 'journals', hint: 'Open posted journal evidence' },
  ];

  return <section className="authoritative-page authoritative-overview" aria-labelledby="authoritative-overview-title">
    <header className="authoritative-page-header">
      <div>
        <p className="authoritative-eyebrow">Control center</p>
        <h1 id="authoritative-overview-title">Accounting control overview</h1>
        <p className="page-subtitle">Live records are loaded from the configured accounting API. Browser seeds and local storage are not accounting authority.</p>
      </div>
      <span className="badge badge-muted">API-backed</span>
    </header>
    <div className="authoritative-overview-grid" aria-label="Authoritative accounting totals">
      {cards.map(card => <button type="button" className="authoritative-overview-card" key={card.label} onClick={() => onNavigate(card.route)}>
        <span className="authoritative-overview-card-label">{card.label}</span>
        <strong>{card.value}</strong>
        <span className="authoritative-overview-card-hint">{card.hint}</span>
      </button>)}
    </div>
    <p className="authoritative-page-note">Choose a workspace to inspect its retained evidence. Counts are scoped to the signed-in entity and period; an empty count is not an inference about balances outside that scope.</p>
  </section>;
}
