import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const requirements = Array.isArray(item?.requirements) ? item.requirements : [];
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} unavailable workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE WORKSPACE CATALOG" title={`${label} is not available in the authoritative API`} description="This product area remains visible so its scope is clear, but no signed-in read model has been configured for it." status="API UNAVAILABLE"/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>No browser-stored or substitute data is shown</b><div className="page-subtitle">REFS will not substitute seed data, local storage, or an inferred accounting balance for this workspace. It cannot offer create, approve, pay, match, post, export, or synchronization controls until an authoritative API contract exists.</div></div><span className="badge badge-warning">BLOCKED</span></div>
      <div className="qbo-toolgrid"><span><i>Entity scope</i><b>{config?.entityId || 'Not configured'}</b></span><span><i>Period scope</i><b>{config?.periodId || 'Not configured'}</b></span><span><i>Requested workspace</i><b>{label}</b></span></div>
      {requirements.length > 0 && <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">Required authoritative read contract</h2><ul className="muted sm">{requirements.map(requirement => <li key={requirement}>{requirement}</li>)}</ul></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
