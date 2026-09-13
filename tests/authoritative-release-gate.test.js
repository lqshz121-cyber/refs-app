import assert from 'node:assert/strict';
import { releaseStampsMatch, verifyAuthoritativeApiRelease } from '../src/authoritative-release-gate.js';

const client = '075c33d240e5bf375dde06a852eaf7b3333c0ae2';
const config = { baseUrl:'https://api.example.test' };
const environment = { __BUILD:{ sha:client } };
const ready = release => ({ ok:true, json:async () => ({ ok:true, status:'ready', release }) });

assert.equal(releaseStampsMatch(client, client.slice(0, 7)), false, 'short stamps cannot stand in for an exact deployment release');
assert.equal(releaseStampsMatch(client, '02d4e95f97232f6f5669b7efcd1ed0a5f9153ff0'), false, 'different releases never match by prefix coincidence');
assert.equal(releaseStampsMatch('invalid', client), false, 'invalid release text is never admitted');

async function run() {
  let called = null;
  const matched = await verifyAuthoritativeApiRelease({ environment, config, fetcher:async (url, options) => {
    called = { url, options };
    return ready(client);
  } });
  assert.deepEqual(matched, { ok:true, clientRelease:client, apiRelease:client });
  assert.equal(called.url, 'https://api.example.test/health/ready');
  assert.equal(called.options.credentials, 'omit', 'release attestation must not send an OIDC token or cookie');
  assert.equal(called.options.cache, 'no-store', 'release attestation must not accept a cached readiness result');
  assert.equal(Object.hasOwn(called.options.headers, 'cache-control'), false, 'release attestation must not trigger a cross-origin preflight with a non-safelisted cache header');

  const mismatch = await verifyAuthoritativeApiRelease({ environment, config, fetcher:async () => ready('02d4e95f97232f6f5669b7efcd1ed0a5f9153ff0') });
  assert.deepEqual(mismatch, {
    ok:false,
    code:'ACCOUNTING_API_RELEASE_MISMATCH',
    message:`The client release ${client} and API release 02d4e95f97232f6f5669b7efcd1ed0a5f9153ff0 are different.`,
  }, 'a ready API with a different release blocks before OIDC or accounting reads');
  const unstamped = await verifyAuthoritativeApiRelease({ environment, config, fetcher:async () => ready(null) });
  assert.equal(unstamped.code, 'ACCOUNTING_API_RELEASE_UNSTAMPED');
  const unavailable = await verifyAuthoritativeApiRelease({ environment, config, fetcher:async () => { throw new Error('offline'); } });
  assert.deepEqual(unavailable, {
    ok:false,
    code:'ACCOUNTING_API_UNREACHABLE',
    message:'The accounting API readiness endpoint produced no HTTP response.',
  }, 'a readiness transport failure stays distinct from a release mismatch');

  console.log('authoritative release gate tests passed');
}

run().catch(error => { console.error(error); process.exitCode = 1; });
