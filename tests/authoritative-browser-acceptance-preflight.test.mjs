import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const read=path=>readFileSync(path,'utf8');
const packageJson=JSON.parse(read('package.json'));
const styles=read('index.html');
const workspace=read('src/authoritative-workspace.jsx');
const sourceDocuments=read('src/authoritative-source-documents-workspace.jsx');
const navigationShell=read('src/authoritative-navigation-shell.jsx');
const trace=read('src/accounting-api.js');
const providerAdapter=read('src/provider-trace-adapter.js');
const providerUi=read('src/authoritative-lineage-drill.jsx');
const stage1=read('server/runtime/verify-stage1-authoritative-e2e.mjs');
const runbook=read('docs/AUTHORITATIVE-BROWSER-ACCEPTANCE.md');

assert.match(packageJson.scripts?.pretest||'',/npm run test:authoritative-browser-acceptance-preflight/);
assert.match(packageJson.scripts?.pretest||'',/npm run test:authoritative-provider-evidence-trace/);
assert.match(stage1,/same-release-stamps/);
assert.match(stage1,/refs-build\.js/);
assert.match(styles,/\.authoritative-list-filters input,\.authoritative-list-filters select\{min-width:0;width:100%;max-width:100%;\}/);
assert.match(styles,/@media \(max-width:1400px\)\{\.authoritative-list-filters\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\);/);
assert.match(styles,/@media \(max-width:720px\)\{[\s\S]*?\.authoritative-list-filters\{grid-template-columns:minmax\(0,1fr\);/);
assert.match(styles,/input:focus-visible,select:focus-visible,textarea:focus-visible\{/);
assert.match(workspace,/<label>\{bill\?'Vendor':'Customer'\} <select/);
assert.match(sourceDocuments,/detailReturnRef\.current/);
assert.doesNotMatch(`${workspace}\n${navigationShell}`,/localStorage|sessionStorage|seed\.js|repo\.js|legacy-demo-app/);
// Provider trace is bundled as a read-only parser/UI contract. Authenticated
// runtime evidence is still required before claiming production equivalence.
assert.match(trace,/optionalLineage/);
assert.match(trace,/cache:'no-store'/);
assert.match(providerAdapter,/UNSUPPORTED_PROVIDER_TRACE/);
assert.match(providerUi,/ProviderEvidenceTrace/);
assert.match(runbook,/PREPARED, NOT EXECUTED/);
for(const viewport of ['320px','900px','1280px','200% zoom'])assert.match(runbook,new RegExp(viewport.replace('%','%')));

console.log('authoritative browser acceptance preflight: static release, responsive, keyboard, no-local-data, and provider evidence-trace contracts prepared; authenticated runtime evidence remains required');
