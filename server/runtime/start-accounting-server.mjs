import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
import {createPool} from './db.mjs';import {runtimeConfig} from './config.mjs';
import {OidcJwtAuthenticator,RemoteJwksResolver} from '../api/oidc-authenticator.mjs';
import {createProductionAccountingServer} from './accounting-server.mjs';
import {S3AttachmentStorage,HttpVirusScanner} from './attachment-storage.mjs';

const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);return parsed;};
const allowedOrigins=(raw,production)=>{
  if(!raw)return [];
  const origins=[...new Set(raw.split(',').map(value=>value.trim()).filter(Boolean))];
  for(const origin of origins){let parsed;try{parsed=new URL(origin);}catch{throw new Error('REFS_HTTP_ALLOWED_ORIGINS must contain absolute origins');}if(parsed.origin!==origin||!['http:','https:'].includes(parsed.protocol)||(production&&parsed.protocol!=='https:'))throw new Error('REFS_HTTP_ALLOWED_ORIGINS must contain HTTPS origins in production');}
  return origins;
};
export function accountingServerConfig(env=process.env){
  const database=runtimeConfig(env);const issuer=env.OIDC_ISSUER,audience=env.OIDC_AUDIENCE,jwksUri=env.OIDC_JWKS_URI;
  if(!issuer||!audience||!jwksUri)throw new Error('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required');
  const required=['S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID'];for(const key of required)if(!env[key])throw new Error(`${key} is required`);
  const origins=allowedOrigins(env.REFS_HTTP_ALLOWED_ORIGINS||'',env.NODE_ENV==='production');if(env.NODE_ENV==='production'&&!origins.length)throw new Error('REFS_HTTP_ALLOWED_ORIGINS is required in production');
  return {database,issuer,audience,jwksUri,host:env.REFS_HTTP_HOST||'127.0.0.1',port:integer(env.PORT||8080,'PORT',{min:1,max:65535}),maxBodyBytes:integer(env.REFS_HTTP_MAX_BODY_BYTES||1048576,'REFS_HTTP_MAX_BODY_BYTES',{min:1024,max:10*1024*1024}),allowedOrigins:origins,
    s3:{endpoint:env.S3_ENDPOINT,bucket:env.S3_BUCKET,region:env.S3_REGION,accessKeyId:env.S3_ACCESS_KEY_ID,secretAccessKey:env.S3_SECRET_ACCESS_KEY,sessionToken:env.S3_SESSION_TOKEN||null},scanner:{endpoint:env.VIRUS_SCANNER_ENDPOINT,bearerToken:env.VIRUS_SCANNER_TOKEN,caFile:env.VIRUS_SCANNER_CA_FILE,serverName:env.VIRUS_SCANNER_SERVER_NAME,actorId:env.ATTACHMENT_SCANNER_ACTOR_ID,timeoutMs:integer(env.VIRUS_SCANNER_TIMEOUT_MS||30000,'VIRUS_SCANNER_TIMEOUT_MS',{min:100,max:120000}),maxAttempts:integer(env.VIRUS_SCANNER_MAX_ATTEMPTS||3,'VIRUS_SCANNER_MAX_ATTEMPTS',{min:1,max:5}),retryBaseMs:integer(env.VIRUS_SCANNER_RETRY_BASE_MS||100,'VIRUS_SCANNER_RETRY_BASE_MS',{min:1,max:10000})}};
}

export async function startAccountingServer({env=process.env,fetcher=globalThis.fetch,logger=console}={}){
  const config=accountingServerConfig(env);
  const runtimePool=await createPool({databaseUrl:config.database.databaseUrl,applicationName:'refs-accounting-http-runtime'});
  const issuerPool=await createPool({databaseUrl:config.database.contextIssuerDatabaseUrl,applicationName:'refs-accounting-http-issuer'});
  const resolver=new RemoteJwksResolver({jwksUri:config.jwksUri,fetcher});
  const authenticator=new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:resolver});
  const attachmentStorage=new S3AttachmentStorage({...config.s3,fetcher});const virusScanner=new HttpVirusScanner({...config.scanner,ca:await readFile(config.scanner.caFile)});
  const server=createProductionAccountingServer({runtimePool,issuerPool,authenticator,attachmentStorage,virusScanner,scannerServiceActorId:config.scanner.actorId,maxBodyBytes:config.maxBodyBytes,allowedOrigins:config.allowedOrigins});
  try{await Promise.all([runtimePool.query('SELECT 1'),issuerPool.query('SELECT 1')]);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});}
  catch(error){await Promise.allSettled([runtimePool.end(),issuerPool.end()]);throw error;}
  let stopping=false;const stop=async signal=>{if(stopping)return;stopping=true;logger.info?.(JSON.stringify({event:'accounting_server_stopping',signal}));await new Promise(resolve=>server.close(resolve));await Promise.allSettled([runtimePool.end(),issuerPool.end()]);};
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop(signal).catch(error=>logger.error?.(error));});
  logger.info?.(JSON.stringify({event:'accounting_server_started',host:config.host,port:config.port}));return {server,runtimePool,issuerPool,stop,config};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startAccountingServer().catch(error=>{console.error(JSON.stringify({event:'accounting_server_start_failed',message:error.message}));process.exitCode=1;});
