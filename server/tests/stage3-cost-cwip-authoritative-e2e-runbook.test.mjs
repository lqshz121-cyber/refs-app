import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const root=new URL('../',import.meta.url);
test('Stage 3 Cost-to-CWIP has one documented executable GET-only production readback',async()=>{const [packageText,runbook]=await Promise.all([readFile(new URL('package.json',root),'utf8'),readFile(new URL('STAGE3-COST-CWIP-AUTHORITATIVE-E2E.md',root),'utf8')]);const scripts=JSON.parse(packageText).scripts;assert.equal(scripts['test:stage3:cost-cwip-authoritative-e2e'],'node runtime/verify-stage3-cost-cwip-authoritative-e2e.mjs');for(const name of ['REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN','REFS_RELEASE_SHA','REFS_STAGE3_COST_CWIP_E2E_READ_ACCESS_TOKEN','REFS_STAGE3_COST_CWIP_E2E_SCENARIO_PATH'])assert.match(runbook,new RegExp(name));assert.match(runbook,/authenticated `GET` requests\s+only/);assert.match(runbook,/never printed\s+or written to an artifact/);assert.match(runbook,/must be paired with `verify:wbs-live-acceptance`/);assert.match(runbook,/not provider signature admission, Review\/SoD actions/);assert.match(runbook,/unsupported\s+Insurance\/Prepaid and Property Operations\/Rent Pickup domains/);});
