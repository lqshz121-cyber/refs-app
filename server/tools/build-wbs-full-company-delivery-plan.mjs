#!/usr/bin/env node
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildWbsFullCompanyDeliveryPlan,WbsFullCompanyDeliveryPlanError} from '../runtime/wbs-full-company-delivery-plan.mjs';
import {canonicalRequestBody} from '../runtime/request-hash.mjs';

const parse=argv=>{
  if(argv.length%2!==0)throw new WbsFullCompanyDeliveryPlanError('WBS_FULL_COMPANY_PLAN_ARGUMENT_INVALID','Arguments must be name/value pairs.');
  const result={};for(let index=0;index<argv.length;index+=2){const key=argv[index]?.replace(/^--/,'');if(!key||result[key]!==undefined)throw new WbsFullCompanyDeliveryPlanError('WBS_FULL_COMPANY_PLAN_ARGUMENT_INVALID','Arguments must be unique.');result[key]=argv[index+1];}return result;
};
const readJson=path=>JSON.parse(readFileSync(resolve(path),'utf8'));

export function main(argv=process.argv.slice(2)){
  const options=parse(argv),required=['catalog','mappings','tenant-id','plan-version','date-from','date-to','domains','trust','output'];
  if(required.some(key=>!options[key]))throw new WbsFullCompanyDeliveryPlanError('WBS_FULL_COMPANY_PLAN_ARGUMENT_INVALID',required.join(','));
  const plan=buildWbsFullCompanyDeliveryPlan({tenantId:options['tenant-id'],planVersion:options['plan-version'],generatedAt:options['generated-at']||new Date().toISOString(),requiredCoverage:{date_from:options['date-from'],date_to:options['date-to'],domains:options.domains.split(',').filter(Boolean)},trust:readJson(options.trust),catalog:readJson(options.catalog),mappings:readJson(options.mappings)});
  writeFileSync(resolve(options.output),canonicalRequestBody(plan),{flag:'wx',mode:0o600});
  console.log(JSON.stringify({status:'READY_TO_RECEIVE_PROVIDER_SIGNED_DELIVERIES',plan_hash:plan.plan_hash,company_count:plan.catalog.companies.length,delivery_unit_count:plan.delivery_units.length,output:resolve(options.output)}));
  return plan;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{main();}catch(error){console.error(JSON.stringify({code:error?.code||'WBS_FULL_COMPANY_PLAN_BUILD_FAILED',message:error?.message||'Build failed.',blockers:error?.details||[]}));process.exitCode=2;}
}
