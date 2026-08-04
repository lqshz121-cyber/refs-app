import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../runtime/test-backup-restore-drill.mjs',import.meta.url),'utf8');
test('backup restore drill is restricted to its own random test project and databases',()=>{
  assert.match(source,/refs_backup_drill_\$\{process\.pid\}_\$\{Date\.now\(\)\.toString\(36\)\}/);
  assert.match(source,/const database='refs_backup_drill_test'/);assert.match(source,/const restoredDatabase='refs_backup_restore_test'/);
  assert.match(source,/endsWith\('_test'\)/);assert.match(source,/\['compose','-p',project,'-f','compose\.yaml','down','-v','--remove-orphans'\]/);assert.doesNotMatch(source,/docker\s+(volume|system)\s+(prune|rm)/i);
});
test('backup restore drill restores migrations and persisted accounting data before cleanup',()=>{
  assert.match(source,/pg_dump -U/);assert.match(source,/pg_restore -U/);assert.match(source,/count\(\*\) FROM refs_schema_migration/);assert.match(source,/tenant_code='BKDRILL'/);assert.match(source,/dropdb -U/);
});
