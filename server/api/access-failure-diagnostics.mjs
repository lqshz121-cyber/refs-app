const reasons=new Map([
  ['Context issuer identity denied','CONTEXT_ISSUER_IDENTITY'],
  ['Actor has no active DB authorization grant','NO_ACTIVE_GRANT'],
  ['Runtime context denied or expired','CONTEXT_BINDING'],
  ['Invalid runtime context token','CONTEXT_TOKEN'],
  ['Tenant/entity scope denied','ENTITY_SCOPE'],
  ['Human write authority requires a finite exact-role grant','HUMAN_AUTHORITY_EXPIRY'],
  ['Service-only permission requires an exact SERVICE authority grant','SERVICE_AUTHORITY_MISMATCH'],
  ['Human permission grant authority does not match its frozen workflow class','HUMAN_AUTHORITY_MISMATCH'],
  ['Service authority contains a non-service permission','SERVICE_PERMISSION_MISMATCH'],
  ['Writable permission is outside the closed authority matrix','AUTHORITY_MATRIX'],
  ['Actor has mutually exclusive workflow authorities in one entity','AUTHORITY_CONFLICT'],
]);

// Only fixed classifications reach logs. Never log tokens, SQL parameters,
// request URLs, database connection strings, or arbitrary database messages.
export function reportAccessFailure(error,write=record=>console.error(JSON.stringify(record))){
  if(error?.code!=='42501')return;
  let reason=reasons.get(error.message);
  if(!reason&&/^Permission [A-Z][A-Z0-9_.]* denied$/.test(error.message||''))reason='ENTITY_PERMISSION';
  if(!reason&&/^permission denied for (function|table|schema|sequence) /.test(error.message||''))reason='DATABASE_OBJECT_PRIVILEGE';
  if(!reason&&/^permission denied to set role /.test(error.message||''))reason='DATABASE_ROLE_MEMBERSHIP';
  if(!reason&&/violates row-level security policy/.test(error.message||''))reason='DATABASE_ROW_POLICY';
  const where=typeof error.where==='string'?error.where:'';
  const stage=/\brefs_issue_context\(/.test(where)?'CONTEXT_ISSUE':/\brefs_bootstrap_context\(/.test(where)?'CONTEXT_BIND':/\brefs_assert_scope\(/.test(where)?'SCOPE_CHECK':'DATABASE_OPERATION';
  try{write({event:'accounting_access_failure',sqlstate:'42501',reason:reason||'OTHER_DATABASE_ACCESS_DENIAL',stage});}catch{}
}
