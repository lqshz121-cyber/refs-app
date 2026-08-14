#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertWbsFullCompanyDeliveryPlanReady,WbsFullCompanyDeliveryPlanError} from '../runtime/wbs-full-company-delivery-plan.mjs';

export function main(argv=process.argv.slice(2)){
  if(argv.length!==2||argv[0]!=='--plan')throw new WbsFullCompanyDeliveryPlanError('WBS_FULL_COMPANY_PLAN_ARGUMENT_INVALID','Usage: --plan <plan.json>');
  const plan=JSON.parse(readFileSync(resolve(argv[1]),'utf8'));
  const result=assertWbsFullCompanyDeliveryPlanReady(plan);
  console.log(JSON.stringify(result));
  return result;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1])){
  try{main();}catch(error){console.error(JSON.stringify({code:error?.code||'WBS_FULL_COMPANY_PLAN_VERIFY_FAILED',message:error?.message||'Verification failed.',blockers:error?.details||[]}));process.exitCode=2;}
}
