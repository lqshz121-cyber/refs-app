import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderBuildChannelStamp,renderFailClosedRuntimeConfig,renderLocalMockRuntimeConfig,renderRuntimeConfig,renderRuntimeConfigOrLock,resolveRuntimeChannel} from '../scripts/runtime-config-lib.mjs';

const environment={REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example/',REFS_PUBLIC_ENTITY_ID:'11111111-1111-4111-8111-111111111111',REFS_PUBLIC_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_PUBLIC_CASH_ACCOUNT_CODE:'111000',REFS_PUBLIC_OIDC_ISSUER:'https://issuer.example/',REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT:'https://issuer.example/authorize',REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'https://issuer.example/token',REFS_PUBLIC_OIDC_REDIRECT_URI:'https://app.example/callback',REFS_PUBLIC_OIDC_CLIENT_ID:'refs-browser',REFS_PUBLIC_OIDC_AUDIENCE:'refs-accounting'};
assert.equal(renderRuntimeConfig({}),null);assert.throws(()=>renderRuntimeConfig({REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example'}),/incomplete/);
const locked=renderRuntimeConfigOrLock({});assert.equal(locked,renderFailClosedRuntimeConfig());assert.match(locked,/window\.__REFS_OIDC__=null/);assert.match(locked,/window\.__REFS_ACCOUNTING_API__=null/);assert.match(locked,/REQUIRES_AUTHORITATIVE_API/);assert.doesNotMatch(locked,/LOCAL_DEMO/);
const mock=renderRuntimeConfigOrLock({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'});assert.equal(mock,renderLocalMockRuntimeConfig());assert.match(mock,/LOCAL_MOCK/);assert.throws(()=>renderRuntimeConfigOrLock({REFS_PUBLIC_RUNTIME_MODE:'DEMO'}),/Unsupported public runtime mode/);
const rendered=renderRuntimeConfig(environment);assert.match(rendered,/window\.__REFS_OIDC__/);assert.match(rendered,/window\.refsOidcClient\?\.getAccessToken/);assert.match(rendered,/https:\/\/api\.example/);assert.doesNotMatch(rendered,/REFS_PUBLIC_|DATABASE_URL|S3_ACCESS_KEY/i);
assert.throws(()=>renderRuntimeConfig({...environment,REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'http://issuer.example/token'}),/invalid/);
const index=readFileSync('index.html','utf8'),build=index.indexOf('src="./refs-build.js"'),lock=index.indexOf('src="./refs-runtime-lock.js"'),adapter=index.indexOf('src="./refs-runtime-config.js"'),bundle=index.indexOf('src="./bundle.js"');
assert.ok(build>=0&&lock>build&&adapter>lock&&bundle>adapter,'index must load build metadata, runtime lock, deployment adapter, then application bundle');
assert.match(index,/Chart\.js\/4\.4\.1\/chart\.umd\.min\.js" integrity="sha384-bs\/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW\+S3zjqSKR5ZEaD" crossorigin="anonymous"/);

// --- release channel stamp -------------------------------------------------
// The adapter and the build stamp are rendered from one environment in one
// build step, so a published site cannot carry a demonstration adapter under an
// authoritative build stamp. src/runtime-mode.mjs refuses that pair in the
// browser; these assertions cover the build side of the same contract.
assert.equal(resolveRuntimeChannel({}),'AUTHORITATIVE');
assert.equal(resolveRuntimeChannel(environment),'AUTHORITATIVE');
assert.equal(resolveRuntimeChannel({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'}),'PUBLIC_DEMONSTRATION');
assert.match(renderBuildChannelStamp({}),/window\.__BUILD=Object\.assign\(window\.__BUILD\|\|\{\},\{channel:"AUTHORITATIVE",authoritative:true\}\);/);
assert.match(renderBuildChannelStamp({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'}),/channel:"PUBLIC_DEMONSTRATION",authoritative:false/);
assert.doesNotMatch(renderBuildChannelStamp(environment),/REFS_PUBLIC_|DATABASE_URL|S3_ACCESS_KEY/i);

// A demonstration build must not also be pointed at a real accounting API.
assert.throws(()=>renderRuntimeConfigOrLock({...environment,REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'}),/must not carry authoritative deployment coordinates/);
assert.throws(()=>renderRuntimeConfigOrLock({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK',REFS_PUBLIC_OIDC_CLIENT_ID:'refs-browser'}),/must not carry authoritative deployment coordinates/);

// --- runtime lock ----------------------------------------------------------
// The lock owns the mode slot so a later script cannot install an unenumerated
// mode and have it read back as usable.
const lockSource=readFileSync('refs-runtime-lock.js','utf8');
assert.match(lockSource,/Object\.defineProperty\(window,'__REFS_RUNTIME_MODE__'/);
assert.match(lockSource,/configurable:false/);
assert.match(lockSource,/RUNTIME_MODE_REJECTED/);
assert.doesNotMatch(lockSource,/LOCAL_DEMO/);
const lockScope={};
new Function('window',lockSource)(lockScope);
lockScope.__REFS_RUNTIME_MODE__='LOCAL_MOCK';
assert.equal(lockScope.__REFS_RUNTIME_MODE__,'LOCAL_MOCK','the lock must accept an enumerated mode');
lockScope.__REFS_RUNTIME_MODE__='DEMO';
assert.equal(lockScope.__REFS_RUNTIME_MODE__,'RUNTIME_MODE_REJECTED','the lock must reject an unenumerated mode');
lockScope.__REFS_RUNTIME_MODE__='REQUIRES_AUTHORITATIVE_API';
assert.equal(lockScope.__REFS_RUNTIME_MODE__,'REQUIRES_AUTHORITATIVE_API');
assert.throws(()=>Object.defineProperty(lockScope,'__REFS_RUNTIME_MODE__',{value:'LOCAL_MOCK'}),TypeError,'the mode slot must not be redefinable');

console.log('runtime-config: all assertions passed');
