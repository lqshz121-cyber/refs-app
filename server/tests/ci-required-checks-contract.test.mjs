// X05: the required-check surface, verified locally.
//
// GitHub branch protection is Owner-configured and cannot be read or set from here, so this file
// verifies the half that lives in the repository: that every job an Owner would select as a
// required check actually exists, actually runs on pull_request, and has a stable name that will
// not silently change underneath the protection rule.
//
// The defect this closes (S-GATE-04 §2): of five workflows, only two ran on pull_request. CodeQL
// was workflow_dispatch only, so security scanning could not be a required check at all, and
// there was no secret/dependency job anywhere.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const DIR=new URL('../../.github/workflows/',import.meta.url);
const read=f=>readFileSync(new URL(f,DIR),'utf8');
const workflows=readdirSync(DIR).filter(f=>f.endsWith('.yml')).sort();

// The jobs an Owner should be able to select in branch protection. Name them here so a rename
// breaks this test rather than silently detaching the protection rule from the job.
const REQUIRED_CANDIDATES=[
  {workflow:'accounting-kernel-ci.yml', job:'static-and-unit',            covers:'TypeScript, frontend build, frontend SSR, unit gates'},
  {workflow:'accounting-kernel-ci.yml', job:'core-gates',                 covers:'migration idempotency and the release gates, one database per gate (R05)'},
  {workflow:'accounting-kernel-ci.yml', job:'postgres-required',          covers:'migrations and core service tests on PostgreSQL'},
  {workflow:'outbox-consumer-ci.yml',   job:'isolated-consumer',          covers:'outbox consumer isolation'},
  {workflow:'security-gate.yml',        job:'secret-and-dependency-scan', covers:'secret scan and dependency audit'},
  {workflow:'codeql.yml',               job:'analyze',                    covers:'SAST'}
];

const jobsOf=text=>{
  const body=text.split(/^jobs:\s*$/m)[1]??'';
  return [...body.matchAll(/^  ([a-zA-Z0-9_-]+):\s*$/gm)].map(m=>m[1]);
};
const triggersOf=text=>{
  const body=(text.split(/^on:\s*$/m)[1]??'').split(/^[a-z]/m)[0];
  return body;
};

test('X05-1: every required-check candidate exists as a job in its workflow',()=>{
  for(const {workflow,job} of REQUIRED_CANDIDATES){
    assert.ok(workflows.includes(workflow),`${workflow} must exist`);
    assert.ok(jobsOf(read(workflow)).includes(job),
      `${workflow} must define job "${job}" -- branch protection selects jobs by name, so a rename detaches the rule`);
  }
});

test('X05-2: every required-check candidate runs on pull_request',()=>{
  const offenders=[];
  for(const {workflow,job} of REQUIRED_CANDIDATES){
    if(!/pull_request/.test(triggersOf(read(workflow))))offenders.push(`${workflow} (${job})`);
  }
  assert.deepEqual(offenders,[],
    `a workflow that does not run on pull_request cannot be a required check:\n${offenders.join('\n')}`);
});

test('X05-3: CodeQL runs on pull_request and cannot block a PR when code scanning is unavailable',()=>{
  const text=read('codeql.yml');
  assert.match(text,/pull_request/,'CodeQL must run on pull_request to be selectable as a required check');
  // The original rationale for manual-only was that a job which cannot run must never be required.
  // That is still true, so the job has to degrade rather than fail when GHAS is absent.
  assert.match(text,/code-scanning\/alerts/,'CodeQL must detect whether code scanning is actually available');
  assert.match(text,/available == 'true'/,'analysis steps must be conditional on that detection');
  assert.doesNotMatch(text,/continue-on-error:\s*true/,
    'do not paper over real analysis failures; gate on capability detection instead');
});

test('X05-4: the security gate scans only the pull request diff and fails on high severity',()=>{
  const text=read('security-gate.yml');
  assert.match(text,/security:secret-scan/,'the secret scanner must run');
  assert.match(text,/SECRET_SCAN_RANGE/,'it must be scoped to the PR diff, or every PR re-reports historical fixtures');
  assert.match(text,/fetch-depth:\s*0/,'diffing against the merge base needs history');
  assert.match(text,/npm audit --audit-level=high/,'dependency audit must gate on high and critical');
});

test('X05-5: deploy is not a merge gate',()=>{
  // deploy.yml is triggered by workflow_run after the kernel gate. If it were ever selected as a
  // required check it would deadlock: it cannot run until after the very merge it would be gating.
  const text=read('deploy.yml');
  assert.match(text,/workflow_run/,'deploy is expected to be workflow_run-triggered');
  assert.ok(!REQUIRED_CANDIDATES.some(c=>c.workflow==='deploy.yml'),
    'deploy must never be listed as a required-check candidate');
});

// R05: a required check is only as good as its failure semantics. These pin the two ways a job can
// go green without proving anything -- a job name that drifts, and a step that is allowed to fail.
const jobBlock=(text,job)=>{
  const body=text.split(/^jobs:\s*$/m)[1]??'';
  const m=new RegExp(`^  ${job}:\\s*$([\\s\\S]*?)(?=^  [a-zA-Z0-9_-]+:\\s*$|$(?![\\s\\S]))`,'m').exec(body);
  return m?m[1]:'';
};

test('R05-1: every required-check candidate declares an explicit, stable `name:` equal to its job id',()=>{
  // Branch protection matches on the displayed name. Without `name:` GitHub shows the job id today
  // and a matrix suffix or a rename tomorrow; pinning name === id makes the rule survive both.
  const offenders=[];
  for(const {workflow,job} of REQUIRED_CANDIDATES){
    const block=jobBlock(read(workflow),job);
    const name=/^\s{4}name:\s*(\S.*)$/m.exec(block)?.[1]?.trim();
    if(job==='analyze'){if(name!=='codeql-analyze')offenders.push(`${workflow}/${job}: name is ${name??'missing'}`);continue;}
    // postgres-required is a matrix job whose per-version display names ("PostgreSQL 16 required gate")
    // predate R05 and may already be referenced by branch protection; renaming them would silently
    // unhook that rule, which is exactly what R05-1 exists to prevent. Pin the existing template instead.
    if(job==='postgres-required'){if(name!=='PostgreSQL ${{ matrix.postgres }} required gate')offenders.push(`${workflow}/${job}: name is ${name??'missing'}`);continue;}
    if(name!==job)offenders.push(`${workflow}/${job}: name is ${name??'missing'}`);
  }
  assert.deepEqual(offenders,[]);
});

test('R05-2: no required-check candidate softens a step with continue-on-error',()=>{
  const offenders=REQUIRED_CANDIDATES.filter(({workflow,job})=>/continue-on-error:\s*true/.test(jobBlock(read(workflow),job))).map(c=>`${c.workflow}/${c.job}`);
  assert.deepEqual(offenders,[],'a step that may fail without failing the job is not a gate');
});

test('R05-3: core-gates runs the migration idempotency check and the isolated gate runner on a fresh database',()=>{
  const block=jobBlock(read('accounting-kernel-ci.yml'),'core-gates');
  assert.match(block,/REFS_PG_REQUIRED:\s*'1'/,'gates may not pass by skipping for lack of a database');
  assert.match(block,/compose\.yaml up -d --wait/,'a fresh local-only PostgreSQL is started for the job');
  assert.match(block,/npm run db:up\s*$/m,'the database is migrated through the real entry point');
  assert.match(block,/npm run verify:migration-idempotent/,'a second db:up must be proven to be a no-op');
  assert.match(block,/npm run gate:isolated/,'gates run one database per gate (R04)');
  assert.match(block,/fetch-depth:\s*0/,'gate:security diffs the PR range and needs history');
  assert.match(block,/upload-artifact[\s\S]*if-no-files-found:\s*error/,'per-gate JSON is the evidence; its absence is a failure');
  assert.ok(block.indexOf('npm run db:up')<block.indexOf('verify:migration-idempotent')&&
    block.indexOf('verify:migration-idempotent')<block.indexOf('gate:isolated'),'steps run in evidence order');
});

test('R05-4: the migration idempotency verifier and the isolated gate runner are real package scripts',()=>{
  const pkg=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  assert.equal(pkg.scripts['verify:migration-idempotent'],'node runtime/verify-migration-idempotent.mjs');
  assert.equal(pkg.scripts['gate:isolated'],'node tools/gate-runner.mjs');
});
