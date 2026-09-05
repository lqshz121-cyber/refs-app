import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importSnapshotFile} from '../tools/import-wbs-h1-snapshot.mjs';
import {resolveSnapshotEntryPath,createSnapshotIntegrityProbe} from '../runtime/wbs-h1-snapshot-manifest.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const claims=body=>({path:'C:\\provider\\snapshot.ndjson',domain:'accounting_info',company_code:'WBPA',period:'2026-H1',rows:2,bytes:Buffer.byteLength(body),sha256:digest(body)});
const body='{"id":1,"amount":"1"}\n{"id":2,"amount":"2"}';
function connection(prior){
  const calls=[];
  const client={async query(sql,args){calls.push({sql,args});return {rows:sql.startsWith('SELECT *')&&prior?[prior]:[]};},release(){calls.push({sql:'RELEASE'});}};
  return {calls,pool:{async connect(){return client;},query(){assert.fail('A file transaction must never use pool.query');}}};
}
async function fixture(t){
  const root=await mkdtemp(join(tmpdir(),'refs-r19-unit-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'snapshot.ndjson'),body);
  return root;
}

test('Windows, POSIX and bare names resolve only inside the delivered root',()=>{
  for(const path of ['snapshot.ndjson','C:\\provider\\snapshot.ndjson','/outside/snapshot.ndjson','../snapshot.ndjson'])
    assert.equal(resolveSnapshotEntryPath('/snapshot',{path}),join('/snapshot','snapshot.ndjson'));
  for(const path of ['','..','/out/','x.json','x.ndjson.bak','C:evil.ndjson'])
    assert.throws(()=>resolveSnapshotEntryPath('/snapshot',{path}));
});
test('integrity counts parsed rows independently of trailing newline and rejects each drift',()=>{
  const file=claims(body),probe=createSnapshotIntegrityProbe(file);
  probe.observe(Buffer.from(body));assert.equal(probe.settle(2).rows,2);
  for(const drift of [{rows:3},{bytes:file.bytes+1},{sha256:'a'.repeat(64)}]){
    const bad=createSnapshotIntegrityProbe({...file,...drift});bad.observe(Buffer.from(body));
    assert.throws(()=>bad.settle(2),/snapshot drift/);
  }
});
test('one checked-out client covers BEGIN, all batches, completion and COMMIT',async t=>{
  const root=await fixture(t),{pool,calls}=connection();
  assert.deepEqual(await importSnapshotFile({pool,root,file:claims(body),batchSize:1}),{rows:2,replayed:false});
  assert.equal(calls[0].sql,'BEGIN');assert.equal(calls.at(-2).sql,'COMMIT');assert.equal(calls.at(-1).sql,'RELEASE');
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO wbs_h1_import.accounting_line')).length,2);
  assert.ok(calls.findIndex(x=>x.sql.startsWith('UPDATE'))>calls.findIndex(x=>x.sql.startsWith('INSERT INTO wbs_h1_import.accounting_line')));
});
test('late integrity failure rolls back after executed batches and never marks imported',async t=>{
  const root=await fixture(t),{pool,calls}=connection();
  await assert.rejects(importSnapshotFile({pool,root,file:{...claims(body),sha256:'a'.repeat(64)},batchSize:1}),/snapshot drift/);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO wbs_h1_import.accounting_line')).length,2);
  assert.equal(calls.some(x=>x.sql.startsWith('UPDATE')||x.sql==='COMMIT'),false);
  assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
});
test('verified replay performs no DML and preserves the existing completion receipt',async t=>{
  const root=await fixture(t),file=claims(body),prior={domain:file.domain,company_code:file.company_code,period_code:file.period,row_count:2,byte_count:file.bytes,sha256:file.sha256,imported_at:new Date(),imported_row_count:2};
  const {pool,calls}=connection(prior);
  assert.deepEqual(await importSnapshotFile({pool,root,file}),{rows:2,replayed:true});
  assert.equal(calls.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x.sql)),false);
});
test('changed or legacy-incomplete receipts fail closed without DML',async t=>{
  const root=await fixture(t),file=claims(body),prior={domain:file.domain,company_code:file.company_code,period_code:file.period,row_count:2,byte_count:file.bytes,sha256:file.sha256,imported_at:new Date(),imported_row_count:2};
  for(const change of [{sha256:'a'.repeat(64)},{imported_at:null},{imported_row_count:1}]){
    const {pool,calls}=connection({...prior,...change});
    await assert.rejects(importSnapshotFile({pool,root,file}),/receipt/);
    assert.equal(calls.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x.sql)),false);
    assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
  }
});
test('missing input and malformed JSON reject inside the transaction and release the client',async t=>{
  const root=await fixture(t);
  for(const content of [null,'{"id":1}\nnot-json\n']){
    if(content===null)await rm(join(root,'snapshot.ndjson'));else await writeFile(join(root,'snapshot.ndjson'),content);
    const {pool,calls}=connection();
    await assert.rejects(importSnapshotFile({pool,root,file:claims(body),batchSize:1}));
    assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
  }
});
