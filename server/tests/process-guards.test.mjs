// R15 / L21: crash-loop regression contract for the process guards.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {installProcessGuards,gracefulClose,safeErrorCode} from '../runtime/process-guards.mjs';

test('an unhandled rejection logs one safe event, runs stop once, and exits 1 - never an object dump',async()=>{
  const proc=new EventEmitter();const logs=[];let stops=0,exitCode=null;
  installProcessGuards({process:proc,logger:{error:l=>logs.push(l)},stop:async()=>{stops++;},exit:c=>{exitCode=c;},stopTimeoutMs:50});
  proc.emit('unhandledRejection',Object.assign(new Error('Connection terminated unexpectedly'),{code:'ECONNRESET',client:{password:'x'}}));
  proc.emit('unhandledRejection',new Error('second'));
  await new Promise(r=>setTimeout(r,20));
  assert.equal(stops,1);assert.equal(exitCode,1);
  assert.deepEqual(logs.map(l=>JSON.parse(l)),[{event:'process_unhandled_rejection',code:'ECONNRESET'},{event:'process_unhandled_rejection',code:'UNKNOWN'}]);
  for(const l of logs){assert.ok(!/password|terminated|stack/.test(l));}
});
test('a hanging stop() is cut by the deadline and still exits 1',async()=>{
  const proc=new EventEmitter();let exitCode=null;
  installProcessGuards({process:proc,logger:{error(){}},stop:()=>new Promise(()=>{}),exit:c=>{exitCode=c;},stopTimeoutMs:30});
  proc.emit('uncaughtException',new Error('boom'));
  await new Promise(r=>setTimeout(r,80));assert.equal(exitCode,1);
});
test('guards install once per process object and can be uninstalled',()=>{
  const proc=new EventEmitter();const a=installProcessGuards({process:proc,logger:{error(){}},exit(){}});const b=installProcessGuards({process:proc,logger:{error(){}},exit(){}});
  assert.equal(a,b);assert.equal(proc.listenerCount('unhandledRejection'),1);a.uninstall();assert.equal(proc.listenerCount('unhandledRejection'),0);
});
test('gracefulClose closes idle connections immediately, resolves on close, and force-closes at the deadline',async()=>{
  const calls=[];let closeCb=null;
  const server={close(cb){calls.push('close');closeCb=cb;},closeIdleConnections(){calls.push('idle');},closeAllConnections(){calls.push('all');}};
  const p=gracefulClose(server,{timeoutMs:20});await new Promise(r=>setTimeout(r,40));await p;
  assert.deepEqual(calls,['close','idle','all']);
  const server2={close(cb){setTimeout(cb,5);},closeIdleConnections(){},closeAllConnections(){calls.push('never');}};
  await gracefulClose(server2,{timeoutMs:1000});assert.ok(!calls.includes('never'));
});
test('safeErrorCode admits SQLSTATE and Node codes only',()=>{assert.equal(safeErrorCode({code:'57P01'}),'57P01');assert.equal(safeErrorCode({code:'ECONNRESET'}),'ECONNRESET');assert.equal(safeErrorCode({code:'drop table x'}),'UNKNOWN');assert.equal(safeErrorCode(null),'UNKNOWN');});
