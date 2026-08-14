import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE" title={`${label} is coming soon`} description="We're preparing this workspace so your finance team can work from clear, connected financial information." status="COMING SOON"/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>This workspace is being prepared</b><div className="page-subtitle">Your current books, reports, and approvals are unchanged while we finish this area.</div></div><span className="badge badge-warning">COMING SOON</span></div>
      <div className="qbo-toolgrid"><span><i>Company</i><b>Current company</b></span><span><i>Period</i><b>Current period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      <section aria-labelledby="authoritative-unavailable-next-title"><h2 id="authoritative-unavailable-next-title" className="qb-sec">When it's ready</h2><ul className="muted sm"><li>The financial information your team needs, in one place.</li><li>A clear activity history for your finance team.</li><li>Only actions that are ready for your business.</li></ul></section>
    </section>
  </AuthoritativeWorkspaceView>;
}
