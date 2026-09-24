// R10: one post-deploy verification pack for the staging release.
//
// Composes the three existing verifiers -- release stamps across the staging pair
// (verify-render-staging-release), the internal-test pair (verify-render-internal-test-release) and
// the browser-safety smoke (test-staging-smoke) -- and adds what none of them had:
//   - a classification for every failure, so "the deploy is not finished" and "the CSP regressed"
//     are not the same red;
//   - the expected migration-ledger hash for THIS release, computed from the manifest the code was
//     built with, plus the read-only SQL that yields the live value, so the database dimension of
//     "same release" can be checked by a person with a read-only connection (the API deliberately
//     has no privilege to read refs_schema_migration and no public endpoint exposes it);
//   - a manual acceptance checklist for the steps that cannot be automated without credentials
//     this pack refuses to hold (Render worker state, a real login, the ledger readback).
//
// It never mutates anything: GET/OPTIONS only, no tokens, no Render API key.
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {verifyRenderStagingRelease} from './verify-render-staging-release.mjs';
import {verifyRenderInternalTestRelease} from './verify-render-internal-test-release.mjs';
import {runStagingSmoke, stagingSmokeConfig} from './test-staging-smoke.mjs';
import {MIGRATION_MANIFEST} from './migration-manifest.mjs';

export const RELEASE_PACK_SCHEMA='REFS_STAGING_RELEASE_PACK_V1';

// Same formula as the observability metric `migration_ledger_hash` and R02's ledger hash:
// sha256 over "name:up_checksum" pairs sorted by name and joined with commas.
export const LEDGER_HASH_SQL="SELECT encode(sha256(convert_to(string_agg(migration_name||':'||checksum,',' ORDER BY migration_name),'UTF8')),'hex') AS ledger_sha256, count(*) AS migrations, max(migration_name) AS head FROM refs_schema_migration";
export function expectedLedgerHash(manifest=MIGRATION_MANIFEST){
  const sorted=[...manifest].sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
  const joined=sorted.map(m=>`${m.name}:${m.up}`).join(',');
  // head mirrors LEDGER_HASH_SQL's max(migration_name), so it must come from the sorted list.
  return {ledger_sha256:createHash('sha256').update(joined,'utf8').digest('hex'),migrations:manifest.length,head:sorted[sorted.length-1]?.name??null};
}

// First matching rule wins. Messages come from the three verifiers' own assertion texts.
export const FAILURE_CLASSES=[
  {code:'NETWORK',            match:m=>/fetch failed|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|TypeError: Failed to fetch|socket hang up/i.test(m),
   meaning:'The service could not be reached at all. Deploy still in progress, wrong origin, or DNS.'},
  {code:'NOT_READY',          match:m=>/returned HTTP 503|readiness (endpoint|response)|not_ready|ok.*false/i.test(m),
   meaning:'The API answered but reports not ready: database/dependency probe failing, or the instance is still booting.'},
  {code:'RELEASE_MISMATCH',   match:m=>/release differs|does not match REFS_RELEASE_SHA|same-release/i.test(m),
   meaning:'Services are running different commits. Deploy order incomplete, or a service was not redeployed.'},
  {code:'WHITE_SCREEN_RISK',  match:m=>/CSP|build stamp|runtime adapter|runtime lock|web root|is missing \.\/|x-frame-options|nosniff|referrer policy|did not return HTTP 200/i.test(m),
   meaning:'The browser shell would fail to boot or be blocked by its own security headers: a white screen for every user.'},
  {code:'AUTH_BOUNDARY',      match:m=>/anonymous|401|fail-closed|OIDC/i.test(m),
   meaning:'The fail-closed authentication boundary changed. Do not proceed.'},
  {code:'CORS',               match:m=>/CORS|preflight|allow-origin|vary by Origin/i.test(m),
   meaning:'The web origin cannot call the API from a browser.'},
  {code:'INTERNAL_TEST_MODE', match:m=>/INTERNAL_TEST_FULL|internalTestNoLogin|internal test/i.test(m),
   meaning:'The internal-test pair is not in its no-login full-workflow mode, or leaks OIDC config.'},
];
export function classifyFailure(message){
  for(const rule of FAILURE_CLASSES)if(rule.match(message))return {code:rule.code,meaning:rule.meaning};
  return {code:'UNCLASSIFIED',meaning:'Read the message; then add a rule here so the next person does not have to.'};
}

async function step(name,fn){
  const started=Date.now();
  try{const result=await fn();return {name,status:'PASSED',durationMs:Date.now()-started,result};}
  catch(error){const message=error?.message||String(error);return {name,status:'FAILED',durationMs:Date.now()-started,message,failure:classifyFailure(message)};}
}

// Config is read from the same environment variables the individual verifiers already use. The
// internal-test pair is optional: absent origins mean the step is reported NOT_CONFIGURED, never
// silently passed.
export function releasePackConfig(env=process.env){
  const sha=String(env.REFS_RELEASE_SHA||'').trim().toLowerCase();
  if(!/^[0-9a-f]{40}$/.test(sha))throw new Error('REFS_RELEASE_SHA must be the full 40-character Git SHA being verified');
  return {
    releaseSha:sha,
    apiBaseUrl:env.REFS_STAGING_API_BASE_URL,webOrigin:env.REFS_STAGING_WEB_ORIGIN,
    internalTestApiBaseUrl:env.REFS_INTERNAL_TEST_API_BASE_URL||null,internalTestWebOrigin:env.REFS_INTERNAL_TEST_WEB_ORIGIN||null,
  };
}

export async function runStagingReleasePack({config,fetchImpl=globalThis.fetch,env=process.env}={}){
  const cfg=config??releasePackConfig(env);
  const steps=[];
  steps.push(await step('staging-release-stamps',()=>verifyRenderStagingRelease({releaseSha:cfg.releaseSha,apiBaseUrl:cfg.apiBaseUrl,webOrigin:cfg.webOrigin,fetchImpl})));
  steps.push(await step('staging-browser-smoke',()=>runStagingSmoke({config:stagingSmokeConfig({REFS_RELEASE_SHA:cfg.releaseSha,REFS_STAGING_API_BASE_URL:cfg.apiBaseUrl,REFS_STAGING_WEB_ORIGIN:cfg.webOrigin}),fetcher:fetchImpl})));
  if(cfg.internalTestApiBaseUrl&&cfg.internalTestWebOrigin){
    steps.push(await step('internal-test-release-stamps',()=>verifyRenderInternalTestRelease({releaseSha:cfg.releaseSha,apiBaseUrl:cfg.internalTestApiBaseUrl,webOrigin:cfg.internalTestWebOrigin,fetchImpl})));
  }else{
    steps.push({name:'internal-test-release-stamps',status:'NOT_CONFIGURED',message:'REFS_INTERNAL_TEST_API_BASE_URL / REFS_INTERNAL_TEST_WEB_ORIGIN not set; the internal-test pair was not verified'});
  }
  const ledger=expectedLedgerHash();
  const failed=steps.filter(s=>s.status==='FAILED');
  const status=failed.length?'FAILED':steps.some(s=>s.status==='NOT_CONFIGURED')?'PASSED_WITH_GAPS':'PASSED';
  return {
    schema_version:RELEASE_PACK_SCHEMA,generated_at:new Date().toISOString(),release:cfg.releaseSha,status,
    automated:steps,
    // The database dimension. Automated only as far as "what the value must be"; reading it needs a
    // read-only connection this pack does not hold.
    migration_ledger:{expected:ledger,readback_sql:LEDGER_HASH_SQL,
      rule:'live ledger_sha256 must equal expected.ledger_sha256; migrations and head must match. A different hash with the same head means a checksum changed under an applied name -- stop.'},
    manual_checklist:manualChecklist(cfg,ledger),
  };
}

export function manualChecklist(cfg,ledger){
  return [
    {id:'M1',item:`Render dashboard: refs-accounting-api-staging, refs-internal-test-api, refs-app, refs-internal-test all show deploy "Live" for commit ${cfg.releaseSha.slice(0,8)}; no service is on an older commit.`,why:'Four-service SHA readback. The pack proves the two HTTP pairs; the dashboard is the source of truth for which commit each instance runs.'},
    {id:'M2',item:'Render dashboard: refs-outbox-dispatch-staging (worker) shows the same commit, status Live, and its latest logs contain the release preflight passing (preflight:outbox-dispatch-release).',why:'The worker has no HTTP surface; only its logs and the dashboard show its release.'},
    {id:'M3',item:`Read-only DB connection: run the readback SQL; expect ledger_sha256=${ledger.ledger_sha256}, migrations=${ledger.migrations}, head=${ledger.head}.`,why:'Code and schema are one release only if the ledger matches the manifest the code was built with.'},
    {id:'M4',item:'Browser, incognito: open the web origin; sign in with a @wanbridgegroup.com Google account; the shell renders (no white screen, no console CSP violation); the first read (accounting scopes) succeeds.',why:'The smoke checks headers and assets; only a real session proves the OIDC round trip on the new tenant.'},
    {id:'M5',item:'Browser: a read-only user sees data but every write control is disabled or returns 403; a non-company Google account is refused at the Auth0 step with the company-only message.',why:'Default read-only for everyone, write for the approver only (Owner decision 2026-09-2x).'},
    {id:'M6',item:'API logs for the first 10 minutes: no MIGRATION_*, no 5xx bursts, no "not_ready" flaps.',why:'Post-deploy stability window.'},
  ];
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  runStagingReleasePack().then(pack=>{
    console.log(JSON.stringify(pack,null,2));
    process.exit(pack.status==='FAILED'?1:0);
  }).catch(error=>{console.error(JSON.stringify({event:'release_pack_error',message:error.message}));process.exit(2);});
}
