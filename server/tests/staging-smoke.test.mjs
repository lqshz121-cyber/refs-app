import test from 'node:test';
import assert from 'node:assert/strict';
import {runStagingSmoke,stagingSmokeConfig} from '../runtime/test-staging-smoke.mjs';

const config={apiBaseUrl:'https://api.staging.example',webOrigin:'https://app.staging.example'};
const response=(status,body,headers={})=>({status,headers:new Headers(headers),json:async()=>body,text:async()=>String(body??'')});
const webHeaders={'cache-control':'no-store','x-frame-options':'SAMEORIGIN','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' https://cdnjs.cloudflare.com; form-action 'self'"};
const webHtml='<!doctype html><script src="./refs-build.js"></script><script src="./refs-runtime-lock.js"></script><script src="./refs-runtime-config.js"></script><script src="./bundle.js"></script>';
const buildSource='window.__BUILD=Object.assign(window.__BUILD||{},{channel:"AUTHORITATIVE",authoritative:true});';
const lockSource="Object.defineProperty(window,'__REFS_RUNTIME_MODE__',{configurable:false});window.__REFS_RUNTIME_MODE__='RUNTIME_MODE_REJECTED';";
const runtimeSource="window.__REFS_OIDC__={\"issuer\":\"https://issuer.staging.example\",\"authorizationEndpoint\":\"https://issuer.staging.example/authorize\",\"tokenEndpoint\":\"https://issuer.staging.example/token\",\"redirectUri\":\"https://app.staging.example/callback\",\"clientId\":\"refs-browser\",\"audience\":\"refs-accounting\",\"scope\":\"openid profile\"};window.__REFS_ACCOUNTING_API__={baseUrl:\"https://api.staging.example\",entityId:\"11111111-1111-4111-8111-111111111111\",periodId:\"33333333-3333-4333-8333-333333333333\",cashAccountCode:\"111000\",getAccessToken:async()=>window.refsOidcClient?.getAccessToken()};window.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';";
const runtimeAsset=(name,body,headers={'cache-control':'no-store'})=>({name,body,headers});
const healthyFetcher=async(url,options={})=>{
  if(url.endsWith('/health/ready'))return response(200,{ok:true,status:'ready'},{'cache-control':'no-store'});
  if(url===`${config.webOrigin}/`)return response(200,webHtml,webHeaders);
  if(url.endsWith('/refs-build.js'))return response(200,buildSource,{'cache-control':'no-store'});
  if(url.endsWith('/refs-runtime-lock.js'))return response(200,lockSource,{'cache-control':'no-store'});
  if(url.endsWith('/refs-runtime-config.js'))return response(200,runtimeSource,{'cache-control':'no-store'});
  if(options.method==='OPTIONS')return response(204,null,{'access-control-allow-origin':config.webOrigin,'access-control-allow-credentials':'true',vary:'Origin'});
  return response(401,{ok:false,code:'AUTHENTICATION_REQUIRED'},{'cache-control':'no-store'});
};

test('staging smoke requires exact HTTPS deployment coordinates',()=>{
  assert.deepEqual(stagingSmokeConfig({REFS_STAGING_API_BASE_URL:'https://api.staging.example/',REFS_STAGING_WEB_ORIGIN:'https://app.staging.example/'}),config);
  for(const [api,web] of [['http://api.staging.example','https://app.staging.example'],['https://api.staging.example/path','https://app.staging.example'],['https://api.staging.example','https://app.staging.example?x=1']])assert.throws(()=>stagingSmokeConfig({REFS_STAGING_API_BASE_URL:api,REFS_STAGING_WEB_ORIGIN:web}),/HTTPS origin/);
});

test('staging smoke verifies web security, readiness CORS and anonymous API rejection without writes',async()=>{
  const calls=[];const result=await runStagingSmoke({config,fetcher:async(url,options={})=>{calls.push({url,options});return healthyFetcher(url,options);}});
  assert.deepEqual(result.checks,['ready','web-security','runtime-assets','cors','anonymous-read-rejected']);assert.deepEqual(calls.map(call=>call.options.method),['GET','GET','GET','GET','GET','OPTIONS','GET']);assert.equal(calls.at(-1).options.headers.authorization,undefined);
});

test('staging smoke fails closed for an unhealthy, permissive or anonymously-readable deployment',async()=>{
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async()=>response(503,{ok:false,status:'not_ready'},{'cache-control':'no-store'})}),/readiness/);
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async(url,options={})=>{if(options.method==='OPTIONS')return response(204,null,{});return healthyFetcher(url,options);}}),/CORS/);
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async(url,options={})=>url.endsWith('/refs-build.js')?response(200,'window.__BUILD={channel:"PUBLIC_DEMONSTRATION",authoritative:false};',{'cache-control':'no-store'}):healthyFetcher(url,options)}),/authoritative channel/);
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async(url,options={})=>url.endsWith('/refs-runtime-lock.js')?response(200,lockSource,{}):healthyFetcher(url,options)}),/refs-runtime-lock\.js must be no-store/);
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async(url,options={})=>url.endsWith('/refs-runtime-config.js')?response(200,runtimeSource.replace('https://api.staging.example','https://wrong.example'),{'cache-control':'no-store'}):healthyFetcher(url,options)}),/configured accounting API origin/);
});
