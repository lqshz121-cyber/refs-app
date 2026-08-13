import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';

const fullSha='abcdef1234567890abcdef1234567890abcdef12';

test('authoritative build preserves the complete promoted Git SHA in refs-build metadata',()=>{
  const built=spawnSync(process.execPath,['build.mjs'],{cwd:process.cwd(),env:{...process.env,GITHUB_SHA:fullSha},encoding:'utf8'});
  assert.equal(built.status,0,built.stderr||built.stdout);
  const metadata=readFileSync('dist/refs-build.js','utf8').match(/window\.__BUILD=(\{[^\n;]+\})/);
  assert.ok(metadata,'refs-build metadata is required');
  assert.equal(JSON.parse(metadata[1]).sha,fullSha);
});
