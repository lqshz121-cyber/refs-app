import assert from 'node:assert/strict';
import {renderRuntimeConfig} from '../scripts/runtime-config-lib.mjs';

const environment={REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example/',REFS_PUBLIC_ENTITY_ID:'11111111-1111-4111-8111-111111111111',REFS_PUBLIC_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_PUBLIC_CASH_ACCOUNT_CODE:'111000',REFS_PUBLIC_OIDC_ISSUER:'https://issuer.example/',REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT:'https://issuer.example/authorize',REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'https://issuer.example/token',REFS_PUBLIC_OIDC_REDIRECT_URI:'https://app.example/callback',REFS_PUBLIC_OIDC_CLIENT_ID:'refs-browser',REFS_PUBLIC_OIDC_AUDIENCE:'refs-accounting'};
assert.equal(renderRuntimeConfig({}),null);assert.throws(()=>renderRuntimeConfig({REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.example'}),/incomplete/);
const rendered=renderRuntimeConfig(environment);assert.match(rendered,/window\.__REFS_OIDC__/);assert.match(rendered,/window\.refsOidcClient\?\.getAccessToken/);assert.match(rendered,/https:\/\/api\.example/);assert.doesNotMatch(rendered,/REFS_PUBLIC_|DATABASE_URL|S3_ACCESS_KEY/i);
assert.throws(()=>renderRuntimeConfig({...environment,REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'http://issuer.example/token'}),/invalid/);
console.log('runtime-config: all assertions passed');
