import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const source=await readFile(new URL('../src/authoritative-property-rent-workspace.jsx',import.meta.url),'utf8');
const app=await readFile(new URL('../src/authoritative-app.jsx',import.meta.url),'utf8');

test('Property Rent workspace is an authoritative queue with explicit detail return context',()=>{
  assert.match(source,/refreshAuthoritativeWbsPropertyRentPickup/);
  assert.match(source,/createAuthoritativeWbsPropertyRentDraft/);
  assert.match(source,/reviewAuthoritativeWbsPropertyRent/);
  assert.match(source,/Back to Rent pickup queue/);
  assert.match(source,/scrollY:Number\(environment\?\.scrollY\)\|\|0/);
  assert.match(source,/setQuery\(context\?\.query\|\|''\);setPage\(context\?\.page\|\|1\)/);
  assert.match(source,/getElementById\?\.\(context\?\.focusId\)\?\.focus/);
  assert.match(source,/role="region" tabIndex=\{0\} aria-label="Property Rent pickup evidence; scroll horizontally to view every column"/);
  assert.match(app,/route === 'property-ops-pickup' && <AuthoritativePropertyRentWorkspace/);
  assert.match(app,/propertyPnlTitle="Property operating P&amp;L"/);
  assert.match(source,/AuthoritativeReportsWorkspace/);
  assert.match(source,/initialDimensionType="PROPERTY" initialDimensionRef=\{report\.propertyRef\}/);
  assert.match(source,/Back to Rent pickup evidence/);
  assert.match(source,/Open this Property P&amp;L and lineage/);
});

test('Property Rent workspace exposes honest loading, empty, error and permission states',()=>{
  assert.match(source,/Loading Rent pickup readiness/);
  assert.match(source,/No admitted Property Rent charges/);
  assert.match(source,/NO_PERMISSION — Property Rent role required/);
  assert.match(source,/No local or demonstration row is substituted/);
  assert.match(source,/READ ONLY FOR CURRENT ACTOR/);
  assert.match(source,/Draft creation never submits, reviews, approves, or posts/);
  assert.match(source,/commandInFlight\.current/);
  assert.match(source,/disabled=\{!ready\|\|running\}/);
  assert.match(source,/!\/\[\\u0000-\\u001f\\u007f\]\//);
  assert.doesNotMatch(source,/localStorage|sessionStorage|auto.?post/i);
});
