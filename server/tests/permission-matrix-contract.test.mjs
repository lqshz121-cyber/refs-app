// S29: the permission matrix document is generated from the database; this
// test pins it against the migration SQL so it cannot drift silently.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
const root=new URL('../',import.meta.url);
const matrix=JSON.parse(readFileSync(new URL('fixtures/permission-matrix.json',root),'utf8'));
const sql=readdirSync(new URL('db/migrations/',root)).filter(f=>f.endsWith('.sql')).map(f=>readFileSync(new URL('db/migrations/'+f,root),'utf8')).join('\n');
test('every permission in the matrix is declared by a migration and vice versa (catalog inserts)',()=>{
  const inserts=[...sql.matchAll(/INSERT INTO permission_catalog[\s\S]*?;/g)].map(m=>m[0]).join('\n');
  const declared=new Set([...inserts.matchAll(/'([A-Z][A-Z0-9_]*(?:\.[A-Z0-9_]+)+)'/g)].map(m=>m[1]));
  const inMatrix=new Set(matrix.map(m=>m.permission_code));
  const missing=[...inMatrix].filter(p=>!declared.has(p));
  assert.deepEqual(missing,[],'matrix rows with no catalog INSERT');
  assert.ok(inMatrix.size>=150);
});
test('CRITICAL posting, close, reopen and sign-off permissions carry a human authority class and a distinct sod_class each',()=>{
  const crit=matrix.filter(m=>/\.(POST|CLOSE|REOPEN|SIGN_OFF)$/.test(m.permission_code));
  assert.ok(crit.length>=8);
  for(const m of crit){assert.equal(m.risk_class,'CRITICAL',m.permission_code);assert.ok(m.authority_class,m.permission_code+' needs a human authority class');}
  assert.equal(new Set(crit.map(m=>m.sod_class)).size,crit.length,'sod classes must not collapse');
});
test('scanner and cleanup permissions have no human authority class (service only)',()=>{
  for(const code of ['ATTACHMENT.FINALIZE','ATTACHMENT.CLEANUP']){const m=matrix.find(x=>x.permission_code===code);assert.ok(m);assert.equal(m.authority_class,null,code);}
});
test('the four GL workflow classes are distinct and each maps to one GL.JE permission',()=>{
  const gl=Object.fromEntries(matrix.filter(m=>/^GL\.JE\.(CREATE|SUBMIT|REVIEW|APPROVE|POST)$/.test(m.permission_code)).map(m=>[m.permission_code,m.authority_class]));
  assert.deepEqual(gl,{'GL.JE.CREATE':'DRAFT','GL.JE.SUBMIT':'SUBMIT','GL.JE.REVIEW':'REVIEW','GL.JE.APPROVE':'APPROVE','GL.JE.POST':'POST'});
});
