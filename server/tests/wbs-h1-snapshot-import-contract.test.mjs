import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importSnapshotFile,snapshotRowIdentity,assertSnapshotMoneyProjection} from '../tools/import-wbs-h1-snapshot.mjs';
import {resolveSnapshotEntryPath,createSnapshotIntegrityProbe} from '../runtime/wbs-h1-snapshot-manifest.mjs';

const digest=value=>createHash('sha256').update(value).digest('hex');
const claims=body=>({path:'C:\\provider\\snapshot.ndjson',domain:'accounting_info',company_code:'WBPA',period:'2026-H1',rows:2,bytes:Buffer.byteLength(body),sha256:digest(body)});
const body='{"id":1,"amount":"1"}\n{"id":2,"amount":"2"}';
function connection(prior){
  const calls=[];
  const client={async query(sql,args){calls.push({sql,args});return {rows:sql.startsWith('WITH input')?[{exact_count:JSON.parse(args.length===3?args[1]:args[0]).length}]:sql.startsWith('SELECT *')&&prior?[prior]:[]};},release(){calls.push({sql:'RELEASE'});}};
  return {calls,pool:{async connect(){return client;},query(){assert.fail('A file transaction must never use pool.query');}}};
}
async function fixture(t,content=body){
  const root=await mkdtemp(join(tmpdir(),'refs-r19-unit-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'snapshot.ndjson'),content);
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
test('verified replay checks stored population without DML and preserves the existing completion receipt',async t=>{
  const root=await fixture(t),file=claims(body),prior={domain:file.domain,company_code:file.company_code,period_code:file.period,row_count:2,byte_count:file.bytes,sha256:file.sha256,imported_at:new Date(),imported_row_count:2};
  const {pool,calls}=connection(prior);
  assert.deepEqual(await importSnapshotFile({pool,root,file}),{rows:2,replayed:true});
  assert.equal(calls.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x.sql)),false);
  assert.ok(calls.some(x=>x.sql.startsWith('WITH input')));
});

test('source identities never use batch indexes or unsafe numeric coercion',()=>{
  for(const row of [{},{id:''},{id:{}},{id:9007199254740992},{id:'\u0000'}])assert.throws(()=>snapshotRowIdentity('accounting_setting',row),/stable identity/);
  assert.equal(snapshotRowIdentity('accounting_setting',{id:12}),'12');
  assert.equal(snapshotRowIdentity('mdm_entity',{entity_id:'entity-1'}),'entity-1');
  assert.equal(snapshotRowIdentity('mdm_company',{uuid:'source-uuid'}),'source-uuid');
  assert.equal(snapshotRowIdentity('accounting_info',{id:'0012'}),'12');
});

test('monetary projections reject JSON numbers instead of rounding or guessing decimal scale',()=>{
  for(const [domain,key] of [['accounting_info','amount'],['accounting_info','accounting_value'],['ap_business','amount'],['ar_aging','amount'],['ar_aging','paid_amount'],['ar_aging','ar_balance'],['ar_aging','bucket_amount'],['invoice_details','invoice_amt'],['invoice_details','invoice_tot_amt']]){
    for(const raw of ['9007199254740993','0.10000000000000001','1.2300','0'])assert.throws(()=>assertSnapshotMoneyProjection(domain,JSON.parse(`{"${key}":${raw}}`)),/lossless source text/);
    for(const value of ['9007199254740993','0.10000000000000001','1.2300','-0.0000',null])assert.doesNotThrow(()=>assertSnapshotMoneyProjection(domain,{[key]:value}));
    assert.throws(()=>assertSnapshotMoneyProjection(domain,{[key]:'1\u0000.00'}),/lossless source text/);
  }
});

test('late numeric money refusal rolls back earlier real importer batches',async t=>{
  const content='{"id":1,"amount":"1.2300"}\n{"id":2,"amount":9007199254740993}',root=await fixture(t,content),{pool,calls}=connection();
  await assert.rejects(importSnapshotFile({pool,root,file:claims(content),batchSize:1}),/lossless source text/);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO wbs_h1_import.accounting_line')).length,1);
  assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
});

test('duplicate identities across batches reject and roll back instead of reducing the population',async t=>{
  const content='{"id":1}\n{"id":2}\n{"id":1}',root=await fixture(t,content),{pool,calls}=connection();
  await assert.rejects(importSnapshotFile({pool,root,file:{...claims(content),domain:'accounting_setting',rows:3},batchSize:1}),/duplicate source identity/);
  assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
  assert.equal(calls.filter(x=>x.sql.startsWith('INSERT INTO wbs_h1_import.reference_row')).length,2);
});

test('mismatched retained population is refused even with a matching completed receipt',async t=>{
  const root=await fixture(t),file=claims(body),prior={domain:file.domain,company_code:file.company_code,period_code:file.period,row_count:2,byte_count:file.bytes,sha256:file.sha256,imported_at:new Date(),imported_row_count:2};
  const {pool,calls}=connection(prior),client=await pool.connect(),query=client.query;
  client.query=async(sql,args)=>sql.startsWith('WITH input')?{rows:[{exact_count:1}]}:query.call(client,sql,args);
  await assert.rejects(importSnapshotFile({pool,root,file}),/population conflict/);
  assert.equal(calls.some(x=>/^(INSERT|UPDATE|DELETE)/.test(x.sql)),false);
  assert.deepEqual(calls.slice(-2).map(x=>x.sql),['ROLLBACK','RELEASE']);
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
