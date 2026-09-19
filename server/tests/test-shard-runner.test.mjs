// R13: unit contract for the resumable shard runner's pure functions. The runner itself
// is what we reach for when a full run is truncated, so its classification and sharding
// logic must be trustworthy without needing a full run to exercise them.
import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverTestFiles,shardOf,selectFiles,parseTap,classifyFailure,outcomeFor,summarize} from '../tools/test-shard-runner.mjs';

const res=(over={})=>({stdout:'',stderr:'',exitCode:0,signal:null,timedOut:false,durationMs:1,...over});
const tap=(t,p,f,s)=>`# tests ${t}\n# pass ${p}\n# fail ${f}\n# skipped ${s}\n# todo 0\n`;

test('R13-1: sharding is deterministic, total, and stable when the file set changes',()=>{
  const files=discoverTestFiles();
  assert.ok(files.length>100,'the server suite should discover a substantial number of files');
  assert.ok(files.every(f=>f.startsWith('tests/')&&f.endsWith('.test.mjs')));

  for(const total of [1,3,4,8,16]){
    const assigned=files.map(f=>shardOf(f,total));
    assert.ok(assigned.every(s=>Number.isInteger(s)&&s>=1&&s<=total),`shard ids must be 1..${total}`);
    // Total: every file lands in exactly one shard, and the union is the whole set.
    const union=[];
    for(let i=1;i<=total;i+=1)union.push(...selectFiles(files,{shard:`${i}/${total}`}));
    assert.equal(union.length,files.length,`shards of ${total} must partition the set with no loss`);
    assert.equal(new Set(union).size,files.length,`shards of ${total} must not overlap`);
  }

  // Deterministic across calls, and independent of neighbours: removing files must not
  // move the survivors, otherwise a resumed run would re-execute the wrong subset.
  const pick=files[Math.floor(files.length/2)];
  const before=shardOf(pick,8);
  assert.equal(shardOf(pick,8),before,'same input must give the same shard');
  const thinned=files.filter((_,i)=>i%3!==0);
  if(thinned.includes(pick))assert.equal(shardOf(pick,8),before,'shard must not depend on the rest of the set');
});

test('R13-2: filtering and shard selection compose without losing files',()=>{
  const files=['tests/a-postgres.test.mjs','tests/b.test.mjs','tests/c-postgres.test.mjs'];
  assert.deepEqual(selectFiles(files,{filter:'postgres'}),['tests/a-postgres.test.mjs','tests/c-postgres.test.mjs']);
  assert.deepEqual(selectFiles(files,{}),files);
  assert.throws(()=>selectFiles(files,{shard:'5/4'}),/out of range/);
});

test('R13-3: TAP counters are read back exactly',()=>{
  assert.deepEqual(parseTap(tap(97,88,0,9)),{tests:97,pass:88,fail:0,skipped:9,todo:0});
  assert.deepEqual(parseTap('no tap here'),{tests:0,pass:0,fail:0,skipped:0,todo:0});
});

test('R13-4: a file that skipped every test is SKIPPED, never PASSED',()=>{
  // This is the honesty rule: a suite that silently skipped because Postgres was absent
  // must not be reported as green.
  const allSkipped=outcomeFor('tests/x.test.mjs',res({stdout:tap(4,0,0,4)}));
  assert.equal(allSkipped.status,'SKIPPED');
  const someRan=outcomeFor('tests/y.test.mjs',res({stdout:tap(4,3,0,1)}));
  assert.equal(someRan.status,'PASSED');
  assert.equal(someRan.failure,null);
});

test('R13-5: failures are classified, and only actionable classes gate the build',()=>{
  const cases=[
    ['POSTGRES NOT RUN: ECONNREFUSED','POSTGRES_UNAVAILABLE',false,res({exitCode:1})],
    ['anything at all','TIMEOUT',true,res({exitCode:null,timedOut:true,signal:'SIGKILL'})],
    [`${tap(1,0,1,0)}MIGRATION_RESET_BLOCKED`,'MIGRATION_BARRIER',true,res({exitCode:1})],
    ['ERR_MODULE_NOT_FOUND cannot find x','MODULE_ERROR',true,res({exitCode:1})],
    ['died quietly','CRASH',true,res({exitCode:1})],
    [`${tap(1,0,1,0)}AssertionError [ERR_ASSERTION]`,'ASSERTION',true,res({exitCode:1})]
  ];
  for(const [text,code,actionable,result] of cases){
    const c=classifyFailure(text,result);
    assert.equal(c.code,code,`"${text.slice(0,30)}" should classify as ${code}`);
    assert.equal(c.actionable,actionable,`${code} actionable flag`);
  }
  // Ordering matters: a timeout whose output also contains an assertion is a TIMEOUT.
  assert.equal(classifyFailure(`${tap(1,0,1,0)}AssertionError`,res({timedOut:true})).code,'TIMEOUT');
});

test('R13-6: the summary separates actionable failures from environment failures',()=>{
  const state={results:[
    outcomeFor('tests/ok.test.mjs',res({stdout:tap(2,2,0,0)})),
    outcomeFor('tests/skip.test.mjs',res({stdout:tap(2,0,0,2)})),
    outcomeFor('tests/assert.test.mjs',res({exitCode:1,stdout:`${tap(1,0,1,0)}AssertionError`})),
    outcomeFor('tests/nopg.test.mjs',res({exitCode:1,stdout:'POSTGRES NOT RUN: ECONNREFUSED'}))
  ]};
  const s=summarize(state);
  assert.deepEqual(s.files,{total:4,passed:1,skipped:1,failed:2});
  assert.equal(s.assertions.tests,5);
  assert.deepEqual(s.failures_by_class,{ASSERTION:1,POSTGRES_UNAVAILABLE:1});
  assert.deepEqual(s.actionable_failures,[{file:'tests/assert.test.mjs',class:'ASSERTION'}]);
  assert.deepEqual(s.non_actionable_failures,[{file:'tests/nopg.test.mjs',class:'POSTGRES_UNAVAILABLE'}]);
});
