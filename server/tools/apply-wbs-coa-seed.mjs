#!/usr/bin/env node
// R08 step B: apply an approved COA seed decision. Dry run unless --apply is given.
//   MIGRATION_DATABASE_URL=... REFS_WBS_TENANT_ID=<uuid> node tools/apply-wbs-coa-seed.mjs --decision decision.json [--apply] [--out receipt.json]
// --apply writes only when the target database name ends in _test, or REFS_COA_SEED_CONFIRM_DATABASE
// names the target database exactly (so a staging run is always a deliberate, named act).
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import pg from 'pg';
import {applyCoaSeedDecision,assertCoaSeedDecision,buildCoaSeedProposal} from '../runtime/wbs-coa-seed.mjs';

const arg=(name)=>{const i=process.argv.indexOf(name);return i>=0?process.argv[i+1]:null;};
async function main(){
  const tenantId=process.env.REFS_WBS_TENANT_ID,url=process.env.MIGRATION_DATABASE_URL,file=arg('--decision');
  if(!url||!tenantId||!file)throw new Error('MIGRATION_DATABASE_URL, REFS_WBS_TENANT_ID and --decision are required');
  const decision=assertCoaSeedDecision(JSON.parse(readFileSync(file,'utf8')));
  const database=decodeURIComponent(new URL(url).pathname.slice(1));
  const client=new pg.Client({connectionString:url});await client.connect();
  try{
    let result;
    if(!process.argv.includes('--apply')){
      await client.query('BEGIN READ ONLY');
      const proposal=await buildCoaSeedProposal(client,{tenantId,companyCodes:decision.company_scope??null});
      await client.query('ROLLBACK');
      result={status:proposal.proposal_hash===decision.proposal_hash?'DRY_RUN_MATCHES':'DRY_RUN_PROPOSAL_DRIFT',database,
        would_insert:decision.decisions.filter(d=>d.decision==='APPROVE').length,rejected:decision.decisions.filter(d=>d.decision==='REJECT').length};
    }else{
      if(!database.endsWith('_test')&&process.env.REFS_COA_SEED_CONFIRM_DATABASE!==database)throw Object.assign(new Error(`Refusing to write to ${database}: set REFS_COA_SEED_CONFIRM_DATABASE=${database}`),{code:'COA_SEED_TARGET_UNCONFIRMED'});
      result=await applyCoaSeedDecision(client,{tenantId,decision});
    }
    const out=arg('--out');if(out)writeFileSync(out,JSON.stringify(result,null,2)+'\n');
    process.stdout.write(JSON.stringify({event:'wbs_coa_seed_applied',status:result.status,inserted_total:result.inserted_total??0,would_insert:result.would_insert??null})+'\n');
    if(String(result.status).includes('DRIFT'))process.exit(1);
  }finally{await client.end();}
}
if(import.meta.url===pathToFileURL(process.argv[1]||'').href)main().catch(e=>{process.stderr.write(JSON.stringify({event:'wbs_coa_seed_failed',code:e.code??null,message:e.message})+'\n');process.exit(1);});
