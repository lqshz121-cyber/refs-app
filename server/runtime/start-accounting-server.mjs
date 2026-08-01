import {pathToFileURL} from 'node:url';
import {createPool} from './db.mjs';import {runtimeConfig} from './config.mjs';
import {OidcJwtAuthenticator,RemoteJwksResolver} from '../api/oidc-authenticator.mjs';
import {createProductionAccountingServer} from './accounting-server.mjs';

const integer=(value,name,{min,max})=>{const parsed=Number(value);if(!Number.isSafeInteger(parsed)||parsed<min||parsed>max)throw new Error(`${name} must be an integer between ${min} and ${max}`);return parsed;};
export function accountingServerConfig(env=process.env){
  const database=runtimeConfig(env);const issuer=env.OIDC_ISSUER,audience=env.OIDC_AUDIENCE,jwksUri=env.OIDC_JWKS_URI;
  if(!issuer||!audience||!jwksUri)throw new Error('OIDC_ISSUER, OIDC_AUDIENCE and OIDC_JWKS_URI are required');
  return {database,issuer,audience,jwksUri,host:env.REFS_HTTP_HOST||'127.0.0.1',port:integer(env.PORT||8080,'PORT',{min:1,max:65535}),maxBodyBytes:integer(env.REFS_HTTP_MAX_BODY_BYTES||1048576,'REFS_HTTP_MAX_BODY_BYTES',{min:1024,max:10*1024*1024})};
}

export async function startAccountingServer({env=process.env,fetcher=globalThis.fetch,logger=console}={}){
  const config=accountingServerConfig(env);
  const runtimePool=await createPool({databaseUrl:config.database.databaseUrl,applicationName:'refs-accounting-http-runtime'});
  const issuerPool=await createPool({databaseUrl:config.database.contextIssuerDatabaseUrl,applicationName:'refs-accounting-http-issuer'});
  const resolver=new RemoteJwksResolver({jwksUri:config.jwksUri,fetcher});
  const authenticator=new OidcJwtAuthenticator({issuer:config.issuer,audience:config.audience,keyResolver:resolver});
  const server=createProductionAccountingServer({runtimePool,issuerPool,authenticator,maxBodyBytes:config.maxBodyBytes});
  try{await Promise.all([runtimePool.query('SELECT 1'),issuerPool.query('SELECT 1')]);await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port,config.host,resolve);});}
  catch(error){await Promise.allSettled([runtimePool.end(),issuerPool.end()]);throw error;}
  let stopping=false;const stop=async signal=>{if(stopping)return;stopping=true;logger.info?.(JSON.stringify({event:'accounting_server_stopping',signal}));await new Promise(resolve=>server.close(resolve));await Promise.allSettled([runtimePool.end(),issuerPool.end()]);};
  for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{stop(signal).catch(error=>logger.error?.(error));});
  logger.info?.(JSON.stringify({event:'accounting_server_started',host:config.host,port:config.port}));return {server,runtimePool,issuerPool,stop,config};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)startAccountingServer().catch(error=>{console.error(JSON.stringify({event:'accounting_server_start_failed',message:error.message}));process.exitCode=1;});
