import assert from 'node:assert/strict';

const SHA = /^[0-9a-f]{40}$/i;
const origin = value => {
  const text = String(value || '').replace(/\/+$/, '');
  assert.ok(/^https:\/\//.test(text), 'expected an HTTPS origin');
  return text;
};
const expected = String(process.env.REFS_RELEASE_SHA || '').trim().toLowerCase();
assert.ok(SHA.test(expected), 'REFS_RELEASE_SHA must be a 40-character Git SHA');

const api = origin(process.env.REFS_STAGING_API_BASE_URL);
const web = origin(process.env.REFS_STAGING_WEB_ORIGIN);
const readJson = async url => {
  const response = await fetch(url, { method:'GET', cache:'no-store', headers:{accept:'application/json'} });
  assert.equal(response.status, 200, `${url} returned HTTP ${response.status}`);
  return response.json();
};
const sameRelease = value => String(value || '').toLowerCase() === expected;
const [live, ready, buildResponse, anonymous] = await Promise.all([
  readJson(`${api}/health/live`),
  readJson(`${api}/health/ready`),
  fetch(`${web}/refs-build.js`, { method:'GET', cache:'no-store' }),
  fetch(`${api}/api/v1/accounting-scopes`, { method:'GET', cache:'no-store', headers:{accept:'application/json'} }),
]);
assert.equal(live?.ok, true); assert.equal(live?.status, 'live'); assert.ok(sameRelease(live?.release), 'liveness release differs');
assert.equal(ready?.ok, true); assert.equal(ready?.status, 'ready'); assert.ok(sameRelease(ready?.release), 'readiness release differs');
assert.equal(buildResponse.status, 200, 'web build stamp did not load');
const buildText = await buildResponse.text();
const match = buildText.match(/window\.__BUILD\s*=\s*(\{[^\n;]+\})/);
assert.ok(match, 'web build stamp is missing');
const build = JSON.parse(match[1]);
assert.ok(sameRelease(build?.sha), 'web build release differs');
assert.equal(anonymous.status, 401, 'anonymous accounting scopes request must stay unauthorized');
console.log(JSON.stringify({ok:true,release:expected,api:{live:live.release,ready:ready.release},web:build.sha,anonymousStatus:anonymous.status}));

