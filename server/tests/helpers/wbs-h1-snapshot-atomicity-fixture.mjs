import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {initializeSnapshotImportSchema,importSnapshotFile} from '../../tools/import-wbs-h1-snapshot.mjs';

// Called only by the existing isolated PostgreSQL kernel gate. No database URL,
// live provider, or production credentials are created by this fixture.
export async function proveSnapshotImportAtomicity(pool){
  const root=await mkdtemp(join(tmpdir(),'refs-r19-pg-'));
  const suffix=randomUUID(),fileName=`snapshot-${suffix}.ndjson`,path=`C:\\provider\\${fileName}`;
  const base=700000000000000+Math.floor(Math.random()*1000000000),ids=[base,base+1,base+2];
  const rows=ids.map((id,index)=>({id,com_code:'R19_TEST',amount:String(index+1)}));
  const body=rows.map(JSON.stringify).join('\n'); // final NDJSON line need not end in LF
  const file={path,domain:'accounting_info',company_code:'R19_TEST',period:'2026-H1',rows:rows.length,bytes:Buffer.byteLength(body),sha256:createHash('sha256').update(body).digest('hex')};
  await initializeSnapshotImportSchema(pool);
  const snapshot=async()=>({
    receipts:(await pool.query('SELECT * FROM wbs_h1_import.snapshot_file WHERE path=$1',[path])).rows,
    rows:(await pool.query('SELECT * FROM wbs_h1_import.accounting_line WHERE wbs_id=ANY($1::bigint[]) ORDER BY wbs_id',[ids])).rows
  });
  try{
    await writeFile(join(root,fileName),body);
    const before=await snapshot();assert.deepEqual(before,{receipts:[],rows:[]});
    // Several real INSERT batches execute before final digest refusal.
    for(const drift of [{sha256:'a'.repeat(64)},{rows:4},{bytes:file.bytes+1}]){
      await assert.rejects(importSnapshotFile({pool,root,file:{...file,...drift},batchSize:1}),/snapshot drift/);
      assert.deepEqual(await snapshot(),before,'failed initial import must leave no receipt or business rows');
    }
    // A later SQL cast failure must undo earlier successful batches as well.
    const invalid=rows.map((row,index)=>JSON.stringify(index===2?{...row,id:'not-an-integer'}:row)).join('\n');
    await writeFile(join(root,fileName),invalid);
    await assert.rejects(importSnapshotFile({pool,root,file:{...file,bytes:Buffer.byteLength(invalid),sha256:createHash('sha256').update(invalid).digest('hex')},batchSize:1}),error=>error.code==='22P02');
    assert.deepEqual(await snapshot(),before,'database failure must roll back earlier batches');
    await writeFile(join(root,fileName),body);
    const concurrent=await Promise.all([importSnapshotFile({pool,root,file,batchSize:1}),importSnapshotFile({pool,root,file,batchSize:1})]);
    assert.deepEqual(concurrent.map(x=>x.replayed).sort(),[false,true]);
    const committed=await snapshot();assert.equal(committed.receipts.length,1);assert.equal(committed.rows.length,3);assert.ok(committed.receipts[0].imported_at);
    assert.equal((await importSnapshotFile({pool,root,file,batchSize:1})).replayed,true);
    assert.deepEqual(await snapshot(),committed,'valid replay must leave timestamps, claims and rows byte-for-byte unchanged');
    const tampered=body.replace('"amount":"1"','"amount":"9"');
    await writeFile(join(root,fileName),tampered);
    await assert.rejects(importSnapshotFile({pool,root,file,batchSize:1}),/snapshot drift/);
    assert.deepEqual(await snapshot(),committed,'failed reimport must preserve old committed receipt and rows');
    const relabelled={...file,sha256:createHash('sha256').update(tampered).digest('hex')};
    await assert.rejects(importSnapshotFile({pool,root,file:relabelled,batchSize:1}),/receipt conflict/);
    assert.deepEqual(await snapshot(),committed,'same-path changed evidence must never relabel the old completion');
  }finally{await rm(root,{recursive:true,force:true});}
}
