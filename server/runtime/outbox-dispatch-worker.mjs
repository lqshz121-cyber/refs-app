import {setTimeout as delay} from 'node:timers/promises';

const safeTime=value=>{const parsed=Date.parse(value||'');return Number.isFinite(parsed)?parsed:null;};
const backlogState=readiness=>readiness?.schema_version!=='OUTBOX_DISPATCH_READINESS_V1'?'UNKNOWN':readiness.failed_count>0?'FAILED_EVENTS':readiness.pending_count>0?'PENDING_EVENTS':'CLEAR';

export function outboxDispatchHealthResponse(worker){
  const health=worker?.health?.(),ready=health?.ok===true;
  return Object.freeze({
    status:ready?200:503,
    headers:Object.freeze({'cache-control':'no-store','content-type':'application/json'}),
    body:Object.freeze({
      schema_version:'OUTBOX_DISPATCH_PUBLIC_READINESS_V2',
      ready,
      worker_state:typeof health?.state==='string'?health.state:'UNAVAILABLE',
      backlog_state:backlogState(health?.readiness),
    }),
  });
}

export class OutboxDispatchWorker{
  constructor({service,principal,scopes,readinessProbe=null,batchSize=100,intervalMs=5000,maxBackoffMs=300000,concurrency=2,maxConsecutiveErrors=6,healthFreshnessMs=Math.max(30000,intervalMs*3),logger=console,sleeper=delay,clock=()=>Date.now()}={}){
    if(!service||!principal?.trusted||!principal.actorId||!Array.isArray(scopes)||scopes.length===0||scopes.length>100||scopes.some(scope=>!scope.tenantId||!scope.entityId)||new Set(scopes.map(scope=>`${scope.tenantId}/${scope.entityId}`)).size!==scopes.length)throw new Error('Outbox worker requires unique tenant/entity scopes');
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>500||!Number.isInteger(concurrency)||concurrency<1||concurrency>16||!Number.isInteger(maxConsecutiveErrors)||maxConsecutiveErrors<1||maxConsecutiveErrors>100||!Number.isInteger(healthFreshnessMs)||healthFreshnessMs<1000||healthFreshnessMs>86400000)throw new Error('Outbox worker limits are invalid');
    if(readinessProbe!==null&&typeof readinessProbe!=='function')throw new Error('Outbox readiness probe must be a function');
    this.service=service;this.principal=Object.freeze({...principal});this.scopes=scopes.map(scope=>Object.freeze({tenantId:scope.tenantId,entityId:scope.entityId}));this.readinessProbe=readinessProbe;this.readiness=null;this.dispatchScopes=[];this.batchSize=batchSize;this.intervalMs=intervalMs;this.maxBackoffMs=maxBackoffMs;this.concurrency=concurrency;this.maxConsecutiveErrors=maxConsecutiveErrors;this.healthFreshnessMs=healthFreshnessMs;this.logger=logger;this.sleeper=sleeper;this.clock=clock;this.running=false;this.stopping=false;this.backingOff=false;this.loopPromise=null;this.abort=null;this.metrics={cycles:0,claimed:0,published:0,retried:0,deadLettered:0,cycleErrors:0,consecutiveErrors:0,lastCycleStartedAt:null,lastCycleFinishedAt:null,lastSuccessAt:null,lastErrorAt:null,lastReadinessCheckAt:null};
  }
  health(){
    const now=this.clock(),readinessAt=safeTime(this.readiness?.checked_at),successAt=safeTime(this.metrics.lastSuccessAt),readinessAge=readinessAt===null?null:now-readinessAt,successAge=successAt===null?null:now-successAt,fresh=readinessAge!==null&&successAge!==null&&readinessAge>=0&&successAge>=0&&readinessAge<=this.healthFreshnessMs&&successAge<=this.healthFreshnessMs;
    const ok=this.running&&!this.stopping&&!this.backingOff&&this.metrics.consecutiveErrors===0&&this.readiness?.ready===true&&fresh;
    const state=this.stopping?'STOPPING':!this.running?'STOPPED':this.backingOff?'BACKING_OFF':!this.metrics.lastSuccessAt?'STARTING':!fresh?'STALE':'READY';
    return {schema_version:'OUTBOX_DISPATCH_HEALTH_V2',ok,state,running:this.running,stopping:this.stopping,backing_off:this.backingOff,scope_count:this.scopes.length,readiness:this.readiness,metrics:{...this.metrics}};
  }
  async checkReadiness(){
    if(!this.readinessProbe)throw Object.assign(new Error('Outbox readiness preflight is required'),{code:'OUTBOX_DISPATCH_PREFLIGHT_UNAVAILABLE'});
    try{
      const evidence=await this.readinessProbe(),configured=new Set(this.scopes.map(scope=>`${scope.tenantId}/${scope.entityId}`));
      if(evidence?.schema_version!=='OUTBOX_DISPATCH_READINESS_V1'||evidence.ready!==true||evidence.scope_count!==this.scopes.length||!Array.isArray(evidence.scopes)||evidence.scopes.length!==this.scopes.length)throw Object.assign(new Error('Outbox readiness evidence is invalid'),{code:'OUTBOX_DISPATCH_PREFLIGHT_INVALID'});
      const seen=new Set(),grouped=new Map();
      for(const scope of evidence.scopes){
        const key=`${scope?.tenant_id}/${scope?.entity_id}`;
        if(!configured.has(key)||seen.has(key)||scope?.permission!=='OUTBOX.DISPATCH'||!Number.isSafeInteger(scope?.grant_set_version)||scope.grant_set_version<1)throw Object.assign(new Error('Outbox readiness scope evidence is invalid'),{code:'OUTBOX_DISPATCH_PREFLIGHT_INVALID'});
        seen.add(key);const list=grouped.get(scope.tenant_id)||[];list.push(Object.freeze({entityId:scope.entity_id,grantSetVersion:scope.grant_set_version}));grouped.set(scope.tenant_id,list);
      }
      this.dispatchScopes=[...grouped].map(([tenantId,scopes])=>Object.freeze({tenantId,scopes:Object.freeze(scopes)}));this.readiness=evidence;this.metrics.lastReadinessCheckAt=new Date(this.clock()).toISOString();return evidence;
    }catch(error){this.readiness=null;this.dispatchScopes=[];this.metrics.lastErrorAt=new Date(this.clock()).toISOString();throw error;}
  }
  async runCycle(){
    this.metrics.lastCycleStartedAt=new Date(this.clock()).toISOString();
    try{
      await this.checkReadiness();let cursor=0;const results=[];const consume=async()=>{while(cursor<this.dispatchScopes.length){const scope=this.dispatchScopes[cursor++];try{const batch=await this.service.runOnce(this.principal,{...scope,limit:this.batchSize});this.metrics.claimed+=batch.length;for(const result of batch){if(result.status==='PUBLISHED')this.metrics.published++;else if(result.status==='PENDING')this.metrics.retried++;else this.metrics.deadLettered++;}results.push(...batch);}catch(error){this.logger.error?.(JSON.stringify({event:'outbox_dispatch_scope_failed',scopeCount:scope.scopes.length,errorCode:/^[A-Z0-9_]{3,80}$/.test(error?.code||'')?error.code:'OUTBOX_DISPATCH_INTERNAL'}));throw error;}}};await Promise.all(Array.from({length:Math.min(this.concurrency,this.dispatchScopes.length)},consume));this.metrics.cycles++;this.metrics.consecutiveErrors=0;this.metrics.lastSuccessAt=new Date(this.clock()).toISOString();this.backingOff=false;return results;
    }catch(error){this.metrics.cycleErrors++;this.metrics.consecutiveErrors++;this.metrics.lastErrorAt=new Date(this.clock()).toISOString();throw error;}
    finally{this.metrics.lastCycleFinishedAt=new Date(this.clock()).toISOString();}
  }
  start(){if(this.loopPromise)return this.loopPromise;this.running=true;this.stopping=false;this.backingOff=false;this.abort=new AbortController();this.loopPromise=this.loop(this.abort.signal).finally(()=>{this.running=false;this.backingOff=false;this.loopPromise=null;});return this.loopPromise;}
  async loop(signal){let backoff=this.intervalMs;while(!signal.aborted){try{await this.runCycle();backoff=this.intervalMs;}catch(error){this.backingOff=true;if(this.metrics.consecutiveErrors>=this.maxConsecutiveErrors)throw Object.assign(new Error('Outbox dispatcher exceeded its consecutive error budget'),{code:'OUTBOX_DISPATCH_UNHEALTHY',cause:error});backoff=Math.min(this.maxBackoffMs,Math.max(this.intervalMs,backoff*2));}try{await this.sleeper(backoff,undefined,{signal});}catch(error){if(!signal.aborted)throw error;}}}
  async stop(){if(!this.loopPromise)return;this.stopping=true;this.abort.abort();await this.loopPromise;}
}
