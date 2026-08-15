import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

const root=dirname(dirname(fileURLToPath(import.meta.url)));

test('the production package cannot mint provider-signed WBS delivery evidence',()=>{
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  assert.equal(manifest.scripts['wbs:signed-delivery:create'],undefined);
  assert.equal(existsSync(join(root,'tools','create-wbs-signed-delivery.mjs')),false);
});
