import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const label = item?.label || 'Workspace';
  const period = config?.periodId || 'Current period';
  return <AuthoritativeWorkspaceView area={`${label} setup guidance`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE SETUP" title={`${label} is being prepared`} description="This workspace will appear here when its company data is ready. Until then, no estimates or substitute balances are shown." status="SETUP REQUIRED"/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>This area is not ready for use yet</b><div className="page-subtitle">We do not show made-up figures, cached browser data, or inferred balances. Your accounting records remain unchanged while this workspace is being connected.</div></div><span className="badge badge-warning">COMING SOON</span></div>
      <div className="qbo-toolgrid"><span><i>Company</i><b title={config?.entityId || undefined}>Current company</b></span><span><i>Period</i><b title={config?.periodId || undefined}>{period}</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">What happens next</h2><ul className="muted sm"><li>Your finance administrator will connect the required records for this workspace.</li><li>Once ready, you can review the same company and period here.</li></ul></section>
    </section>
  </AuthoritativeWorkspaceView>;
}
