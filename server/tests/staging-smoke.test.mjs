import test from 'node:test';
import assert from 'node:assert/strict';
import {runStagingSmoke,stagingSmokeConfig} from '../runtime/test-staging-smoke.mjs';

const config={apiBaseUrl:'https://api.staging.example',webOrigin:'https://app.staging.example'};
const response=(status,body,headers={})=>({status,headers:new Headers(headers),json:async()=>body,text:async()=>String(body??'')});
const webHeaders={'cache-control':'no-store','x-frame-options':'SAMEORIGIN','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':"default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' https://cdnjs.cloudflare.com; form-action 'self'"};
const webHtml='<!doctype html><script src="./refs-build.js"></script><script src="./refs-runtime-lock.js"></script><script src="./refs-runtime-config.js"></script><script src="./bundle.js"></script>';
const runtimeSource="window.__REFS_OIDC__={};window.__REFS_ACCOUNTING_API__={};window.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';";

test('staging smoke requires exact HTTPS deployment coordinates',()=>{
  assert.deepEqual(stagingSmokeConfig({REFS_STAGING_API_BASE_URL:'https://api.staging.example/',REFS_STAGING_WEB_ORIGIN:'https://app.staging.example/'}),config);
  for(const [api,web] of [['http://api.staging.example','https://app.staging.example'],['https://api.staging.example/path','https://app.staging.example'],['https://api.staging.example','https://app.staging.example?x=1']])assert.throws(()=>stagingSmokeConfig({REFS_STAGING_API_BASE_URL:api,REFS_STAGING_WEB_ORIGIN:web}),/HTTPS origin/);
});

test('staging smoke verifies web security, readiness CORS and anonymous API rejection without writes',async()=>{
  const calls=[];const result=await runStagingSmoke({config,fetcher:async(url,options={})=>{calls.push({url,options});if(url.endsWith('/health/ready'))return response(200,{ok:true,status:'ready'},{'cache-control':'no-store'});if(url===`${config.webOrigin}/`)return response(200,webHtml,webHeaders);if(url.endsWith('/refs-runtime-config.js'))return response(200,runtimeSource,{'cache-control':'no-store'});if(options.method==='OPTIONS')return response(204,null,{'access-control-allow-origin':config.webOrigin,'access-control-allow-credentials':'true',vary:'Origin'});return response(401,{ok:false,code:'AUTHENTICATION_REQUIRED'},{'cache-control':'no-store'});}});
  assert.deepEqual(result.checks,['ready','web-security','runtime-adapter','cors','anonymous-read-rejected']);assert.deepEqual(calls.map(call=>call.options.method),['GET','GET','GET','OPTIONS','GET']);assert.equal(calls[4].options.headers.authorization,undefined);
});

test('staging smoke fails closed for an unhealthy, permissive or anonymously-readable deployment',async()=>{
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async()=>response(503,{ok:false,status:'not_ready'},{'cache-control':'no-store'})}),/readiness/);
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async(url,options={})=>{if(url.endsWith('/health/ready'))return response(200,{ok:true,status:'ready'},{'cache-control':'no-store'});if(url===`${config.webOrigin}/`)return response(200,webHtml,webHeaders);if(url.endsWith('/refs-runtime-config.js'))return response(200,runtimeSource,{'cache-control':'no-store'});if(options.method==='OPTIONS')return response(204,null,{});return response(401,{ok:false,code:'AUTHENTICATION_REQUIRED'},{'cache-control':'no-store'});}}),/CORS/);
});
