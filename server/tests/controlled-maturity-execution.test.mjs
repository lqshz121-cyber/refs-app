import test from 'node:test';
import assert from 'node:assert/strict';
import {FIXTURES} from '../runtime/run-postgres-fixture-suite.mjs';
import {EXPECTED_TAP_ASSERTIONS_PER_IMAGE,REQUIRED_POSTGRES_IMAGES,validateControlledExecution} from '../runtime/controlled-maturity-execution.mjs';

const releaseSha='a'.repeat(40);
const assertionCounts=[...Array(EXPECTED_TAP_ASSERTIONS_PER_IMAGE-FIXTURES.length).fill(2),...Array(2*FIXTURES.length-EXPECTED_TAP_ASSERTIONS_PER_IMAGE).fill(1)];
const fixture=(item,index)=>({id:item.id,exitCode:0,error:null,tap:{tests:assertionCounts[index],pass:assertionCounts[index],fail:0,skipped:0}});
const summary=image=>({schema:'REFS_POSTGRES_FIXTURE_SUITE_V1',releaseSha,image,fixtures:FIXTURES.map(fixture),pass:true});
const summaries=()=>REQUIRED_POSTGRES_IMAGES.map(summary);

test('exact PG15, PG16, and PG18 controlled evidence passes without becoming production evidence',()=>{
  const evidence=validateControlledExecution({releaseSha,summaries:summaries(),cleanupResources:[]});
  assert.equal(evidence.fixtureGroupsPerImage,24);
  assert.equal(evidence.tapAssertionsPerImage,33);
  assert.equal(evidence.controlledExecutionPass,true);
  assert.equal(evidence.dockerCleanupVerified,true);
  assert.equal(evidence.productionPass,false);
});

test('execution evidence fails closed for release, version, fixture, TAP, or cleanup drift',()=>{
  assert.throws(()=>validateControlledExecution({releaseSha:'abc',summaries:summaries()}),/40-character/);
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries().slice(1)}),/exactly PG15/);
  const wrongSha=summaries();wrongSha[0]={...wrongSha[0],releaseSha:'b'.repeat(40)};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:wrongSha}),/exact release SHA/);
  const missing=summaries();missing[0]={...missing[0],fixtures:missing[0].fixtures.slice(1)};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:missing}),/all 24 fixture groups/);
  const skipped=summaries();skipped[0].fixtures[0]={...skipped[0].fixtures[0],tap:{tests:1,pass:0,fail:0,skipped:1}};
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:skipped}),/not a passing, non-skipped fixture/);
  assert.throws(()=>validateControlledExecution({releaseSha,summaries:summaries(),cleanupResources:['volume:refs_kernel_gate_fixture_leftover']}),/resources remain/);
});
