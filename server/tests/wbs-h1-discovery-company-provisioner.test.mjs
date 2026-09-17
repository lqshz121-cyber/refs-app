import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {readFrozenWbsH1DiscoveryCatalog} from '../tools/provision-wbs-h1-discovery-companies.mjs';
import {WBS_H1_DISCOVERY_COMPANY_CODES} from '../tools/wbs-h1-discovery-company-codes.mjs';

const artifact=new URL('../../outputs/wbs-h1-2026/qbo-company-workbench.html',import.meta.url);
// The reviewed workbench artifact is a git-ignored Owner deliverable; when a checkout does not carry it the two
// roster tests are skipped with an explicit reason instead of failing as a false red (H10 §4).
import {existsSync} from 'node:fs';
const artifactMissing=existsSync(artifact)?null:`SKIPPED: reviewed workbench artifact missing at ${artifact.pathname} (git-ignored Owner deliverable)`;

test('the reviewed H1 workbench yields one exact 192-company test discovery roster',async t=>{if(artifactMissing){t.skip(artifactMissing);return;}
  const rows=readFrozenWbsH1DiscoveryCatalog(await readFile(artifact,'utf8'));
  assert.equal(rows.length,192);
  assert.equal(new Set(rows.map(row=>row.company_code)).size,192);
  assert.ok(rows.some(row=>row.company_code==='WBPA'));
  assert.ok(rows.every(row=>row.company_name===`WBS ${row.company_code}`));
  assert.deepEqual(WBS_H1_DISCOVERY_COMPANY_CODES,rows.map(row=>row.company_code));
});

test('discovery provisioning rejects any artifact drift before database access',async t=>{if(artifactMissing){t.skip(artifactMissing);return;}
  const source=await readFile(artifact,'utf8');
  assert.throws(()=>readFrozenWbsH1DiscoveryCatalog(`${source}\n`),/hash does not match/);
});
