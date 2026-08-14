import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createPool} from './db.mjs';import {runtimeConfig} from './config.mjs';
import {OidcJwtAuthenticator,RemoteJwksResolver} from '../api/oidc-authenticator.mjs';
import {createProductionAccountingServer} from './accounting-server.mjs';
import {S3AttachmentStorage,HttpVirusScanner} from './attachment-storage.mjs';
import {createWbsManifestSignatureVerifier,createWbsSnapshotSignatureVerifier} from './wbs-snapshot-signature.mjs';
import {createWbsAutoRecTransitionContractVerifier} from './wbs-autorec-transition-contract.mjs';
import {stage1SelfGrantConfig,stage1SelfWbsOperatorUpgradeConfig,stage1SelfWbsReadUpgradeConfig} from './stage1-bootstrap.mjs';
import {createWbsLivePilotClient} from './wbs-live-pilot-read-service.mjs';
import {createLiteLlmGateway} from './litellm-gateway.mjs';

const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);return parsed;};
const releaseSha=(value,production)=>{
  const sha=String(value||'').trim().toLowerCase();
  if(!sha&&!production)return null;
  if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('RENDER_GIT_COMMIT or GITHUB_SHA must be a full 40-character Git SHA in production');
  return sha;
};
const integrationMode=(value,name,production)=>{
  const mode=String(value||(production?'REQUIRED':'DISABLED')).trim().toUpperCase();
  if(!['REQUIRED','DISABLED'].includes(mode))throw new Error(`${name} must be REQUIRED or DISABLED`);
  return mode;
};
const requireAll=(env,keys)=>{for(const key of keys)if(!env[key])throw new Error(`${key} is required`);};
const scannerCa=(env)=>{
  const pem=typeof env.VIRUS_SCANNER_CA_PEM==='string'?env.VIRUS_SCANNER_CA_PEM.trim():'';
  const file=typeof env.VIRUS_SCANNER_CA_FILE==='string'?env.VIRUS_SCANNER_CA_FILE.trim():'';
  if(!pem&&!file)throw new Error('VIRUS_SCANNER_CA_PEM or VIRUS_SCANNER_CA_FILE is required');
  if(pem&&!pem.includes('-----BEGIN CERTIFICATE-----'))throw new Error('VIRUS_SCANNER_CA_PEM must contain a PEM certificate');
  return {pem:pem||null,file:file||null};
};
const allowedOrigins=(raw,production)=>{
  if(!raw)return [];
  const origins=[...new Set(raw.split(',').map(value=>value.trim()).filter(Boolean))];
  for(const origin of origins){let parsed;try{parsed=new URL(origin);}catch{throw new Error('REFS_HTTP_ALLOWED_ORIGINS must contain absolute origins');}if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||(production&&parsed.protocol!=='https:'))throw new Error('REFS_HTTP_ALLOWED_ORIGINS must contain HTTPS origins in production');}
  return origins;
};
export function accountingServerConfig(env=process.env){
  const production=env.NODE_ENV==='production';
  const database=runtimeConfig(env);const issuer=env.OIDC_ISSUER,audience=env.OIDC_AUDIENCE,jwksUri=env.OIDC_JWKS_URI;
  if(!issuer||!audience||!jwksUri)throw new Error('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required');
  const attachmentMode=integrationMode(env.REFS_ATTACHMENT_MODE,'REFS_ATTACHMENT_MODE',production);
  const wbsIngestMode=integrationMode(env.REFS_WBS_INGEST_MODE,'REFS_WBS_INGEST_MODE',production);
  const wbsLivePilotMode=String(env.REFS_WBS_LIVE_PILOT_MODE||'DISABLED').trim().toUpperCase();
  if(!['ENABLED','DISABLED'].includes(wbsLivePilotMode))throw new Error('REFS_WBS_LIVE_PILOT_MODE must be ENABLED or DISABLED');
  const aiMode=String(env.REFS_AI_MODE||'DISABLED').trim().toUpperCase();if(!['ENABLED','DISABLED'].includes(aiMode))throw new Error('REFS_AI_MODE must be ENABLED or DISABLED');
  const aiGateway=aiMode==='ENABLED'?createLiteLlmGateway({baseUrl:env.LITELLM_BASE_URL,apiKey:env.LITELLM_API_KEY,model:env.LITELLM_MODEL||'gpt-4.1-mini',timeoutMs:integer(env.LITELLM_TIMEOUT_MS||45000,'LITELLM_TIMEOUT_MS',{min:1000,max:120000}),fetcher:globalThis.fetch}):null;
  const attachmentKeys=['S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID'];
  if(attachmentMode==='REQUIRED')requireAll(env,attachmentKeys);
  const scannerCaConfig=attachmentMode==='REQUIRED'?scannerCa(env):null;
  let wbsSnapshotPublicKeys=null;
  let wbsProviderSignedTrust=null,wbsProviderSignedServiceActorId=null;
  if(wbsIngestMode==='REQUIRED'){
    requireAll(env,['WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','WBS_PROVIDER_SIGNED_TRUST','WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID']);
    try{wbsSnapshotPublicKeys=JSON.parse(env.WBS_SNAPSHOT_ED25519_PUBLIC_KEYS);}catch{throw new Error('WBS_SNAPSHOT_ED25519_PUBLIC_KEYS must be JSON');}
    try{wbsProviderSignedTrust=JSON.parse(env.WBS_PROVIDER_SIGNED_TRUST);}catch{throw new Error('WBS_PROVIDER_SIGNED_TRUST must be JSON');}
    if(!wbsProviderSignedTrust||typeof wbsProviderSignedTrust.issuer!=='string'||typeof wbsProviderSignedTrust.key_id!=='string'||typeof wbsProviderSignedTrust.public_key!=='string')throw new Error('WBS_PROVIDER_SIGNED_TRUST requires issuer, key_id and public_key');
    wbsProviderSignedServiceActorId=env.WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID;
  }
  const wbsLivePilotKeys=['WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'];
  if(wbsLivePilotMode==='ENABLED')requireAll(env,wbsLivePilotKeys);
  const origins=allowedOrigins(env.REFS_HTTP_ALLOWED_ORIGINS||'',production);if(production&&!origins.length)throw new Error('REFS_HTTP_ALLOWED_ORIGINS is required in production');
  const deploymentRelease=releaseSha(env.RENDER_GIT_COMMIT||env.GITHUB_SHA,production);
  return {database,issuer,audience,jwksUri,host:env.REFS_HTTP_HOST||'127.0.0.1',port:integer(env.PORT||8080,'PORT',{min:1,max:65535}),maxBodyBytes:integer(env.REFS_HTTP_MAX_BODY_BYTES||1048576,'REFS_HTTP_MAX_BODY_BYTES',{min:1024,max:10*1024*1024}),runtimePoolMax:integer(env.REFS_PG_RUNTIME_POOL_MAX||4,'REFS_PG_RUNTIME_POOL_MAX',{min:1,max:20}),issuerPoolMax:integer(env.REFS_PG_ISSUER_POOL_MAX||2,'REFS_PG_ISSUER_POOL_MAX',{min:1,max:10}),allowedOrigins:origins,
    attachmentMode,wbsIngestMode,wbsSnapshotPublicKeys,wbsProviderSignedTrust,wbsProviderSignedServiceActorId,wbsLivePilotMode,wbsLivePilotCredentials:wbsLivePilotMode==='ENABLED'?{'CF-Access-Client-Id':env.WBS_CF_ACCESS_CLIENT_ID,'CF-Access-Client-Secret':env.WBS_CF_ACCESS_CLIENT_SECRET,'X-REFS-Auth':env.WBS_REFS_AUTH}:null,aiMode,aiGateway,controlledDemoEnabled:database.controlledDemoEnabled,stage1SelfGrant:stage1SelfGrantConfig(env),stage1SelfWbsReadUpgrade:stage1SelfWbsReadUpgradeConfig(env),stage1SelfWbsOperatorUpgrade:stage1SelfWbsOperatorUpgradeConfig(env),releaseSha:deploymentRelease,s3:attachmentMode==='REQUIRED'?{endpoint:env.S3_ENDPOINT,bucket:env.S3_BUCKET,region:env.S3_REGION,accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY,sessionToken:env.S3_SESSION_TOKEN||null}:null,scanner:attachmentMode==='REQUIRED'?{endpoint:env.VIRUS_SCANNER_ENDPOINT,bearerToken:env.VIRUS_SCANNER_TOKEN,caFile:scannerCaConfig.file,caPem:scannerCaConfig.pem,serverName:env.VIRUS_SCANNER_SERVER_NAME,actorId:env.ATTACHMENT_SCANNER_ACTOR_ID,timeoutMs:integer(env.VIRUS_SCANNER_TIMEOUT_MS||30000,'VIRUS_SCANNER_TIMEOUT_MS',{min:100,max:120000}),maxAttempts:integer(env.VIRUS_SCANNER_MAX_ATTEMPTS||3,'VIRUS_SCANNER_MAX_ATTEMPTS',{min:1,max:5}),retryBaseMs:integer(env.VIRUS_SCANNER_RETRY_BASE_MS||100,'VIRUS_SCANNER_RETRY_BASE_MS',{min:1,max:10000})}:null};
}

export async function startAccountingServer({env=process.env,fetcher=globalThis.fetch,logger=console}={}){
  const config=accountingServerConfig(env);
  const runtimePool=await createPool({databaseUrl:config.database.databaseUrl,applicationName:'refs-accounting-http-runtime',max:config.runtimePoolMax});
  const issuerPool=await createPool({databaseUrl:config.database.contextIssuerDatabaseUrl,applicationName:'refs-accounting-http-issuer',max:config.issuerPoolMax});
  const grantSyncPool=(config.stage1SelfGrant||config.stage1SelfWbsReadUpgrade||config.stage1SelfWbsOperatorUpgrade)?await createPool({databaseUrl:config.database.grantSyncDatabaseUrl,applicationName:'refs-accounting-http-stage1-grant',max:1}):null;
  const resolver=new RemoteJwksResolver({jwksUri:config.jwksUri,fetcher});
  const authenticator=new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:resolver});
  const wbsSnapshotVerifier=config.wbsIngestMode==='REQUIRED'?createWbsSnapshotSignatureVerifier({publicKeys:config.wbsSnapshotPublicKeys}):null;
  const wbsManifestVerifier=config.wbsIngestMode==='REQUIRED'?createWbsManifestSignatureVerifier({publicKeys:config.wbsSnapshotPublicKeys}):null;
  const wbsSignedBankAdmissionVerifier=wbsManifestVerifier?admission=>wbsManifestVerifier({manifest_hash:admission?.admission_hash,detached_signature:admission?.detached_signature}):null;
  const wbsAutoRecTransitionContractVerifier=config.wbsIngestMode==='REQUIRED'?createWbsAutoRecTransitionContractVerifier({publicKeys:config.wbsSnapshotPublicKeys}):null;
  const attachmentStorage=config.attachmentMode==='REQUIRED'?new S3AttachmentStorage({...config.s3,fetcher}):null;
  const scannerCaPem=config.attachmentMode==='REQUIRED'?(config.scanner.caPem||await readFile(config.scanner.caFile,'utf8')):null;
  const virusScanner=config.attachmentMode==='REQUIRED'?new HttpVirusScanner({...config.scanner,ca:scannerCaPem}):null;
  const wbsLivePilotClient=config.wbsLivePilotMode==='ENABLED'?createWbsLivePilotClient({credentials:config.wbsLivePilotCredentials,fetcher}):null;
  const server=createProductionAccountingServer({runtimePool,issuerPool,grantSyncPool,stage1SelfGrant:config.stage1SelfGrant,stage1SelfWbsReadUpgrade:config.stage1SelfWbsReadUpgrade,stage1SelfWbsOperatorUpgrade:config.stage1SelfWbsOperatorUpgrade,authenticator,attachmentStorage,virusScanner,scannerServiceActorId:config.scanner?.actorId,wbsSnapshotVerifier,wbsSignedBankAdmissionVerifier,wbsAutoRecTransitionContractVerifier,wbsLivePilotClient,wbsProviderSignedTrust:config.wbsProviderSignedTrust,wbsProviderSignedServiceActorId:config.wbsProviderSignedServiceActorId,aiGateway:config.aiGateway,maxBodyBytes:config.maxBodyBytes,releaseSha:config.releaseSha,allowedOrigins:config.allowedOrigins});
  try{await Promise.all([runtimePool.query('SELECT 1'),issuerPool.query('SELECT 1'),...(grantSyncPool?[grantSyncPool.query('SELECT 1')]:[])]);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});}
  catch(error){await Promise.allSettled([runtimePool.end(),issuerPool.end(),grantSyncPool?.end()]);throw error;}
  let stopping=false;const stop=async signal=>{if(stopping)return;stopping=true;logger.info?.(JSON.stringify({event:'accounting_server_stopping',signal}));await new Promise(resolve=>server.close(resolve));await Promise.allSettled([runtimePool.end(),issuerPool.end(),grantSyncPool?.end()]);};
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop(signal).catch(error=>logger.error?.(error));});
  logger.info?.(JSON.stringify({event:'accounting_server_started',host:config.host,port:config.port}));return {server,runtimePool,issuerPool,stop,config};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startAccountingServer().catch(error=>{console.error(JSON.stringify({event:'accounting_server_start_failed',message:error.message}));process.exitCode=1;});
