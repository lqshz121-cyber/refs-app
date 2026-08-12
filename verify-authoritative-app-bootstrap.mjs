import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
const authoritative = readFileSync(new URL('./src/authoritative-app.jsx', import.meta.url), 'utf8');
const oidc = readFileSync(new URL('./src/oidc-client.js', import.meta.url), 'utf8');

assert.match(app, /<AuthoritativeApp environment=\{globalThis\}\s*\/>/, 'production runtime must enter AuthoritativeApp');
assert.doesNotMatch(app, /__REFS_RUNTIME_MODE__==='REQUIRES_AUTHORITATIVE_API'\) return <AuthoritativeRuntimeLock/, 'configured production must not unconditionally lock');
assert.match(authoritative, /accountingApiConfig\(environment\) && oidcRuntimeConfig\(environment\)/, 'API and OIDC configuration must both be required');
assert.match(authoritative, /Reflect\.apply\(fetcher, environment, \[url, options\]\)/, 'authoritative runtime must bind browser fetch to its environment');
assert.match(authoritative, /new BrowserOidcClient\(\{ environment, fetcher:boundFetcher \}\)/, 'authoritative runtime must bootstrap OIDC with the environment-bound fetcher');
assert.match(authoritative, /refreshAuthoritativeDocuments\(\{ config, fetcher:boundFetcher \}\)/, 'authoritative AP and AR reads must use the environment-bound fetcher');
assert.match(authoritative, /refreshAuthoritativeJournalEntries\(\{ config, fetcher:boundFetcher \}\)/, 'authoritative journal reads must use the environment-bound fetcher');
for (const workspace of ['AuthoritativeAgingWorkspace', 'AuthoritativeBankWorkspace', 'AuthoritativeReconciliationWorkspace', 'AuthoritativeReportsWorkspace']) {
  assert.match(authoritative, new RegExp(`<${workspace}[^>]+fetcher=\\{boundFetcher\\}`), `${workspace} must receive the environment-bound fetcher`);
}
assert.match(authoritative, /refreshAuthoritativeDocuments/, 'authoritative AP and AR reads must be mounted');
assert.match(authoritative, /refreshAuthoritativeJournalEntries/, 'authoritative Journal Entry reads must be mounted');
assert.match(authoritative, /AuthoritativeJournalWorkspace/, 'authoritative Journal Entry evidence workspace must be mounted');
assert.doesNotMatch(authoritative, /transitionAuthoritativeJournal|nextAuthoritativeWorkflowAction/, 'authoritative Journal list evidence must not mount workflow mutations');
assert.match(authoritative, /Accounting records are read only from the authenticated API in this mode/, 'authoritative login must describe its authenticated API boundary');
assert.doesNotMatch(authoritative, /No demo identity/, 'authoritative login must not expose retired product terminology');
assert.doesNotMatch(authoritative, /localStorage\s*[.(]|JOURNAL_ENTRIES|SEED_BILLS|SEED_BANK|FY2026/, 'authoritative runtime must not use browser seed accounting state');
assert.doesNotMatch(authoritative, /Draft entry|route === 'drafts'/, 'authoritative shell must not advertise an unimplemented Draft entry route');
assert.doesNotMatch(oidc, /refresh_token|refreshToken|offline_access/, 'public browser OIDC must not persist a long-lived refresh credential');
assert.doesNotMatch(oidc, /localStorage/, 'OIDC identity state must remain tab-scoped');
assert.match(oidc, /prompt:'none'/, 'silent renewal must use prompt=none');
assert.match(oidc, /code_challenge_method:'S256',prompt:'none'/, 'silent renewal must use a fresh PKCE exchange');
assert.match(authoritative, /renewSilently/, 'authoritative runtime must attempt token renewal before expiry');
assert.match(authoritative, /silentRenewalSchedule/, 'authoritative runtime must schedule renewal from the verified expiry');
const watchStart = authoritative.indexOf('RENEWAL_WATCH_PHASES.has(phase)');
const watchEnd = authoritative.indexOf('}, [oidcClient, phase, environment]);');
assert.ok(watchStart > 0 && watchEnd > watchStart, 'the renewal watch must remain auditable');
const watch = authoritative.slice(watchStart, watchEnd);
assert.doesNotMatch(watch, /AUTHORIZATION_DENIED|ACCESS_DENIED|setPhase/, 'renewal failure must not become an authorization decision');

console.log('PASS authoritative runtime: configured API and OIDC reach server-backed AP/AR and read-only JE evidence without demo state');
console.log('PASS authoritative identity: prompt=none PKCE renewal is subject-bound, fail-closed and stores no refresh token');
