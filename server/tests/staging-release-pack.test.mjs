// R10: the staging release pack against a mocked pair of services. No network, no credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {runStagingReleasePack, classifyFailure, expectedLedgerHash, LEDGER_HASH_SQL, manualChecklist} from '../runtime/verify-staging-release-pack.mjs';

const SHA='0123456789abcdef0123456789abcdef01234567';
const API='https://api.example.test', WEB='https://web.example.test';
const CSP="default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; script-src 'self' https://cdnjs.cloudflare.com; form-action 'self'";
const webHeaders={'cache-control':'no-store','x-frame-options':'SAMEORIGIN','x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','content-security-policy':CSP};
const runtimeConfig=`window.__REFS_OIDC__=${JSON.stringify({issuer:'https://idp.example.test',authorizationEndpoint:'https://idp.example.test/authorize',tokenEndpoint:'https://idp.example.test/oauth/token',redirectUri:`${WEB}/callback`,clientId:'client',audience:'aud',scope:'openid profile'})};\nwindow.__REFS_ACCOUNTING_API__={baseUrl:"${API}",entityId:"e",periodId:"p",cashAccountCode:"111000",getAccessToken:async()=>window.refsOidcClient?.getAccessToken()};\nwindow.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';\n`;
const lock="Object.defineProperty(window,'__REFS_RUNTIME_MODE__',{configurable:false});/*RUNTIME_MODE_REJECTED*/";
const build=sha=>`window.__BUILD={"sha":"${sha}","time":"t"};\nwindow.__BUILD=Object.assign(window.__BUILD||{},{channel:"AUTHORITATIVE",authoritative:true});\n`;
const html='<script src="./refs-build.js"></script><script src="./refs-runtime-lock.js"></script><script src="./refs-runtime-config.js"></script><script src="./bundle.js"></script>';

const response=(status,body,headers={})=>({status,headers:{get:n=>headers[n.toLowerCase()]??null},json:async()=>typeof body==='string'?JSON.parse(body):body,text:async()=>typeof body==='string'?body:JSON.stringify(body)});
function mockFetch({apiSha=SHA,webSha=SHA,csp=CSP}={}){
  const calls=[];
  return Object.assign(async(url,init={})=>{
    calls.push({url,method:init.method||'GET'});
    const u=new URL(url);
    if(u.origin===API){
      if(u.pathname==='/health/live')return response(200,{ok:true,status:'live',release:apiSha},{'cache-control':'no-store'});
      if(u.pathname==='/health/ready')return response(200,{ok:true,status:'ready',release:apiSha},{'cache-control':'no-store'});
      if(init.method==='OPTIONS')return response(204,'',{'access-control-allow-origin':WEB,'access-control-allow-credentials':'true','vary':'Origin'});
      return response(401,{ok:false,code:'AUTHENTICATION_REQUIRED'},{'cache-control':'no-store'});
    }
    if(u.pathname==='/')return response(200,html,{...webHeaders,'content-security-policy':csp});
    if(u.pathname==='/refs-build.js')return response(200,build(webSha),{'cache-control':'no-store'});
    if(u.pathname==='/refs-runtime-lock.js')return response(200,lock,{'cache-control':'no-store'});
    if(u.pathname==='/refs-runtime-config.js')return response(200,runtimeConfig,{'cache-control':'no-store'});
    return response(404,'');
  },{calls});
}
const config={releaseSha:SHA,apiBaseUrl:API,webOrigin:WEB,internalTestApiBaseUrl:null,internalTestWebOrigin:null};

test('SRP-1: a consistent pair passes both automated steps; the unconfigured internal-test pair is a gap, not a pass',async()=>{
  const fetchImpl=mockFetch();
  const pack=await runStagingReleasePack({config,fetchImpl});
  assert.equal(pack.status,'PASSED_WITH_GAPS');
  assert.deepEqual(pack.automated.map(s=>[s.name,s.status]),[['staging-release-stamps','PASSED'],['staging-browser-smoke','PASSED'],['internal-test-release-stamps','NOT_CONFIGURED']]);
  assert.ok(fetchImpl.calls.every(c=>['GET','OPTIONS'].includes(c.method)),'the pack never writes');
  assert.equal(pack.migration_ledger.expected.ledger_sha256.length,64);
  assert.equal(pack.migration_ledger.readback_sql,LEDGER_HASH_SQL);
  assert.equal(pack.manual_checklist.length,6);
});

test('SRP-2: a web build on a different commit is classified RELEASE_MISMATCH and fails the pack',async()=>{
  const pack=await runStagingReleasePack({config,fetchImpl:mockFetch({webSha:'f'.repeat(40)})});
  assert.equal(pack.status,'FAILED');
  const failed=pack.automated.filter(s=>s.status==='FAILED');
  assert.ok(failed.length>=1);
  for(const s of failed)assert.equal(s.failure.code,'RELEASE_MISMATCH',s.message);
});

test('SRP-3: a CSP regression is classified WHITE_SCREEN_RISK while the release stamps still pass',async()=>{
  const pack=await runStagingReleasePack({config,fetchImpl:mockFetch({csp:"default-src 'self'; script-src 'self' 'unsafe-inline'"})});
  assert.equal(pack.status,'FAILED');
  const byName=Object.fromEntries(pack.automated.map(s=>[s.name,s]));
  assert.equal(byName['staging-release-stamps'].status,'PASSED');
  assert.equal(byName['staging-browser-smoke'].status,'FAILED');
  assert.equal(byName['staging-browser-smoke'].failure.code,'WHITE_SCREEN_RISK');
});

test('SRP-4: classification table',()=>{
  assert.equal(classifyFailure('fetch failed').code,'NETWORK');
  assert.equal(classifyFailure('https://x/health/ready returned HTTP 503').code,'NOT_READY');
  assert.equal(classifyFailure('readiness release differs').code,'RELEASE_MISMATCH');
  assert.equal(classifyFailure('Staging web CSP is missing object-src').code,'WHITE_SCREEN_RISK');
  assert.equal(classifyFailure('anonymous accounting scopes request must stay unauthorized').code,'AUTH_BOUNDARY');
  assert.equal(classifyFailure('Staging CORS preflight did not return HTTP 204').code,'CORS');
  assert.equal(classifyFailure('something nobody anticipated').code,'UNCLASSIFIED');
});

test('SRP-5: the expected ledger hash follows the observability formula (sorted name:up, comma-joined, sha256)',()=>{
  const manifest=[{name:'002_b.sql',up:'bb'},{name:'001_a.sql',up:'aa'}];
  const expected=createHash('sha256').update('001_a.sql:aa,002_b.sql:bb','utf8').digest('hex');
  assert.deepEqual(expectedLedgerHash(manifest),{ledger_sha256:expected,migrations:2,head:'002_b.sql'});
  assert.match(LEDGER_HASH_SQL,/ORDER BY migration_name/);
  assert.match(LEDGER_HASH_SQL,/^SELECT /);
});

test('SRP-6: the manual checklist names the four HTTP services, the worker, the ledger readback and a real login',()=>{
  const items=manualChecklist(config,expectedLedgerHash()).map(i=>i.item).join('\n');
  for(const needle of ['refs-accounting-api-staging','refs-internal-test-api','refs-app','refs-internal-test','refs-outbox-dispatch-staging','ledger_sha256','@wanbridgegroup.com'])assert.ok(items.includes(needle),needle);
});
