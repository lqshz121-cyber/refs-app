import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURES} from '../runtime/run-postgres-fixture-suite.mjs';
import {EXPECTED_TAP_ASSERTIONS_PER_IMAGE,REQUIRED_COMMAND_GATES,REQUIRED_POSTGRES_IMAGES,assertExecutionDependencies,runControlledCommandGates,validateControlledExecution} from '../runtime/controlled-maturity-execution.mjs';

const releaseSha='a'.repeat(40);
const assertionCounts=[...Array(EXPECTED_TAP_ASSERTIONS_PER_IMAGE-FIXTURES.length).fill(2),...Array(2*FIXTURES.length-EXPECTED_TAP_ASSERTIONS_PER_IMAGE).fill(1)];
const fixture=(item,index)=>({id:item.id,exitCode:0,error:null,tap:{tests:assertionCounts[index],pass:assertionCounts[index],fail:0,skipped:0}});
const summary=image=>({schema:'REFS_POSTGRES_FIXTURE_SUITE_V1',releaseSha,image,fixtures:FIXTURES.map(fixture),pass:true});
const summaries=()=>REQUIRED_POSTGRES_IMAGES.map(summary);
const commandGates=()=>REQUIRED_COMMAND_GATES.map(({id})=>({id,exitCode:0}));

test('exact PG15, PG16, and PG18 controlled evidence passes without becoming production evidence',()=>{
  const evidence=validateControlledExecution({releaseSha,summaries:summaries(),commandGates:commandGates(),cleanupResources:[]});
  assert.equal(evidence.fixtureGroupsPerImage,24);
  assert.equal(evidence.tapAssertionsPerImage,33);
  assert.deepEqual(evidence.commandGates,commandGates());
  assert.equal(evidence.controlledExecutionPass,true);
  assert.equal(evidence.dockerCleanupVerified,true);
  assert.equal(evidence.productionPass,false);
});

test('execution evidence fails closed for release, version, fixture, TAP, or cleanup drift',()=>{
  assert.throws(()=>validateControlledExecution({releaseSha:'abc',summaries:summaries(),commandGates:commandGates()}),/40-character/);
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries().slice(1),commandGates:commandGates()}),/exactly PG15/);
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries(),commandGates:commandGates().slice(1)}),/root and server/);
  const failedGate=commandGates();failedGate[0]={...failedGate[0],exitCode:1};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries(),commandGates:failedGate}),/command gate did not pass/);
  const wrongSha=summaries();wrongSha[0]={...wrongSha[0],releaseSha:'b'.repeat(40)};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:wrongSha,commandGates:commandGates()}),/exact release SHA/);
  const missing=summaries();missing[0]={...missing[0],fixtures:missing[0].fixtures.slice(1)};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:missing,commandGates:commandGates()}),/all 24 fixture groups/);
  const skipped=summaries();skipped[0].fixtures[0]={...skipped[0].fixtures[0],tap:{tests:1,pass:0,fail:0,skipped:1}};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:skipped,commandGates:commandGates()}),/not a passing, non-skipped fixture/);
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries(),commandGates:commandGates(),cleanupResources:['volume:refs_kernel_gate_fixture_leftover']}),/resources remain/);
});

test('root and server full tests are executed as exact controlled command gates',()=>{
  const calls=[];
  const evidence=runControlledCommandGates({env:{REFS_RELEASE_SHA:releaseSha},run:(command,args,options)=>calls.push({command,args,cwd:options.cwd})});
  assert.deepEqual(evidence,commandGates());
  assert.equal(calls.length,2);
  assert.ok(calls.every(({args})=>args.join(' ').includes('test')));
  assert.notEqual(calls[0].cwd,calls[1].cwd);
});

test('dependency preflight stops before any fixture when pg or Docker is unavailable',async()=>{
  let dockerCalls=0;
  await assert.rejects(()=>assertExecutionDependencies({loadPg:async()=>{throw new Error('missing pg');},run:()=>{dockerCalls++;}}),/installed server dependencies/);
  assert.equal(dockerCalls,0);
  await assert.rejects(()=>assertExecutionDependencies({loadPg:async()=>({}),run:()=>{throw new Error('daemon unavailable');}}),/reachable Docker server/);
});
