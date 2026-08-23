import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFrozenWbsH1DiscoveryCatalog} from '../tools/provision-wbs-h1-discovery-companies.mjs';
import {WBS_H1_DISCOVERY_COMPANY_CODES} from '../tools/wbs-h1-discovery-company-codes.mjs';

const artifact=new URL('../../outputs/wbs-h1-2026/qbo-company-workbench.html',import.meta.url);

test('the reviewed H1 workbench yields one exact 192-company test discovery roster',async()=>{
  const rows=readFrozenWbsH1DiscoveryCatalog(await readFile(artifact,'utf8'));
  assert.equal(rows.length,192);
  assert.equal(new Set(rows.map(row=>row.company_code)).size,192);
  assert.ok(rows.some(row=>row.company_code==='WBPA'));
  assert.ok(rows.every(row=>row.company_name===`WBS ${row.company_code}`));
  assert.deepEqual(WBS_H1_DISCOVERY_COMPANY_CODES,rows.map(row=>row.company_code));
});

test('discovery provisioning rejects any artifact drift before database access',async()=>{
  const source=await readFile(artifact,'utf8');
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(`${source}\n`),/hash does not match/);
});
