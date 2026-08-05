import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('tools/verify-external-release-gate.mjs');
for (const gate of ['ui', 's3', 'wbs']) {
  const result = spawnSync(process.execPath, [script, gate], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 2, `${gate} must fail closed without deployment configuration`);
  assert.match(`${result.stdout}${result.stderr}`, /RELEASE_GATE_CONFIG_MISSING/);
}
const all = spawnSync(process.execPath, [script, 'all'], { encoding: 'utf8', env: {} });
assert.equal(all.status, 2, 'aggregate gate must fail closed without deployment configuration');
assert.match(`${all.stdout}${all.stderr}`, /RELEASE_GATE_CONFIG_MISSING/);

const invalid = spawnSync(process.execPath, [script, 'unknown'], { encoding: 'utf8', env: {} });
assert.equal(invalid.status, 2, 'unknown gate must fail closed');
assert.match(`${invalid.stdout}${invalid.stderr}`, /RELEASE_GATE_ARGUMENT_INVALID/);

console.log('external-release-gate: missing configuration fails closed for ui, s3, wbs, and all');
