import assert from 'node:assert/strict';
import { AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES } from '../src/authoritative-navigation.js';

assert.deepEqual(AUTHORITATIVE_ROUTES,['overview','payables','receivables','bank','reconciliation','journals','reports']);
assert.equal(new Set(AUTHORITATIVE_ROUTES).size,AUTHORITATIVE_ROUTES.length,'an authoritative route may appear only once');
assert.deepEqual(AUTHORITATIVE_NAVIGATION.map(group=>group.label),['Control center','Expenses','Receivables','Auto reconciliation','Accounting','Reports']);
for(const group of AUTHORITATIVE_NAVIGATION){assert.ok(group.items.length>0,`${group.label} may not be empty`);for(const item of group.items)assert.ok(AUTHORITATIVE_ROUTES.includes(item.route));}
const source = await import('node:fs').then(({readFileSync})=>readFileSync(new URL('../src/authoritative-app.jsx',import.meta.url),'utf8'));
for (const group of AUTHORITATIVE_NAVIGATION) assert.match(source, /AUTHORITATIVE_NAVIGATION\.map/, 'the shell must render navigation groups rather than flattening them into a generic API list');
assert.doesNotMatch(source, /legacy-demo-app|\.\/repo\.js|\.\/seed\.js|module-wbs|module-aiaudit|module-ai-je-workbench/,
  'authoritative navigation may not import demo, mock, or browser-state workspaces');
console.log('authoritative navigation model: only API-backed production workflows are exposed');
