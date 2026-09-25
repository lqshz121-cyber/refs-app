#!/usr/bin/env node
// R08 step A: read-only COA seed proposal for WBS companies (see runtime/wbs-coa-seed.mjs).
//   MIGRATION_DATABASE_URL=... REFS_WBS_TENANT_ID=<uuid> node tools/propose-wbs-coa-seed.mjs [--companies A,B] --out proposal.json [--decision-template decision.json]
// Runs in a READ ONLY transaction. The decision template pre-fills every PROPOSED item as APPROVE with
// the inferred member requirement and every other item as REJECT; the approver edits and signs it.
import {writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {buildCoaSeedProposal,COA_SEED_DECISION_SCHEMA} from '../runtime/wbs-coa-seed.mjs';

const arg=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
export function decisionTemplate(proposal){
  return {schema_version:COA_SEED_DECISION_SCHEMA,proposal_hash:proposal.proposal_hash,company_scope:proposal.company_scope,
    approved_by:'<approver actor id>',approved_at:'<ISO-8601 timestamp>',reason:'<why these accounts are created>',
    decisions:proposal.companies.flatMap(c=>c.items.map(i=>({company_code:c.company_code,account_code:i.account_code,
      decision:i.status==='PROPOSED'?'APPROVE':'REJECT',account_name:i.account_name,requires_member:i.requires_member,
      required_member_type:i.required_member_type,...(i.status==='PROPOSED'?{}:{note:`${i.status}: ${i.name_candidates.join(' | ')||'no WBS name'}`})})))};
}

async function main(){
  const tenantId=process.env.REFS_WBS_TENANT_ID,out=arg('--out');
  if(!process.env.MIGRATION_DATABASE_URL||!tenantId||!out)throw new Error('MIGRATION_DATABASE_URL, REFS_WBS_TENANT_ID and --out are required');
  const companies=arg('--companies')?arg('--companies').split(',').map(s=>s.trim()).filter(Boolean):null;
  const client=new pg.Client({connectionString:process.env.MIGRATION_DATABASE_URL});await client.connect();
  try{
    await client.query('BEGIN READ ONLY');
    const proposal=await buildCoaSeedProposal(client,{tenantId,companyCodes:companies});
    await client.query('ROLLBACK');
    writeFileSync(out,JSON.stringify(proposal,null,2)+'\n');
    const template=arg('--decision-template');if(template)writeFileSync(template,JSON.stringify(decisionTemplate(proposal),null,2)+'\n');
    process.stdout.write(JSON.stringify({event:'wbs_coa_seed_proposed',proposal_hash:proposal.proposal_hash,...proposal.totals,unmapped_companies:proposal.unmapped_company_codes.length})+'\n');
  }finally{await client.end();}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{process.stderr.write(JSON.stringify({event:'wbs_coa_seed_failed',code:e.code??null,message:e.message})+'\n');process.exit(1);});
