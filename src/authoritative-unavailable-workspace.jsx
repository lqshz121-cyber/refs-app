import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const requirements = (Array.isArray(item?.requirements) ? item.requirements : []).map((_, index) => index === 0
    ? 'Company connection and current records are awaiting confirmation.'
    : 'The required finance access is awaiting confirmation.');
  const hasSetupItems = requirements.length > 0;
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} setup workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE" title={`${label} is not ready yet`} description="This workspace will be available once your company connection and finance access are confirmed." status={null}/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>No records are available here yet</b><div className="page-subtitle">To protect your books, this workspace stays empty until the company connection is ready. We never substitute sample balances or enable accounting actions.</div></div></div>
      <div className="qbo-toolgrid"><span title={config?.entityId || undefined}><i>Company</i><b>Configured company</b></span><span title={config?.periodId || undefined}><i>Reporting period</i><b>Configured period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      {hasSetupItems && <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">Getting this workspace ready</h2><div className="page-subtitle"><b>Your finance administrator completes this:</b> confirm the company, reporting period, and access.</div><ul className="page-subtitle">{requirements.map(requirement=><li key={requirement}>{requirement}</li>)}</ul><div className="page-subtitle"><b>After that:</b> Your finance team can review the current records for this workspace in REFS.</div><div className="page-subtitle"><b>Until then:</b> This workspace is read-only and does not show sample data.</div></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
