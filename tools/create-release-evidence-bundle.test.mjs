import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const script = resolve('tools/create-release-evidence-bundle.mjs');
const source = readFileSync(script, 'utf8');
assert.match(source, /RELEASE_RECEIPT_MAX_BUFFER\s*=\s*64\s*\*\s*1024\s*\*\s*1024/,
  'executed PostgreSQL receipt output must not be truncated at Node\'s 1 MiB default');
assert.match(source, /runToReceipt[\s\S]*stdio:\s*\['ignore', stdoutFd, stderrFd\]/,
  'long-running receipt commands must stream to files instead of retaining TAP output in memory');
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
assert.equal(manifest.head_ci.head_sha, manifest.head_sha, 'CI evidence must bind to the same frozen SHA as the bundle');
assert.equal(typeof manifest.head_ci.available, 'boolean');
assert.deepEqual(manifest.local_execution, {
  requested: false,
  requested_postgres_versions: [],
  status: 'NOT_RUN',
  receipts: [],
});
assert.equal(manifest.local_simulation_artifacts.envFile, 'outputs/local-release-simulation/env.json');
assert.equal(manifest.scripts['verify:external-release-gate'], 'node tools/verify-external-release-gate.mjs all');

const commandNames = new Set(manifest.required_commands.map(row => row.name));
for (const name of ['root-test', 'release-simulation', 'wbs-e2e-harness', 'external-release-gate-local-sim', 'live-ui-22-page', 'provider-s3-scanner', 'provider-wbs-receipt', 'stage1-payable-live-chain', 'stage2-bank-live-chain', 'stage3-wbs-live-chain', 'stage3-cost-cwip-live-chain', 'stage3-g11-live-chain', 'stage3-reporting-live-chain', 'stage4-report-live-chain']) {
  assert.equal(commandNames.has(name), true, `missing required command ${name}`);
}
assert.match(manifest.release_acceptance.global_release_gate, /PARTIAL\/FAIL/);
assert.match(manifest.release_acceptance.global_release_gate, /22-page authoritative live E2E/);
assert.equal(manifest.scripts['verify:stage1-payable-live-acceptance'], 'node server/tools/verify-stage1-payable-live-acceptance.mjs');
assert.equal(manifest.scripts['verify:stage2-bank-live-chain'], 'node server/runtime/verify-stage2-authoritative-e2e.mjs');
assert.equal(manifest.scripts['verify:stage3-wbs-live-chain'], 'npm.cmd --prefix server run verify:wbs-live-acceptance');
assert.equal(manifest.scripts['verify:stage3-g11-live-chain'], 'node server/runtime/verify-stage3-g11-authoritative-e2e.mjs');
assert.equal(manifest.scripts['verify:stage4-report-live-chain'], 'node server/runtime/verify-stage4-authoritative-e2e.mjs');
const g11=manifest.required_commands.find(row=>row.name==='stage3-g11-live-chain');
assert.match(g11.scope,/ACCEPTED review→released candidate→PAYABLE_INCUR\/AUTOC events/);
assert.match(g11.scope,/291001 member allocation\/net zero→INCURRED/);
assert.match(g11.scope,/not satisfied by offline downstream JSON or local simulation/);
assert.equal(manifest.scripts['verify:stage3-cost-cwip-live-chain'], 'node server/runtime/verify-stage3-cost-cwip-authoritative-e2e.mjs');
assert.equal(manifest.scripts['verify:stage3-reporting-live-chain'], 'node server/runtime/verify-stage3-reporting-authoritative-e2e.mjs');
assert.equal(manifest.scripts['verify:stage4-report-live-chain'], 'node server/runtime/verify-stage4-authoritative-e2e.mjs');
const costCwip=manifest.required_commands.find(row=>row.name==='stage3-cost-cwip-live-chain');
assert.match(costCwip.scope,/GET-only WBS_COST_CWIP/);
assert.match(costCwip.scope,/must pair with the offline provider-signed gate/);
assert.match(costCwip.scope,/does not prove Review\/SoD, Insurance\/Prepaid, or Property Operations\/Rent Pickup/);
const reporting=manifest.required_commands.find(row=>row.name==='stage3-reporting-live-chain');
assert.match(reporting.scope,/paired TB→BS\/IS\/Cash matrix/);
assert.match(reporting.scope,/reporting readback only, not provider Insurance\/Prepaid or Property Operations\/Rent Pickup admission/);

const readme = readFileSync(readmePath, 'utf8');
assert.match(readme, /Global release remains blocked/);
assert.match(readme, /provider S3\/scanner/);
assert.match(readme, /signed-off Bank-to-GL\/TB\/BS\/Cash Flow chain/);
assert.match(readme, /signed WBS multi-source ingress-to-GL\/report evidence/);
assert.match(readme, /immutable report-snapshot-to-source evidence/);
assert.match(readme, /No commands were executed by this bundle invocation/);

console.log('release-evidence-bundle: manifest, command matrix and release boundary verified');
