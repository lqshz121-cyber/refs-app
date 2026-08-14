import React from 'react';

// Mechanical presentation extraction from the General Ledger workbench in
// modules-core.jsx.  Data, query ownership, and navigation remain API/OIDC
// workspace responsibilities.
export function AuthoritativeGeneralLedgerView({eyebrow,title,subtitle,actions,children}){
  return <section className="full-bleed authoritative-general-ledger authoritative-workbench-shell authoritative-general-ledger-presentation" aria-label="Authoritative General Ledger">
    <div className="accounting-page-head"><div><div className="page-eyebrow">{eyebrow}</div><h1 className="page-h">{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="row-acts"><span className="badge badge-muted">READ ONLY</span>{actions}</div></div>
    {children}
  </section>;
}

export function AuthoritativeGeneralLedgerDetailView({eyebrow,title,subtitle,children}){
  return <section className="full-bleed authoritative-general-ledger-detail authoritative-workbench-shell authoritative-evidence-page authoritative-general-ledger-detail-presentation" aria-label="Authoritative General Ledger line detail">
    <div className="accounting-page-head"><div><div className="page-eyebrow">{eyebrow}</div><h1 className="page-h">{title}</h1><p className="page-subtitle">{subtitle}</p></div><span className="badge badge-muted">READ ONLY</span></div>
    {children}
  </section>;
}
