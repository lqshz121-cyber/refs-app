import React from 'react';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

export function AuthoritativeUnavailableWorkspace({ item }) {
  const label = item?.label || 'Workspace';
  return <AuthoritativeWorkspaceView area={label} className="stack authoritative-unavailable-workspace">
    <section className="report-workbench authoritative-unavailable-state" role="status">
      <AuthoritativeWorkspaceHeader eyebrow="READ ONLY" title={`${label} is not available yet`} description="The authoritative API does not provide this workspace yet. No sample data or actions are shown." status={null}/>
    </section>
  </AuthoritativeWorkspaceView>;
}
