import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTHORITATIVE_API_ROUTES, AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES, navigationItemForRoute } from '../src/authoritative-navigation.js';

assert.ok(AUTHORITATIVE_NAVIGATION.length >= 10, 'the formal navigation must retain the full product taxonomy');
assert.equal(new Set(AUTHORITATIVE_ROUTES).size, AUTHORITATIVE_ROUTES.length, 'every formal route needs a stable unique identity');
assert.deepEqual([...AUTHORITATIVE_API_ROUTES].sort(), ['bank','journals','overview','payables','receivables','reconciliation','reports'].sort());
for (const group of AUTHORITATIVE_NAVIGATION) {
  assert.ok(group.items.length > 0, `${group.label} may not be empty`);
  for (const item of group.items) assert.ok(AUTHORITATIVE_ROUTES.includes(item.route));
}
assert.equal(navigationItemForRoute('project-cost-cwip').availability, 'API_UNAVAILABLE');
assert.equal(navigationItemForRoute('bank').availability, 'API_READ');
const source = readFileSync(new URL('../src/authoritative-app.jsx', import.meta.url), 'utf8');
assert.match(source, /AuthoritativeNavigationShell/, 'the production app must render the reusable formal shell');
assert.match(source, /AuthoritativeUnavailableWorkspace/, 'unsupported modules must render an explicit fail-closed workspace');
assert.doesNotMatch(source, /legacy-demo-app|\.\/repo\.js|\.\/seed\.js|module-wbs|module-aiaudit|module-ai-je-workbench/,
  'the authoritative shell may not import demo, mock, or browser-state workspaces');
console.log('authoritative navigation model: complete catalog retains only API-backed reads and fails closed elsewhere');
