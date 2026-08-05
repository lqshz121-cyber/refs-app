import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const node = process.execPath;
const generator = resolve('tools/create-local-release-simulation.mjs');
const gate = resolve('tools/verify-external-release-gate.mjs');

const generated = spawnSync(node, [generator], { encoding: 'utf8' });
assert.equal(generated.status, 0, `generator failed\n${generated.stdout}\n${generated.stderr}`);

const envConfig = JSON.parse(readFileSync(resolve('outputs/local-release-simulation/env.json'), 'utf8'));
const env = { ...process.env, ...envConfig };

for (const name of ['ui', 's3', 'wbs']) {
  const result = spawnSync(node, [gate, name], { encoding: 'utf8', env });
  assert.equal(
    result.status,
    0,
    `${name} local simulation gate failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`,
  );
}

const aggregate = spawnSync(node, [gate, 'all'], { encoding: 'utf8', env });
assert.equal(
  aggregate.status,
  0,
  `aggregate local simulation gate failed\nSTDOUT:\n${aggregate.stdout}\nSTDERR:\n${aggregate.stderr}`,
);
assert.match(aggregate.stdout, /external-release-gate: 3\/3 provider evidence gates verified/);

const uiManifest = JSON.parse(readFileSync(envConfig.REFS_UI_E2E_MANIFEST, 'utf8'));
assert.equal(uiManifest.mode, 'LOCAL_SIMULATION');
assert.match(uiManifest.warning, /not production\/live evidence/i);

const s3Receipt = JSON.parse(readFileSync(envConfig.REFS_S3_SCANNER_LIFECYCLE_RECEIPT, 'utf8'));
assert.equal(s3Receipt.mode, 'LOCAL_SIMULATION');
assert.match(s3Receipt.warning, /not provider-backed/i);

const wbsReceipt = JSON.parse(readFileSync(envConfig.REFS_WBS_SIGNED_RECEIPT_FILE, 'utf8'));
assert.equal(wbsReceipt.mode, 'LOCAL_SIMULATION');
assert.match(wbsReceipt.warning, /not a live WBS signed receipt/i);
assert.equal(wbsReceipt.detached_signature?.algorithm, 'Ed25519');

const tamperedReceipt = resolve('outputs/local-release-simulation/wbs-signed-receipt-tampered.json');
writeFileSync(tamperedReceipt, `${JSON.stringify({ ...wbsReceipt, package_hash: 'sha256:'.concat('9'.repeat(64)) }, null, 2)}\n`, 'utf8');
const tampered = spawnSync(node, [gate, 'wbs'], {
  encoding: 'utf8',
  env: { ...env, REFS_WBS_SIGNED_RECEIPT_FILE: tamperedReceipt },
});
assert.equal(tampered.status, 2, 'tampered WBS receipt must fail closed');
assert.match(`${tampered.stdout}${tampered.stderr}`, /RELEASE_WBS_RECEIPT_SIGNATURE_INVALID/);

console.log('local-release-simulation: ui, s3, and wbs gates pass with local simulation artifacts');
