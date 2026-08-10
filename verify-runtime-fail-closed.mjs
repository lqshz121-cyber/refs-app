// ===========================================================================
// Runtime fail-closed gate (Phase 1)
//
// The failure this gate exists to prevent: a deployed REFS client that serves
// browser demonstration data while looking like the live accounting system.
//
// It checks three things and says which kind of evidence each one is.
//
//   A. EXECUTED. Every branch of src/runtime-mode.mjs and of the deployment
//      adapter renderer is run here, in this process. These are real results,
//      not pattern matches.
//   B. EXECUTED. The published-asset coherence rules are run against the
//      generated adapter and build stamp text.
//   C. STATIC. The wiring in src/app.jsx, src/authoritative-app.jsx and
//      src/accounting-api.js is asserted by reading the source. This proves
//      what the source says. It does not prove what a browser renders: there
//      is no browser in this gate and no accounting API is contacted.
// ===========================================================================
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import {
  AUTHORITATIVE_CHANNEL,
  AUTHORITATIVE_MODE,
  DEMONSTRATION_CHANNEL,
  DEMONSTRATION_MODE,
  REJECTED_MODE,
  SURFACE_AUTHORITATIVE,
  SURFACE_DEMONSTRATION,
  SURFACE_ERROR,
  resolveRuntimeBoundary,
} from './src/runtime-mode.mjs';
import {
  renderBuildChannelStamp,
  renderFailClosedRuntimeConfig,
  renderLocalMockRuntimeConfig,
  renderRuntimeConfigOrLock,
  resolveRuntimeChannel,
} from './scripts/runtime-config-lib.mjs';

const read = file => readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
const stamp = channel => ({ sha: '0000000', time: '2026-01-01 00:00 UTC', channel });

// ---------------------------------------------------------------------------
// A. EXECUTED - every route into the demonstration surface.
//
// The rule is one-directional: demonstration data renders only when the
// deployment adapter AND the build stamp both say public demonstration. Each
// case below is an environment a real deployment could produce.
// ---------------------------------------------------------------------------
const boundaryCases = [
  ['no runtime assets executed at all', {}, SURFACE_ERROR, 'RUNTIME_CONFIG_MISSING'],
  ['runtime mode present but empty', { __REFS_RUNTIME_MODE__: '   ' }, SURFACE_ERROR, 'RUNTIME_CONFIG_MISSING'],
  ['runtime mode is not a string', { __REFS_RUNTIME_MODE__: { mode: DEMONSTRATION_MODE } }, SURFACE_ERROR, 'RUNTIME_CONFIG_MISSING'],
  ['runtime mode this build does not implement', { __REFS_RUNTIME_MODE__: 'DEMO' }, SURFACE_ERROR, 'RUNTIME_MODE_UNRECOGNISED'],
  ['mode rejected by the runtime lock', { __REFS_RUNTIME_MODE__: REJECTED_MODE }, SURFACE_ERROR, 'RUNTIME_MODE_UNRECOGNISED'],
  ['lowercase spelling of the demonstration mode', { __REFS_RUNTIME_MODE__: 'local_mock', __BUILD: stamp(DEMONSTRATION_CHANNEL) }, SURFACE_ERROR, 'RUNTIME_MODE_UNRECOGNISED'],
  ['demonstration adapter with no build stamp', { __REFS_RUNTIME_MODE__: DEMONSTRATION_MODE }, SURFACE_ERROR, 'RUNTIME_CHANNEL_MISMATCH'],
  ['demonstration adapter under an authoritative build stamp', { __REFS_RUNTIME_MODE__: DEMONSTRATION_MODE, __BUILD: stamp(AUTHORITATIVE_CHANNEL) }, SURFACE_ERROR, 'RUNTIME_CHANNEL_MISMATCH'],
  ['authoritative adapter under a demonstration build stamp', { __REFS_RUNTIME_MODE__: AUTHORITATIVE_MODE, __BUILD: stamp(DEMONSTRATION_CHANNEL) }, SURFACE_ERROR, 'RUNTIME_CHANNEL_MISMATCH'],
  ['build stamp channel this build does not implement', { __REFS_RUNTIME_MODE__: AUTHORITATIVE_MODE, __BUILD: stamp('STAGING') }, SURFACE_ERROR, 'RUNTIME_CHANNEL_UNRECOGNISED'],
  ['authoritative adapter, unstamped build', { __REFS_RUNTIME_MODE__: AUTHORITATIVE_MODE }, SURFACE_AUTHORITATIVE, null],
  ['authoritative adapter, authoritative stamp', { __REFS_RUNTIME_MODE__: AUTHORITATIVE_MODE, __BUILD: stamp(AUTHORITATIVE_CHANNEL) }, SURFACE_AUTHORITATIVE, null],
  ['demonstration adapter, demonstration stamp', { __REFS_RUNTIME_MODE__: DEMONSTRATION_MODE, __BUILD: stamp(DEMONSTRATION_CHANNEL) }, SURFACE_DEMONSTRATION, null],
];
let demonstrationSurfaces = 0;
for (const [name, environment, surface, code] of boundaryCases) {
  const boundary = resolveRuntimeBoundary(environment);
  assert.equal(boundary.surface, surface, `runtime boundary: ${name} must resolve to ${surface}, got ${boundary.surface}`);
  assert.equal(boundary.code, code, `runtime boundary: ${name} must report ${code}, got ${boundary.code}`);
  if (boundary.surface === SURFACE_DEMONSTRATION) demonstrationSurfaces += 1;
}
assert.equal(demonstrationSurfaces, 1, 'exactly one enumerated environment may reach the demonstration surface');
assert.equal(resolveRuntimeBoundary(undefined).surface, SURFACE_ERROR, 'an absent environment must fail closed');
assert.equal(resolveRuntimeBoundary(null).surface, SURFACE_ERROR, 'a null environment must fail closed');

// ---------------------------------------------------------------------------
// B. EXECUTED - the deployment adapter renderer.
// ---------------------------------------------------------------------------
const coordinates = {
  REFS_PUBLIC_ACCOUNTING_API_BASE_URL: 'https://api.example',
  REFS_PUBLIC_ENTITY_ID: '11111111-1111-4111-8111-111111111111',
  REFS_PUBLIC_PERIOD_ID: '33333333-3333-4333-8333-333333333333',
  REFS_PUBLIC_CASH_ACCOUNT_CODE: '111000',
  REFS_PUBLIC_OIDC_ISSUER: 'https://issuer.example',
  REFS_PUBLIC_OIDC_AUTHORIZATION_ENDPOINT: 'https://issuer.example/authorize',
  REFS_PUBLIC_OIDC_TOKEN_ENDPOINT: 'https://issuer.example/token',
  REFS_PUBLIC_OIDC_REDIRECT_URI: 'https://app.example/callback',
  REFS_PUBLIC_OIDC_CLIENT_ID: 'refs-browser',
  REFS_PUBLIC_OIDC_AUDIENCE: 'refs-accounting',
};

// A build cannot publish a demonstration adapter while it is pointed at a real
// accounting API. That combination is exactly how a demo becomes "the live site".
assert.throws(
  () => renderRuntimeConfigOrLock({ ...coordinates, REFS_PUBLIC_RUNTIME_MODE: DEMONSTRATION_MODE }),
  /must not carry authoritative deployment coordinates/,
  'a demonstration build must refuse authoritative coordinates',
);
assert.throws(
  () => renderRuntimeConfigOrLock({ REFS_PUBLIC_RUNTIME_MODE: DEMONSTRATION_MODE, REFS_PUBLIC_ACCOUNTING_API_BASE_URL: 'https://api.example' }),
  /must not carry authoritative deployment coordinates/,
  'one authoritative coordinate is enough to refuse a demonstration build',
);
assert.throws(() => renderRuntimeConfigOrLock({ REFS_PUBLIC_RUNTIME_MODE: 'STAGING' }), /Unsupported public runtime mode/);
assert.equal(renderRuntimeConfigOrLock({}), renderFailClosedRuntimeConfig(), 'an unconfigured build must render the fail-closed adapter');
assert.equal(renderRuntimeConfigOrLock({ REFS_PUBLIC_RUNTIME_MODE: DEMONSTRATION_MODE }), renderLocalMockRuntimeConfig());

// The adapter and the stamp are rendered from one environment, so they agree by
// construction. Verify that agreement rather than assuming it.
for (const [environment, expectedChannel, expectedMode] of [
  [{}, AUTHORITATIVE_CHANNEL, AUTHORITATIVE_MODE],
  [coordinates, AUTHORITATIVE_CHANNEL, AUTHORITATIVE_MODE],
  [{ REFS_PUBLIC_RUNTIME_MODE: DEMONSTRATION_MODE }, DEMONSTRATION_CHANNEL, DEMONSTRATION_MODE],
]) {
  const adapter = renderRuntimeConfigOrLock(environment);
  const channelStamp = renderBuildChannelStamp(environment);
  assert.equal(resolveRuntimeChannel(environment), expectedChannel);
  assert.ok(channelStamp.includes(`channel:"${expectedChannel}"`), 'the build stamp must record the rendered channel');
  assert.ok(adapter.includes(`window.__REFS_RUNTIME_MODE__='${expectedMode}';`), 'the adapter must declare exactly the expected mode');
  assert.ok(!/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS/i.test(adapter), 'the adapter must not carry environment placeholders or secrets');
  assert.ok(!/REFS_PUBLIC_|DATABASE_URL|ACCESS_KEY|SECRET_ACCESS/i.test(channelStamp), 'the build stamp must not carry environment placeholders or secrets');
  // The browser-side resolver must accept the artefacts the build step produces.
  const boundary = resolveRuntimeBoundary({ __REFS_RUNTIME_MODE__: expectedMode, __BUILD: stamp(expectedChannel) });
  assert.equal(boundary.surface, expectedMode === DEMONSTRATION_MODE ? SURFACE_DEMONSTRATION : SURFACE_AUTHORITATIVE);
}

// A configured authoritative adapter must reach its API and provider over HTTPS.
const configuredAdapter = renderRuntimeConfigOrLock(coordinates);
for (const url of [...configuredAdapter.matchAll(/"(https?:\/\/[^"]+)"/g)].map(match => match[1])) {
  assert.ok(url.startsWith('https://'), `a non-mock deployment adapter must only carry HTTPS endpoints: ${url}`);
}
assert.throws(
  () => renderRuntimeConfigOrLock({ ...coordinates, REFS_PUBLIC_ACCOUNTING_API_BASE_URL: 'http://api.example' }),
  /invalid HTTPS URL/,
  'a plaintext API base must be refused at render time',
);

// ---------------------------------------------------------------------------
// C. STATIC - the wiring that carries the executed rules into the app.
// ---------------------------------------------------------------------------
const lock = read('refs-runtime-lock.js');
assert.match(lock, /Object\.defineProperty\(window,'__REFS_RUNTIME_MODE__'/, 'the runtime lock must own the mode slot');
assert.match(lock, /configurable:false/, 'the mode slot must not be redefinable by a later script');
assert.match(lock, /RUNTIME_MODE_REJECTED/, 'the lock must collapse an unenumerated mode to an explicit rejected value');

const app = read('src/app.jsx');
assert.match(app, /resolveRuntimeBoundary\(globalThis\)/, 'app.jsx must resolve the runtime boundary rather than test the mode inline');
assert.doesNotMatch(app, /__REFS_RUNTIME_MODE__\s*[!=]==/, 'app.jsx must not compare the runtime mode directly');
assert.match(app, /boundary\.surface === SURFACE_ERROR\) return <RuntimeErrorPage/, 'an error surface must render the runtime error page');
assert.match(app, /boundary\.surface !== SURFACE_AUTHORITATIVE/, 'only the authoritative surface may reach the authoritative app');
assert.doesNotMatch(app, /SURFACE_DEMONSTRATION|legacy-demo-app|seed\.js|localStorage/, 'the production entry must not retain a route to browser demonstration state');

const authoritative = read('src/authoritative-app.jsx');
assert.match(authoritative, /AUTHENTICATION_REQUIRED' \? 'LOGIN_REQUIRED'/, '401 must route to re-authentication');
assert.match(authoritative, /AUTHORIZATION_DENIED' \? 'ACCESS_DENIED'/, '403 must be kept apart from 401');
assert.match(authoritative, /readRetainedRoute/, 'the current route must survive a page refresh');
assert.match(authoritative, /sessionStorage/, 'route retention must use tab session storage, not accounting storage');
assert.doesNotMatch(authoritative, /localStorage\s*[.(]/, 'the authoritative runtime must not write browser accounting state');

const client = read('src/accounting-api.js');
assert.doesNotMatch(client, /ACCOUNTING_API_UNAVAILABLE/, 'a single catch-all unavailable code hides which failure actually happened');
for (const [status, code] of [[401, 'AUTHENTICATION_REQUIRED'], [403, 'AUTHORIZATION_DENIED'], [404, 'ACCOUNTING_API_SCOPE_NOT_FOUND'], [429, 'ACCOUNTING_API_RATE_LIMITED']]) {
  assert.ok(client.includes(`status===${status}?'${code}'`), `HTTP ${status} must map to ${code}`);
}
assert.match(client, /status>=500\?'ACCOUNTING_API_SERVER_ERROR'/, 'a 5xx must be reported as a server error, not as unreachable');
assert.match(client, /ACCOUNTING_API_UNREACHABLE/, 'a transport failure must have its own code');
assert.match(client, /const decisive=derived==='AUTHENTICATION_REQUIRED'\|\|derived==='AUTHORIZATION_DENIED'/, 'the status line must decide 401 and 403 regardless of the response body');

const errorPage = read('src/runtime-error-page.jsx');
for (const code of [
  'RUNTIME_CONFIG_MISSING', 'RUNTIME_MODE_UNRECOGNISED', 'RUNTIME_CHANNEL_MISMATCH', 'CONFIGURATION_REQUIRED',
  'AUTHENTICATION_REQUIRED', 'AUTHORIZATION_DENIED', 'ACCOUNTING_API_UNREACHABLE', 'ACCOUNTING_API_SERVER_ERROR',
  'ACCOUNTING_API_PROTOCOL', 'ACCOUNTING_API_SCOPE_NOT_FOUND',
]) {
  assert.ok(errorPage.includes(`${code}: {`), `the runtime error page must state ${code} in its own words`);
}
assert.match(errorPage, /StateBlock/, 'the runtime error page must use the shared state renderer');
// An authorization refusal must not offer a sign-in retry: signing in again
// cannot change it, and offering the action implies otherwise.
const denied = errorPage.slice(errorPage.indexOf('AUTHORIZATION_DENIED: {'), errorPage.indexOf('ACCOUNTING_API_UNREACHABLE: {'));
assert.match(denied, /offer: null/, 'an authorization refusal must not offer a retry or a sign-in');
assert.ok(denied.replace(/'\s*\+\s*\n\s*'/g, '').includes('REFS does not report what other entities exist or what access other accounts hold.'), 'an authorization refusal must say it does not disclose what exists');

// ---------------------------------------------------------------------------
// B (continued). EXECUTED against the published assets when a build is present.
// ---------------------------------------------------------------------------
let published = 'not built in this run';
if (existsSync(new URL('./dist/refs-runtime-config.js', import.meta.url)) && existsSync(new URL('./dist/refs-build.js', import.meta.url))) {
  const publishedConfig = read('dist/refs-runtime-config.js');
  const publishedBuild = read('dist/refs-build.js');
  const modes = [...publishedConfig.matchAll(/window\.__REFS_RUNTIME_MODE__='([A-Z_]+)'/g)].map(match => match[1]);
  const channels = [...publishedBuild.matchAll(/channel:"([A-Z_]+)"/g)].map(match => match[1]);
  assert.equal(modes.length, 1, 'the published adapter must declare exactly one runtime mode');
  assert.equal(channels.length, 1, 'the published build stamp must declare exactly one release channel');
  assert.equal(modes[0] === DEMONSTRATION_MODE, channels[0] === DEMONSTRATION_CHANNEL, 'the published adapter and build stamp must describe the same deployment');
  const boundary = resolveRuntimeBoundary({ __REFS_RUNTIME_MODE__: modes[0], __BUILD: stamp(channels[0]) });
  assert.notEqual(boundary.surface, SURFACE_ERROR, 'the published asset pair must resolve to a usable surface');
  published = `${modes[0]} / ${channels[0]} -> ${boundary.surface}`;
}

console.log(`PASS EXECUTED: ${boundaryCases.length} runtime environments resolved; app.jsx refuses the one legacy demonstration surface.`);
console.log('PASS EXECUTED: deployment adapter refuses a demonstration build with authoritative coordinates, an unsupported mode, and a plaintext API base.');
console.log(`PASS EXECUTED: published assets ${published}.`);
console.log('PASS STATIC: app boundary, 401/403 separation, route retention and error-state copy are wired as required.');
console.log('BLOCKED RUNTIME: no browser and no accounting API in this gate. Rendering and live HTTP behaviour are not evaluated here.');
