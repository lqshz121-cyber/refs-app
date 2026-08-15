import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const requirements = (Array.isArray(item?.requirements) ? item.requirements : []).map((_, index) => index === 0
    ? 'Company records are being connected.'
    : 'Finance access is being confirmed.');
  const hasSetupItems = requirements.length > 0;
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} setup workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE SETUP" title={`${label} is being prepared`} description="We are connecting your company records and confirming finance access. When ready, your team can review the live records here." status={null}/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>Records will appear here soon</b><div className="page-subtitle">This workspace is ready for your live company records. Until the connection is complete, there is nothing for your team to review or act on.</div></div></div>
      <div className="qbo-toolgrid"><span title={config?.entityId || undefined}><i>Company</i><b>Configured company</b></span><span title={config?.periodId || undefined}><i>Reporting period</i><b>Configured period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      {hasSetupItems && <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">What happens next</h2><div className="page-subtitle"><b>Your finance team is completing:</b></div><ul className="page-subtitle">{requirements.map(requirement=><li key={requirement}>{requirement}</li>)}</ul><div className="page-subtitle"><b>Next step:</b> This page will automatically show the current records for the selected company and reporting period.</div></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
