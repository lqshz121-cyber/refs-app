import React from 'react';

// Direct presentation extraction from module-ap.jsx / module-ar.jsx. It keeps
// their page-header -> KPI row -> tabs -> content hierarchy, but deliberately
// receives only API facts and callbacks from its authoritative parent.
export function AuthoritativeDemoApArView({
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
    ? 'Review authenticated API list facts, supplier bills, and retained evidence without initiating payments.'
    : 'Review authenticated API list facts, customer invoices, and retained evidence without collecting payments.';
  return <section className={`demo-ap-ar-presentation demo-ap-ar-${payable ? 'ap' : 'ar'} ${className}`.trim()} aria-label={`${title} authoritative workspace`}>
    <div className={`accounting-page-head ${headerClassName}`.trim()}>
      <div><div className="page-eyebrow">{eyebrow}</div><h2 className="page-h">{title}</h2><div className="page-subtitle">{subtitle}</div></div>
      <span className="badge badge-muted">READ ONLY</span>
    </div>
    <div className="kpi-row" aria-label={`${title} API summary`}>
      {metrics.map(metric => <div className={`kpi ${metric.tone || ''}`.trim()} key={metric.label}>
        <div className="kpi-label">{metric.label}</div><div className="kpi-value">{metric.value}</div>{metric.sub && <div className="kpi-sub">{metric.sub}</div>}
      </div>)}
    </div>
    {tabs.length > 0 && <div className="tabs" role="tablist" aria-label={`${title} evidence views`}>
      {tabs.map(tab => <button key={tab.id} type="button" role="tab" aria-selected={tab.id === activeTab} disabled={tab.disabled} className={tab.id === activeTab ? 'tab-on' : ''} onClick={() => !tab.disabled && onSelectTab?.(tab.id)}>{tab.label}</button>)}
    </div>}
    {toolbar}
    {children}
  </section>;
}
