import assert from 'node:assert/strict';
import { createLocalReportScope, localReportScopeForEntity, normalizeLocalReportScopes, saveLocalReportScope } from './src/report-scope-presets.js';

const scope = createLocalReportScope({entityId:4,tab:'Trial Balance',fromP:'2026-01',toP:'2026-07',propertyId:2});
assert.equal(scope.label, 'Local Trial Balance · E4 · 2026-01–2026-07');
assert.equal(createLocalReportScope({entityId:'ALL',fromP:'2026-01',toP:'2026-07'}), null, 'an all-entity scope cannot be saved');
assert.equal(createLocalReportScope({entityId:4,fromP:'2026-08',toP:'2026-07'}), null, 'invalid ranges cannot be saved');
const saved = saveLocalReportScope([{entityId:2,tab:'GL Detail',fromP:'2026-01',toP:'2026-07'}], scope);
assert.equal(saved.length, 2);
assert.equal(localReportScopeForEntity(saved, 4).length, 1, 'a saved scope never leaks across entities');
assert.equal(normalizeLocalReportScopes([scope, scope, {entityId:null,fromP:'2026-01',toP:'2026-07'}]).length, 1);
console.log('report scope presets: entity-bound local report filters verified');
