import React from 'react';

const permissionList = values => values.length ? [...values].sort().join(', ') : 'None in this session';

export function AuthoritativeAccessStatus({state}){
  if(!state||state.status==='LOADING')return <span className="authoritative-access-status" role="status"><b>Access</b> Checking current session...</span>;
  if(state.status==='ERROR')return <details className="authoritative-access-status authoritative-access-error">
    <summary><b>Access</b> Unavailable</summary>
    <p><strong>{state.code}</strong>: {state.message}</p>
    <p>This is a diagnostic read failure, not an empty permission set.</p>
  </details>;
  const row=state.row;
  return <details className={`authoritative-access-status ${row.session_refresh_required?'authoritative-access-stale':''}`}>
    <summary><b>Access</b> {row.session_refresh_required?'Some actions unavailable':'Session permissions current'}</summary>
    <div className="authoritative-access-detail">
      <p><strong>Effective now</strong> {permissionList(row.permissions)}</p>
      <p><strong>Configured</strong> {row.configured_permissions.length?[...row.configured_permissions].sort().join(', '):'None configured'}</p>
      <p><strong>Grant revision</strong> {row.grant_set_version}</p>
      {row.session_refresh_required&&<p>Some configured permissions are not active in this request. You can continue using the available functions.</p>}
      <p className="muted sm">Technical scope: actor {row.actor_id}; tenant {row.tenant_id}; entity {row.entity_id}.</p>
    </div>
  </details>;
}
