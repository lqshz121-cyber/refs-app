import {pathToFileURL} from 'node:url';
import {createPool} from './db.mjs';
import {runtimeConfig} from './config.mjs';
import {PostgresContextIssuer} from './context-issuer.mjs';
import {PostgresAccountingKernel} from './kernel-repository.mjs';
import {HttpOutboxPublisher,OutboxDispatchService} from './outbox-dispatcher.mjs';
import {OutboxDispatchWorker} from './outbox-dispatch-worker.mjs';

const integer=(value,name,min,max)=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be ${min}..${max}`);return parsed;};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function outboxDispatchConfig(env=process.env){
  const database=runtimeConfig(env),required=['OUTBOX_DISPATCH_ACTOR_ID','OUTBOX_DISPATCH_SCOPES','OUTBOX_PUBLISH_URL','OUTBOX_PUBLISH_TOKEN'];for(const key of required)if(!env[key])throw new Error(`${key} is required`);
  let scopes;try{scopes=JSON.parse(env.OUTBOX_DISPATCH_SCOPES);}catch{throw new Error('OUTBOX_DISPATCH_SCOPES must be JSON');}
  if(!/^[A-Za-z0-9|._:@/-]{8,160}$/.test(env.OUTBOX_DISPATCH_ACTOR_ID)||!Array.isArray(scopes)||!scopes.length||scopes.some(x=>!x||!UUID.test(x.tenantId))||new Set(scopes.map(x=>x.tenantId.toLowerCase())).size!==scopes.length)throw new Error('Outbox scopes require one canonical actor and unique tenantId values');
  return {database,actorId:env.OUTBOX_DISPATCH_ACTOR_ID,scopes,batchSize:integer(env.OUTBOX_DISPATCH_BATCH||100,'OUTBOX_DISPATCH_BATCH',1,500),intervalMs:integer(env.OUTBOX_DISPATCH_INTERVAL_MS||5000,'OUTBOX_DISPATCH_INTERVAL_MS',100,3600000),concurrency:integer(env.OUTBOX_DISPATCH_CONCURRENCY||2,'OUTBOX_DISPATCH_CONCURRENCY',1,16),leaseSeconds:integer(env.OUTBOX_DISPATCH_LEASE_SECONDS||300,'OUTBOX_DISPATCH_LEASE_SECONDS',5,3600),maxAttempts:integer(env.OUTBOX_DISPATCH_MAX_ATTEMPTS||8,'OUTBOX_DISPATCH_MAX_ATTEMPTS',1,100),retryBaseSeconds:integer(env.OUTBOX_DISPATCH_RETRY_BASE_SECONDS||5,'OUTBOX_DISPATCH_RETRY_BASE_SECONDS',1,3600),timeoutMs:integer(env.OUTBOX_PUBLISH_TIMEOUT_MS||10000,'OUTBOX_PUBLISH_TIMEOUT_MS',100,60000),publisher:{endpoint:env.OUTBOX_PUBLISH_URL,token:env.OUTBOX_PUBLISH_TOKEN}};
}

export async function startOutboxDispatchWorker({env=process.env,fetcher=globalThis.fetch,logger=console}={}){
  const config=outboxDispatchConfig(env),runtimePool=await createPool({databaseUrl:config.database.databaseUrl,applicationName:'refs-outbox-dispatch-runtime'}),issuerPool=await createPool({databaseUrl:config.database.contextIssuerDatabaseUrl,applicationName:'refs-outbox-dispatch-issuer'}),principal={trusted:true,actorId:config.actorId,roleCode:'SERVICE'};
  try{
    const kernelFactory=async(_principal,scope)=>{const issuer=new PostgresContextIssuer(issuerPool,{principalProvider:async()=>({...principal,tenantId:scope.tenantId})});return new PostgresAccountingKernel(runtimePool,{sessionProvider:()=>issuer.issue({tenantId:scope.tenantId})});};
    const publisher=new HttpOutboxPublisher({...config.publisher,fetcher,timeoutMs:config.timeoutMs,nodeEnv:env.NODE_ENV}),service=new OutboxDispatchService({kernelFactory,publisher,maxAttempts:config.maxAttempts,retryBaseSeconds:config.retryBaseSeconds,leaseSeconds:config.leaseSeconds}),worker=new OutboxDispatchWorker({service,principal,scopes:config.scopes,batchSize:config.batchSize,intervalMs:config.intervalMs,concurrency:config.concurrency,logger});
    await Promise.all([runtimePool.query('SELECT 1'),issuerPool.query('SELECT 1')]);worker.start();let stopping=false;const stop=async signal=>{if(stopping)return;stopping=true;logger.info?.(JSON.stringify({event:'outbox_dispatch_stopping',signal,metrics:worker.metrics}));await worker.stop();await Promise.allSettled([runtimePool.end(),issuerPool.end()]);};for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>stop(signal).catch(error=>logger.error?.(JSON.stringify({event:'outbox_dispatch_stop_failed',code:error?.code||'OUTBOX_DISPATCH_INTERNAL'}))));return {worker,stop,config};
  }catch(error){await Promise.allSettled([runtimePool.end(),issuerPool.end()]);throw error;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startOutboxDispatchWorker().catch(error=>{console.error(JSON.stringify({event:'outbox_dispatch_start_failed',code:error?.code||'OUTBOX_DISPATCH_CONFIG_INVALID'}));process.exitCode=1;});
