import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('./.github/workflows/deploy.yml', import.meta.url), 'utf8');
assert.match(workflow, /workflow_run:\s*\n\s+workflows: \[Accounting Kernel Gate\]/, 'Pages must be triggered by the accounting kernel gate');
assert.doesNotMatch(workflow, /\n\s+push:\s*\n\s+branches: \[main\]/, 'Pages must not race the kernel gate on a direct push');
assert.match(workflow, /workflow_run\.conclusion == 'success'/, 'Pages build must require a successful kernel conclusion');
assert.match(workflow, /workflow_run\.head_branch == 'main'/, 'automatic Pages deploy must be restricted to main');
assert.match(workflow, /ref: \$\{\{ github\.event\.workflow_run\.head_sha \|\| github\.sha \}\}/, 'Pages must checkout the exact gated SHA');
assert.match(workflow, /deploy:\s*\n\s+needs: build/, 'deployment must require the gated build job');
assert.match(workflow, /npm run verify:runtime-deployment-assets/, 'Pages must verify runtime deployment assets before upload');
console.log('PASS release deploy: Pages waits for the successful same-SHA accounting kernel gate');
