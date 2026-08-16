// Stage 3 reporting matrix. Reuses the Stage 4 immutable report-lineage reader.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {stage4AuthoritativeE2eConfig,verifyStage4AuthoritativeE2e} from './verify-stage4-authoritative-e2e.mjs';

const expect=(condition,message)=>{if(!condition)throw new Error(`stage3-reporting-authoritative-e2e: ${message}`);};
const entries=Object.freeze([['balanceSheet','BALANCE_SHEET'],['incomeStatement','INCOME_STATEMENT'],['cashFlow','CASH_FLOW']]);

export function stage3ReportingAuthoritativeE2eConfig(environment=process.env,scenario){
  expect(scenario&&typeof scenario==='object'&&!Array.isArray(scenario),'scenario must be a JSON object');
  const stage4Environment={...environment,REFS_STAGE4_E2E_READ_ACCESS_TOKEN:environment.REFS_STAGE3_REPORTING_E2E_READ_ACCESS_TOKEN};
  const configs=Object.fromEntries(entries.map(([key,statementType])=>{
    expect(scenario[key]&&typeof scenario[key]==='object',`scenario.${key} is required`);
    expect(scenario[key].statementType===statementType,`scenario.${key}.statementType must be ${statementType}`);
    expect(scenario[key].pairedTrialBalance===true,`scenario.${key}.pairedTrialBalance must be true`);
    expect(Object.hasOwn(scenario[key],'expectedAmount'),`scenario.${key}.expectedAmount is required`);
    return [key,stage4AuthoritativeE2eConfig(stage4Environment,scenario[key])];
  }));
  const scope=Object.values(configs).map(config=>`${config.scenario.entityId}:${config.scenario.periodId}:${config.scenario.financialStatementSnapshotId}`);
  expect(new Set(scope).size===1,'all reporting scenarios must use the same entity, period and immutable statement snapshot');
  return Object.freeze(configs);
}

export async function readStage3ReportingScenario(pathname=process.env.REFS_STAGE3_REPORTING_E2E_SCENARIO_PATH){
  expect(typeof pathname==='string'&&pathname.trim(),'REFS_STAGE3_REPORTING_E2E_SCENARIO_PATH is required');
  try{return JSON.parse(await readFile(pathname,'utf8'));}catch(error){throw new Error(`stage3-reporting-authoritative-e2e: scenario cannot be read: ${error.message}`);}
}

export async function verifyStage3ReportingAuthoritativeE2e({configs,fetcher=globalThis.fetch}={}){
  expect(configs&&typeof fetcher==='function','configs and fetcher are required');
  const results=[];
  for(const [key,statementType] of entries){const result=await verifyStage4AuthoritativeE2e({config:configs[key],fetcher});expect(result?.ok===true&&result.checks.includes('paired-trial-balance-row'),`${statementType} did not retain its paired Trial Balance lineage`);results.push(Object.freeze({statementType,financialStatementSnapshotId:result.financialStatementSnapshotId}));}
  return Object.freeze({ok:true,mode:'READ_ONLY_SOURCE_JE_TB_REPORT_MATRIX',release:configs.balanceSheet.releaseSha,checks:['same-entity-period-snapshot','source-to-posted-je','posted-je-to-trial-balance','trial-balance-to-balance-sheet','trial-balance-to-income-statement','trial-balance-to-cash-flow','exact-identifiers','money4'],statements:Object.freeze(results)});
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){try{const configs=stage3ReportingAuthoritativeE2eConfig(process.env,await readStage3ReportingScenario());console.log(JSON.stringify(await verifyStage3ReportingAuthoritativeE2e({configs})));}catch(error){console.error(error.message);process.exitCode=1;}}
