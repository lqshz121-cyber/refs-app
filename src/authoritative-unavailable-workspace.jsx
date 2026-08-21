import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item }) {
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={`${label} setup`} className="stack authoritative-unavailable-workspace">
    <section className="report-workbench authoritative-unavailable-state" role="status">
      <AuthoritativeWorkspaceHeader eyebrow="WORKSPACE SETUP" title={`${label} is not available yet`} description="Your finance administrator must confirm the company connection and access. No sample data or accounting actions are available." status={null}/>
    </section>
  </AuthoritativeWorkspaceView>;
}
