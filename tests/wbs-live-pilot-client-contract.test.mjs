import assert from 'node:assert/strict';
import test from 'node:test';
import {refreshAuthoritativeWbsLivePilot} from '../src/accounting-api.js';

const config={entityId:'11111111-1111-4111-8111-111111111111',baseUrl:'https://accounting.example',getAccessToken:async()=> 'a'.repeat(48)};
const response=(body,{contentType='application/json'}={})=>({ok:true,status:200,headers:{get:name=>name==='content-type'?contentType:null},json:async()=>body});

test('WBS live read rejects an HTML route fallback as protocol, not empty accounting data',async()=>{
  const result=await refreshAuthoritativeWbsLivePilot({config,tool:'list_autorec_details',fetcher:async()=>response('<!doctype html>',{contentType:'text/html'})});
  assert.equal(result.ok,false);
  assert.equal(result.code,'WBS_LIVE_PILOT_PROTOCOL');
  assert.match(result.message,/non-JSON response/i);
});

test('WBS live read rejects an unreadable JSON response as protocol, not no-response transport',async()=>{
  const result=await refreshAuthoritativeWbsLivePilot({config,tool:'list_autorec_details',fetcher:async()=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>{throw new SyntaxError('invalid json');}})});
  assert.equal(result.ok,false);
  assert.equal(result.code,'WBS_LIVE_PILOT_PROTOCOL');
  assert.match(result.message,/unreadable response/i);
});

console.log('wbs live pilot client contract: non-JSON and unreadable responses fail closed');
