// Published-asset coherence gate.
//
// Runs immediately after the build, against dist/, and asserts that the four
// runtime assets describe one and the same deployment. The failure this exists
// to prevent is a live site that quietly serves browser demonstration data: it
// is caught here as a disagreement between the build stamp and the deployment
// adapter, before the artefact is uploaded.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {AUTHORITATIVE_CHANNEL,DEMONSTRATION_CHANNEL,DEMONSTRATION_MODE,resolveRuntimeChannel} from './runtime-config-lib.mjs';

const read=path=>readFileSync(path,'utf8');
const index=read('dist/index.html');
const assets=['refs-build.js','refs-runtime-lock.js','refs-runtime-config.js','bundle.js'];
let previous=-1;
for(const asset of assets){
  const position=index.indexOf(`./${asset}`);
  assert.ok(position>previous,`dist/index.html must load ${asset} in the safe runtime order`);
  previous=position;
  read(`dist/${asset}`);
}

const build=read('dist/refs-build.js'),lock=read('dist/refs-runtime-lock.js'),config=read('dist/refs-runtime-config.js');
const mock=resolveRuntimeChannel(process.env)===DEMONSTRATION_CHANNEL;

assert.match(build,/window\.__BUILD=/,'build metadata asset is missing');

// --- runtime lock ---------------------------------------------------------
// The lock owns the mode slot. It must install an enumerated-value guard that a
// later script cannot redefine, so an unrecognised mode can never be read back
// as a usable mode.
assert.match(lock,/REQUIRES_AUTHORITATIVE_API/,'runtime lock must require the authoritative API');
assert.doesNotMatch(lock,/LOCAL_DEMO/,'deployment lock must not enable local demo mode');
assert.match(lock,/Object\.defineProperty\(window,'__REFS_RUNTIME_MODE__'/,'runtime lock must install the runtime mode slot itself');
assert.match(lock,/configurable:false/,'the runtime mode slot must not be redefinable by a later script');
assert.match(lock,/RUNTIME_MODE_REJECTED/,'the runtime lock must reject an unenumerated mode explicitly');

// --- deployment adapter ---------------------------------------------------
assert.match(config,/window\.__REFS_OIDC__=/,'runtime config must explicitly configure or clear OIDC');
assert.match(config,/window\.__REFS_ACCOUNTING_API__=/,'runtime config must explicitly configure or clear the accounting API');
const declaredModes=[...config.matchAll(/window\.__REFS_RUNTIME_MODE__='([A-Z_]+)'/g)].map(match=>match[1]);
assert.equal(declaredModes.length,1,'runtime config must declare exactly one explicit runtime mode');
const [declaredMode]=declaredModes;

// --- build stamp / adapter coherence --------------------------------------
const stampedChannels=[...build.matchAll(/channel:"([A-Z_]+)"/g)].map(match=>match[1]);
assert.equal(stampedChannels.length,1,'dist/refs-build.js must carry exactly one release channel stamp');
const [stampedChannel]=stampedChannels;
assert.ok([AUTHORITATIVE_CHANNEL,DEMONSTRATION_CHANNEL].includes(stampedChannel),`unrecognised release channel stamp ${stampedChannel}`);
assert.equal(stampedChannel,mock?DEMONSTRATION_CHANNEL:AUTHORITATIVE_CHANNEL,'the build stamp must record the channel this build was requested with');
assert.equal(
  declaredMode===DEMONSTRATION_MODE,
  stampedChannel===DEMONSTRATION_CHANNEL,
  'a demonstration adapter may only ship with a demonstration build stamp, and an authoritative build stamp may never ship with a demonstration adapter',
);
assert.match(build,/authoritative:(?:true|false)/,'the build stamp must state whether this deployment is authoritative');
assert.equal(/authoritative:true/.test(build),stampedChannel===AUTHORITATIVE_CHANNEL,'the build stamp authority flag must match its channel');

if(mock){
  assert.equal(declaredMode,DEMONSTRATION_MODE,'the Pages demonstration must be explicitly marked LOCAL_MOCK');
  assert.match(config,/window\.__REFS_OIDC__=null/,'the Pages demonstration must not carry an OIDC provider');
  assert.match(config,/window\.__REFS_ACCOUNTING_API__=null/,'the Pages demonstration must not carry an authoritative API');
}else{
  assert.equal(declaredMode,'REQUIRES_AUTHORITATIVE_API','an unconfigured or authoritative deployment must remain fail closed');
  // A configured authoritative deployment must reach its API over HTTPS only.
  const apiBases=[...config.matchAll(/baseUrl:"([^"]*)"/g)].map(match=>match[1]);
  const issuers=[...config.matchAll(/"(?:issuer|authorizationEndpoint|tokenEndpoint|redirectUri)":"([^"]*)"/g)].map(match=>match[1]);
  for(const url of [...apiBases,...issuers]){
    assert.ok(/^https:\/\//.test(url),`authoritative deployment endpoints must be HTTPS: ${url}`);
  }
  if(!/window\.__REFS_ACCOUNTING_API__=null/.test(config)){
    assert.ok(apiBases.length===1,'a configured authoritative adapter must declare exactly one API base URL');
  }
}
assert.doesNotMatch(config,/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS|BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY/i,'runtime config must not contain environment placeholders or secrets');
assert.doesNotMatch(build,/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS/i,'build stamp must not contain environment placeholders or secrets');
console.log(`PASS runtime deployment assets: complete, ordered, mode ${declaredMode}, channel ${stampedChannel}, and ${mock?'explicitly local-mock':'fail closed'}`);
