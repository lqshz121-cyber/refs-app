import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const UUID='00000000-0000-4000-8000-000000000000';

const httpsOrigin=(value,name)=>{
  if(typeof value!=='string'||!value.trim())throw new Error(`${name} is required`);
  let url;try{url=new URL(value);}catch{throw new Error(`${name} must be an HTTPS origin`);}
  if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error(`${name} must be an HTTPS origin`);
  return url.origin;
};

export const stagingSmokeConfig=(environment=process.env)=>({
  apiBaseUrl:httpsOrigin(environment.REFS_STAGING_API_BASE_URL,'REFS_STAGING_API_BASE_URL'),
  webOrigin:httpsOrigin(environment.REFS_STAGING_WEB_ORIGIN,'REFS_STAGING_WEB_ORIGIN'),
});

const expect=(condition,message)=>{if(!condition)throw new Error(message);};
const noStore=response=>String(response.headers.get('cache-control')||'').toLowerCase().split(',').map(value=>value.trim()).includes('no-store');

export async function runStagingSmoke({config=stagingSmokeConfig(),fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function')throw new Error('A fetch implementation is required');
  const endpoint=`${config.apiBaseUrl}/api/v1/entities/${UUID}/ap/bills`;
  const ready=await fetcher(`${config.apiBaseUrl}/health/ready`,{method:'GET',redirect:'error',cache:'no-store'});
  expect(ready.status===200,'Staging readiness endpoint did not return HTTP 200');
  expect(noStore(ready),'Staging readiness response must be no-store');
  const readyBody=await ready.json();expect(readyBody?.ok===true&&readyBody?.status==='ready','Staging readiness response is invalid');
  const preflight=await fetcher(endpoint,{method:'OPTIONS',redirect:'error',headers:{origin:config.webOrigin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  expect(preflight.status===204,'Staging CORS preflight did not return HTTP 204');
  expect(preflight.headers.get('access-control-allow-origin')===config.webOrigin,'Staging CORS does not allow the configured web origin');
  expect(preflight.headers.get('access-control-allow-credentials')==='true','Staging CORS must allow browser credentials for the configured origin');
  expect(String(preflight.headers.get('vary')||'').toLowerCase().split(',').map(value=>value.trim()).includes('origin'),'Staging CORS response must vary by Origin');
  const anonymous=await fetcher(endpoint,{method:'GET',redirect:'error',cache:'no-store',headers:{origin:config.webOrigin,accept:'application/json'}});
  expect(anonymous.status===401,'Staging accounting reads must reject anonymous callers with HTTP 401');
  expect(noStore(anonymous),'Staging anonymous problem response must be no-store');
  const anonymousBody=await anonymous.json();expect(anonymousBody?.ok===false&&anonymousBody?.code==='AUTHENTICATION_REQUIRED','Staging anonymous response is not the expected fail-closed problem');
  return {ok:true,checks:['ready','cors','anonymous-read-rejected']};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  runStagingSmoke().then(result=>console.log(`staging-smoke: ${result.checks.join(', ')} passed`)).catch(error=>{console.error(`staging-smoke: ${error.message}`);process.exitCode=1;});
}
