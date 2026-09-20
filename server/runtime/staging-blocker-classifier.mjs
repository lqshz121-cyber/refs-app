// Z02: tell the seven "staging E2E cannot proceed" conditions apart, before anyone spends an hour
// chasing the wrong one.
//
// Each of these presents to an operator as "the E2E did not work", but they need completely
// different responses -- redeploy, grant a role, enable a mode, wait for data, call Render. The
// classifier turns an observation into exactly one class plus the action that clears it.
//
// Rules this file follows:
//   fail closed   -- an unrecognised condition is UNCLASSIFIED and blocking, never "probably fine"
//   no secrets    -- diagnostics carry key NAMES and status codes, never values, tokens or payloads
//   no writes     -- classification is a pure function over observations; it performs no I/O
export const STAGING_BLOCKER_SCHEMA='REFS_STAGING_BLOCKER_CLASSIFICATION_V1';

export const BLOCKER_CLASSES={
  RELEASE_MISMATCH:{
    blocking:true,
    meaning:'A service reports a release SHA other than the candidate.',
    action:'Redeploy that service at the candidate SHA. Do not run business acceptance against a mixed fleet.',
    x04_step:2
  },
  API_UNREACHABLE:{
    blocking:true,
    meaning:'The API did not answer at all (DNS, TLS, connection refused, 5xx from the edge).',
    action:'Render service health. Nothing downstream is meaningful until this clears.',
    x04_step:3
  },
  EXTERNAL_DEPENDENCY_UNCONFIGURED:{
    blocking:true,
    meaning:'A dependency is switched on but its configuration keys are absent, so the process refuses to boot.',
    action:'Supply the named keys in Render. The refusal is correct: a half-configured dependency must not run.',
    x04_step:1
  },
  WBS_DISABLED:{
    blocking:false,
    meaning:'WBS live pilot is DISABLED. Not a fault -- the WBS leg is simply out of scope for this run.',
    action:'Record the WBS steps as BLOCKED and continue. Do not substitute a local fake.',
    x04_step:7
  },
  ROLE_MISSING:{
    blocking:true,
    meaning:'Authenticated, but the actor holds no grant for the entity being addressed (403).',
    action:'Owner grants the role. Never self-grant.',
    x04_step:5
  },
  STATEMENT_SCOPE_MISSING:{
    blocking:true,
    meaning:'Authenticated and granted on the entity, but not for the specific permission the command needs (403).',
    action:'Owner extends the grant to the named permission. Distinct from ROLE_MISSING: the entity is reachable, the verb is not.',
    x04_step:5
  },
  EMPTY_DATA:{
    blocking:false,
    meaning:'Everything works and the answer is genuinely empty -- nothing has been imported for this scope.',
    action:'Expected before a controlled import. An honest empty result is a pass, not a failure.',
    x04_step:6
  },
  UNCLASSIFIED:{
    blocking:true,
    meaning:'The observation matched no known class.',
    action:'Stop and have a human look. Do not treat as pass.',
    x04_step:null
  }
};

const isBlank=v=>v===undefined||v===null||String(v).trim()==='';

// classifyStagingBlocker(observation) -> {schema_version, class, blocking, meaning, action, x04_step, diagnostics}
// `observation` is what a preflight can see without credentials:
//   {reachable, httpStatus, expectedSha, observedShas:{service:sha}, missingConfigKeys:[], modes:{},
//    permissionDenied:{entityGranted, permission}, resultCount}
export function classifyStagingBlocker(observation={}){
  const d=[];                                   // diagnostics: names and codes only
  const out=(name)=>({schema_version:STAGING_BLOCKER_SCHEMA,class:name,...BLOCKER_CLASSES[name],diagnostics:d});

  // 1. Configuration precedes everything: a process that refuses to boot cannot be asked anything.
  const missing=Array.isArray(observation.missingConfigKeys)?observation.missingConfigKeys.filter(k=>!isBlank(k)):[];
  if(missing.length){
    d.push(`missing_config_keys=${missing.slice().sort().join(',')}`);   // names only, never values
    return out('EXTERNAL_DEPENDENCY_UNCONFIGURED');
  }

  // 2. Reachability.
  if(observation.reachable===false){
    d.push(`reachable=false${observation.httpStatus?` http=${observation.httpStatus}`:''}`);
    return out('API_UNREACHABLE');
  }
  if(typeof observation.httpStatus==='number'&&observation.httpStatus>=500){
    d.push(`http=${observation.httpStatus}`);
    return out('API_UNREACHABLE');
  }

  // 3. Fleet version. Checked before authorisation, because a 403 from the wrong build tells you
  //    nothing useful about grants.
  const observed=observation.observedShas&&typeof observation.observedShas==='object'?observation.observedShas:null;
  if(observed&&!isBlank(observation.expectedSha)){
    const expected=String(observation.expectedSha).toLowerCase();
    const drifted=Object.entries(observed)
      .filter(([,sha])=>isBlank(sha)||String(sha).toLowerCase()!==expected)
      .map(([service])=>service).sort();
    if(drifted.length){
      d.push(`release_drift_services=${drifted.join(',')}`);             // service names, not SHAs
      return out('RELEASE_MISMATCH');
    }
  }

  // 4. Authorisation. Entity-level and permission-level are different fixes, so they are different
  //    classes even though both surface as 403.
  const denied=observation.permissionDenied;
  if(denied&&typeof denied==='object'){
    if(denied.entityGranted===false){
      d.push('denied=entity_scope');
      return out('ROLE_MISSING');
    }
    if(denied.entityGranted===true){
      d.push(`denied=permission${isBlank(denied.permission)?'':` permission=${denied.permission}`}`);
      return out('STATEMENT_SCOPE_MISSING');
    }
  }
  if(observation.httpStatus===403){
    d.push('http=403 scope_detail_unavailable');
    return out('ROLE_MISSING');
  }

  // 5. A disabled optional leg is a scope statement, not a fault.
  const modes=observation.modes&&typeof observation.modes==='object'?observation.modes:{};
  if(String(modes.wbsLivePilotMode??'').toUpperCase()==='DISABLED'){
    d.push('wbsLivePilotMode=DISABLED');
    return out('WBS_DISABLED');
  }

  // 6. Working, and genuinely empty.
  if(observation.httpStatus===200&&observation.resultCount===0){
    d.push('http=200 result_count=0');
    return out('EMPTY_DATA');
  }

  d.push('no rule matched');
  return out('UNCLASSIFIED');
}

// Which X04 steps a class permits continuing past.
export function x04Disposition(classification){
  const step=classification?.x04_step??null;
  return {
    stop_at_step:classification?.blocking?step:null,
    continue_allowed:!classification?.blocking,
    record_as:classification?.blocking?'BLOCKED':(classification?.class==='EMPTY_DATA'?'PASS_EMPTY':'BLOCKED_NON_FATAL')
  };
}
