import assert from 'node:assert/strict';
import test from 'node:test';
import {verifyRenderStagingRelease} from '../runtime/verify-render-staging-release.mjs';

const sha = 'a'.repeat(40);
const response = ({status=200,body={},text=null}={}) => ({status,json:async()=>body,text:async()=>text ?? JSON.stringify(body)});
const base = {releaseSha:sha,apiBaseUrl:'https://api.example.test',webOrigin:'https://web.example.test'};

test('release verifier requires identical API and web stamps and retains anonymous denial',async()=>{
  const calls=[];
  const result=await verifyRenderStagingRelease({...base,fetchImpl:async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith('/health/live'))return response({body:{ok:true,status:'live',release:sha}});
    if(url.endsWith('/health/ready'))return response({body:{ok:true,status:'ready',release:sha}});
    if(url.endsWith('/refs-build.js'))return response({text:`window.__BUILD={"sha":"${sha}"};\n`});
    if(url.endsWith('/api/v1/accounting-scopes'))return response({status:401});
    throw new Error(url);
  }});
  assert.equal(result.ok,true);
  assert.equal(calls.length,4);
  assert.equal(calls[0].options.cache,'no-store');
});

test('release verifier fails closed on stale API, web, or anonymous access',async()=>{
  const fetcher = mode => async url => {
    if(url.endsWith('/health/live'))return response({body:{ok:true,status:'live',release:mode==='live'?'b'.repeat(40):sha}});
    if(url.endsWith('/health/ready'))return response({body:{ok:true,status:'ready',release:mode==='ready'?'b'.repeat(40):sha}});
    if(url.endsWith('/refs-build.js'))return response({text:`window.__BUILD={"sha":"${mode==='web'?'b'.repeat(40):sha}"};\n`});
    return response({status:mode==='anonymous'?200:401});
  };
  for(const mode of ['live','ready','web','anonymous'])await assert.rejects(()=>verifyRenderStagingRelease({...base,fetchImpl:fetcher(mode)}));
});

