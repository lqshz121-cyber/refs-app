import React from 'react';

// Presentation-only extraction from the demonstration workspace: every page
// has one compact eyebrow/title/status row followed by its API-owned content.
// The component deliberately owns no view state, queries, or commands.
export function AuthoritativeDemoWorkspaceHeader({
  eyebrow,
  title,
  description,
  status = 'READ ONLY',
  scope = null,
  className = '',
}) {
  return <header className={`accounting-page-head authoritative-demo-workspace-header ${className}`.trim()}>
    <div>
      {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
      <h1 className="page-h">{title}</h1>
      {description && <p className="page-subtitle">{description}</p>}
    </div>
    {scope || <span className="badge badge-muted authoritative-demo-workspace-status">{status}</span>}
  </header>;
}

// This is intentionally a layout boundary, not a data adapter. Callers pass
// authenticated API facts as children, so the old seed/repository/controller
// graph cannot cross into the authoritative bundle.
export function AuthoritativeDemoView({ area, children, className = '' }) {
  return <section className={`authoritative-demo-view ${className}`.trim()} aria-label={`${area} workspace`}>
    {children}
  </section>;
}
