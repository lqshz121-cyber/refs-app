import React from 'react';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  return <section className="authoritative-page authoritative-unavailable-workspace" aria-labelledby="authoritative-unavailable-title">
    <header className="authoritative-page-header">
      <div>
        <p className="authoritative-eyebrow">Authoritative workspace catalog</p>
        <h1 id="authoritative-unavailable-title">{item?.label || 'Workspace'} is not available in the authoritative API</h1>
        <p className="page-subtitle">This product area remains visible so its scope is clear, but no signed-in read model has been configured for it.</p>
      </div>
      <span className="badge badge-danger">API unavailable</span>
    </header>
    <div className="authoritative-unavailable-card" role="status">
      <h2>No browser or demonstration data is shown</h2>
      <p>REFS will not substitute seed data, local storage, or an inferred accounting balance for this workspace. It also cannot offer create, approve, pay, match, post, export, or synchronization controls until an authoritative API contract exists.</p>
      <dl className="authoritative-unavailable-scope"><div><dt>Entity scope</dt><dd>{config?.entityId || 'Not configured'}</dd></div><div><dt>Period scope</dt><dd>{config?.periodId || 'Not configured'}</dd></div><div><dt>Requested workspace</dt><dd>{item?.label || 'Unknown'}</dd></div></dl>
    </div>
  </section>;
}
