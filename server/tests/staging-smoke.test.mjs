import test from 'node:test';
import assert from 'node:assert/strict';
import {runStagingSmoke,stagingSmokeConfig} from '../runtime/test-staging-smoke.mjs';

const config={apiBaseUrl:'https://api.staging.example',webOrigin:'https://app.staging.example'};
const response=(status,body,headers={})=>({status,headers:new Headers(headers),json:async()=>body});

test('staging smoke requires exact HTTPS deployment coordinates',()=>{
  assert.deepEqual(stagingSmokeConfig({REFS_STAGING_API_BASE_URL:'https://api.staging.example/',REFS_STAGING_WEB_ORIGIN:'https://app.staging.example/'}),config);
  for(const [api,web] of [['http://api.staging.example','https://app.staging.example'],['https://api.staging.example/path','https://app.staging.example'],['https://api.staging.example','https://app.staging.example?x=1']])assert.throws(()=>stagingSmokeConfig({REFS_STAGING_API_BASE_URL:api,REFS_STAGING_WEB_ORIGIN:web}),/HTTPS origin/);
});

test('staging smoke verifies readiness CORS and anonymous API rejection without writes',async()=>{
  const calls=[];const result=await runStagingSmoke({config,fetcher:async(url,options={})=>{calls.push({url,options});if(url.endsWith('/health/ready'))return response(200,{ok:true,status:'ready'},{'cache-control':'no-store'});if(options.method==='OPTIONS')return response(204,null,{'access-control-allow-origin':config.webOrigin,'access-control-allow-credentials':'true',vary:'Origin'});return response(401,{ok:false,code:'AUTHENTICATION_REQUIRED'},{'cache-control':'no-store'});}});
  assert.deepEqual(result.checks,['ready','cors','anonymous-read-rejected']);assert.deepEqual(calls.map(call=>call.options.method),['GET','OPTIONS','GET']);assert.equal(calls[2].options.headers.authorization,undefined);
});

test('staging smoke fails closed for an unhealthy, permissive or anonymously-readable deployment',async()=>{
  await assert.rejects(()=>runStagingSmoke({config,fetcher:async()=>response(503,{ok:false,status:'not_ready'},{'cache-control':'no-store'})}),/readiness/);
  let phase=0;await assert.rejects(()=>runStagingSmoke({config,fetcher:async()=>{phase++;if(phase===1)return response(200,{ok:true,status:'ready'},{'cache-control':'no-store'});return response(204,null,{});}}),/CORS/);
});
