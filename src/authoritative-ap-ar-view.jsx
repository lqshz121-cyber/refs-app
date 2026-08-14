import React from 'react';

  // Presentation-only shell for authoritative AP and AR facts. It owns no
// data, storage, identity, or accounting command; those stay with the parent.
export function AuthoritativeApArView({
  kind,
  metrics = [],
  tabs = [],
  activeTab,
  onSelectTab,
  headerClassName = '',
  className = '',
  toolbar,
  children,
}) {
  const payable = kind === 'AP';
  const title = payable ? 'Expenses' : 'Accounts Receivable';
  const eyebrow = payable ? 'EXPENSES / ACCOUNTS PAYABLE' : 'REVENUE / ACCOUNTS RECEIVABLE';
  const subtitle = payable
    ? 'Review supplier bills and supporting details. Payments are completed in their approved workflow.'
    : 'Review customer invoices and supporting details. Collections are completed in their approved workflow.';
  return <section className={`authoritative-ap-ar-presentation authoritative-ap-ar-${payable ? 'ap' : 'ar'} ${className}`.trim()} aria-label={`${title} workspace`}>
    <div className={`accounting-page-head ${headerClassName}`.trim()}>
      <div><div className="page-eyebrow">{eyebrow}</div><h2 className="page-h">{title}</h2><div className="page-subtitle">{subtitle}</div></div>
      <span className="badge badge-muted">VIEW ONLY</span>
    </div>
    <div className="kpi-row" aria-label={`${title} summary`}>
      {metrics.map(metric => <div className={`kpi ${metric.tone || ''}`.trim()} key={metric.label}>
        <div className="kpi-label">{metric.label}</div><div className="kpi-value">{metric.value}</div>{metric.sub && <div className="kpi-sub">{metric.sub}</div>}
      </div>)}
    </div>
    {tabs.length > 0 && <div className="tabs" role="tablist" aria-label={`${title} evidence views`}>
      {tabs.map(tab => tab.unavailable
        ? <span key={tab.id} className="tab-unavailable" role="note">{tab.label} coming soon</span>
        : <button key={tab.id} id={tab.focusId} type="button" role="tab" aria-selected={tab.id === activeTab} className={tab.id === activeTab ? 'tab-on' : ''} onClick={() => onSelectTab?.(tab.id)}>{tab.label}</button>)}
    </div>}
    {toolbar}
    {children}
  </section>;
}
