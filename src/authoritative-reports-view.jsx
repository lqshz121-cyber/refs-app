import React from 'react';

// Direct presentation extraction from modules-more.jsx Reports: its Reports
// Center heading and compact category shelf are presentation only. API/OIDC
// readers, catalog state, and every action remain supplied by the caller.
export function AuthoritativeReportsView({eyebrow,title,description,scope,children,className=''}) {
  return <section className={`reports-library authoritative-reports-library authoritative-workbench-shell authoritative-reports-presentation ${className}`.trim()} aria-label={`${title} workspace`}>
    <div className="accounting-page-head reports-head">
      <div><div className="page-eyebrow">{eyebrow}</div><h2 className="page-h">{title}</h2><div className="page-subtitle">{description}</div></div>
      {scope}
    </div>
    <nav aria-label="Reports categories" className="report-shelf"><span className="report-shelf-chip report-shelf-chip-on">Core statements</span><span className="report-shelf-chip">Cash &amp; capital</span><span className="report-shelf-chip">Property &amp; project</span><span className="report-shelf-chip">Group &amp; comparison</span></nav>
    {children}
  </section>;
}
