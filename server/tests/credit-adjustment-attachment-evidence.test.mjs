import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {MIGRATION_MANIFEST} from '../runtime/migration-manifest.mjs';

const file=name=>new URL(name,import.meta.url);
const [up,down,repository,http,client,openapi]=await Promise.all([
  readFile(file('../db/migrations/328_credit_adjustment_attachment_evidence.sql'),'utf8'),
  readFile(file('../db/migrations/down/328_credit_adjustment_attachment_evidence.sql'),'utf8'),
  readFile(file('../runtime/kernel-repository.mjs'),'utf8'),
  readFile(file('../api/accounting-http.mjs'),'utf8'),
  readFile(file('../../src/accounting-api.js'),'utf8'),
  readFile(file('../api/openapi-accounting.json'),'utf8').then(JSON.parse)
]);

test('credit adjustment commands bind verified company attachment evidence atomically',()=>{
  assert.match(up,/COALESCE\(cardinality\(p_attachment_ids\),0\) NOT BETWEEN 1 AND 25/);
  assert.match(up,/p_lines IS NULL OR jsonb_typeof\(p_lines\)<>'array'/);
  assert.match(up,/finalization_status='VERIFIED_CLEAN' AND scan_status='CLEAN'/);
  assert.match(up,/INSERT INTO journal_entry[\s\S]*'MANUAL','DRAFT'/);
  assert.match(up,/INSERT INTO source_link[\s\S]*'JE_ATTACHMENT'/);
  assert.match(up,/INSERT INTO business_adjustment[\s\S]*p_kind[\s\S]*'DRAFT'/);
  assert.doesNotMatch(up,/INSERT INTO ledger_line/);
  assert.match(up,/receipt\.actor_id IS DISTINCT FROM actor/);
  assert.match(up,/'attachment_ids'[\s\S]*ORDER BY id/);
});

test('legacy attachment-free credit signatures lose runtime execution and down restores them',()=>{
  for(const name of ['refs_ap_vendor_credit_hash','refs_create_ap_vendor_credit','refs_ar_credit_memo_hash','refs_create_ar_credit_memo']){
    assert.match(up,new RegExp(`REVOKE EXECUTE ON FUNCTION ${name}\\([^\\n]+\\) FROM refs_app`));
    assert.match(down,new RegExp(`GRANT EXECUTE ON FUNCTION ${name}\\([^\\n]+\\) TO refs_app`));
  }
  assert.match(down,/DROP FUNCTION refs_create_credit_adjustment_v2/);
  assert.doesNotMatch(down,/DROP TABLE|DELETE FROM|TRUNCATE/i);
});

test('repository, HTTP, browser and OpenAPI require attachment identities',()=>{
  assert.match(repository,/refs_ap_vendor_credit_hash\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11\)/);
  assert.match(repository,/refs_create_ar_credit_memo\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11,\$12,\$13\)/);
  assert.match(http,/vendor-credits'[\s\S]*allowOnly\(payload,\[[^\]]*'attachmentIds'/);
  assert.match(http,/credit-memos'[\s\S]*allowOnly\(payload,\[[^\]]*'attachmentIds'/);
  assert.match(client,/Credit adjustments require 1-25 unique server-listed attachment IDs/);
  for(const name of ['ApVendorCredit','ArCreditMemo']){
    const schema=openapi.components.requestBodies[name].content['application/json'].schema;
    assert.ok(schema.required.includes('attachmentIds'));
    assert.deepEqual({min:schema.properties.attachmentIds.minItems,max:schema.properties.attachmentIds.maxItems,unique:schema.properties.attachmentIds.uniqueItems},{min:1,max:25,unique:true});
  }
});

test('migration 328 is checksum-bound in fixed order',()=>{
  const names=MIGRATION_MANIFEST.map(row=>row.name),name='328_credit_adjustment_attachment_evidence.sql',index=names.indexOf(name);
  assert.equal(names.filter(item=>item===name).length,1);
  assert.ok(index>0&&Number.parseInt(names[index-1],10)<328);
  assert.ok(index===names.length-1||Number.parseInt(names[index+1],10)>328);
});
