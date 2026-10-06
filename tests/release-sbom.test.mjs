import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8').replace(/\r\n/g,'\n');
test('release-sbom tool emits CycloneDX for root and server, stamps the git SHA, and fails closed on ESBOMPROBLEMS',()=>{
  const s=read('tools/release-sbom.mjs');
  assert.match(s,/'sbom','--sbom-format','cyclonedx','--omit','dev'/);assert.match(s,/refs:git_sha/);assert.match(s,/REFS_RELEASE_SBOM_MANIFEST_V1/);
  assert.match(s,/process\.exitCode=results\.every\(r=>r\.ok\)\?0:3/);
  assert.doesNotMatch(s,/https?:\/\//,'the SBOM step never uploads anywhere');
  const pkg=JSON.parse(read('package.json'));assert.equal(pkg.scripts['release:sbom'],'node tools/release-sbom.mjs');
});
test('CodeQL workflow runs on every pull request and never fakes an analysis when code scanning is unavailable (X05)',()=>{
  // X05 superseded the manual-only rule: the check must exist on every PR so the Owner can make it
  // required, and when GHAS is absent it must say so instead of pretending. The PR-trigger and GHAS
  // probe details are pinned by server/tests/ci-required-checks-contract.test.mjs (X05-1..5).
  const y=read('.github/workflows/codeql.yml');
  assert.match(y,/^on:\n  pull_request:\n/m);assert.match(y,/workflow_dispatch:/);
  assert.match(y,/name: codeql-analyze/);
  assert.match(y,/security-events: write/);
  for(const wf of ['accounting-kernel-ci.yml','deploy.yml','outbox-consumer-ci.yml','wbs-readonly-pilot.yml'])assert.ok(existsSync(new URL(`../.github/workflows/${wf}`,import.meta.url)),wf);
});
