import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('production import resolves exact entity/company identity before using configured actors',async()=>{
  const repository=await readFile(new URL('../runtime/kernel-repository.mjs',import.meta.url),'utf8');
  const server=await readFile(new URL('../runtime/accounting-server.mjs',import.meta.url),'utf8');
  assert.match(repository,/async resolveWbsTestImportScope/);
  assert.match(repository,/entity_code=\$3 AND active/);
  assert.match(repository,/source_system='WBS' AND source_entity_id=\$3/);
  assert.match(repository,/\$3='WBPA' AND source_system='REFS_STAGE1' AND source_entity_id='REFS_US_001'/);
  assert.match(server,/resolveScope:selection=>kernelFor\(principal\)\.resolveWbsTestImportScope\(selection\)/);
});
