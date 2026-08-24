import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..','..');
const serviceSection=(manifest,name)=>{
  const match=manifest.match(new RegExp(`^  - type: ([^\\r\\n]+)\\r?\\n    name: ${name}\\r?\\n([\\s\\S]*?)(?=^  - type:|(?![\\s\\S]))`,'m'));
  assert.ok(match,`Render manifest is missing ${name}`);
  return {type:match[1],body:match[2]};
};
const hasSecret=(section,key)=>new RegExp(`- key: ${key}\\r?\\n\\s+sync: false`).test(section);
const hasFixed=(section,key,value)=>new RegExp(`- key: ${key}\\r?\\n\\s+value: ${value}`).test(section);
const hasServiceReference=(section,key,name,envVarKey=key)=>new RegExp(`- key: ${key}\\r?\\n\\s+fromService:\\r?\\n\\s+type: web\\r?\\n\\s+name: ${name}\\r?\\n\\s+envVarKey: ${envVarKey}`).test(section);

test('Render staging manifest declares every production startup secret and uses locked frontend installs',async()=>{
  const manifest=await readFile(resolve(root,'render.yaml'),'utf8');
  const integrations=await readFile(resolve(root,'render.integrations.yaml'),'utf8');
  const api=serviceSection(manifest,'refs-accounting-api-staging'),integrationApi=serviceSection(integrations,'refs-accounting-api-integrations-staging'),worker=serviceSection(integrations,'refs-attachment-cleanup-staging'),web=serviceSection(manifest,'refs-app');
  assert.equal(api.type,'web');assert.equal(integrationApi.type,'web');assert.equal(worker.type,'worker');assert.equal(web.type,'web');
  for(const section of [api.body,integrationApi.body,worker.body,web.body])assert.doesNotMatch(section,/buildCommand: npm install/);
  assert.match(api.body,/rootDir: server/);assert.match(api.body,/buildCommand: npm ci/);assert.match(api.body,/preDeployCommand: npm run db:up/);assert.match(api.body,/startCommand: npm start/);assert.match(api.body,/healthCheckPath: \/health\/ready/);assert.ok(hasFixed(api.body,'REFS_PG_REQUIRED','"1"'));assert.ok(hasFixed(api.body,'REFS_HTTP_MAX_BODY_BYTES','"10485760"'));
  for(const [key,value] of [
    ['REFS_DEPLOYMENT_ENV','staging'],
    ['REFS_STAGE1_BOOTSTRAP_CONFIRM','STAGE1_AUTHORITATIVE_ONLY'],
    ['REFS_STAGE1_SELF_GRANT_ENABLED','STAGE1_AUTHORITATIVE_ONLY'],
    ['REFS_STAGE1_TENANT_ID','6fb25daf-0799-4805-bede-be54230da33c'],
    ['REFS_STAGE1_ENTITY_ID','ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3'],
  ])assert.ok(hasFixed(api.body,key,value),`API is missing durable Stage 1 setting ${key}`);
  assert.match(worker.body,/rootDir: server/);assert.match(worker.body,/buildCommand: npm ci/);assert.match(worker.body,/startCommand: npm run start:attachment-cleanup/);assert.ok(hasFixed(worker.body,'REFS_PG_REQUIRED','"1"'));
  assert.match(web.body,/runtime: static/);assert.match(web.body,/buildCommand: npm ci && npm run build/);assert.match(web.body,/staticPublishPath: \.\/dist/);assert.match(web.body,/source: \/\*/);assert.match(web.body,/destination: \/index\.html/);
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL','OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS'])assert.ok(hasSecret(api.body,key),`API is missing ${key}`);
  assert.ok(hasFixed(api.body,'REFS_ATTACHMENT_MODE','DISABLED'),'Stage 1 API must not require unreleased attachment infrastructure');
  assert.ok(hasFixed(api.body,'REFS_WBS_INGEST_MODE','DISABLED'),'Stage 1 API must not require unreleased signed-ingest infrastructure');
  assert.ok(hasFixed(api.body,'REFS_WBS_LIVE_PILOT_MODE','ENABLED'));
  for(const [key,value] of [['REFS_WBS_TEST_IMPORT_MODE','ENABLED'],['REFS_WBS_TEST_IMPORT_TENANT_ID','6fb25daf-0799-4805-bede-be54230da33c'],['REFS_WBS_TEST_IMPORT_ENTITY_ID','ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3'],['REFS_WBS_TEST_IMPORT_COMPANY_CODE','WBPA'],['REFS_WBS_TEST_IMPORT_IMPORTER_ACTOR_ID','wbs-test-importer'],['REFS_WBS_TEST_IMPORT_RECONCILIATION_STARTER_ACTOR_ID','wbs-test-reconciliation-starter'],['REFS_WBS_TEST_IMPORT_MAKER_ACTOR_ID','wbs-test-maker'],['REFS_WBS_TEST_IMPORT_PAYMENT_MAKER_ACTOR_ID','wbs-test-payment-maker'],['REFS_WBS_TEST_IMPORT_MATCH_MAKER_ACTOR_ID','wbs-test-match-maker'],['REFS_WBS_TEST_IMPORT_SUBMITTER_ACTOR_ID','wbs-test-submitter'],['REFS_WBS_TEST_IMPORT_REVIEWER_ACTOR_ID','wbs-test-reviewer'],['REFS_WBS_TEST_IMPORT_APPROVER_ACTOR_ID','wbs-test-approver'],['REFS_WBS_TEST_IMPORT_POSTER_ACTOR_ID','wbs-test-poster'],['REFS_WBS_TEST_IMPORT_CLEARER_ACTOR_ID','wbs-test-clearer'],['REFS_WBS_TEST_IMPORT_REOPENER_ACTOR_ID','wbs-test-reopener']])assert.ok(hasFixed(api.body,key,value),`test-import API is missing ${key}=${value}`);
  assert.doesNotMatch(api.body,/- key: REFS_ATTACHMENT_MODE\r?\n\s+value: REQUIRED/);
  assert.doesNotMatch(api.body,/- key: REFS_WBS_INGEST_MODE\r?\n\s+value: REQUIRED/);
  for(const key of ['WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'])assert.ok(hasSecret(api.body,key),`${key} must remain a server-side Render secret`);
  for(const key of ['S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_PEM','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID','WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','WBS_PROVIDER_SIGNED_TRUST','WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID'])assert.ok(hasSecret(api.body,key),`Phase 1 signed admission is missing ${key}`);
  assert.match(integrationApi.body,/rootDir: server/);assert.match(integrationApi.body,/buildCommand: npm ci/);assert.match(integrationApi.body,/preDeployCommand: npm run db:up/);assert.match(integrationApi.body,/startCommand: npm start/);assert.match(integrationApi.body,/healthCheckPath: \/health\/ready/);
  for(const [key,value] of [['NODE_ENV','production'],['REFS_HTTP_HOST','0.0.0.0'],['REFS_DEPLOYMENT_ENV','staging'],['REFS_STAGE1_BOOTSTRAP_CONFIRM','STAGE1_AUTHORITATIVE_ONLY'],['REFS_STAGE1_SELF_GRANT_ENABLED','STAGE1_AUTHORITATIVE_ONLY'],['REFS_PG_REQUIRED','"1"'],['REFS_HTTP_MAX_BODY_BYTES','"10485760"'],['REFS_ATTACHMENT_MODE','REQUIRED'],['REFS_WBS_INGEST_MODE','REQUIRED'],['REFS_WBS_LIVE_PILOT_MODE','DISABLED'],['REFS_STAGE1_TENANT_ID','6fb25daf-0799-4805-bede-be54230da33c'],['REFS_STAGE1_ENTITY_ID','ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3']])assert.ok(hasFixed(integrationApi.body,key,value),`integrations API is missing ${key}=${value}`);
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])assert.ok(hasSecret(integrationApi.body,key),`integrations API must receive ${key} through Render secret configuration`);
  for(const key of ['OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS'])assert.ok(hasServiceReference(integrationApi.body,key,'refs-accounting-api-staging'),`integrations API must securely inherit ${key} from the healthy Stage 1 API`);
  for(const key of ['WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','WBS_PROVIDER_SIGNED_TRUST','WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID','REFS_WBS_EVIDENCE_RETENTION_DAYS','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_PEM','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID'])assert.ok(hasSecret(integrationApi.body,key),`integrations API is missing ${key}`);
  for(const key of ['WBS_CF_ACCESS_CLIENT_ID','WBS_CF_ACCESS_CLIENT_SECRET','WBS_REFS_AUTH'])assert.equal(hasSecret(integrationApi.body,key),false,`integrations API must not depend on unsigned-pilot secret ${key}`);
  assert.doesNotMatch(integrationApi.body,/REFS_PUBLIC_/,'browser configuration must remain on the static service');
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SESSION_TOKEN'])assert.ok(hasServiceReference(worker.body,key,'refs-accounting-api-integrations-staging'),`cleanup worker must inherit ${key} from the integrations API`);
  for(const key of ['ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES'])assert.ok(hasSecret(worker.body,key),`cleanup worker is missing ${key}`);
  const publicKeys=['REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_ENTITY_ID','REFS_PUBLIC_PERIOD_ID','REFS_PUBLIC_CASH_ACCOUNT_CODE','REFS_PUBLIC_OIDC_ISSUER','REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT','REFS_PUBLIC_OIDC_TOKEN_ENDPOINT','REFS_PUBLIC_OIDC_REDIRECT_URI','REFS_PUBLIC_OIDC_CLIENT_ID','REFS_PUBLIC_OIDC_AUDIENCE'];
  for(const key of publicKeys)assert.ok(hasSecret(web.body,key),`static service is missing ${key}`);
  assert.ok(hasFixed(web.body,'REFS_WBS_TEST_IMPORT_MODE','ENABLED'),'static runtime config must expose the staging test-import switch');
  assert.doesNotMatch(api.body,/REFS_PUBLIC_/);assert.doesNotMatch(worker.body,/REFS_PUBLIC_/);assert.doesNotMatch(web.body,/REFS_PUBLIC_RUNTIME_MODE/,'authoritative static builds must not opt into LOCAL_MOCK');
  assert.equal((manifest.match(/autoDeployTrigger: off/g)||[]).length,2,'Stage 1 coordinates only API and static client');
  assert.equal((integrations.match(/autoDeployTrigger: off/g)||[]).length,2,'signed-ingest API and attachment cleanup require explicit coordinated releases');
  const pages=await readFile(resolve(root,'.github','workflows','deploy.yml'),'utf8');
  assert.match(pages,/run: npm ci/);assert.doesNotMatch(pages,/run: npm install/);
  assert.match(pages,/name: Run frontend gate\r?\n\s+run: npm test/);
  assert.match(pages,/name: Run kernel static and unit gate\r?\n\s+working-directory: server\r?\n\s+run: npm test/);
  assert.match(web.body,/name: Content-Security-Policy\r?\n\s+value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'; frame-src 'self' https:; script-src 'self' https:\/\/cdnjs\.cloudflare\.com;/);
  assert.match(web.body,/frame-src 'self' https:/,'authoritative CSP must permit the validated HTTPS OIDC authorization endpoint to answer prompt=none renewal in a hidden frame');
  assert.doesNotMatch(web.body,/script-src 'self' 'unsafe-inline'/);
  for(const asset of ['/refs-runtime-lock.js','/refs-runtime-config.js','/refs-build.js','/index.html','/']){
    const escaped=asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    assert.match(web.body,new RegExp(`path: ${escaped}\\r?\\n\\s+name: Cache-Control\\r?\\n\\s+value: no-store`));
  }
  assert.match(pages,/REFS_PUBLIC_RUNTIME_MODE: LOCAL_MOCK/);assert.doesNotMatch(pages,/REFS_PUBLIC_ACCOUNTING_API_BASE_URL/);
});
