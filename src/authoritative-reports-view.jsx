import React from 'react';

// Direct presentation extraction from modules-more.jsx Reports. API/OIDC
// readers, catalog state, and every action remain supplied by the caller.
export function AuthoritativeReportsView({eyebrow,title,description,scope,children,className=''}) {
  return <section className={`reports-library authoritative-reports-library authoritative-workbench-shell authoritative-reports-presentation ${className}`.trim()} aria-label={`${title} workspace`}>
    <div className="accounting-page-head reports-head">
      <div><div className="page-eyebrow">{eyebrow}</div><h2 className="page-h">{title}</h2>{description&&<div className="page-subtitle">{description}</div>}</div>
      {scope}
    </div>
    {children}
  </section>;
}
