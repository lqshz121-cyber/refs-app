import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REFS_BUSINESS_SCOPE, isBusinessCapabilityExcluded } from './src/business-scope.js';

assert.ok(REFS_BUSINESS_SCOPE.included.some(item => item.includes('Bank transactions')));
assert.ok(REFS_BUSINESS_SCOPE.included.some(item => item.includes('tenant')));
for (const label of ['Integration Hub', 'Amazon marketplace', 'Online payment link', 'Spreadsheet Sync']) {
  assert.equal(isBusinessCapabilityExcluded(label), true, `${label} must remain outside the REFS product scope`);
}
assert.equal(isBusinessCapabilityExcluded('Local AP aging'), false);
const app = readFileSync(new URL('./src/app.jsx', import.meta.url), 'utf8');
assert.equal(app.includes("['integration','Integration Hub']"), false);
assert.equal(app.includes('integration:IntegrationHub'), false);
console.log('business scope: local close capabilities retained and excluded connection surfaces are not navigable');
