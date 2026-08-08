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
const header=(response,name)=>String(response.headers.get(name)||'').toLowerCase();
const exactRuntimeAssignment=(source,name)=>{
  const match=source.match(new RegExp(`window\\.${name}=([^;]+);`));
  if(!match)throw new Error(`Staging runtime adapter is missing ${name}`);
  return match[1];
};
const jsonAssignment=(source,name)=>{
  const value=exactRuntimeAssignment(source,name);
  try{return JSON.parse(value);}catch{throw new Error(`Staging runtime adapter ${name} is not JSON`);}
};
const quotedProperty=(source,objectName,property)=>{
  const expression=exactRuntimeAssignment(source,objectName);
  const match=expression.match(new RegExp(`${property}:\\"([^\\"]*)\\"`));
  if(!match)throw new Error(`Staging runtime adapter is missing ${objectName}.${property}`);
  return match[1];
};
const httpsUrl=(value,name)=>{
  let url;try{url=new URL(value);}catch{throw new Error(`${name} must be HTTPS`);}
  if(url.protocol!=='https:'||url.username||url.password)throw new Error(`${name} must be HTTPS`);
  return url;
};
const assertAuthoritativeRuntime=(source,config)=>{
  const mode=exactRuntimeAssignment(source,'__REFS_RUNTIME_MODE__');
  expect(mode==="'REQUIRES_AUTHORITATIVE_API'",'Staging runtime adapter must declare one authoritative runtime mode');
  const oidc=jsonAssignment(source,'__REFS_OIDC__');
  expect(oidc&&typeof oidc==='object'&&!Array.isArray(oidc),'Staging runtime adapter OIDC configuration is invalid');
  for(const key of ['issuer','authorizationEndpoint','tokenEndpoint','redirectUri','clientId','audience'])expect(typeof oidc[key]==='string'&&oidc[key].trim(),`Staging runtime adapter is missing OIDC ${key}`);
  const issuer=httpsUrl(oidc.issuer,'OIDC issuer'),authorization=httpsUrl(oidc.authorizationEndpoint,'OIDC authorization endpoint'),token=httpsUrl(oidc.tokenEndpoint,'OIDC token endpoint'),redirect=httpsUrl(oidc.redirectUri,'OIDC redirect URI');
  expect(redirect.origin===config.webOrigin,'Staging OIDC redirect URI must use the configured web origin');
  expect(issuer.origin===authorization.origin&&issuer.origin===token.origin,'Staging OIDC endpoints must use one issuer origin');
  const apiBase=httpsUrl(quotedProperty(source,'__REFS_ACCOUNTING_API__','baseUrl'),'Accounting API base URL');
  expect(apiBase.origin===config.apiBaseUrl,'Staging runtime adapter must point at the configured accounting API origin');
  for(const property of ['entityId','periodId','cashAccountCode'])expect(quotedProperty(source,'__REFS_ACCOUNTING_API__',property).trim(),`Staging runtime adapter is missing accounting API ${property}`);
  const apiExpression=exactRuntimeAssignment(source,'__REFS_ACCOUNTING_API__');
  expect(/getAccessToken:async\(\)=>window\.refsOidcClient\?\.getAccessToken\(\)/.test(apiExpression),'Staging runtime adapter must obtain browser tokens from the OIDC client');
  expect(!/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS|PRIVATE KEY/i.test(source),'Staging runtime adapter must not contain placeholders or secrets');
};
const assertRuntimeLock=(source)=>{
  expect(/Object\.defineProperty\(window,'__REFS_RUNTIME_MODE__'/.test(source),'Staging runtime lock must own the runtime mode slot');
  expect(/configurable:false/.test(source),'Staging runtime lock must not be redefinable');
  expect(/RUNTIME_MODE_REJECTED/.test(source),'Staging runtime lock must reject unrecognised modes');
};
const assertBuildStamp=(source)=>{
  expect(/window\.__BUILD=/.test(source),'Staging build stamp is missing');
  expect(/channel:\"AUTHORITATIVE\"/.test(source),'Staging build stamp must declare the authoritative channel');
  expect(/authoritative:true/.test(source),'Staging build stamp must declare authoritative:true');
  expect(!/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS/i.test(source),'Staging build stamp must not contain placeholders or secrets');
};

export async function runStagingSmoke({config=stagingSmokeConfig(),fetcher=globalThis.fetch}={}){
  if(typeof fetcher!=='function')throw new Error('A fetch implementation is required');
  const endpoint=`${config.apiBaseUrl}/api/v1/entities/${UUID}/ap/bills`;
  const ready=await fetcher(`${config.apiBaseUrl}/health/ready`,{method:'GET',redirect:'error',cache:'no-store'});
  expect(ready.status===200,'Staging readiness endpoint did not return HTTP 200');
  expect(noStore(ready),'Staging readiness response must be no-store');
  const readyBody=await ready.json();expect(readyBody?.ok===true&&readyBody?.status==='ready','Staging readiness response is invalid');
  const web=await fetcher(`${config.webOrigin}/`,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'text/html'}});
  expect(web.status===200,'Staging web root did not return HTTP 200');
  expect(noStore(web),'Staging web root must be no-store');
  expect(header(web,'x-frame-options')==='sameorigin','Staging web root must deny cross-origin framing');
  expect(header(web,'x-content-type-options')==='nosniff','Staging web root must disable MIME sniffing');
  expect(header(web,'referrer-policy')==='strict-origin-when-cross-origin','Staging web root has an unexpected referrer policy');
  const csp=header(web,'content-security-policy');
  for(const directive of ["default-src 'self'","base-uri 'self'","object-src 'none'","frame-ancestors 'self'","script-src 'self' https://cdnjs.cloudflare.com","form-action 'self'"])expect(csp.includes(directive),`Staging web CSP is missing ${directive}`);
  expect(!csp.includes("script-src 'self' 'unsafe-inline'"),'Staging web CSP must not allow inline scripts');
  const html=await web.text();
  for(const asset of ['./refs-build.js','./refs-runtime-lock.js','./refs-runtime-config.js','./bundle.js'])expect(html.includes(asset),`Staging web root is missing ${asset}`);
  const readRuntimeAsset=async name=>{
    const response=await fetcher(`${config.webOrigin}/${name}`,{method:'GET',redirect:'error',cache:'no-store',headers:{accept:'application/javascript'}});
    expect(response.status===200,`Staging ${name} did not return HTTP 200`);
    expect(noStore(response),`Staging ${name} must be no-store`);
    return response.text();
  };
  const [buildSource,lockSource,runtimeSource]=await Promise.all([
    readRuntimeAsset('refs-build.js'),
    readRuntimeAsset('refs-runtime-lock.js'),
    readRuntimeAsset('refs-runtime-config.js'),
  ]);
  assertBuildStamp(await buildSource);assertRuntimeLock(await lockSource);assertAuthoritativeRuntime(await runtimeSource,config);
  const preflight=await fetcher(endpoint,{method:'OPTIONS',redirect:'error',headers:{origin:config.webOrigin,'access-control-request-method':'GET','access-control-request-headers':'authorization'}});
  expect(preflight.status===204,'Staging CORS preflight did not return HTTP 204');
  expect(preflight.headers.get('access-control-allow-origin')===config.webOrigin,'Staging CORS does not allow the configured web origin');
  expect(preflight.headers.get('access-control-allow-credentials')==='true','Staging CORS must allow browser credentials for the configured origin');
  expect(String(preflight.headers.get('vary')||'').toLowerCase().split(',').map(value=>value.trim()).includes('origin'),'Staging CORS response must vary by Origin');
  const anonymous=await fetcher(endpoint,{method:'GET',redirect:'error',cache:'no-store',headers:{origin:config.webOrigin,accept:'application/json'}});
  expect(anonymous.status===401,'Staging accounting reads must reject anonymous callers with HTTP 401');
  expect(noStore(anonymous),'Staging anonymous problem response must be no-store');
  const anonymousBody=await anonymous.json();expect(anonymousBody?.ok===false&&anonymousBody?.code==='AUTHENTICATION_REQUIRED','Staging anonymous response is not the expected fail-closed problem');
  return {ok:true,checks:['ready','web-security','runtime-assets','cors','anonymous-read-rejected']};
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  runStagingSmoke().then(result=>console.log(`staging-smoke: ${result.checks.join(', ')} passed`)).catch(error=>{console.error(`staging-smoke: ${error.message}`);process.exitCode=1;});
}
