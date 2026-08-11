import React from 'react';

// Mechanical presentation extraction from module-sourcedocs.jsx.  This owns
// the demo register hierarchy only; the authoritative workspace supplies all
// scoped API/OIDC facts as slots.
export function AuthoritativeDemoSourceDocumentsView({scope,metrics,actions,children}){
  return <section className="full-bleed authoritative-page authoritative-source-documents-workspace demo-source-documents-presentation" aria-labelledby="source-documents-title">
    <div className="accounting-page-head">
      <div>
        <div className="page-eyebrow">SOURCE &amp; STAGING | RETAINED EVIDENCE</div>
        <h1 id="source-documents-title" className="page-h">Source Documents Register</h1>
        <p className="page-subtitle">{scope}</p>
      </div>
      <div className="row-acts"><span className="authoritative-readonly-chip">Read only</span>{actions}</div>
    </div>
    <section className="kpi-row authoritative-source-summary" aria-label="Source Document summary">{metrics}</section>
    {children}
  </section>;
}
