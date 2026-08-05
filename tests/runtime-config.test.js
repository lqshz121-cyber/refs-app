import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderFailClosedRuntimeConfig,renderLocalMockRuntimeConfig,renderRuntimeConfig,renderRuntimeConfigOrLock} from '../scripts/runtime-config-lib.mjs';

const environment={REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example/',REFS_PUBLIC_ENTITY_ID:'11111111-1111-4111-8111-111111111111',REFS_PUBLIC_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_PUBLIC_CASH_ACCOUNT_CODE:'111000',REFS_PUBLIC_OIDC_ISSUER:'https://issuer.example/',REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT:'https://issuer.example/authorize',REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'https://issuer.example/token',REFS_PUBLIC_OIDC_REDIRECT_URI:'https://app.example/callback',REFS_PUBLIC_OIDC_CLIENT_ID:'refs-browser',REFS_PUBLIC_OIDC_AUDIENCE:'refs-accounting'};
assert.equal(renderRuntimeConfig({}),null);assert.throws(()=>renderRuntimeConfig({REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example'}),/incomplete/);
const locked=renderRuntimeConfigOrLock({});assert.equal(locked,renderFailClosedRuntimeConfig());assert.match(locked,/window\.__REFS_OIDC__=null/);assert.match(locked,/window\.__REFS_ACCOUNTING_API__=null/);assert.match(locked,/REQUIRES_AUTHORITATIVE_API/);assert.doesNotMatch(locked,/LOCAL_DEMO/);
const mock=renderRuntimeConfigOrLock({REFS_PUBLIC_RUNTIME_MODE:'LOCAL_MOCK'});assert.equal(mock,renderLocalMockRuntimeConfig());assert.match(mock,/LOCAL_MOCK/);assert.throws(()=>renderRuntimeConfigOrLock({REFS_PUBLIC_RUNTIME_MODE:'DEMO'}),/Unsupported public runtime mode/);
const rendered=renderRuntimeConfig(environment);assert.match(rendered,/window\.__REFS_OIDC__/);assert.match(rendered,/window\.refsOidcClient\?\.getAccessToken/);assert.match(rendered,/https:\/\/api\.example/);assert.doesNotMatch(rendered,/REFS_PUBLIC_|DATABASE_URL|S3_ACCESS_KEY/i);
assert.throws(()=>renderRuntimeConfig({...environment,REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'http://issuer.example/token'}),/invalid/);
const index=readFileSync('index.html','utf8'),build=index.indexOf('src="./refs-build.js"'),lock=index.indexOf('src="./refs-runtime-lock.js"'),adapter=index.indexOf('src="./refs-runtime-config.js"'),bundle=index.indexOf('src="./bundle.js"');
assert.ok(build>=0&&lock>build&&adapter>lock&&bundle>adapter,'index must load build metadata, runtime lock, deployment adapter, then application bundle');
assert.match(index,/Chart\.js\/4\.4\.1\/chart\.umd\.min\.js" integrity="sha384-bs\/nf9FbdNouRbMiFcrcZfLXYPKiPaGVGplVbv7dLGECccEXDW\+S3zjqSKR5ZEaD" crossorigin="anonymous"/);
console.log('runtime-config: all assertions passed');
