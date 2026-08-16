import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const upPath=new URL('../db/migrations/161_insurance_prepaid_amortization_entity_capabilities.sql',import.meta.url);
const downPath=new URL('../db/migrations/down/161_insurance_prepaid_amortization_entity_capabilities.sql',import.meta.url);

test('161 replaces only insurance readiness capability checks with entity-scoped permissions',async()=>{
  const [up,down]=await Promise.all([readFile(upPath,'utf8'),readFile(downPath,'utf8')]);
  assert.match(up,/pg_get_functiondef\('refs_read_insurance_prepaid_amortization\(uuid,uuid,uuid,integer\)'::regprocedure\)/);
  for(const permission of ['PREPAID.AMORTIZATION.REVIEW','PREPAID.AMORTIZATION.DRAFT','GL.JE.AUTO.CREATE']){
    assert.match(up,new RegExp(`refs_entity_has_permission\\(p_entity,''${permission.replaceAll('.','\\.')}''\\)`));
    assert.match(down,new RegExp(`refs_has_permission\\(''${permission.replaceAll('.','\\.')}''\\)`));
  }
  assert.match(up,/CREATE OR REPLACE FUNCTION/);
  assert.match(up,/EXECUTE tightened_definition/);
  assert.match(down,/EXECUTE restored_definition/);
  assert.doesNotMatch(up,/INSERT INTO|UPDATE\s+|DELETE FROM/i);
});
