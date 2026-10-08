import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {withTransaction} from '../runtime/db.mjs';

test('a checked-out disconnect is owned by the transaction, prevents commit and discards the connection',async()=>{
  const client=new EventEmitter(),queries=[];
  let releasedWith;
  client.query=async sql=>{queries.push(sql);return {rows:[]};};
  client.release=error=>{releasedWith=error;};
  const failure=Object.assign(new Error('private connection details'),{code:'ECONNRESET'});
  await assert.rejects(withTransaction({connect:async()=>client},async()=>{
    assert.equal(client.listenerCount('error'),1,'checked-out client needs an error owner');
    client.emit('error',failure);
    return 'must not commit';
  }),error=>error===failure);
  assert.ok(!queries.includes('COMMIT'));
  assert.equal(releasedWith,failure);
  assert.equal(client.listenerCount('error'),0,'transaction listener must not leak after release');
});

test('ordinary transaction success and work failure preserve release and rollback behavior',async()=>{
  for(const fails of [false,true]){
    const client=new EventEmitter(),queries=[];let released=false;
    client.query=async sql=>{queries.push(sql);};client.release=()=>{released=true;};
    const failure=new Error('work rejected');
    const run=withTransaction({connect:async()=>client},async()=>{if(fails)throw failure;return 42;});
    if(fails)await assert.rejects(run,error=>error===failure);else assert.equal(await run,42);
    assert.equal(queries.at(-1),fails?'ROLLBACK':'COMMIT');
    assert.equal(released,true);assert.equal(client.listenerCount('error'),0);
  }
});
