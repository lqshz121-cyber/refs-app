// O04: every POSTED-only surface that can render an empty scope must consult the entity evidence summary,
// so a blank report is labelled NO_EVIDENCE_IMPORTED / EVIDENCE_WITHOUT_POSTINGS instead of reading as zero.
// Static wiring contract (effects do not run under SSR); the copy itself is covered by
// tests/entity-evidence-summary-client.test.js and the data path by server/tests/evidence-to-report-stage-trace-postgres.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const src=name=>readFileSync(new URL(`../src/${name}`,import.meta.url),'utf8');
const SURFACES=['authoritative-reports-workspace.jsx','authoritative-general-ledger-workspace.jsx','authoritative-journal-workspace.jsx'];
test('reports, general ledger and journal register pass the evidence summary into their empty state',()=>{
  for(const name of SURFACES){
    const s=src(name);
    const emptyStates=[...s.matchAll(/<AuthoritativeScopeEmpty\b[^>]*\/>/g)].map(m=>m[0]);
    assert.ok(emptyStates.length>0,`${name} renders AuthoritativeScopeEmpty`);
    for(const tag of emptyStates)assert.match(tag,/evidence=\{evidence\}/,`${name}: ${tag} must receive evidence={evidence}`);
    assert.ok(/useEntityEvidenceWhenEmpty\(|refreshEntityEvidenceSummary\(/.test(s),`${name} must fetch the evidence summary when empty`);
  }
});
test('the shared hook only fetches while the scope is empty and degrades to null on any failure',()=>{
  const s=src('authoritative-read-state.jsx');
  assert.match(s,/export function useEntityEvidenceWhenEmpty\(\{config,fetcher,empty\}\)/);
  assert.match(s,/if\(!empty\)\{setEvidence\(null\);return/);
  assert.match(s,/\.catch\(\(\)=>\{if\(current\)setEvidence\(null\);\}\)/);
  assert.match(s,/result\?\.ok\?result\.row:null/);
});
test('empty-state copy never presents an empty query as a zero balance',()=>{
  const s=src('authoritative-read-state.jsx');
  assert.match(s,/this is not a zero balance and no figures were substituted/);
  assert.match(s,/Reports and GL read posted evidence only/);
  assert.doesNotMatch(s,/balance is 0|zero balance confirmed/i);
});
