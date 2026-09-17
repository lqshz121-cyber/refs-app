import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const read=p=>readFileSync(new URL(`../${p}`,import.meta.url),'utf8');
test('release-sbom tool emits CycloneDX for root and server, stamps the git SHA, and fails closed on ESBOMPROBLEMS',()=>{
  const s=read('tools/release-sbom.mjs');
  assert.match(s,/'sbom','--sbom-format','cyclonedx','--omit','dev'/);assert.match(s,/refs:git_sha/);assert.match(s,/REFS_RELEASE_SBOM_MANIFEST_V1/);
  assert.match(s,/process\.exitCode=results\.every\(r=>r\.ok\)\?0:3/);
  assert.doesNotMatch(s,/https?:\/\//,'the SBOM step never uploads anywhere');
  const pkg=JSON.parse(read('package.json'));assert.equal(pkg.scripts['release:sbom'],'node tools/release-sbom.mjs');
});
test('CodeQL workflow is manual-only and cannot become a blocking check by accident',()=>{
  const y=read('.github/workflows/codeql.yml');
  assert.match(y,/^on:\n  workflow_dispatch:\n/m);assert.doesNotMatch(y,/pull_request|push:/);
  assert.match(y,/security-events: write/);
  for(const wf of ['accounting-kernel-ci.yml','deploy.yml','outbox-consumer-ci.yml','wbs-readonly-pilot.yml'])assert.ok(existsSync(new URL(`../.github/workflows/${wf}`,import.meta.url)),wf);
});
