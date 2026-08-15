import React from 'react';
import { Icon } from './ui.jsx';
import {AuthoritativeWbsLivePilotObservation,WBS_LIVE_PILOT_SURFACE_TOOLS} from './authoritative-wbs-live-pilot-observation.jsx';

const number = value => Number.isSafeInteger(value) && value >= 0 ? value : 0;

const overviewCards = counts => [
  { label: 'Bills & expenses', value: number(counts.bills), route: 'payables', eyebrow: 'Payables', hint: 'Review bills and expenses' },
  { label: 'Invoices & receipts', value: number(counts.invoices), route: 'receivables', eyebrow: 'Receivables', hint: 'Review invoices and receipts' },
  { label: 'Adjustments', value: number(counts.adjustments), route: 'journals', eyebrow: 'Accounting', hint: 'Review proposed adjustments' },
  { label: 'Journal entries', value: number(counts.journals), route: 'journals', eyebrow: 'Accounting', hint: 'Review the journal queue' },
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
    <div className="qbo-home-hero"><div className="qb-greet-spacer" aria-hidden="true"/><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Loading your financial overview</h1><p className="qb-greet-sub">Retrieving the latest records for your current company and period.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-loading"><h2>Preparing your overview</h2><p>Your balances and review queues will appear as soon as the signed-in records finish loading.</p></div>
  </section>;

  if (state === 'blocked') return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero"><div className="qb-greet-spacer" aria-hidden="true"/><div className="qb-greet"><h1 className="qb-greeting" id="authoritative-overview-title">Financial overview</h1><p className="qb-greet-sub">We could not load this company and period.</p></div></div>
    <div className="authoritative-overview-state authoritative-overview-state-blocked"><span className="badge badge-warning">ACCESS NEEDED</span><h2>This overview is not available yet</h2><p>{detail || 'Ask an administrator to confirm your access to this company and period, then refresh.'}</p></div>
  </section>;

  const allEmpty = cards.every(card => card.value === 0);
  const total = cards.reduce((sum, card) => sum + card.value, 0);
  return <section className="authoritative-page authoritative-overview qb-home" aria-labelledby="authoritative-overview-title">
    <div className="qbo-home-hero">
      <div className="qb-greet-spacer" aria-hidden="true"/>
      <div className="qb-greet">
        <h1 className="qb-greeting" id="authoritative-overview-title">Financial overview</h1>
        <p className="qb-greet-sub">Review the activity that needs attention and move from source records to clear financial results.</p>
      </div>
      <div className="qbo-home-actions" aria-label="Authoritative workspace actions">
        <button type="button" className="btn btn-ghost" onClick={() => navigate('journals')}>Journal entries</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('reports')}>Reports</button>
        <button type="button" className="btn btn-ghost" onClick={() => navigate('bank')}>Banking</button>
      </div>
    </div>

    <div className="qbo-quicklinks" aria-label="Quick links">
      {quickLinks.map(link => <button key={link.route} type="button" onClick={() => navigate(link.route)}><i aria-hidden="true"><Icon name={link.glyph} size={18}/></i><span>{link.label}</span></button>)}
    </div>

    <div className="qb-actionhead"><h2 className="qb-sec">Your books at a glance</h2><span className="muted sm"><span title={entityDetail||undefined}>{total} records available for {entity}</span><span aria-hidden="true"> · </span><span title={periodDetail||undefined}>{period}</span></span></div>
    <div className="qbo-grid" aria-label="Authoritative accounting totals">
      {cards.map(card => <button type="button" className="qbo-card authoritative-overview-card" key={card.label} onClick={() => navigate(card.route)}>
        <h4>{card.eyebrow}</h4><strong className="qbo-big">{card.value}</strong><span className="qbo-sub">{card.label} - {card.hint}</span>
      </button>)}
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reports')}>
        <h4>Financial statements</h4><strong className="qbo-big">{allEmpty ? '—' : total}</strong><span className="qbo-sub">Review posted financial results</span>
      </button>
      <button type="button" className="qbo-card authoritative-overview-card" onClick={() => navigate('reconciliation')}>
        <h4>Reconciliation</h4><strong className="qbo-big">{allEmpty ? '—' : 'Open'}</strong><span className="qbo-sub">Review bank reconciliation</span>
      </button>
    </div>
    {allEmpty && <div className="authoritative-overview-empty" role="status">
      <section className="state-block empty"><h2>No posted activity in this period yet</h2><p>There are no bills, invoices, adjustments, or journal entries available for the current company and period.</p><p><b>Next step:</b> have an authorized reviewer verify a signed source record. It can then follow the normal draft, approval, and posting workflow before it appears in the ledger and reports.</p></section>
    </div>}

    <AuthoritativeWbsLivePilotObservation config={config} fetcher={fetcher} tools={WBS_LIVE_PILOT_SURFACE_TOOLS.dashboard} title="External WBS observations" showRows={true}/>

    <p className="authoritative-page-note">This overview shows only signed-in accounting records. It never fills gaps with demo data, browser-stored balances, or estimated amounts.</p>
  </section>;
}
