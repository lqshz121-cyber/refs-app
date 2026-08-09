import test from 'node:test';
import assert from 'node:assert/strict';
import {validateStagingEnvironment} from '../runtime/validate-staging-env.mjs';

const base={
  DATABASE_URL:'postgresql://runtime:password@db.example/refs',
  MIGRATION_DATABASE_URL:'postgresql://migration:password@db.example/refs',
  CONTEXT_ISSUER_DATABASE_URL:'postgresql://issuer:password@db.example/refs',
  GRANT_SYNC_DATABASE_URL:'postgresql://grants:password@db.example/refs',
  OIDC_ISSUER:'https://issuer.example',OIDC_AUDIENCE:'refs-accounting',OIDC_JWKS_URI:'https://issuer.example/jwks',
  REFS_HTTP_ALLOWED_ORIGINS:'https://app.staging.example',REFS_ATTACHMENT_MODE:'REQUIRED',REFS_WBS_INGEST_MODE:'REQUIRED',S3_ENDPOINT:'https://s3.example',S3_BUCKET:'refs',S3_REGION:'us-east-1',S3_ACCESS_KEY_ID:'access',S3_SECRET_ACCESS_KEY:'secret',
  VIRUS_SCANNER_ENDPOINT:'https://scanner.example/v1/scan',VIRUS_SCANNER_TOKEN:'scanner-token',VIRUS_SCANNER_CA_FILE:'/run/secrets/scanner-ca.pem',VIRUS_SCANNER_SERVER_NAME:'scanner.example',
  ATTACHMENT_SCANNER_ACTOR_ID:'scanner-service',ATTACHMENT_CLEANUP_ACTOR_ID:'cleanup-service',ATTACHMENT_CLEANUP_SCOPES:'ATTACHMENT.CLEANUP',
  WBS_SNAPSHOT_ED25519_PUBLIC_KEYS:JSON.stringify({'wbs-2026-08':'-----BEGIN PUBLIC KEY-----\nABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n-----END PUBLIC KEY-----'}),
  REFS_STAGING_API_BASE_URL:'https://api.staging.example',REFS_STAGING_WEB_ORIGIN:'https://app.staging.example'
};
const publicRuntime={
  REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.staging.example',REFS_PUBLIC_ENTITY_ID:'11111111-1111-4111-8111-111111111111',REFS_PUBLIC_PERIOD_ID:'33333333-3333-4333-8333-333333333333',REFS_PUBLIC_CASH_ACCOUNT_CODE:'111000',
  REFS_PUBLIC_OIDC_ISSUER:'https://issuer.example',REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT:'https://issuer.example/authorize',REFS_PUBLIC_OIDC_TOKEN_ENDPOINT:'https://issuer.example/token',REFS_PUBLIC_OIDC_REDIRECT_URI:'https://app.staging.example/callback',REFS_PUBLIC_OIDC_CLIENT_ID:'refs-browser',REFS_PUBLIC_OIDC_AUDIENCE:'refs-accounting',REFS_PUBLIC_OIDC_SCOPE:'openid profile'
};

test('staging validation accepts API/worker configuration without browser deployment coordinates',()=>{
  const result=validateStagingEnvironment(base);
  assert.equal(result.apiBaseUrl,'https://api.staging.example');assert.equal(result.webOrigin,'https://app.staging.example');assert.equal(result.publicRuntimeConfigured,false);
});

test('staging validation accepts an explicit Stage 1 core-only deployment',()=>{
  const stage1={...base,REFS_ATTACHMENT_MODE:'DISABLED',REFS_WBS_INGEST_MODE:'DISABLED'};
  for(const key of ['S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_FILE','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID','ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES','WBS_SNAPSHOT_ED25519_PUBLIC_KEYS'])delete stage1[key];
  const result=validateStagingEnvironment({...stage1,...publicRuntime});
  assert.equal(result.attachmentMode,'DISABLED');assert.equal(result.wbsIngestMode,'DISABLED');assert.equal(result.publicRuntimeConfigured,true);
});

test('staging validation accepts a complete aligned public runtime',()=>{
  const result=validateStagingEnvironment({...base,...publicRuntime});
  assert.equal(result.publicRuntimeConfigured,true);
});

test('staging validation rejects malformed scope, keyring, incomplete or cross-origin runtime configuration',()=>{
  assert.throws(()=>validateStagingEnvironment({...base,REFS_HTTP_ALLOWED_ORIGINS:'https://other.example'}),/must include/);
  assert.throws(()=>validateStagingEnvironment({...base,WBS_SNAPSHOT_ED25519_PUBLIC_KEYS:'{}'}),/non-empty keyring/);
  assert.throws(()=>validateStagingEnvironment({...base,REFS_STAGING_API_BASE_URL:'https://api.staging.example/path'}),/HTTPS origin/);
  assert.throws(()=>validateStagingEnvironment({...base,REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://api.staging.example'}),/incomplete/);
  assert.throws(()=>validateStagingEnvironment({...base,...publicRuntime,REFS_PUBLIC_ACCOUNTING_API_BASE_URL:'https://other.example'}),/must equal/);
  assert.throws(()=>validateStagingEnvironment({...base,...publicRuntime,REFS_PUBLIC_OIDC_REDIRECT_URI:'https://other.example/callback'}),/must use/);
  assert.throws(()=>validateStagingEnvironment({...base,REFS_ATTACHMENT_MODE:'DISABLED',REFS_WBS_INGEST_MODE:'AUTO'}),/must be REQUIRED or DISABLED/);
  assert.throws(()=>validateStagingEnvironment({...base,REFS_ATTACHMENT_MODE:'REQUIRED',S3_ENDPOINT:''}),/attachment integration missing/);
});
