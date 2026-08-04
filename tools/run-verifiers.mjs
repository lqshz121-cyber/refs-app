import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const verifiers = readdirSync(root)
  .filter(name => /^verify-.*\.mjs$/.test(name))
  .sort();

let failed = 0;
for (const verifier of verifiers) {
  const result = spawnSync(process.execPath, [resolve(root, verifier)], {
    cwd: root,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    failed += 1;
    console.error(`FAIL ${verifier} (exit ${result.status ?? 'signal'})`);
  }
}

console.log(`Verifier summary: ${verifiers.length - failed}/${verifiers.length} passed`);
process.exitCode = failed ? 1 : 0;
