import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = resolve('tools/create-release-evidence-bundle.mjs');
const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });

assert.equal(result.status, 0, `bundle generator failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
assert.match(result.stdout, /release-evidence-bundle: wrote/);

const manifestPath = resolve('outputs/release-evidence-bundle/manifest.json');
const readmePath = resolve('outputs/release-evidence-bundle/README.md');
assert.equal(existsSync(manifestPath), true, 'bundle manifest must be written');
assert.equal(existsSync(readmePath), true, 'bundle README must be written');

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
assert.equal(manifest.mode, 'LOCAL_RELEASE_EVIDENCE_BUNDLE');
assert.match(manifest.warning, /not a production release claim/i);
assert.match(manifest.head_sha, /^[0-9a-f]{40}$/);
assert.equal(manifest.local_simulation_artifacts.envFile, 'outputs/local-release-simulation/env.json');
assert.equal(manifest.scripts['verify:external-release-gate'], 'node tools/verify-external-release-gate.mjs all');

const commandNames = new Set(manifest.required_commands.map(row => row.name));
for (const name of ['root-test', 'release-simulation', 'external-release-gate-local-sim', 'live-ui-7-page', 'provider-s3-scanner', 'provider-wbs-receipt', 'stage1-payable-live-chain', 'stage2-bank-live-chain']) {
  assert.equal(commandNames.has(name), true, `missing required command ${name}`);
}
assert.match(manifest.release_acceptance.global_release_gate, /PARTIAL\/FAIL/);
assert.equal(manifest.scripts['verify:stage1-payable-live-acceptance'], 'node server/tools/verify-stage1-payable-live-acceptance.mjs');
assert.equal(manifest.scripts['verify:stage2-bank-live-chain'], 'node server/runtime/verify-stage2-authoritative-e2e.mjs');

const readme = readFileSync(readmePath, 'utf8');
assert.match(readme, /Global release remains blocked/);
assert.match(readme, /provider S3\/scanner/);
assert.match(readme, /signed-off Bank-to-GL\/TB\/BS\/Cash Flow chain/);

console.log('release-evidence-bundle: manifest, command matrix and release boundary verified');
