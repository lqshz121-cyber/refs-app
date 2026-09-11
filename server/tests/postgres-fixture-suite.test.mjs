import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {FIXTURES,fixtureResult,readTapSummary,runFixture,selectFixtures} from '../runtime/run-postgres-fixture-suite.mjs';
import {dropIamRaceDatabase} from './helpers/iam-race-database-cleanup.mjs';

test('IAM race cleanup reserves a connection, bounds DDL time and restores its prior query timeout',async()=>{
  const calls=[],releases=[],name='refs_iam_race_0123456789abcdef_test';
  const pool={connect:async()=>({query:async(sql,args)=>{calls.push([sql,args]);return {rows:[{timeout:'10s'}]};},release:error=>releases.push(error)})};
  await dropIamRaceDatabase(pool,name);
  assert.deepEqual(calls,[["SELECT current_setting('statement_timeout') AS timeout",undefined],["SELECT set_config('statement_timeout',$1,false)",['600000']],[`DROP DATABASE "${name}"`,undefined],["SELECT set_config('statement_timeout',$1,false)",['10s']]]);
  assert.deepEqual(releases,[undefined]);
  for(const unsafe of ['refs_kernel_gate_test','production','refs_iam_race_0123456789abcdef_test"; DROP DATABASE production;'])await assert.rejects(dropIamRaceDatabase({connect:()=>{throw Error('must not connect');}},unsafe),/only the generated IAM race database/);
});

test('IAM cleanup preserves the test failure and discards a connection whose timeout cannot be restored',async()=>{
  const primary=new Error('original assertion'),dropError=new Error('drop timed out'),resetError=new Error('connection lost'),releases=[];
  const pool={connect:async()=>({query:async(sql,args)=>{if(sql.startsWith('DROP'))throw dropError;if(args?.[0]==='10s')throw resetError;return {rows:[{timeout:'10s'}]};},release:error=>releases.push(error)})};
  await assert.rejects(dropIamRaceDatabase(pool,'refs_iam_race_0123456789abcdef_test',primary),error=>error instanceof AggregateError&&error.errors.length===3&&error.errors[0]===primary&&error.errors[1]===dropError&&error.errors[2]===resetError);
  assert.deepEqual(releases,[resetError]);
  await assert.rejects(dropIamRaceDatabase({connect:async()=>{throw dropError;}},'refs_iam_race_0123456789abcdef_test',primary),error=>error instanceof AggregateError&&error.errors[0]===primary&&error.errors[1]===dropError);
});

test('PostgreSQL fixture suite names each isolated accounting closure explicitly',()=>{
  assert.deepEqual(FIXTURES.map(item=>item.id),['controlled-ap-close','ar-rent-pickup-close','signed-wbs-payable-post','signed-cost-cwip-post','signed-bank-same-source-close','bank-reconcile-close','bank-match-unmatch-controls','wbs-autorec-reserve-release','reconciliation-governance-snapshot','reconciliation-lifecycle-close','ai-exception-lineage','ai-amortization-human-close','dimension-profitability-close','cash-flow-close','cwip-rollforward-close','construction-loan-rollforward-close','prepaid-rollforward-close','intercompany-reconciliation-close','budget-vs-actual-close','consolidation-close','insurance-pc-mapping-controller','wbs-autorec-event-foundation','real-estate-profitability-lineage','real-estate-reports']);
  assert.ok(FIXTURES.every(item=>typeof item.pattern==='string'&&item.pattern.length>20));
  assert.deepEqual(selectFixtures().map(item=>item.id),FIXTURES.map(item=>item.id));
  assert.deepEqual(selectFixtures(['--fixture','bank-reconcile-close']).map(item=>item.id),['bank-reconcile-close']);
  assert.deepEqual(selectFixtures(['--fixture','signed-bank-same-source-close']).map(item=>item.id),['signed-bank-same-source-close']);
  assert.deepEqual(selectFixtures(['--fixture','wbs-autorec-event-foundation']).map(item=>item.id),['wbs-autorec-event-foundation']);
  assert.deepEqual(selectFixtures(['--fixture','insurance-pc-mapping-controller']).map(item=>item.id),['insurance-pc-mapping-controller']);
  assert.deepEqual(selectFixtures(['--fixture','real-estate-profitability-lineage']).map(item=>item.id),['real-estate-profitability-lineage']);
});

test('PostgreSQL fixture suite fails closed for malformed or unknown selection',()=>{
  assert.throws(()=>selectFixtures(['--fixture']),/Usage/);
  assert.throws(()=>selectFixtures(['--fixture','not-a-fixture']),/Unknown PostgreSQL fixture/);
});

test('PostgreSQL fixture suite accepts only a child-verified pattern receipt with every selected test passing',()=>{
  const output='# tests 266\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 259\n# todo 0\nFresh PostgreSQL gate verified mode=PATTERN tests=266 pass=7 fail=0 cancelled=0 skipped=259 todo=0\nFresh PostgreSQL gate executed_selected_test_count=7 skipped_unmatched_test_count=259\n';
  assert.deepEqual(readTapSummary(output),{tests:266,pass:7,fail:0,cancelled:0,skipped:259,todo:0});
  assert.equal(fixtureResult({id:'fixture',exitCode:0,output,durationMs:1}).exitCode,0);
  for(const rejected of [
    '# tests 266\n# pass 7\n# fail 0\n# cancelled 0\n# skipped 259\n# todo 0\n',
    output.replace('mode=PATTERN','mode=FULL'),
    output.replace('pass=7 fail=0','pass=8 fail=0'),
    output.replace('# todo 0','# todo 1').replace('todo=0','todo=1'),
    'no TAP summary'
  ])assert.equal(fixtureResult({id:'fixture',exitCode:0,output:rejected,durationMs:1}).exitCode,1);
  assert.equal(fixtureResult({id:'fixture',exitCode:1,output,durationMs:1}).exitCode,1);
});

test('PostgreSQL fixture suite waits for child exit and owned Docker cleanup after timeout',async()=>{
  const child=new EventEmitter(),signals=[],cleanups=[];
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=signal=>{signals.push(signal);return true;};
  let releaseCleanup;
  const cleanupBlocked=new Promise(resolve=>{releaseCleanup=resolve;});
  let settled=false;
  const resultPromise=runFixture({id:'timeout-behavior',pattern:'behavior-only fixture'},
    {REFS_PG_FIXTURE_TIMEOUT_MS:'1000',REFS_PG_FIXTURE_PROCESS_TIMEOUT_MS:'1000'},
    {spawnFixture:(_fixture,env)=>{assert.match(env.REFS_PG_COMPOSE_PROJECT,/^refs_kernel_gate_fixture_/);return child;},cleanupProject:async project=>{cleanups.push(project);await cleanupBlocked;}});
  resultPromise.then(()=>{settled=true;});
  await delay(1050);
  assert.deepEqual(signals,['SIGTERM']);
  assert.equal(settled,false);
  assert.deepEqual(cleanups,[]);
  child.emit('exit',null,'SIGTERM');
  await delay(0);
  assert.equal(settled,false);
  assert.equal(cleanups.length,1);
  assert.match(cleanups[0],/^refs_kernel_gate_fixture_/);
  releaseCleanup();
  const result=await resultPromise;
  assert.equal(result.exitCode,1);
  assert.equal(result.signal,'SIGTERM');
  assert.match(result.error,/Fixture process exceeded 1000ms/);
});
