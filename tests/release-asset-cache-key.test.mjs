import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, resolve} from 'node:path';

// S28: published-asset cache-key regression guard.
//
// Every published asset must be protected against being served stale after a
// redeploy, by exactly one of two mechanisms: a `no-store` header declared in
// the Render blueprint, or a `?b=<build key>` query on its <script> src. The
// build once used a bare `.replace('bundle.js', ...)`, which rewrote the first
// textual occurrence — a prose comment — and shipped the real bundle tag
// unkeyed. bundle.js has no no-store header, so it was protected by neither.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const buildScript = readFileSync(resolve(root, 'build.mjs'), 'utf8');
const renderBlueprint = readFileSync(resolve(root, 'render.yaml'), 'utf8');
const shell = readFileSync(resolve(root, 'index.html'), 'utf8');

test('the build anchors its cache key to the script src attribute, not to a bare filename', () => {
  assert.match(buildScript, /replace\(\/src="\\\.\\\/\(/, 'dist/index.html must be rewritten through an src="./…" anchored pattern');
  for (const asset of ['refs-build.js', 'refs-runtime-config.js', 'bundle.js']) {
    assert.doesNotMatch(buildScript, new RegExp(`replace\\('${asset.replace('.', '\\.')}'`), `${asset} must not be cache-keyed by a bare string replace`);
  }
});

test('index.html mentions these filenames in prose, which is why the anchor is required', () => {
  // If this ever stops being true the anchor is still correct, but the specific
  // trap it defends against is worth keeping visible.
  assert.ok(shell.split('bundle.js').length - 1 > 1, 'index.html references bundle.js more than once (tag plus prose)');
});

test('every published asset is either no-store in the blueprint or cache-keyed by the build', () => {
  const noStore = new Set(
    [...renderBlueprint.matchAll(/- path: \/([A-Za-z0-9._-]*)\n\s+name: Cache-Control\n\s+value: no-store/g)].map(match => match[1])
  );
  for (const asset of ['refs-build.js', 'refs-runtime-config.js', 'refs-runtime-lock.js', 'index.html']) {
    assert.ok(noStore.has(asset), `${asset} must be declared no-store in render.yaml`);
  }
  assert.ok(!noStore.has('bundle.js'), 'bundle.js is intentionally cacheable; it is protected by the build cache key instead');
  assert.match(buildScript, /bundle\\\.js/, 'the build cache-key pattern must cover bundle.js');
});
