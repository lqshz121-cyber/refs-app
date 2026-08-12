import React from 'react';

// Mechanical presentation extraction from module-coa.jsx and module-register.jsx.
// It deliberately accepts content slots so no demo records, repository, or state
// machine can enter the authoritative bundle.
export function AuthoritativeDemoChartOfAccountsView({eyebrow,title,subtitle,actions,children}){
  return <section className="full-bleed authoritative-coa authoritative-workbench-shell demo-coa-presentation" aria-label="Authoritative Chart of Accounts">
    <div className="accounting-page-head"><div><div className="page-eyebrow">{eyebrow}</div><h1 className="page-h">{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="row-acts"><span className="badge badge-muted">READ ONLY</span>{actions}</div></div>
    {children}
  </section>;
}

export function AuthoritativeDemoAccountRegisterView({eyebrow,title,subtitle,actions,children}){
  return <section className="full-bleed authoritative-register authoritative-workbench-shell authoritative-evidence-page demo-account-register-presentation" aria-label="Authoritative account register">
    <div className="accounting-page-head"><div><div className="page-eyebrow">{eyebrow}</div><h1 className="page-h">{title}</h1><p className="page-subtitle">{subtitle}</p></div><div className="row-acts"><span className="badge badge-muted">READ ONLY</span>{actions}</div></div>
    {children}
  </section>;
}
