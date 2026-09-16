// N40: every test file and document the acceptance matrix cites must exist,
// so a row cannot silently point at evidence that was renamed or deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const matrix=readFileSync(new URL('ACCEPTANCE-TRACEABILITY-MATRIX.md',root),'utf8');
test('every referenced test file and runbook exists',()=>{
  const refs=[...matrix.matchAll(/`((?:server\/)?(?:tests|db\/migrations|runtime|api)\/[\w./-]+\.(?:mjs|js|jsx|json|sql)|[\w-]+\.md|server\/[\w-]+\.md|verify-[\w-]+\.mjs|\.github\/workflows\/[\w-]+\.yml|render(?:\.integrations)?\.yaml|index\.html)`/g)].map(m=>m[1]);
  const unique=[...new Set(refs)].filter(f=>!f.includes('*'));
  assert.ok(unique.length>=25,`expected many references, got ${unique.length}`);
  const missing=unique.filter(f=>!existsSync(new URL(f,root)));
  assert.deepEqual(missing,[]);
});
test('every row carries a status and an Owner tick box',()=>{
  const rows=matrix.split('\n').filter(l=>/^\| [A-F]\d+ \|/.test(l));
  assert.ok(rows.length>=30);
  for(const row of rows){const cells=row.split('|').map(c=>c.trim());assert.match(cells[cells.length-2],/[☐☑]/,row.slice(0,40));assert.match(cells[cells.length-3],/DONE|EVIDENCED|GAP|BLOCKED|PARTIAL|open task|Owner .*decision/,row.slice(0,40));}
});
