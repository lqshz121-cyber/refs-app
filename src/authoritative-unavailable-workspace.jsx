import React from 'react';
import {AuthoritativeDemoView,AuthoritativeDemoWorkspaceHeader} from './authoritative-demo-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const label = item?.label || 'Workspace';
  return <AuthoritativeDemoView area={`${label} unavailable workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeDemoWorkspaceHeader eyebrow="WORKSPACE" title={`${label} is being prepared`} description="This area will bring the right financial information together in one place when it is ready to use." status="IN SETUP"/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>This workspace is not ready to use yet</b><div className="page-subtitle">No financial information is available here yet. Your existing books, reports, and approvals are unchanged.</div></div><span className="badge badge-warning">NOT READY</span></div>
      <div className="qbo-toolgrid"><span><i>Company</i><b>Current company</b></span><span><i>Period</i><b>Current period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      <section aria-labelledby="authoritative-unavailable-next-title"><h2 id="authoritative-unavailable-next-title" className="qb-sec">What to expect</h2><ul className="muted sm"><li>Connected financial information in one place.</li><li>A clear activity history for your finance team.</li><li>Only the actions that are ready and approved for this workspace.</li></ul></section>
    </section>
  </AuthoritativeDemoView>;
}
