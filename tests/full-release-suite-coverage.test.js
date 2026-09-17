import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const serverPackageJson=JSON.parse(await readFile(new URL('../server/package.json',import.meta.url),'utf8'));

function untrackedScriptSources(scripts,prefix,tracked){
  const missing=[];
  for(const [name,command] of Object.entries(scripts)){
    const generated=new Set();
    for(const raw of command.split(/\s+/)){
      const token=raw.replace(/^['"]|['"]$/g,'');
      if(token.startsWith('--outfile=')){
        generated.add(prefix+token.slice('--outfile='.length).replace(/^\.\//,''));
        continue;
      }
      if(token.startsWith('-')||! /\.(?:mjs|cjs|jsx|js)$/.test(token))continue;
      const path=prefix+token.replace(/^\.\//,'');
      if(!tracked.has(path)&&!generated.has(path))missing.push(`${name}: ${path}`);
    }
  }
  return missing;
}

test('every root and server script source exists in the exact-case Git inventory',()=>{
  // Node 22 can silently ignore a missing --test argument when another file exists.
  // Check Git, not the working directory: untracked files must not hide CI omissions.
  const root=fileURLToPath(new URL('../',import.meta.url));
  const tracked=new Set(execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0'));
  const missing=[...untrackedScriptSources(packageJson.scripts,'',tracked),...untrackedScriptSources(serverPackageJson.scripts,'server/',tracked)];
  assert.deepEqual(missing,[],`script sources absent from Git (or case-mismatched): ${missing.join(', ')}`);
});

test('script inventory rejects missing, untracked and case-mismatched sources but permits earlier bundle outputs',()=>{
  const tracked=new Set(['tests/existing.test.mjs','src/input.jsx']);
  assert.deepEqual(untrackedScriptSources({test:'node --test tests/missing.test.mjs tests/existing.test.mjs'},'',tracked),['test: tests/missing.test.mjs']);
  assert.deepEqual(untrackedScriptSources({test:'node tests/Existing.test.mjs'},'',tracked),['test: tests/Existing.test.mjs']);
  assert.deepEqual(untrackedScriptSources({test:'node tests/local-only.test.mjs'},'',tracked),['test: tests/local-only.test.mjs']);
  assert.deepEqual(untrackedScriptSources({test:'esbuild ./src/input.jsx --outfile=tests/output.cjs && node tests/output.cjs'},'',tracked),[]);
  assert.deepEqual(untrackedScriptSources({test:'node tests/output.cjs && esbuild ./src/input.jsx --outfile=tests/output.cjs'},'',tracked),['test: tests/output.cjs']);
});

test('the reachable audit mutation harness uses the cross-platform esbuild API, never a guessed CLI entry',async()=>{
  const source=await readFile(new URL('../tools/analysis/audit-mutation-harness.mjs',import.meta.url),'utf8');
  assert.match(source,/import\s*\{\s*buildSync\s*\}\s*from\s*'esbuild'/);
  assert.match(source,/buildSync\(\{absWorkingDir: root, entryPoints: \['\.\/audit\.js'\], bundle: true/);
  assert.doesNotMatch(source,/execFileSync|node_modules|\.bin/);
  assert.equal(packageJson.scripts['test:audit-mutations'],'node tools/analysis/audit-mutation-harness.mjs');
});

// Server suites that cannot run inside `npm test`: they need a live staging/production
// API, a Docker daemon, or a real Postgres container. Each is executed by a dedicated job
// -- accounting-kernel-ci.yml (postgres:fresh, backup:restore, attachments:containers) or
// an operator-run release target. Adding a name here is a deliberate, reviewable decision;
// forgetting to wire a plain Node suite is not.
const INFRASTRUCTURE_BOUND_SERVER_SUITES=Object.freeze([
  'test:fixed-asset-acquisition-browser:e2e', // Requires owned Docker PostgreSQL and installed Chromium/Playwright.
  'test:fixed-asset-browser:e2e', // Requires owned Docker PostgreSQL and installed Chromium/Playwright.
  'test:attachments:containers',
  'test:backup:restore',
  'test:postgres:fixture:ai-exception-lineage',
  'test:postgres:fixture:ar-rent-pickup-close',
  'test:postgres:fixture:bank-reconcile',
  'test:postgres:fixture:controlled-ap-close',
  'test:postgres:fixture:real-estate-reports',
  'test:postgres:fixture:signed-bank-same-source-close',
  'test:postgres:fixture:signed-wbs-payable-post',
  'test:postgres:fixtures:closure',
  'test:restore:logical', // Requires a fresh PostgreSQL cluster: Docker-free logical restore drill (S24).
  'test:postgres:historical-head', // Requires a fresh _test cluster: proves migrateUp({until}) (S18).
  'test:postgres:ap-bill-void', // Requires the fresh gate database: pins T11-G1 (native AP bill posts OPEN; void requires APPROVED).
  'test:postgres:barriers', // Requires the fresh gate database: probes down/401 and down/414 inside rolled-back transactions.
  'test:postgres:concurrency', // Requires the fresh gate database: two-transaction races on one journal, If-Match 428/412, close/post interlock.
  'test:postgres:context-revocation', // Requires the fresh gate database: 16-way parallel bootstrap under SERIALIZABLE.
  'test:postgres:fresh',
  'test:postgres:journal-lifecycle', // Requires the fresh gate database: Draft->Submit->Review->Approve->Post->Reverse contract with SoD, 40001, idempotency and immutability.
  'test:postgres:report-trace', // Requires the fresh gate database: report-row-first reverse trace to ledger_line, journal_entry and evidence.
  'test:postgres:sod',
  'test:postgres:wbs-evidence', // Requires the fresh gate database: pg_trigger/privilege readback proving WBS evidence tables are immutable to refs_app. // Requires the fresh gate database: grant -> issue -> bind -> refs_post_journal positive and refusal paths.
  'test:production-ai-accounting-e2e',
  'test:stage1:authoritative-e2e',
  'test:stage2:authoritative-e2e',
  'test:stage3:bank-exception-authoritative-e2e',
  'test:stage3:cost-cwip-authoritative-e2e',
  'test:stage3:g11-authoritative-e2e',
  'test:stage3:insurance-prepaid-authoritative-e2e',
  'test:stage3:property-rent-authoritative-e2e',
  'test:stage3:reporting-authoritative-e2e',
  'test:stage4:authoritative-e2e',
  'test:staging:smoke',
]);

// Executed separately with an installed Playwright module and Chromium. This is
// component browser evidence, not a substitute for real API/identity acceptance.
const INFRASTRUCTURE_BOUND_ROOT_SUITES=Object.freeze([
  'test:asset-acquisition-browser',
]);

const reachableTestScripts=scripts=>{
  const reachable=new Set();
  const visit=command=>{
    for(const match of String(command||'').matchAll(/npm run (?:--silent )?([\w:.@/-]+)/g)){
      const name=match[1];
      if(reachable.has(name))continue;
      reachable.add(name);
      visit(scripts[name]);
    }
  };
  visit(`${scripts.pretest||''} && ${scripts.test||''} && ${scripts.posttest||''}`);
  return reachable;
};

test('root full test cannot omit authoritative Insurance, Property, dark-mode, accessibility or release gates',()=>{
  const full=packageJson.scripts?.test||'';
  for(const script of [
    'test:authoritative-amortization',
    'test:authoritative-property-rent',
    'test:authoritative-theme-preference',
    'test:navigation-a11y',
    'test:authoritative-runtime-evidence',
    'test:release-evidence-bundle',
  ])assert.match(full,new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: &&|$)`),`root test omits ${script}`);
});

test('root and server release suites include the accounting settings workflow gates',()=>{
  assert.match(packageJson.scripts?.test||'',/npm run test:accounting-settings-workflow(?: &&|$)/);
  const rootWorkflow=packageJson.scripts?.['test:accounting-settings-workflow']||'';
  assert.match(rootWorkflow,/accounting-settings-workflow-api-client\.test\.js/);
  assert.match(rootWorkflow,/authoritative-accounting-settings-workspace\.test\.jsx/);
  assert.match(serverPackageJson.scripts?.posttest||'',/npm run test:accounting-settings-workflow(?: &&|$)/);
  const serverWorkflow=serverPackageJson.scripts?.['test:accounting-settings-workflow']||'';
  for(const source of [
    'accounting-settings-workflow-contract.test.mjs',
    'accounting-settings-workflow-http.test.mjs',
    'accounting-settings-workflow-kernel-wiring.test.mjs',
    'accounting-settings-workflow-migration-contract.test.mjs',
    'accounting-settings-workflow-openapi.test.mjs',
  ])assert.match(serverWorkflow,new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('root release suite includes the authoritative Cash Transfer stack',()=>{
  assert.match(packageJson.scripts?.pretest||'',/npm run test:cash-transfer(?: &&|$)/);
  const cash=packageJson.scripts?.['test:cash-transfer']||'';
  for(const source of [
    'cash-transfer-contract.test.mjs',
    'cash-transfer-migration-contract.test.mjs',
    'cash-transfer-read-surfaces-contract.test.mjs',
    'cash-transfer-public-create-contract.test.mjs',
    'cash-transfer-attachment-candidates-pagination-contract.test.mjs',
    'cash-transfer-kernel-wiring.test.mjs',
    'cash-transfer-http.test.mjs',
    'cash-transfer-openapi-contract.test.mjs',
    'cash-transfer-api-client.test.js',
    'authoritative-cash-transfer-workspace.test.jsx',
  ])assert.match(cash,new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
});

test('Insurance and Property suites exercise both workspace and authoritative API client contracts',()=>{
  assert.match(packageJson.scripts?.['test:authoritative-amortization']||'',/authoritative-amortization-workspace\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-amortization']||'',/insurance-amortization-authoritative-client\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-property-rent']||'',/authoritative-property-rent-workspace\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-property-rent']||'',/property-rent-authoritative-client\.test/);
});

test('every root test:* script is reachable or explicitly requires browser infrastructure',()=>{
  const scripts=packageJson.scripts||{};
  const reachable=reachableTestScripts(scripts);
  const allowed=new Set(INFRASTRUCTURE_BOUND_ROOT_SUITES);
  const orphans=Object.keys(scripts).filter(name=>name.startsWith('test:')&&!reachable.has(name)&&!allowed.has(name));
  assert.deepEqual(orphans,[],`defined but never run by npm test: ${orphans.join(', ')}`);
  for(const name of allowed){
    assert.ok(Object.hasOwn(scripts,name),`allowlisted root suite no longer exists: ${name}`);
    assert.ok(!reachable.has(name),`allowlisted root suite already runs in npm test: ${name}`);
  }
});

test('every server test:* script is reachable from the server aggregate, or is a named infrastructure-bound suite',()=>{
  const scripts=serverPackageJson.scripts||{};
  const reachable=reachableTestScripts(scripts);
  const allowed=new Set([...INFRASTRUCTURE_BOUND_SERVER_SUITES,'test:database-dictionary']);
  const orphans=Object.keys(scripts).filter(name=>name.startsWith('test:')&&!reachable.has(name)&&!allowed.has(name));
  assert.deepEqual(orphans,[],`defined but never run by the server npm test: ${orphans.join(', ')}`);
});

test('server full test executes both fixed asset read contract suites',()=>{
  const full=serverPackageJson.scripts?.test||'';
  for(const source of [
    'tests/fixed-asset-register-contract.test.mjs',
    'tests/fixed-asset-movement-contract.test.mjs',
  ])assert.match(full,new RegExp(`(?:^|\\s)${source.replace(/[.*+?^${}()|[\\]\\\\]/g,'\\$&')}(?:\\s|$)`),`server test omits ${source}`);
});

test('root release pretest includes the database dictionary safety contract',()=>{
  assert.match(packageJson.scripts?.pretest||'',/server\/tests\/database-dictionary\.test\.mjs/);
  assert.equal(serverPackageJson.scripts?.['test:database-dictionary'],'node runtime/test-database-dictionary.mjs && node --test tests/database-dictionary-reader-role.test.mjs');
  assert.equal(serverPackageJson.scripts?.['db:dictionary'],'node runtime/export-database-dictionary.mjs');
});

test('accounting kernel CI runs the TypeScript domain gate before the frontend build',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/accounting-kernel-ci.yml',import.meta.url),'utf8');
  const typecheck=workflow.indexOf('name: TypeScript domain gate');
  const build=workflow.indexOf('name: Frontend build');
  assert.ok(typecheck>=0&&build>typecheck,'TypeScript domain gate must precede the frontend build');
  assert.match(workflow,/name: TypeScript domain gate\s+run: npm run typecheck/);
});
test('accounting kernel CI makes the database dictionary least-privilege gate explicit',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/accounting-kernel-ci.yml',import.meta.url),'utf8');
  assert.match(workflow,/name: Database dictionary least-privilege gate\s+working-directory: server\s+run: npm run test:database-dictionary/);
});

test('accounting kernel CI runs every isolated PostgreSQL business closure',async()=>{
  const workflow=await readFile(new URL('../.github/workflows/accounting-kernel-ci.yml',import.meta.url),'utf8');
  assert.match(workflow,/postgres-business-closures:\s+name: PostgreSQL business-closure fixture gate.*?timeout-minutes: (?:6\d|[7-9]\d|[1-9]\d{2,})/s);
  assert.match(workflow,/name: Run every isolated PostgreSQL accounting closure\s+working-directory: server\s+env:\s+POSTGRES_IMAGE: postgres:16-alpine\s+run: npm run test:postgres:fixtures:closure/s);
});

test('the infrastructure-bound allowlist cannot name a suite that npm test already runs, or one that no longer exists',()=>{
  const scripts=serverPackageJson.scripts||{};
  const reachable=reachableTestScripts(scripts);
  const missing=INFRASTRUCTURE_BOUND_SERVER_SUITES.filter(name=>!Object.hasOwn(scripts,name));
  assert.deepEqual(missing,[],`allowlisted server suites that no longer exist: ${missing.join(', ')}`);
  const redundant=INFRASTRUCTURE_BOUND_SERVER_SUITES.filter(name=>reachable.has(name));
  assert.deepEqual(redundant,[],`allowlisted server suites that npm test already runs: ${redundant.join(', ')}`);
});
