import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';

const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');

export const FIXTURES=Object.freeze([
  Object.freeze({id:'controlled-ap-close',pattern:'controlled DEMO tenant runs one AP Bill through HTTP Draft, four-role Post, GL, TB and AP aging without affecting another tenant'}),
  Object.freeze({id:'ar-rent-pickup-close',pattern:'isolated property rent pickup carries invoice and bank receipt evidence through AR, JE, GL, trial balance, and reports'}),
  Object.freeze({id:'signed-wbs-payable-post',pattern:'provider-signed Payable admission atomically reaches Review Draft four-role Post and same-JE reports'}),
  Object.freeze({id:'signed-cost-cwip-post',pattern:'isolated test-key Cost-to-CWIP admission survives independent Review Draft four-role Post and report lineage'}),
  Object.freeze({id:'signed-bank-same-source-close',pattern:'provider-signed Bank source survives exact Match Unmatch adjustment Post reconciliation and same-source reports'}),
  Object.freeze({id:'bank-reconcile-close',pattern:'Stage 2 test-data chain traces one reconciled bank payment through its posted JE, GL, TB and report rows'}),
  Object.freeze({id:'bank-match-unmatch-controls',pattern:'061 bank match creates exact posted AP evidence once and fails closed for reversal and ambiguous cash account evidence|reconciliation rejects mixed currencies and non-posted hand-made match evidence'}),
  Object.freeze({id:'wbs-autorec-reserve-release',pattern:'WBS AutoRec Reserve and Release persist receipt-bound source reservations without creating a journal'}),
  // Each lifecycle gate is its own PostgreSQL process.  The kernel test module owns
  // connection pools in a global before/after hook, so combining these independent
  // closures under one --test-name-pattern can race pool teardown during Docker
  // cleanup and turn a passing control test into a spurious 57P01.
  Object.freeze({id:'reconciliation-governance-snapshot',pattern:'reconciliation lifecycle is scoped, idempotent, separated by role, snapshotted, and reopen-gated'}),
  Object.freeze({id:'reconciliation-lifecycle-close',pattern:'reconciliation adjustment Draft binds one unresolved bank source through Posted clearance, review, and immutable sign-off'}),
  Object.freeze({id:'ai-exception-lineage',pattern:'operator exception row links append-only to the later exact signed Payable source without becoming Review authority'}),
  Object.freeze({id:'ai-amortization-human-close',pattern:'AI amortization creates a human Draft then standard Posted JE with immutable source and ledger lineage'}),
  // PostgreSQL test modules own process-level pools. Keep each report closure in
  // its own process so a slow report teardown cannot hide another passing closure.
  Object.freeze({id:'dimension-profitability-close',pattern:'dimension profitability reads only exact POSTED ledger dimensions and never fills a missing property, project, unit, or lot'}),
  Object.freeze({id:'cash-flow-close',pattern:'cash flow statement classifies POSTED cash only through one exact approved mapping snapshot'}),
  Object.freeze({id:'cwip-rollforward-close',pattern:'CWIP rollforward admits an account only through one exact immutable mapping snapshot and retains posted ledger evidence'}),
  Object.freeze({id:'construction-loan-rollforward-close',pattern:'construction-loan rollforward admits a credit-normal liability only through one exact immutable mapping snapshot and retains posted ledger evidence'}),
  Object.freeze({id:'prepaid-rollforward-close',pattern:'prepaid rollforward admits a debit-normal asset only through one exact immutable mapping snapshot and retains posted ledger evidence'}),
  Object.freeze({id:'intercompany-reconciliation-close',pattern:'intercompany reconciliation requires two authorized entity scopes, reciprocal exact mappings, and POSTED ledger evidence without creating an elimination'}),
  Object.freeze({id:'budget-vs-actual-close',pattern:'budget versus actual reads one approved immutable snapshot against same-currency POSTED ledger evidence without mutating a budget or journal'}),
  Object.freeze({id:'consolidation-close',pattern:'consolidation reads only an approved immutable two-member scope with explicit elimination evidence and never creates an elimination journal'}),
  Object.freeze({id:'insurance-pc-mapping-controller',pattern:'Insurance PC company mapping Controller164 records proposes approves resumes and preserves zero accounting writes'}),
  Object.freeze({id:'wbs-autorec-event-foundation',pattern:'independent AutoRec review and immutable accounting-event foundation derive exact G11 Drafts from approved rules'}),
  Object.freeze({id:'real-estate-profitability-lineage',pattern:'isolated financial-statement snapshots retain|financial statement period comparison reads|dimension profitability reads only exact POSTED ledger dimensions'}),
  Object.freeze({id:'real-estate-reports',pattern:'cash flow statement classifies|CWIP rollforward admits|construction-loan rollforward admits|prepaid rollforward admits|intercompany reconciliation requires|budget versus actual reads|consolidation reads only'})
]);

export function selectFixtures(args=[]){
  if(args.length===0)return FIXTURES;
  if(args.length!==2||args[0]!=='--fixture'||!args[1])throw new Error('Usage: node runtime/run-postgres-fixture-suite.mjs [--fixture <id>]');
  const fixture=FIXTURES.find(value=>value.id===args[1]);
  if(!fixture)throw new Error(`Unknown PostgreSQL fixture: ${args[1]}`);
  return [fixture];
}

export function readTapSummary(output){
  const summary={};
  for(const key of ['tests','pass','fail','skipped']){
    const match=output.match(new RegExp(`^# ${key} (\\d+)$`,'m'));
    if(!match)return null;
    summary[key]=Number(match[1]);
  }
  return summary;
}

export function fixtureResult({id,exitCode,output,durationMs,signal=null,error=null}){
  const tap=readTapSummary(output);
  const verified=tap!==null&&tap.tests>0&&tap.pass>0&&tap.fail===0&&tap.skipped===0;
  return Object.freeze({
    id,
    exitCode:verified&&exitCode===0?0:1,
    durationMs,
    signal,
    error:error??(verified&&exitCode===0?null:'Fixture must execute at least one passing, non-skipped PostgreSQL test.'),
    tap
  });
}

const ownedProjectName=fixture=>`refs_kernel_gate_fixture_${process.pid}_${Date.now().toString(36)}_${randomUUID().replaceAll('-','')}_${fixture.id.replaceAll('-','_')}`.toLowerCase();

function spawnFixtureProcess(fixture,env){
  return spawn(process.execPath,['runtime/test-postgres-fresh.mjs','--pattern',fixture.pattern],{cwd:serverRoot,env,stdio:['ignore','pipe','pipe']});
}

function cleanupOwnedProject(project,env){
  if(!/^refs_kernel_gate_fixture_[a-z0-9_-]+$/.test(project))throw new Error('Refusing to clean an unowned PostgreSQL fixture project');
  return new Promise((resolveCleanup,reject)=>{
    const child=spawn('docker',['compose','-p',project,'-f','compose.yaml','down','-v','--remove-orphans'],{cwd:serverRoot,env,stdio:'inherit',shell:process.platform==='win32'});
    child.once('error',reject);
    child.once('exit',(code,signal)=>code===0?resolveCleanup():reject(new Error(`Owned PostgreSQL fixture cleanup exited ${code??signal}`)));
  });
}

export function runFixture(fixture,env,{spawnFixture=spawnFixtureProcess,cleanupProject=cleanupOwnedProject}={}){
  return new Promise(resolveRun=>{
    const startedAt=Date.now();
    const timeout=env.REFS_PG_FIXTURE_TIMEOUT_MS||'90000';
    const processTimeout=env.REFS_PG_FIXTURE_PROCESS_TIMEOUT_MS||String(Number(timeout)+30000);
    if(!/^[1-9]\d*$/.test(processTimeout)||Number(processTimeout)<1000||Number(processTimeout)>930000)throw new Error('REFS_PG_FIXTURE_PROCESS_TIMEOUT_MS must be an integer between 1000 and 930000 milliseconds');
    const project=ownedProjectName(fixture);
    const childEnv={...env,REFS_PG_TEST_TIMEOUT_MS:timeout,REFS_PG_COMPOSE_PROJECT:project};
    const child=spawnFixture(fixture,childEnv);
    let output='';
    let settled=false;
    let timedOut=false;
    let timeoutError=null;
    let terminationWatchdog=null;
    const finish=result=>{
      if(settled)return;
      settled=true;
      clearTimeout(watchdog);
      if(terminationWatchdog)clearTimeout(terminationWatchdog);
      resolveRun(result);
    };
    const watchdog=setTimeout(()=>{
      timedOut=true;
      timeoutError=`Fixture process exceeded ${processTimeout}ms after its ${timeout}ms test timeout.`;
      child.kill('SIGTERM');
      terminationWatchdog=setTimeout(()=>child.kill('SIGKILL'),5000);
    },Number(processTimeout));
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',chunk=>{output+=chunk;process.stdout.write(chunk);});
    child.stderr.on('data',chunk=>{output+=chunk;process.stderr.write(chunk);});
    child.once('error',error=>{
      if(!timedOut)finish(fixtureResult({id:fixture.id,exitCode:1,output,durationMs:Date.now()-startedAt,error:error.message}));
    });
    child.once('exit',async(code,signal)=>{
      if(timedOut){
        let cleanupError=null;
        try{await cleanupProject(project,childEnv);}catch(error){cleanupError=error.message;}
        const error=cleanupError?`${timeoutError} Cleanup failed: ${cleanupError}`:timeoutError;
        finish(fixtureResult({id:fixture.id,exitCode:1,output,durationMs:Date.now()-startedAt,signal:signal??'SIGTERM',error}));
        return;
      }
      finish(fixtureResult({id:fixture.id,exitCode:code??1,output,durationMs:Date.now()-startedAt,signal:signal??null}));
    });
  });
}

export async function runFixtureSuite({fixtures=FIXTURES,env=process.env}={}){
  const results=[];
  for(const fixture of fixtures)results.push(await runFixture(fixture,env));
  return {schema:'REFS_POSTGRES_FIXTURE_SUITE_V1',image:env.POSTGRES_IMAGE||'postgres:16-alpine',fixtures:results,pass:results.every(result=>result.exitCode===0)};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  const summary=await runFixtureSuite({fixtures:selectFixtures(process.argv.slice(2))});
  console.log(JSON.stringify(summary));
  if(!summary.pass)process.exitCode=1;
}
