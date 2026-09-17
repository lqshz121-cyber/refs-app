import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';
import {createHash, generateKeyPairSync} from 'node:crypto';
import {stagingEnvironmentKeys, validateStagingEnvironment} from '../runtime/validate-staging-env.mjs';

// S09 external dependency contract gate.
//
// REFS has five external dependencies: object storage (S3), the virus scanner
// bridge, the OIDC issuer, the signed WBS receipt provider, and the WBS
// live-read pilot gateway. Each is enabled by a mode variable and each fails the
// process at boot when its variables are absent. The operator-facing handoff
// (.env.staging.example and staging-secrets-required.md) is the only place an
// operator learns those names before secrets are applied, so this test pins the
// handoff to the validator's own inventory. A newly required variable that is
// not written into both operator files fails here instead of failing after a
// staging deploy has already started.

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../..');
const envExample = readFileSync(resolve(repoRoot, '.env.staging.example'), 'utf8');
const handoff = readFileSync(resolve(repoRoot, 'staging-secrets-required.md'), 'utf8');
const startServer = readFileSync(resolve(repoRoot, 'server/runtime/start-accounting-server.mjs'), 'utf8');

const declaredExampleKeys = new Set(
  envExample.split('\n').filter(line => /^[A-Z][A-Z0-9_]*=/.test(line)).map(line => line.split('=')[0])
);
const allKeys = [...new Set(Object.values(stagingEnvironmentKeys).flat())];

const providerKey = generateKeyPairSync('ed25519').publicKey;
const providerPublicKey = providerKey.export({type: 'spki', format: 'pem'}).toString();
const providerFingerprint = `sha256:${createHash('sha256').update(providerKey.export({type: 'spki', format: 'der'})).digest('hex')}`;
const base = {
  DATABASE_URL: 'postgresql://runtime:password@db.example/refs',
  MIGRATION_DATABASE_URL: 'postgresql://migration:password@db.example/refs',
  CONTEXT_ISSUER_DATABASE_URL: 'postgresql://issuer:password@db.example/refs',
  GRANT_SYNC_DATABASE_URL: 'postgresql://grants:password@db.example/refs',
  OIDC_ISSUER: 'https://issuer.example',
  OIDC_AUDIENCE: 'refs-accounting',
  OIDC_JWKS_URI: 'https://issuer.example/jwks',
  REFS_HTTP_ALLOWED_ORIGINS: 'https://app.staging.example',
  REFS_HTTP_MAX_BODY_BYTES: '10485760',
  REFS_ATTACHMENT_MODE: 'REQUIRED',
  REFS_WBS_INGEST_MODE: 'REQUIRED',
  REFS_WBS_EVIDENCE_RETENTION_DAYS: '365',
  S3_ENDPOINT: 'https://s3.example',
  S3_BUCKET: 'refs',
  S3_REGION: 'us-east-1',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
  VIRUS_SCANNER_ENDPOINT: 'https://scanner.example/v1/scan',
  VIRUS_SCANNER_TOKEN: 'scanner-token',
  VIRUS_SCANNER_CA_PEM: '-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----',
  VIRUS_SCANNER_SERVER_NAME: 'scanner.example',
  ATTACHMENT_SCANNER_ACTOR_ID: 'scanner-service',
  WBS_SNAPSHOT_ED25519_PUBLIC_KEYS: JSON.stringify({'wbs-2026-08': providerPublicKey}),
  WBS_PROVIDER_SIGNED_TRUST: JSON.stringify({issuer: 'wanbridge-wbs', key_id: 'wbs-2026-08', public_key: providerPublicKey, fingerprint_sha256: providerFingerprint}),
  WBS_PROVIDER_SIGNED_SERVICE_ACTOR_ID: 'oidc|wbs-provider-import',
  REFS_STAGING_API_BASE_URL: 'https://api.staging.example',
  REFS_STAGING_WEB_ORIGIN: 'https://app.staging.example'
};

test('every staging variable the validator can require is named in .env.staging.example', () => {
  const missing = allKeys.filter(key => !declaredExampleKeys.has(key));
  assert.deepEqual(missing, [], `.env.staging.example is missing ${missing.join(', ')}`);
});

test('every staging variable the validator can require is named in staging-secrets-required.md', () => {
  const missing = allKeys.filter(key => !handoff.includes('`' + key + '`'));
  assert.deepEqual(missing, [], `staging-secrets-required.md is missing ${missing.join(', ')}`);
});

test('.env.staging.example declares every integration mode switch as DISABLED by default', () => {
  for (const key of ['REFS_ATTACHMENT_MODE', 'REFS_WBS_INGEST_MODE', 'REFS_WBS_LIVE_PILOT_MODE']) {
    assert.match(envExample, new RegExp(`^${key}=DISABLED$`, 'm'), `${key} must default to DISABLED in the handoff example`);
  }
});

test('server boot requires exactly the attachment, signed-ingest and live-pilot keys the checklist names', () => {
  for (const key of ['S3_ENDPOINT', 'S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY', 'VIRUS_SCANNER_ENDPOINT', 'VIRUS_SCANNER_TOKEN', 'VIRUS_SCANNER_SERVER_NAME', 'ATTACHMENT_SCANNER_ACTOR_ID', 'WBS_CF_ACCESS_CLIENT_ID', 'WBS_CF_ACCESS_CLIENT_SECRET', 'WBS_REFS_AUTH', 'REFS_WBS_EVIDENCE_RETENTION_DAYS']) {
    assert.ok(startServer.includes(key), `start-accounting-server.mjs no longer references ${key}`);
    assert.ok(allKeys.includes(key), `${key} is enforced at boot but absent from the staging checklist inventory`);
  }
});

test('live pilot mode is validated before deployment instead of failing at boot', () => {
  const enabled = {...base, REFS_WBS_LIVE_PILOT_MODE: 'ENABLED'};
  assert.throws(() => validateStagingEnvironment(enabled), /WBS live pilot integration missing WBS_CF_ACCESS_CLIENT_ID, WBS_CF_ACCESS_CLIENT_SECRET, WBS_REFS_AUTH/);
  const complete = {...enabled, WBS_CF_ACCESS_CLIENT_ID: 'cf-id', WBS_CF_ACCESS_CLIENT_SECRET: 'cf-secret', WBS_REFS_AUTH: 'refs-auth'};
  assert.equal(validateStagingEnvironment(complete).wbsLivePilotMode, 'ENABLED');
  assert.throws(() => validateStagingEnvironment({...base, REFS_WBS_LIVE_PILOT_MODE: 'AUTO'}), /REFS_WBS_LIVE_PILOT_MODE must be ENABLED or DISABLED/);
});

test('live pilot credentials are not demanded while the pilot is disabled', () => {
  assert.equal(validateStagingEnvironment({...base, REFS_WBS_LIVE_PILOT_MODE: 'DISABLED'}).wbsLivePilotMode, 'DISABLED');
  assert.equal(validateStagingEnvironment(base).wbsLivePilotMode, 'DISABLED');
});

test('signed WBS ingest still demands its retention window', () => {
  const {REFS_WBS_EVIDENCE_RETENTION_DAYS, ...withoutRetention} = base;
  assert.throws(() => validateStagingEnvironment(withoutRetention), /WBS ingest integration missing REFS_WBS_EVIDENCE_RETENTION_DAYS/);
});
