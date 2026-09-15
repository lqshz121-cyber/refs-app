import assert from 'node:assert/strict';

const SHA=/^[0-9a-f]{40}$/i;
const origin=value=>{const text=String(value||'').replace(/\/+$/,'');assert.ok(/^https:\/\//.test(text),'expected an HTTPS origin');return text;};
const release=value=>{const text=String(value||'').trim().toLowerCase();assert.ok(SHA.test(text),'REFS_RELEASE_SHA must be a 40-character Git SHA');return text;};

// This verifier intentionally performs no accounting or provider action. It proves
// that the no-login internal-test browser and its API are one promoted release.
export async function verifyRenderInternalTestRelease({releaseSha,apiBaseUrl,webOrigin,fetchImpl=globalThis.fetch}={}){
 const expected=release(releaseSha),api=origin(apiBaseUrl),web=origin(webOrigin);
 assert.equal(typeof fetchImpl,'function','fetch implementation is required');
 const readJson=async url=>{const response=await fetchImpl(url,{method:'GET',cache:'no-store',headers:{accept:'application/json'}});assert.equal(response.status,200,`${url} returned HTTP ${response.status}`);return response.json();};
 const [live,ready,buildResponse,runtimeResponse]=await Promise.all([
  readJson(`${api}/health/live`),readJson(`${api}/health/ready`),
  fetchImpl(`${web}/refs-build.js`,{method:'GET',cache:'no-store'}),
  fetchImpl(`${web}/refs-runtime-config.js`,{method:'GET',cache:'no-store'})
 ]);
 const same=value=>String(value||'').trim().toLowerCase()===expected;
 assert.equal(live?.ok,true);assert.equal(live?.status,'live');assert.ok(same(live?.release),'liveness release differs');
 assert.equal(ready?.ok,true);assert.equal(ready?.status,'ready');assert.ok(same(ready?.release),'readiness release differs');
 assert.equal(buildResponse.status,200,'web build stamp did not load');
 const buildText=await buildResponse.text(),match=buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);assert.ok(match,'web build stamp is missing');
 const build=JSON.parse(match[1]);assert.ok(same(build?.sha),'web build release differs');assert.equal(build?.channel,'INTERNAL_TEST_FULL');assert.equal(build?.authoritative,false);
 assert.equal(runtimeResponse.status,200,'web runtime config did not load');
 const runtime=await runtimeResponse.text();
 assert.match(runtime,/window\.__REFS_RUNTIME_MODE__='INTERNAL_TEST_FULL'/);assert.match(runtime,/internalTestNoLogin:true/);assert.match(runtime,/cashTransferUiMode:'ENABLED'/);assert.doesNotMatch(runtime,/window\.__REFS_OIDC__\s*=\s*\{/, 'internal test must not expose OIDC configuration');
 return {ok:true,release:expected,api:{live:live.release,ready:ready.release},web:build.sha,channel:build.channel};
}

if(process.argv[1]&&import.meta.url===new URL(process.argv[1],'file:').href){
 const result=await verifyRenderInternalTestRelease({releaseSha:process.env.REFS_RELEASE_SHA,apiBaseUrl:process.env.REFS_INTERNAL_TEST_API_BASE_URL,webOrigin:process.env.REFS_INTERNAL_TEST_WEB_ORIGIN});
 console.log(JSON.stringify(result));
}
