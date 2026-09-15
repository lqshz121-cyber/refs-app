import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRenderInternalTestRelease} from '../runtime/verify-render-internal-test-release.mjs';

const sha='a'.repeat(40);
const response=({status=200,body={},text=null}={})=>({status,json:async()=>body,text:async()=>text??JSON.stringify(body)});
const base={releaseSha:sha,apiBaseUrl:'https://api.example.test',webOrigin:'https://web.example.test'};
const runtime="window.__REFS_OIDC__=null; window.__REFS_ACCOUNTING_API__={cashTransferUiMode:'ENABLED',internalTestNoLogin:true}; window.__REFS_RUNTIME_MODE__='INTERNAL_TEST_FULL';";

test('internal test release verifier accepts one no-login API and web release',async()=>{
 const calls=[];const result=await verifyRenderInternalTestRelease({...base,fetchImpl:async(url,options)=>{calls.push({url,options});if(url.endsWith('/health/live'))return response({body:{ok:true,status:'live',release:sha}});if(url.endsWith('/health/ready'))return response({body:{ok:true,status:'ready',release:sha}});if(url.endsWith('/refs-build.js'))return response({text:`window.__BUILD={\"sha\":\"${sha}\"};\nwindow.__BUILD=Object.assign(window.__BUILD||{},{channel:\"INTERNAL_TEST_FULL\",authoritative:false});`});if(url.endsWith('/refs-runtime-config.js'))return response({text:runtime});throw new Error(url);}});
 assert.equal(result.ok,true);assert.equal(calls.length,4);assert.ok(calls.every(call=>call.options.cache==='no-store'));
});

test('internal test release verifier fails closed on mixed releases or login runtime',async()=>{
 for(const mode of ['live','ready','web','channel','runtime'])await assert.rejects(()=>verifyRenderInternalTestRelease({...base,fetchImpl:async url=>{if(url.endsWith('/health/live'))return response({body:{ok:true,status:'live',release:mode==='live'?'b'.repeat(40):sha}});if(url.endsWith('/health/ready'))return response({body:{ok:true,status:'ready',release:mode==='ready'?'b'.repeat(40):sha}});if(url.endsWith('/refs-build.js'))return response({text:`window.__BUILD={\"sha\":\"${mode==='web'?'b'.repeat(40):sha}\",\"channel\":\"${mode==='channel'?'AUTHORITATIVE':'INTERNAL_TEST_FULL'}\",\"authoritative\":false};`});return response({text:mode==='runtime'?"window.__REFS_OIDC__={issuer:'x'};":runtime});}}));
});
