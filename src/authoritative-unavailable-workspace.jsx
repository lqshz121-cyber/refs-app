import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item, config }) {
  const requirements = Array.isArray(item?.requirements) ? item.requirements : [];
  const label = item?.label || 'Workspace';
  const readerChecklist = requirements.map(requirement => {
    if (/attachment/i.test(requirement)) return 'Supporting documents can be reviewed securely.';
    if (/entity|period|source.document|detail/i.test(requirement)) return 'Company records are available for this workspace.';
    return 'The required finance records and access have been confirmed.';
  });
  return <AuthoritativeWorkspaceView area={`${label} setup workspace`} className="stack authoritative-unavailable-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE SETUP" title={`${label} is being prepared`} description="This workspace will appear when the company records and access are ready." status="SETUP IN PROGRESS"/>
    <section className="report-workbench" role="status">
      <div className="report-workbench-head"><div><b>No financial activity is shown until setup is complete</b><div className="page-subtitle">To protect your books, this area does not show sample balances or enable accounting actions before the company connection and access are ready.</div></div><span className="badge badge-warning">SETUP NEEDED</span></div>
      <div className="qbo-toolgrid"><span title={config?.entityId || undefined}><i>Company</i><b>Configured company</b></span><span title={config?.periodId || undefined}><i>Reporting period</i><b>Configured period</b></span><span><i>Workspace</i><b>{label}</b></span></div>
      {requirements.length > 0 && <section aria-labelledby="authoritative-unavailable-requirements-title"><h2 id="authoritative-unavailable-requirements-title" className="qb-sec">What happens next</h2><ul className="muted sm">{readerChecklist.map((requirement,index)=><li key={`${requirement}-${index}`}>{requirement}</li>)}</ul><div className="page-subtitle"><b>Who completes this:</b> Your finance administrator confirms the company, reporting period, and access. The REFS team then enables this view.</div><div className="page-subtitle"><b>Next step:</b> Ask your finance administrator to review the items above. This workspace stays read-only and shows no sample balances until they are complete.</div></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
