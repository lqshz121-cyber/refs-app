import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {FIXTURES} from './run-postgres-fixture-suite.mjs';

const serverRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const repositoryRoot=resolve(serverRoot,'..');

export const DIMENSIONS=Object.freeze([
  Object.freeze({
    id:'security',
    fixtures:['signed-wbs-payable-post','signed-cost-cwip-post','signed-bank-same-source-close','reconciliation-governance-snapshot','insurance-pc-mapping-controller'],
    rootScripts:['test:authoritative-provider-evidence-trace','test:authoritative-release-gate'],
    serverScripts:['test:wbs-signed-admission','test:wbs-signed-bank-admission']
  }),
  Object.freeze({
    id:'api',
    fixtures:['controlled-ap-close','ar-rent-pickup-close','signed-wbs-payable-post','bank-reconcile-close'],
    rootScripts:['test:authoritative-full-shell'],
    serverScripts:['test:stage1:authoritative-e2e','test:stage2:authoritative-e2e']
  }),
  Object.freeze({
    id:'accounting',
    fixtures:['controlled-ap-close','ar-rent-pickup-close','signed-wbs-payable-post','signed-cost-cwip-post','signed-bank-same-source-close','reconciliation-lifecycle-close','ai-amortization-human-close','wbs-autorec-event-foundation'],
    rootScripts:['test:authoritative-lineage-drill'],
    serverScripts:['test:wbs-payable-draft','test:ai-amortization']
  }),
  Object.freeze({
    id:'wbs',
    fixtures:['signed-wbs-payable-post','signed-cost-cwip-post','signed-bank-same-source-close','wbs-autorec-reserve-release','insurance-pc-mapping-controller','wbs-autorec-event-foundation'],
    rootScripts:['test:authoritative-provider-evidence-trace'],
    serverScripts:['test:wbs-provider-signed-payable','test:wbs-provider-final1-insurance']
  }),
  Object.freeze({
    id:'ai',
    fixtures:['ai-exception-lineage','ai-amortization-human-close','wbs-autorec-event-foundation'],
    rootScripts:['test:authoritative-full-shell'],
    serverScripts:['test:ai-wbs-exception-findings','test:ai-analysis-summary']
  }),
  Object.freeze({
    id:'reporting',
    fixtures:['dimension-profitability-close','cash-flow-close','cwip-rollforward-close','construction-loan-rollforward-close','prepaid-rollforward-close','intercompany-reconciliation-close','budget-vs-actual-close','consolidation-close','real-estate-profitability-lineage','real-estate-reports'],
    rootScripts:['test:authoritative-lineage-drill'],
    serverScripts:['test:stage3:reporting-authoritative-e2e','test:stage4:authoritative-e2e']
  }),
  Object.freeze({
    id:'ui',
    fixtures:['controlled-ap-close','signed-bank-same-source-close','real-estate-reports'],
    rootScripts:['test:visual','test:authoritative-browser-acceptance-preflight','test:payables-responsive','test:authoritative-bank-responsive'],
    serverScripts:[]
  }),
  Object.freeze({
    id:'release',
    fixtures:FIXTURES.map(({id})=>id),
    rootScripts:['test:release-harness','test:release-evidence-bundle'],
    serverScripts:['test:postgres:fixtures:closure','validate:staging-env']
  })
]);

export function evaluateControlledMaturity({fixtureIds,rootScripts,serverScripts}){
  const fixtures=new Set(fixtureIds);
  const root=new Set(rootScripts);
  const server=new Set(serverScripts);
  const dimensions=DIMENSIONS.map(dimension=>{
    const missingFixtures=dimension.fixtures.filter(id=>!fixtures.has(id));
    const missingRootScripts=dimension.rootScripts.filter(id=>!root.has(id));
    const missingServerScripts=dimension.serverScripts.filter(id=>!server.has(id));
    const complete=missingFixtures.length===0&&missingRootScripts.length===0&&missingServerScripts.length===0;
    return Object.freeze({
      id:dimension.id,
      controlledTestDataScore:complete?10:0,
      complete,
      missingFixtures,
      missingRootScripts,
      missingServerScripts,
      productionPass:false
    });
  });
  return Object.freeze({
    schema:'REFS_CONTROLLED_MATURITY_MATRIX_V1',
    scope:'CONTROLLED_TEST_DATA_ONLY',
    scoreBasis:'DEFINED_FIXTURES_AND_WIRED_TEST_COMMANDS',
    fixtureCount:fixtures.size,
    dimensions,
    productionPass:false,
    executionPass:false,
    executionEvidenceRequired:'Run every fixture on PG15, PG16, and PG18 and retain the raw TAP and cleanup evidence.',
    productionEvidenceRequired:Object.freeze([
      'approved OIDC authenticated readback',
      'deployed migrations and grants on the exact release',
      'Provider-signed production receipts',
      'same-release browser and API workflow evidence'
    ])
  });
}

export async function readControlledMaturityMatrix(){
  const [rootPackage,serverPackage]=await Promise.all([
    readFile(resolve(repositoryRoot,'package.json'),'utf8').then(JSON.parse),
    readFile(resolve(serverRoot,'package.json'),'utf8').then(JSON.parse)
  ]);
  return evaluateControlledMaturity({
    fixtureIds:FIXTURES.map(({id})=>id),
    rootScripts:Object.keys(rootPackage.scripts??{}),
    serverScripts:Object.keys(serverPackage.scripts??{})
  });
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const matrix=await readControlledMaturityMatrix();
  console.log(JSON.stringify(matrix,null,2));
  if(matrix.dimensions.some(({complete})=>!complete))process.exitCode=1;
}
