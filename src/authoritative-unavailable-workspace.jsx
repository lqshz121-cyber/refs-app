import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const hasSetupItems = Array.isArray(item?.requirements) && item.requirements.length > 0;
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} setup workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE SETUP" title={`${label} is being prepared`} description="This page will be ready once your company connection and finance access are confirmed." status={null}/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>Nothing to review here yet</b><div className="page-subtitle">To protect your books, this page stays empty until the company connection is ready. We never substitute sample balances or enable accounting actions.</div></div></div>
      <div className="qbo-toolgrid"><span title={config?.entityId || undefined}><i>Company</i><b>Configured company</b></span><span title={config?.periodId || undefined}><i>Reporting period</i><b>Configured period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      {hasSetupItems && <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">What happens next</h2><div className="page-subtitle"><b>Your finance administrator</b> confirms the company, reporting period, and access. Once complete, this page will show the same current records your finance team can review elsewhere in REFS.</div><div className="page-subtitle"><b>For now:</b> No action is needed on this page. It remains read-only and does not show sample data.</div></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
