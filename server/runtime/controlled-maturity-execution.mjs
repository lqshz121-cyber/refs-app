import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {FIXTURES,runFixtureSuite} from './run-postgres-fixture-suite.mjs';
import {readControlledMaturityMatrix} from './controlled-maturity-matrix.mjs';

export const REQUIRED_POSTGRES_IMAGES=Object.freeze(['postgres:15-alpine','postgres:16-alpine','postgres:18-alpine']);
export const EXPECTED_TAP_ASSERTIONS_PER_IMAGE=33;
const SHA_PATTERN=/^[0-9a-f]{40}$/;

const sorted=value=>[...value].sort();

export function validateControlledExecution({releaseSha,summaries,cleanupResources=[]}){
  if(!SHA_PATTERN.test(releaseSha))throw new Error('Controlled execution requires the exact 40-character release SHA.');
  if(!Array.isArray(summaries)||summaries.length!==REQUIRED_POSTGRES_IMAGES.length)throw new Error('Controlled execution requires exactly PG15, PG16, and PG18 summaries.');
  if(!Array.isArray(cleanupResources))throw new Error('Docker cleanup evidence must be an array.');
  if(cleanupResources.length!==0)throw new Error(`Owned Docker resources remain: ${cleanupResources.join(', ')}`);

  const expectedFixtureIds=sorted(FIXTURES.map(({id})=>id));
  const images=[];
  for(const summary of summaries){
    if(summary?.schema!=='REFS_POSTGRES_FIXTURE_SUITE_V1')throw new Error('Unexpected fixture-suite evidence schema.');
    if(summary.releaseSha!==releaseSha)throw new Error('Fixture-suite evidence is not bound to the exact release SHA.');
    if(!REQUIRED_POSTGRES_IMAGES.includes(summary.image))throw new Error(`Unexpected PostgreSQL image: ${summary.image}`);
    if(images.includes(summary.image))throw new Error(`Duplicate PostgreSQL image evidence: ${summary.image}`);
    images.push(summary.image);
    if(summary.pass!==true)throw new Error(`${summary.image} fixture suite did not pass.`);
    if(!Array.isArray(summary.fixtures)||summary.fixtures.length!==FIXTURES.length)throw new Error(`${summary.image} does not contain all ${FIXTURES.length} fixture groups.`);
    const fixtureIds=sorted(summary.fixtures.map(({id})=>id));
    if(JSON.stringify(fixtureIds)!==JSON.stringify(expectedFixtureIds))throw new Error(`${summary.image} fixture identities do not match the frozen suite.`);
    let assertions=0;
    for(const fixture of summary.fixtures){
      const tap=fixture?.tap;
      if(fixture?.exitCode!==0||fixture?.error!==null||!tap||tap.tests<1||tap.pass<1||tap.fail!==0||tap.skipped!==0){
        throw new Error(`${summary.image}/${fixture?.id??'unknown'} is not a passing, non-skipped fixture.`);
      }
      assertions+=tap.tests;
    }
    if(assertions!==EXPECTED_TAP_ASSERTIONS_PER_IMAGE)throw new Error(`${summary.image} executed ${assertions} TAP assertions; expected ${EXPECTED_TAP_ASSERTIONS_PER_IMAGE}.`);
  }
  if(JSON.stringify(sorted(images))!==JSON.stringify(sorted(REQUIRED_POSTGRES_IMAGES)))throw new Error('PostgreSQL version evidence is incomplete.');

  return Object.freeze({
    schema:'REFS_CONTROLLED_MATURITY_EXECUTION_V1',
    scope:'CONTROLLED_TEST_DATA_ONLY',
    releaseSha,
    postgresImages:Object.freeze([...REQUIRED_POSTGRES_IMAGES]),
    fixtureGroupsPerImage:FIXTURES.length,
    tapAssertionsPerImage:EXPECTED_TAP_ASSERTIONS_PER_IMAGE,
    dockerCleanupVerified:true,
    controlledExecutionPass:true,
    productionPass:false
  });
}

export function currentGitSha(){
  return execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim().toLowerCase();
}

export async function assertExecutionDependencies({loadPg=()=>import('pg'),run=execFileSync}={}){
  try{await loadPg();}catch(error){throw new Error(`Controlled execution requires installed server dependencies: ${error.message}`);}
  try{run('docker',['version','--format','{{.Server.Version}}'],{encoding:'utf8'});}catch(error){throw new Error(`Controlled execution requires a reachable Docker server: ${error.message}`);}
}

export function listOwnedDockerResources(){
  const commands=[
    ['container',['ps','-a','--format','{{.Names}}']],
    ['network',['network','ls','--format','{{.Name}}']],
    ['volume',['volume','ls','--format','{{.Name}}']]
  ];
  const resources=[];
  for(const [type,args] of commands){
    const output=execFileSync('docker',args,{encoding:'utf8'});
    for(const name of output.split(/\r?\n/).filter(Boolean))if(name.includes('refs_kernel_gate_fixture_'))resources.push(`${type}:${name}`);
  }
  return resources;
}

export async function runControlledMaturityExecution({env=process.env}={}){
  const releaseSha=(env.REFS_RELEASE_SHA??'').toLowerCase();
  if(!SHA_PATTERN.test(releaseSha))throw new Error('REFS_RELEASE_SHA must be the exact 40-character commit SHA.');
  const gitSha=currentGitSha();
  if(gitSha!==releaseSha)throw new Error(`REFS_RELEASE_SHA ${releaseSha} does not match current HEAD ${gitSha}.`);
  await assertExecutionDependencies();
  const matrix=await readControlledMaturityMatrix();
  if(matrix.dimensions.some(({complete})=>!complete))throw new Error('Controlled maturity coverage matrix is incomplete.');
  const summaries=[];
  for(const image of REQUIRED_POSTGRES_IMAGES){
    summaries.push(await runFixtureSuite({env:{...env,REFS_RELEASE_SHA:releaseSha,POSTGRES_IMAGE:image}}));
  }
  const cleanupResources=listOwnedDockerResources();
  const execution=validateControlledExecution({releaseSha,summaries,cleanupResources});
  return Object.freeze({...execution,summaries});
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const evidence=await runControlledMaturityExecution();
    console.log(JSON.stringify(evidence));
  }catch(error){
    console.error(error.message);
    process.exitCode=1;
  }
}
