// N40: every test file and document the acceptance matrix cites must exist,
// so a row cannot silently point at evidence that was renamed or deleted.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const matrix=readFileSync(new URL('ACCEPTANCE-TRACEABILITY-MATRIX.md',root),'utf8');
test('every referenced test file and runbook exists',()=>{
  const body=matrix.split('\n## H. Receipt index')[0];
  const refs=[...body.matchAll(/`((?:server\/)?(?:tests|db\/migrations|runtime|api)\/[\w./-]+\.(?:mjs|js|jsx|json|sql)|[\w-]+\.md|server\/[\w-]+\.md|verify-[\w-]+\.mjs|\.github\/workflows\/[\w-]+\.yml|render(?:\.integrations)?\.yaml|index\.html)`/g)].map(m=>m[1]);
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

test('section H receipt index exists and every indexed receipt has a class; outputs/ paths cited in rows exist when present in this checkout',()=>{
  const h=matrix.split('\n## H. Receipt index')[1];assert.ok(h,'section H missing');
  const rows=h.split('\n').filter(l=>/^\| `CLAUDE-TO-CODEX-/.test(l));
  assert.ok(rows.length>=40);
  for(const r of rows)assert.match(r,/\| (VERIFIED|INHERITED|BLOCKED) \|$/,r);
  const outs=[...matrix.matchAll(/`(outputs\/[a-z0-9-]+\/[^`]*)`/g)].map(m=>m[1]);
  for(const o of outs){const dir=o.split('/').slice(0,2).join('/')+'/';if(existsSync(new URL(dir,root)))assert.ok(existsSync(new URL(o,root)),o);}
});
test('live read-backs use the LIVE_VERIFIED prefix and ☑ appears only in the Owner column',()=>{
  const rows=matrix.split('\n').filter(l=>/^\| [A-F]\d+ \|/.test(l));
  for(const row of rows){const cells=row.split('|').map(c=>c.trim());const live=cells[cells.length-4];if(/https?:|deployed|→ \d{3}|\bexit\b/.test(live))assert.match(live,/^LIVE_VERIFIED|^not run|^n\/a|^—|Owner|impossible|plan only/,row.slice(0,50));assert.ok(!cells.slice(1,cells.length-2).some(c=>/☑/.test(c)),'☑ outside Owner column: '+row.slice(0,40));}
});
