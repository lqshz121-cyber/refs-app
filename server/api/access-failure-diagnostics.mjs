const reasons=new Map([
  ['Context issuer identity denied','CONTEXT_ISSUER_IDENTITY'],
  ['Actor has no active DB authorization grant','NO_ACTIVE_GRANT'],
  ['Runtime context denied or expired','CONTEXT_BINDING'],
  ['Invalid runtime context token','CONTEXT_TOKEN'],
  ['Tenant/entity scope denied','ENTITY_SCOPE'],
]);

// Only fixed classifications reach logs. Never log tokens, SQL parameters,
// request URLs, database connection strings, or arbitrary database messages.
export function reportAccessFailure(error,write=record=>console.error(JSON.stringify(record))){
  if(error?.code!=='42501')return;
  let reason=reasons.get(error.message);
  if(!reason&&/^Permission [A-Z][A-Z0-9_.]* denied$/.test(error.message||''))reason='ENTITY_PERMISSION';
  if(!reason&&/^permission denied for (function|table|schema|sequence) /.test(error.message||''))reason='DATABASE_OBJECT_PRIVILEGE';
  try{write({event:'accounting_access_failure',sqlstate:'42501',reason:reason||'OTHER_DATABASE_ACCESS_DENIAL'});}catch{}
}
