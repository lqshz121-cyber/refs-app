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
const assertOutboxCoverage=(manifest,{apiName,workerName,fixedTenant=false})=>{
  const api=serviceSection(manifest,apiName);
  const outboxWorker=serviceSection(manifest,workerName);
  assert.equal(outboxWorker.type,'worker','the authoritative outbox producer must have a worker consumer in the same blueprint');
  assert.match(outboxWorker.body,/rootDir: server/);assert.match(outboxWorker.body,/buildCommand: npm ci/);assert.match(outboxWorker.body,/startCommand: npm run start:outbox-dispatch/);assert.ok(hasFixed(outboxWorker.body,'REFS_PG_REQUIRED','"1"'));
  for(const key of ['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'])assert.ok(hasServiceReference(outboxWorker.body,key,apiName),`outbox worker must inherit ${key} from its own API producer`);
  for(const key of ['OUTBOX_DISPATCH_ACTOR_ID','OUTBOX_PUBLISH_URL','OUTBOX_PUBLISH_TOKEN'])assert.ok(hasSecret(outboxWorker.body,key),`outbox worker is missing ${key}`);
  if(fixedTenant){
    const tenant=/^[ \t]*- key: REFS_STAGE1_TENANT_ID\r?\n[ \t]+value: ([0-9a-f-]{36})$/im.exec(api.body)?.[1];
    assert.ok(tenant,'authoritative API must declare its exact Stage 1 tenant');
    const entity='ca8d23c7-0ea6-4860-8e3e-caf9a3e22ce3';assert.ok(outboxWorker.body.includes(`- key: OUTBOX_DISPATCH_SCOPES\n        value: '[{"tenantId":"${tenant}","entityId":"${entity}"}]'`)||outboxWorker.body.includes(`- key: OUTBOX_DISPATCH_SCOPES\r\n        value: '[{"tenantId":"${tenant}","entityId":"${entity}"}]'`),'outbox worker scope must be pinned to its authoritative API tenant and entity');
  }else assert.ok(hasSecret(outboxWorker.body,'OUTBOX_DISPATCH_SCOPES'),'separately promoted API worker must receive its own tenant scopes as a secret');
  for(const [key,value] of [['OUTBOX_DISPATCH_BATCH','"100"'],['OUTBOX_DISPATCH_INTERVAL_MS','"5000"'],['OUTBOX_DISPATCH_LEASE_SECONDS','"300"'],['OUTBOX_DISPATCH_MAX_ATTEMPTS','"8"'],['OUTBOX_DISPATCH_RETRY_BASE_SECONDS','"5"'],['OUTBOX_DISPATCH_HEALTH_PORT','"10002"']])assert.ok(hasFixed(outboxWorker.body,key,value),`outbox worker is missing ${key}=${value}`);
  return outboxWorker;
};

test('Render staging manifest declares every production startup secret and uses locked frontend installs',async()=>{
  const manifest=await readFile(resolve(root,'render.yaml'),'utf8');
  const integrations=await readFile(resolve(root,'render.integrations.yaml'),'utf8');
  const api=serviceSection(manifest,'refs-accounting-api-staging'),integrationApi=serviceSection(integrations,'refs-accounting-api-integrations-staging'),worker=serviceSection(integrations,'refs-attachment-cleanup-staging'),outboxWorker=assertOutboxCoverage(manifest,{apiName:'refs-accounting-api-staging',workerName:'refs-outbox-dispatch-staging',fixedTenant:true}),integrationOutboxWorker=assertOutboxCoverage(integrations,{apiName:'refs-accounting-api-integrations-staging',workerName:'refs-outbox-dispatch-integrations-staging'}),web=serviceSection(manifest,'refs-app');
  assert.doesNotMatch(integrations,/name: refs-outbox-dispatch-staging/,'the authoritative dispatcher name must not be duplicated in the integrations blueprint');
  assert.equal(api.type,'web');assert.equal(integrationApi.type,'web');assert.equal(worker.type,'worker');assert.equal(outboxWorker.type,'worker');assert.equal(integrationOutboxWorker.type,'worker');assert.equal(web.type,'web');
  for(const section of [api.body,integrationApi.body,worker.body,outboxWorker.body,integrationOutboxWorker.body,web.body])assert.doesNotMatch(section,/buildCommand: npm install/);
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
  assert.equal((manifest.match(/autoDeployTrigger: off/g)||[]).length,3,'Stage 1 coordinates API, its outbox consumer, and static client');
  assert.equal((integrations.match(/autoDeployTrigger: off/g)||[]).length,3,'signed-ingest API and both isolated workers require explicit coordinated releases');
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

test('Render authoritative outbox producer fails closed when its consumer is absent',async()=>{
  const manifest=await readFile(resolve(root,'render.yaml'),'utf8');
  const withoutConsumer=manifest.replace(/^  # Dedicated transactional-outbox dispatcher[\s\S]*?(?=^  - type: web\r?\n    name: refs-app)/m,'');
  assert.throws(()=>assertOutboxCoverage(withoutConsumer,{apiName:'refs-accounting-api-staging',workerName:'refs-outbox-dispatch-staging',fixedTenant:true}),/Render manifest is missing refs-outbox-dispatch-staging/);
});

test('Render integrations outbox producer fails closed when its isolated consumer is absent',async()=>{
  const integrations=await readFile(resolve(root,'render.integrations.yaml'),'utf8');
  const withoutConsumer=integrations.replace(/^  # Dedicated dispatcher for the separately promoted integrations API[\s\S]*$/m,'');
  assert.throws(()=>assertOutboxCoverage(withoutConsumer,{apiName:'refs-accounting-api-integrations-staging',workerName:'refs-outbox-dispatch-integrations-staging'}),/Render manifest is missing refs-outbox-dispatch-integrations-staging/);
});

const envKeys=section=>[...section.matchAll(/^\s+- key: ([A-Z0-9_]+)\r?$/gm)].map(match=>match[1]).sort();
const exactEnv=(section,keys,label)=>assert.deepEqual(envKeys(section),[...keys].sort(),`${label} environment contract must remain closed`);
const DATABASE_KEYS=['DATABASE_URL','MIGRATION_DATABASE_URL','CONTEXT_ISSUER_DATABASE_URL','GRANT_SYNC_DATABASE_URL'];
const OIDC_KEYS=['OIDC_ISSUER','OIDC_AUDIENCE','OIDC_JWKS_URI','REFS_HTTP_ALLOWED_ORIGINS'];
const API_BASE_KEYS=['NODE_ENV','REFS_DEPLOYMENT_ENV','REFS_HTTP_HOST','REFS_HTTP_MAX_BODY_BYTES','REFS_PG_REQUIRED','REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS','REFS_ATTACHMENT_MODE','REFS_WBS_INGEST_MODE','REFS_WBS_LIVE_PILOT_MODE','REFS_WBS_TEST_IMPORT_MODE','REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','REFS_CONTROLLED_DEMO_MODE',...DATABASE_KEYS,...OIDC_KEYS];
const OUTBOX_KEYS=['NODE_ENV','REFS_PG_REQUIRED',...DATABASE_KEYS,'OUTBOX_DISPATCH_ACTOR_ID','OUTBOX_DISPATCH_SCOPES','OUTBOX_PUBLISH_URL','OUTBOX_PUBLISH_TOKEN','OUTBOX_DISPATCH_BATCH','OUTBOX_DISPATCH_INTERVAL_MS','OUTBOX_DISPATCH_CONCURRENCY','OUTBOX_DISPATCH_LEASE_SECONDS','OUTBOX_DISPATCH_MAX_ATTEMPTS','OUTBOX_DISPATCH_RETRY_BASE_SECONDS','OUTBOX_PUBLISH_TIMEOUT_MS','OUTBOX_DISPATCH_HEALTH_PORT','OUTBOX_DISPATCH_HEALTH_FRESHNESS_MS','OUTBOX_DISPATCH_MAX_CONSECUTIVE_ERRORS'];

test('Render production topology is independent, closed, and keeps every test-only mode disabled',async()=>{
  const manifest=await readFile(resolve(root,'render.production.yaml'),'utf8');
  const api=serviceSection(manifest,'refs-accounting-api-production'),outbox=serviceSection(manifest,'refs-outbox-dispatch-production'),web=serviceSection(manifest,'refs-app-production');
  assert.equal(api.type,'web');assert.equal(outbox.type,'worker');assert.equal(web.type,'web');
  assert.doesNotMatch(manifest,/staging/i);assert.doesNotMatch(manifest,/^databases:/m);assert.doesNotMatch(manifest,/^\s+(?:plan|region):/m);assert.doesNotMatch(manifest,/autoDeploy:\s*true|autoDeployTrigger:\s*(?:commit|checksPass)/);
  assert.equal((manifest.match(/autoDeployTrigger: off/g)||[]).length,3);
  exactEnv(api.body,API_BASE_KEYS,'production API');
  for(const [key,value] of [['NODE_ENV','production'],['REFS_DEPLOYMENT_ENV','production'],['REFS_HTTP_HOST','0.0.0.0'],['REFS_HTTP_MAX_BODY_BYTES','"10485760"'],['REFS_PG_REQUIRED','"1"'],['REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS','"600000"'],['REFS_ATTACHMENT_MODE','DISABLED'],['REFS_WBS_INGEST_MODE','DISABLED'],['REFS_WBS_LIVE_PILOT_MODE','DISABLED'],['REFS_WBS_TEST_IMPORT_MODE','DISABLED'],['REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','DISABLED'],['REFS_CONTROLLED_DEMO_MODE','DISABLED']])assert.ok(hasFixed(api.body,key,value),`production API is missing ${key}=${value}`);
  for(const key of [...DATABASE_KEYS,...OIDC_KEYS])assert.ok(hasSecret(api.body,key),`production API must receive ${key} independently`);
  assert.doesNotMatch(api.body,/REFS_STAGE1_|WBS_CF_ACCESS_|REFS_PUBLIC_/);
  exactEnv(outbox.body,OUTBOX_KEYS,'production outbox dispatcher');
  assert.match(outbox.body,/preDeployCommand: npm run preflight:outbox-dispatch-release/);assert.match(outbox.body,/startCommand: npm run start:outbox-dispatch/);
  for(const key of DATABASE_KEYS)assert.ok(hasServiceReference(outbox.body,key,'refs-accounting-api-production'),`production dispatcher must inherit ${key} only from its producer`);
  for(const key of ['OUTBOX_DISPATCH_ACTOR_ID','OUTBOX_DISPATCH_SCOPES','OUTBOX_PUBLISH_URL','OUTBOX_PUBLISH_TOKEN'])assert.ok(hasSecret(outbox.body,key),`production dispatcher is missing ${key}`);
  const webKeys=['REFS_DEPLOYMENT_ENV','REFS_WBS_TEST_IMPORT_MODE','REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','REFS_PUBLIC_ACCOUNTING_API_BASE_URL','REFS_PUBLIC_ENTITY_ID','REFS_PUBLIC_PERIOD_ID','REFS_PUBLIC_CASH_ACCOUNT_CODE','REFS_PUBLIC_OIDC_ISSUER','REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT','REFS_PUBLIC_OIDC_TOKEN_ENDPOINT','REFS_PUBLIC_OIDC_REDIRECT_URI','REFS_PUBLIC_OIDC_CLIENT_ID','REFS_PUBLIC_OIDC_AUDIENCE','REFS_PUBLIC_OIDC_SCOPE'];
  exactEnv(web.body,webKeys,'production Web');assert.match(web.body,/runtime: static/);assert.match(web.body,/pullRequestPreviewsEnabled: false/);
  for(const [key,value] of [['REFS_DEPLOYMENT_ENV','production'],['REFS_WBS_TEST_IMPORT_MODE','DISABLED'],['REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','DISABLED']])assert.ok(hasFixed(web.body,key,value),`production Web is missing ${key}=${value}`);
  for(const key of webKeys.filter(key=>key.startsWith('REFS_PUBLIC_')&&key!=='REFS_PUBLIC_OIDC_SCOPE'))assert.ok(hasSecret(web.body,key),`production Web must receive ${key} independently`);
  for(const asset of ['/refs-runtime-lock.js','/refs-runtime-config.js','/refs-build.js','/index.html','/'])assert.match(web.body,new RegExp(`path: ${asset.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\r?\\n\\s+name: Cache-Control\\r?\\n\\s+value: no-store`));
  assert.doesNotMatch(manifest,/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,'production manifest must not commit tenant/entity/user facts');
});

test('Render production integrations isolate signed ingest, cleanup, and dispatch from all other environments',async()=>{
  const manifest=await readFile(resolve(root,'render.integrations.production.yaml'),'utf8');
  const api=serviceSection(manifest,'refs-accounting-api-integrations-production'),cleanup=serviceSection(manifest,'refs-attachment-cleanup-production'),outbox=serviceSection(manifest,'refs-outbox-dispatch-integrations-production');
  assert.equal(api.type,'web');assert.equal(cleanup.type,'worker');assert.equal(outbox.type,'worker');
  assert.doesNotMatch(manifest,/staging/i);assert.doesNotMatch(manifest,/^databases:/m);assert.doesNotMatch(manifest,/^\s+(?:plan|region):/m);assert.equal((manifest.match(/autoDeployTrigger: off/g)||[]).length,3);
  const integrationKeys=[...API_BASE_KEYS,'WBS_SNAPSHOT_ED25519_PUBLIC_KEYS','WBS_PROVIDER_SIGNED_TRUST','WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID','REFS_WBS_EVIDENCE_RETENTION_DAYS','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SESSION_TOKEN','VIRUS_SCANNER_ENDPOINT','VIRUS_SCANNER_TOKEN','VIRUS_SCANNER_CA_PEM','VIRUS_SCANNER_SERVER_NAME','ATTACHMENT_SCANNER_ACTOR_ID'];
  exactEnv(api.body,integrationKeys,'production integrations API');
  for(const [key,value] of [['NODE_ENV','production'],['REFS_DEPLOYMENT_ENV','production'],['REFS_ATTACHMENT_MODE','REQUIRED'],['REFS_WBS_INGEST_MODE','REQUIRED'],['REFS_WBS_LIVE_PILOT_MODE','DISABLED'],['REFS_WBS_TEST_IMPORT_MODE','DISABLED'],['REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','DISABLED'],['REFS_CONTROLLED_DEMO_MODE','DISABLED']])assert.ok(hasFixed(api.body,key,value),`production integrations API is missing ${key}=${value}`);
  for(const key of integrationKeys.filter(key=>!['NODE_ENV','REFS_DEPLOYMENT_ENV','REFS_HTTP_HOST','REFS_HTTP_MAX_BODY_BYTES','REFS_PG_REQUIRED','REFS_PG_MIGRATION_STATEMENT_TIMEOUT_MS','REFS_ATTACHMENT_MODE','REFS_WBS_INGEST_MODE','REFS_WBS_LIVE_PILOT_MODE','REFS_WBS_TEST_IMPORT_MODE','REFS_CONTROLLED_TEST_AI_WORKFLOW_MODE','REFS_CONTROLLED_DEMO_MODE'].includes(key)))assert.ok(hasSecret(api.body,key),`production integrations API must receive ${key} independently`);
  assert.doesNotMatch(api.body,/REFS_STAGE1_|WBS_CF_ACCESS_|REFS_PUBLIC_/);
  const cleanupKeys=['NODE_ENV','REFS_PG_REQUIRED',...DATABASE_KEYS,'ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES','ATTACHMENT_CLEANUP_BATCH','ATTACHMENT_CLEANUP_INTERVAL_MS','ATTACHMENT_CLEANUP_CONCURRENCY','ATTACHMENT_CLEANUP_HEALTH_PORT','S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SESSION_TOKEN'];
  exactEnv(cleanup.body,cleanupKeys,'production attachment cleanup');assert.match(cleanup.body,/startCommand: npm run start:attachment-cleanup/);
  for(const key of [...DATABASE_KEYS,'S3_ENDPOINT','S3_BUCKET','S3_REGION','S3_ACCESS_KEY_ID','S3_SECRET_ACCESS_KEY','S3_SESSION_TOKEN'])assert.ok(hasServiceReference(cleanup.body,key,'refs-accounting-api-integrations-production'),`production cleanup must inherit ${key} only from its producer`);
  for(const key of ['ATTACHMENT_CLEANUP_ACTOR_ID','ATTACHMENT_CLEANUP_SCOPES'])assert.ok(hasSecret(cleanup.body,key),`production cleanup is missing ${key}`);
  exactEnv(outbox.body,OUTBOX_KEYS,'production integrations dispatcher');
  for(const key of DATABASE_KEYS)assert.ok(hasServiceReference(outbox.body,key,'refs-accounting-api-integrations-production'),`production integrations dispatcher must inherit ${key} only from its producer`);
  for(const key of ['OUTBOX_DISPATCH_ACTOR_ID','OUTBOX_DISPATCH_SCOPES','OUTBOX_PUBLISH_URL','OUTBOX_PUBLISH_TOKEN'])assert.ok(hasSecret(outbox.body,key),`production integrations dispatcher is missing ${key}`);
  assert.doesNotMatch(manifest,/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,'production integrations manifest must not commit tenant/entity/user facts');
});

test('production topology runbook reuses the independent consumer and forbids automatic database rollback',async()=>{
  const runbook=await readFile(resolve(root,'server','PRODUCTION-RENDER-TOPOLOGY.md'),'utf8');
  const consumer=await readFile(resolve(root,'render.outbox-consumer.production.yaml'),'utf8');
  for(const token of ['render.production.yaml','render.integrations.production.yaml','render.outbox-consumer.production.yaml','sync:false','OUTBOX.DISPATCH','/health/live','/health/ready','/refs-build.js','exact same SHA','authenticated read-only acceptance','backup/PITR'])assert.match(runbook,new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'),'i'),`production runbook is missing ${token}`);
  assert.doesNotMatch(runbook,/use `db:(?:down|reset)`/i);assert.match(runbook,/never use automatic down\/reset migrations/i);
  assert.match(consumer,/name: refs-outbox-consumer-production/);assert.match(consumer,/name: refs-outbox-consumer-postgres-production/);assert.doesNotMatch(consumer,/staging/i);
  for(const key of ['OUTBOX_CONSUMER_DATABASE_URL','OUTBOX_CONSUMER_TOKEN','OUTBOX_CONSUMER_TENANT_ID','OUTBOX_CONSUMER_ENTITY_ID'])assert.ok(hasSecret(serviceSection(consumer,'refs-outbox-consumer-production').body,key),`production consumer is missing ${key}`);
});
