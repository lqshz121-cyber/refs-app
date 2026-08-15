import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('Insurance current-release readback has a direct executable GET-only runbook',async()=>{const runbook=await readFile(new URL('../STAGE3-INSURANCE-PREPAID-AUTHORITATIVE-E2E.md',import.meta.url),'utf8');for(const name of ['REFS_STAGING_API_BASE_URL','REFS_STAGING_WEB_ORIGIN','REFS_RELEASE_SHA','REFS_STAGE3_INSURANCE_PREPAID_E2E_READ_ACCESS_TOKEN','REFS_STAGE3_INSURANCE_PREPAID_E2E_SCENARIO_PATH'])assert.match(runbook,new RegExp(name));assert.match(runbook,/node runtime\/verify-stage3-insurance-prepaid-authoritative-e2e\.mjs/);assert.match(runbook,/authenticated `GET`\s+requests only/);assert.match(runbook,/never printed\s+or written to an artifact/);assert.match(runbook,/does not execute Review, Draft\s+creation, Submit, journal Review, Approve, or Post/);assert.match(runbook,/provider trust, signature verification, and replay gate/);});
