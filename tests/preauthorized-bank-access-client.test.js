import test from 'node:test';
import assert from 'node:assert/strict';
import {readPreauthorizedBankAccess,activatePreauthorizedBankAccess,PREAUTHORIZED_BANK_READ_PERMISSIONS} from '../src/accounting-api.js';
const entityId='1cfa5b82-7f38-461e-aa58-f94c5f824292',tenantId='6fb25daf-0799-4805-bede-be54230da33c';
const config={baseUrl:'https://accounting.example',entityId,getAccessToken:async()=> 'a'.repeat(48)};
const policy={role:'WBS_BANK_IMPORT_REQUESTER_ACCOUNTING_VIEWER',entityId,expectedVersion:4,validUntil:'2026-10-10T11:00:00.000Z',permissionCount:10};
const receipt={role:policy.role,version:5,validUntil:policy.validUntil,permissionCount:10,idempotent:false};
const access={tenant_id:tenantId,entity_id:entityId,actor_id:'oidc|approved-human',grant_set_version:5,permissions:[...PREAUTHORIZED_BANK_READ_PERMISSIONS],configured_permissions:[...PREAUTHORIZED_BANK_READ_PERMISSIONS],session_refresh_required:false};
const response=data=>({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({ok:true,data})});
test('policy read is authenticated no-store and rejects cross-company or expanded permission count',async()=>{
  let call;assert.equal((await readPreauthorizedBankAccess({config,fetcher:async(url,options)=>{call={url,options};return response(policy);}})).ok,true);
  assert.equal(call.options.method,'GET');assert.equal(call.options.cache,'no-store');assert.ok(call.options.headers.authorization||call.options.headers.Authorization);
  for(const change of [{entityId:tenantId},{permissionCount:11},{expectedVersion:-1},{validUntil:'invalid'}])assert.equal((await readPreauthorizedBankAccess({config,fetcher:async()=>response({...policy,...change})})).code,'ACCOUNTING_API_PROTOCOL');
});
test('activation requires explicit confirmation and reads back the exact effective grant',async()=>{
  const calls=[],fetcher=async(url,options)=>{calls.push({url,options});return response(options.method==='POST'?receipt:access);};
  assert.equal((await activatePreauthorizedBankAccess({config,fetcher,idempotencyKey:'owned-approved-access'})).code,'PREAUTHORIZED_ACCESS_CONFIRMATION_REQUIRED');assert.equal(calls.length,0);
  const result=await activatePreauthorizedBankAccess({config,fetcher,idempotencyKey:'owned-approved-access',confirmed:true});assert.equal(result.ok,true);assert.equal(calls.length,2);
  assert.equal(calls[0].options.body,'{}');assert.equal(calls[0].options.headers['idempotency-key'],'owned-approved-access');assert.ok(calls[1].url.endsWith('/access/self'));assert.equal(calls[1].options.method,'GET');
  for(const change of [{session_refresh_required:true},{grant_set_version:6},{permissions:['WBS.TEST.IMPORT']},{permissions:[...access.permissions,'GL.JE.POST']}])assert.equal((await activatePreauthorizedBankAccess({config,confirmed:true,idempotencyKey:'owned-approved-access',fetcher:async(url,options)=>response(options.method==='POST'?receipt:{...access,...change})})).code,'PREAUTHORIZED_ACCESS_READBACK_MISMATCH');
});
