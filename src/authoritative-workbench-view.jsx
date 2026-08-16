import React from 'react';

// Presentation-only extraction for the authoritative workspace: every page
// has one compact eyebrow/title/status row followed by its API-owned content.
// The component deliberately owns no view state, queries, or commands.
export function AuthoritativeWorkspaceHeader({
  eyebrow,
  title,
  description,
  status = 'READ ONLY',
  scope = null,
  className = '',
}) {
  return <header className={`accounting-page-head authoritative-workspace-header ${className}`.trim()}>
    <div>
      {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
      <h1 className="page-h">{title}</h1>
      {description && <p className="page-subtitle">{description}</p>}
    </div>
    {scope || (status ? <span className="badge badge-muted authoritative-workspace-status">{status}</span> : null)}
  </header>;
}

// This is intentionally a layout boundary, not a data adapter. Callers pass
// authenticated API facts as children, so the old seed/repository/controller
// graph cannot cross into the authoritative bundle.
export function AuthoritativeWorkspaceView({ area, children, className = '' }) {
  return <section className={`authoritative-workspace-view ${className}`.trim()} aria-label={`${area} workspace`}>
    {children}
  </section>;
}
