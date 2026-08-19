import React from 'react';

// Shared presentation-only disclosure for secondary evidence. The child keeps
// ownership of every API read, command boundary, loading state, and error.
export function AuthoritativeSecondaryDisclosure({label,children,open=false}) {
  return <details className="authoritative-secondary-disclosure" open={open || undefined}>
    <summary><span>{label}</span><span className="badge badge-muted">READ ONLY</span></summary>
    {children}
  </details>;
}
