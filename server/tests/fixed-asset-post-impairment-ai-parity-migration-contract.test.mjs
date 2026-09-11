import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import test from 'node:test';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const name='372_fixed_asset_post_impairment_ai_parity.sql';
const read=direction=>readFile(new URL(`../db/migrations/${direction==='down'?'down/':''}${name}`,import.meta.url),'utf8');

test('372 derives AI depreciation from the authoritative schedule and closes policy lineage',async()=>{
 const up=await read('up');
 assert.match(up,/refs_fixed_asset_depreciation_schedule_snapshot\(p_tenant,p_entity,asset\.fixed_asset_register_evidence_id,p_period\)/);
 assert.match(up,/AI_FIXED_ASSET_DEPRECIATION_SOURCE_V2/);
 assert.match(up,/AI_FIXED_ASSET_POSTED_RECONCILIATION_V2/);
 assert.match(up,/post_impairment_policy_evidence_hash/);
 assert.match(up,/post_impairment_policy_identity/);
 assert.match(up,/policy_evidence_hash/);
 assert.match(up,/actual_posted_accumulated_impairment/);
 assert.match(up,/asset\.cost_basis-expected_accumulated-actual_impairment/);
 assert.match(up,/Authoritative post-impairment depreciation policy is invalid/);
 assert.match(up,/FROM refs_read_ai_fixed_asset_depreciation_source\(p_tenant,p_entity,p_period\)/);
 assert.doesNotMatch(up,/round\(\(asset\.cost_basis-asset\.salvage_value\)\/asset\.useful_life_months/);
});

test('372 retains and protectively restores the 353 and 354 function boundaries',async()=>{
 const [up,down]=await Promise.all([read('up'),read('down')]);
 for(const retained of ['refs_read_ai_fixed_asset_depreciation_source_pre_372','refs_read_ai_fixed_asset_posted_reconciliation_pre_372']){assert.match(up,new RegExp(retained));assert.match(down,new RegExp(retained));}
 assert.match(down,/Refusing to overwrite an unexpected fixed asset depreciation AI source/);
 assert.match(down,/Refusing to overwrite an unexpected fixed asset depreciation AI reconciliation/);
 assert.match(down,/Retained fixed asset depreciation AI source is not the 353 boundary/);
 assert.match(down,/Retained fixed asset depreciation AI reconciliation is not the 354 boundary/);
 assert.match(down,/DROP FUNCTION refs_read_ai_fixed_asset_depreciation_source_pre_372/);
 assert.match(down,/DROP FUNCTION refs_read_ai_fixed_asset_posted_reconciliation_pre_372/);
});

test('372 migration files match the exact manifest hashes',async()=>{
 const entry=MIGRATION_MANIFEST.find(row=>row.name===name);assert.ok(entry);
 for(const direction of ['up','down'])assert.equal(createHash('sha256').update(await read(direction)).digest('hex'),entry[direction]);
});
