import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const packageJson=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));

test('root full test cannot omit authoritative Insurance, Property, dark-mode, accessibility or release gates',()=>{
  const full=packageJson.scripts?.test||'';
  for(const script of [
    'test:authoritative-amortization',
    'test:authoritative-property-rent',
    'test:authoritative-theme-preference',
    'test:navigation-a11y',
    'test:authoritative-runtime-evidence',
    'test:release-evidence-bundle',
  ])assert.match(full,new RegExp(`npm run ${script.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}(?: &&|$)`),`root test omits ${script}`);
});

test('Insurance and Property suites exercise both workspace and authoritative API client contracts',()=>{
  assert.match(packageJson.scripts?.['test:authoritative-amortization']||'',/authoritative-amortization-workspace\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-amortization']||'',/insurance-amortization-authoritative-client\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-property-rent']||'',/authoritative-property-rent-workspace\.test/);
  assert.match(packageJson.scripts?.['test:authoritative-property-rent']||'',/property-rent-authoritative-client\.test/);
});
