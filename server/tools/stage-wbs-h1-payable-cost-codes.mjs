#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createPool} from '../runtime/db.mjs';
import {runtimeConfig} from '../runtime/config.mjs';
import {canonicalRequestHash} from '../runtime/request-hash.mjs';

const PROVIDER_ID=/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const COMPANY=/^[A-Z0-9][A-Z0-9_:-]{0,63}$/;
const CONTROL=/[\u0000-\u001f\u007f]/;
const text=(value,max)=>{const out=value==null?'':String(value).trim();return out&&out.length<=max&&!CONTROL.test(out)?out:null;};
const sourceHash=value=>`sha256:${createHash('sha256').update(`list_payables\u0000${value}`,'utf8').digest('hex')}`;
const readStdin=async()=>{const chunks=[];for await(const chunk of process.stdin)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks).toString('utf8');};

export function normalizeWbsH1PayableCostCode(row){
  const providerId=text(row?.uuid??row?.ap_guid,128),companyCode=text(row?.company_code,64),costCode=text(row?.cost_code,128);
  if(!PROVIDER_ID.test(providerId||'')||!COMPANY.test(companyCode||'')||!costCode)throw new Error('WBS H1 payable cost-code evidence is invalid');
  const core={company_code:companyCode,source_record_hash:sourceHash(providerId),cost_code:costCode};
  return Object.freeze({...core,evidence_hash:canonicalRequestHash(core)});
}

async function main(){
  const input=(await readStdin()).trim();if(!input)throw new Error('WBS H1 payable cost-code JSON is required on stdin');
  const parsed=JSON.parse(input),rows=(Array.isArray(parsed)?parsed:[parsed]).map(normalizeWbsH1PayableCostCode);
  if(!rows.length||rows.length>1000||new Set(rows.map(row=>row.source_record_hash)).size!==rows.length)throw new Error('WBS H1 payable cost-code page must contain 1..1000 unique sources');
  const config=runtimeConfig(process.env),pool=await createPool({databaseUrl:config.migrationDatabaseUrl,applicationName:'refs-wbs-h1-cost-code-stage',max:1});
  try{
    const receipt=(await pool.query(`WITH input AS (
        SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(company_code text,source_record_hash text,cost_code text,evidence_hash text)
      ), resolved AS (
        SELECT b.tenant_id,b.entity_id,i.company_code,i.source_record_hash,i.cost_code,i.evidence_hash
        FROM input i JOIN wbs_h1_payable_mapping_source_stage b
          ON b.company_code=i.company_code AND b.source_record_hash=i.source_record_hash
      ), inserted AS (
        INSERT INTO wbs_h1_payable_cost_code_stage(tenant_id,entity_id,company_code,source_record_hash,cost_code,evidence_hash)
        SELECT tenant_id,entity_id,company_code,source_record_hash,cost_code,evidence_hash FROM resolved
        ON CONFLICT DO NOTHING RETURNING 1
      ) SELECT (SELECT count(*)::int FROM input) expected_count,(SELECT count(*)::int FROM resolved) resolved_count,
        (SELECT count(*)::int FROM inserted) inserted_count,
        ((SELECT count(*)::int FROM inserted)+(SELECT count(*)::int FROM resolved r JOIN wbs_h1_payable_cost_code_stage s USING(tenant_id,entity_id,source_record_hash,cost_code,evidence_hash))) exact_count`,[JSON.stringify(rows)])).rows[0];
    if(receipt.expected_count!==rows.length||receipt.resolved_count!==rows.length||receipt.exact_count!==rows.length)throw new Error('WBS H1 payable cost-code evidence did not resolve exactly once');
    process.stdout.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_COST_CODES_STAGED',row_count:rows.length,inserted_count:receipt.inserted_count})}\n`);
  }finally{await pool.end();}
}

if(import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{process.stderr.write(`${JSON.stringify({status:'WBS_H1_PAYABLE_COST_CODES_STAGE_FAILED',code:error.code||'UNEXPECTED',message:error.message})}\n`);process.exitCode=1;});
