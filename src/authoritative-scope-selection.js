const nonEmpty = value => typeof value === 'string' && value.length > 0;
const SCOPE_PREFERENCE_KEY='refs.authoritative.scope-preference.v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const preferenceOwner=owner=>owner&&nonEmpty(owner.baseUrl)&&owner.baseUrl.length<=2048&&UUID.test(owner.tenantId||'')&&typeof owner.actorId==='string'&&owner.actorId.length>0&&owner.actorId.length<=200&&owner.actorId.trim()===owner.actorId&&!/[\u0000-\u001f\u007f]/.test(owner.actorId);

// Only a tab-local selector preference, never an authorization or record cache.
// The caller supplies identity from the current authenticated API response and
// the fresh API catalog. Return that catalog's row, never the stored object.
export function clearRetainedScopePreference(environment){
  try{environment?.sessionStorage?.removeItem(SCOPE_PREFERENCE_KEY);}catch{/* optional presentation storage */}
}

export function retainAuthorizedScopePreference({environment,owner,scopes,selection}={}){
  if(!preferenceOwner(owner)||!Array.isArray(scopes)||!UUID.test(selection?.entity_id||'')||!UUID.test(selection?.period_id||''))return false;
  const exact=scopes.find(row=>row.entity_id===selection.entity_id&&row.period_id===selection.period_id);
  if(!exact)return false;
  try{
    if(!environment?.sessionStorage)return false;
    environment.sessionStorage.setItem(SCOPE_PREFERENCE_KEY,JSON.stringify({version:1,baseUrl:owner.baseUrl,tenantId:owner.tenantId,actorId:owner.actorId,entityId:exact.entity_id,periodId:exact.period_id}));
    return true;
  }catch{return false;}
}

export function resolveRetainedScopePreference({environment,owner,scopes}={}){
  if(!preferenceOwner(owner)||!Array.isArray(scopes))return null;
  try{
    const raw=environment?.sessionStorage?.getItem(SCOPE_PREFERENCE_KEY);
    if(!raw)return null;
    const value=raw.length<=4096?JSON.parse(raw):null;
    const exactKeys=['actorId','baseUrl','entityId','periodId','tenantId','version'];
    if(!value||Array.isArray(value)||Object.keys(value).sort().join('|')!==exactKeys.join('|')||value.version!==1||value.baseUrl!==owner.baseUrl||value.tenantId!==owner.tenantId||value.actorId!==owner.actorId||!UUID.test(value.entityId||'')||!UUID.test(value.periodId||'')){
      clearRetainedScopePreference(environment);return null;
    }
    const exact=scopes.find(row=>row.entity_id===value.entityId&&row.period_id===value.periodId)||null;
    if(!exact)clearRetainedScopePreference(environment);
    return exact;
  }catch{clearRetainedScopePreference(environment);return null;}
}

// Read identity in a catalogued company even when the deployment default is
// no longer available to this actor. Neither read loads accounting records.
export async function readRetainedScopePreference({environment,config,readCatalog,readIdentity,isCurrent=()=>true}){
  const catalog=await readCatalog(config);
  if(!isCurrent())return {cancelled:true,selection:null};
  if(!catalog.ok)return {cancelled:false,selection:null};
  const identityScope=catalog.rows.find(row=>row.entity_id===config.entityId)||catalog.rows[0];
  if(!identityScope)return {cancelled:false,selection:null};
  const identity=await readIdentity({...config,entityId:identityScope.entity_id,periodId:identityScope.period_id});
  if(!isCurrent())return {cancelled:true,selection:null};
  if(!identity.ok)return {cancelled:false,selection:null};
  return {cancelled:false,scopes:catalog.rows,selection:resolveRetainedScopePreference({environment,owner:{baseUrl:config.baseUrl,tenantId:identity.row.tenant_id,actorId:identity.row.actor_id},scopes:catalog.rows})};
}

// The accounting-scope catalog is already restricted by the authenticated
// database context. If the deployment default points at a scope the current
// actor cannot read, prefer another period in the same company and then the
// first catalogued company. Returning null for an exact match prevents a
// transient read failure from silently moving a user away from their choice.
export function resolveAuthorizedScopeFallback({
  scopes,
  entityId,
  periodId,
} = {}) {
  if (!Array.isArray(scopes) || !nonEmpty(entityId) || !nonEmpty(periodId)) return null;
  const catalog = scopes.filter(row => row && nonEmpty(row.entity_id) && nonEmpty(row.period_id));
  if (catalog.some(row => row.entity_id === entityId && row.period_id === periodId)) return null;
  return catalog.find(row => row.entity_id === entityId) || catalog[0] || null;
}
