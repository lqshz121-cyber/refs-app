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
