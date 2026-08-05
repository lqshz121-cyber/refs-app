import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('tools/verify-external-release-gate.mjs');
for (const gate of ['ui', 's3', 'wbs']) {
  const result = spawnSync(process.execPath, [script, gate], { encoding: 'utf8', env: {} });
  assert.equal(result.status, 2, `${gate} must fail closed without deployment configuration`);
  assert.match(`${result.stdout}${result.stderr}`, /RELEASE_GATE_CONFIG_MISSING/);
}
console.log('external-release-gate: missing configuration fails closed for ui, s3, and wbs');
