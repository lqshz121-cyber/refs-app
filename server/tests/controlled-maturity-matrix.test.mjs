import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {FIXTURES} from '../runtime/run-postgres-fixture-suite.mjs';
import {DIMENSIONS,evaluateControlledMaturity,readControlledMaturityMatrix} from '../runtime/controlled-maturity-matrix.mjs';

test('the controlled maturity matrix covers all eight dimensions and all current fixtures',async()=>{
  const matrix=await readControlledMaturityMatrix();
  assert.equal(FIXTURES.length,24);
  assert.equal(new Set(FIXTURES.map(({id})=>id)).size,24);
  assert.deepEqual(DIMENSIONS.map(({id})=>id),['security','api','accounting','wbs','ai','reporting','ui','release']);
  assert.equal(matrix.fixtureCount,24);
  assert.equal(matrix.dimensions.length,8);
  assert.ok(matrix.dimensions.every(({controlledTestDataScore,complete,productionPass})=>controlledTestDataScore===10&&complete&&productionPass===false));
  const covered=new Set(DIMENSIONS.flatMap(({fixtures})=>fixtures));
  assert.deepEqual([...FIXTURES.map(({id})=>id)].sort(),[...covered].sort());
  assert.equal(matrix.scope,'CONTROLLED_TEST_DATA_ONLY');
  assert.equal(matrix.scoreBasis,'DEFINED_FIXTURES_AND_WIRED_TEST_COMMANDS');
  assert.equal(matrix.executionPass,false);
  assert.equal(matrix.productionPass,false);
});

test('missing evidence fails only the affected controlled dimension closed',async()=>{
  const complete=await readControlledMaturityMatrix();
  const fixtureIds=FIXTURES.map(({id})=>id).filter(id=>id!=='ai-amortization-human-close');
  const rootScripts=[...new Set(DIMENSIONS.flatMap(({rootScripts})=>rootScripts))];
  const serverScripts=[...new Set(DIMENSIONS.flatMap(({serverScripts})=>serverScripts))];
  const matrix=evaluateControlledMaturity({fixtureIds,rootScripts,serverScripts});
  assert.equal(matrix.dimensions.find(({id})=>id==='ai').controlledTestDataScore,0);
  assert.ok(matrix.dimensions.find(({id})=>id==='ai').missingFixtures.includes('ai-amortization-human-close'));
  assert.equal(matrix.dimensions.find(({id})=>id==='security').controlledTestDataScore,10);
  assert.equal(complete.productionPass,false);
  assert.equal(matrix.productionPass,false);
});

test('closure documentation names every fixture and preserves the production boundary',async()=>{
  const document=await readFile(new URL('../TEST-DATA-CLOSURE.md',import.meta.url),'utf8');
  for(const {id} of FIXTURES)assert.match(document,new RegExp(`\\b${id}\\b`));
  assert.match(document,/CONTROLLED_TEST_DATA_ONLY/);
  assert.match(document,/productionPass=false/);
  assert.match(document,/24 fixture groups/);
});
