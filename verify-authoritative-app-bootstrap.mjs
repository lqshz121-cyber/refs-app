import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
const authoritative = readFileSync(new URL('./src/authoritative-app.jsx', import.meta.url), 'utf8');

assert.match(app, /<AuthoritativeApp environment=\{globalThis\}\s*\/>/, 'production runtime must enter AuthoritativeApp');
assert.doesNotMatch(app, /__REFS_RUNTIME_MODE__==='REQUIRES_AUTHORITATIVE_API'\) return <AuthoritativeRuntimeLock/, 'configured production must not unconditionally lock');
assert.match(authoritative, /accountingApiConfig\(environment\) && oidcRuntimeConfig\(environment\)/, 'API and OIDC configuration must both be required');
assert.match(authoritative, /new BrowserOidcClient\(\{ environment, fetcher \}\)/, 'authoritative runtime must bootstrap the configured OIDC client');
assert.match(authoritative, /refreshAuthoritativeDocuments/, 'authoritative AP and AR reads must be mounted');
assert.match(authoritative, /refreshAuthoritativeJournalEntries/, 'authoritative Journal Entry reads must be mounted');
assert.match(authoritative, /transitionAuthoritativeJournal/, 'authoritative workflow transitions must be mounted');
assert.match(authoritative, /No demo identity or browser accounting state is available in this mode/, 'authoritative login must not fall back to a demo identity');
assert.doesNotMatch(authoritative, /localStorage\s*[.(]|JOURNAL_ENTRIES|SEED_BILLS|SEED_BANK|FY2026/, 'authoritative runtime must not use browser seed accounting state');
assert.match(authoritative, /SUBMIT|nextAuthoritativeWorkflowAction/, 'workflow must begin with the server-derived next action');
assert.match(authoritative, /revision:Number\(row\.journal_revision \?\? row\.revision\)/, 'workflow must send the authoritative revision for If-Match');

console.log('PASS authoritative runtime: configured API and OIDC reach server-backed AP/AR/JE without demo state');
