const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SECRET_VALUE=/(?:\bBearer\s+[A-Za-z0-9._~+/=-]{8,}|\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,})/i;
const ACCESS_KEYS=['actor_id','configured_permissions','entity_id','grant_set_version','permissions','session_refresh_required','tenant_id'];
const BACKLOG_KEYS=['entity_id','failed_count','oldest_pending_at','pending_count','tenant_id'];
const exactKeys=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify(keys);
const fail=(code,message)=>{const error=new Error(message);error.code=code;throw error;};
const canonicalTime=value=>{if(value===null)return null;const date=value instanceof Date?value:new Date(value);return Number.isFinite(date.valueOf())?date.toISOString():null;};

export function validateOutboxDispatchScopes(scopes){
  if(!Array.isArray(scopes)||scopes.length===0||scopes.length>100)fail('OUTBOX_DISPATCH_SCOPE_INVALID','Outbox dispatch requires between one and 100 tenant/entity scopes.');
  const pairs=new Set();
  return Object.freeze(scopes.map(scope=>{
    if(!exactKeys(scope,['entityId','tenantId'])||!UUID.test(scope.tenantId||'')||!UUID.test(scope.entityId||''))fail('OUTBOX_DISPATCH_SCOPE_INVALID','Every outbox scope must contain only canonical tenantId and entityId UUIDs.');
    const key=`${scope.tenantId}/${scope.entityId}`;if(pairs.has(key))fail('OUTBOX_DISPATCH_SCOPE_DUPLICATE','Outbox tenant/entity scopes must be unique.');pairs.add(key);
    return Object.freeze({tenantId:scope.tenantId,entityId:scope.entityId});
  }));
}

export function validateOutboxDispatchAccess(value,{tenantId,entityId,actorId}){
  if(!exactKeys(value,ACCESS_KEYS)||value.tenant_id!==tenantId||value.entity_id!==entityId||value.actor_id!==actorId)fail('OUTBOX_DISPATCH_ACCESS_SCOPE_INVALID','Outbox dispatcher access evidence does not bind the configured actor and scope.');
  if(SECRET_VALUE.test(actorId)||!Number.isSafeInteger(value.grant_set_version)||value.grant_set_version<1)fail('OUTBOX_DISPATCH_ACCESS_INVALID','Outbox dispatcher identity or grant revision is invalid.');
  if(value.session_refresh_required!==false||JSON.stringify(value.permissions)!=='["OUTBOX.DISPATCH"]'||JSON.stringify(value.configured_permissions)!=='["OUTBOX.DISPATCH"]')fail('OUTBOX_DISPATCH_ACCESS_DENIED','Outbox dispatcher must have exactly one effective OUTBOX.DISPATCH permission in every scope.');
  return Object.freeze({tenant_id:tenantId,entity_id:entityId,grant_set_version:value.grant_set_version,permission:'OUTBOX.DISPATCH'});
}

export function validateOutboxDispatchBacklog(value,{tenantId,entityId}){
  if(!exactKeys(value,BACKLOG_KEYS)||value.tenant_id!==tenantId||value.entity_id!==entityId||!Number.isSafeInteger(value.pending_count)||value.pending_count<0||!Number.isSafeInteger(value.failed_count)||value.failed_count<0)fail('OUTBOX_DISPATCH_BACKLOG_INVALID','Outbox backlog evidence is outside its closed scope.');
  const oldest=canonicalTime(value.oldest_pending_at);if((value.oldest_pending_at===null)!==(oldest===null)||value.pending_count===0&&oldest!==null||value.pending_count>0&&oldest===null)fail('OUTBOX_DISPATCH_BACKLOG_INVALID','Outbox backlog age evidence is inconsistent.');
  return Object.freeze({tenant_id:tenantId,entity_id:entityId,pending_count:value.pending_count,failed_count:value.failed_count,oldest_pending_at:oldest});
}

export class OutboxDispatchPreflight{
  constructor({kernelFactory,clock=()=>Date.now()}={}){if(typeof kernelFactory!=='function')fail('OUTBOX_DISPATCH_PREFLIGHT_CONFIG_INVALID','Outbox preflight requires an authoritative kernel factory.');this.kernelFactory=kernelFactory;this.clock=clock;}
  async verify(principal,{scopes}={}){
    if(!principal?.trusted||typeof principal.actorId!=='string'||!principal.actorId||SECRET_VALUE.test(principal.actorId))fail('OUTBOX_DISPATCH_ACCESS_INVALID','Outbox preflight requires a non-secret dedicated service actor.');
    const exactScopes=validateOutboxDispatchScopes(scopes),evidence=[];let pendingCount=0,failedCount=0,oldestPendingAt=null;
    for(const scope of exactScopes){
      const kernel=await this.kernelFactory(principal,scope);if(typeof kernel?.readCurrentActorAccess!=='function'||typeof kernel?.readOutboxDispatchBacklog!=='function')fail('OUTBOX_DISPATCH_PREFLIGHT_UNAVAILABLE','Outbox access or backlog reader is unavailable.');
      const access=validateOutboxDispatchAccess(await kernel.readCurrentActorAccess(scope),{...scope,actorId:principal.actorId});
      const backlog=validateOutboxDispatchBacklog(await kernel.readOutboxDispatchBacklog(scope),scope);evidence.push(Object.freeze({...access,pending_count:backlog.pending_count,failed_count:backlog.failed_count,oldest_pending_at:backlog.oldest_pending_at}));pendingCount+=backlog.pending_count;failedCount+=backlog.failed_count;if(backlog.oldest_pending_at&&(oldestPendingAt===null||backlog.oldest_pending_at<oldestPendingAt))oldestPendingAt=backlog.oldest_pending_at;
    }
    return Object.freeze({schema_version:'OUTBOX_DISPATCH_READINESS_V1',ready:true,checked_at:new Date(this.clock()).toISOString(),scope_count:evidence.length,pending_count:pendingCount,failed_count:failedCount,oldest_pending_at:oldestPendingAt,scopes:Object.freeze(evidence)});
  }
}
