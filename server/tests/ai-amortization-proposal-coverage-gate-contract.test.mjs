import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const up=await readFile(new URL('../db/migrations/141_ai_amortization_proposal_coverage_gate.sql',import.meta.url),'utf8');
const down=await readFile(new URL('../db/migrations/down/141_ai_amortization_proposal_coverage_gate.sql',import.meta.url),'utf8');

test('AI amortization proposals require exact immutable coverage evidence for the same source version',()=>{
  assert.match(up,/pg_get_functiondef\('refs_propose_ai_amortization_schedule/);
  for(const token of ['ai_amortization_coverage_evidence','coverage\.tenant_id=p_tenant','coverage\.entity_id=p_entity','coverage\.source_document_id=p_source','coverage\.source_document_version=source\.version','coverage\.source_payload_hash=source\.payload_hash','coverage\.coverage_start=p_coverage_start','coverage\.coverage_end=p_coverage_end','requires exact retained whole-month coverage evidence'])assert.match(up,new RegExp(token));
  assert.match(up,/USING ERRCODE=''23514''/);
});

test('coverage gate rollback refuses to weaken retained amortization proposals',()=>{
  assert.match(down,/IF EXISTS\(SELECT 1 FROM ai_amortization_schedule\)/);
  assert.match(down,/Cannot remove AI amortization coverage gate after proposals are retained/);
});
