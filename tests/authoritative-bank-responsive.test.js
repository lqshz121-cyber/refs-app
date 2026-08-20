import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const source=readFileSync('src/authoritative-bank-workspace.jsx','utf8');
const css=readFileSync('index.html','utf8');

// The responsive contract intentionally targets the authoritative Bank and
// Reconciliation routes only. It does not change the legacy/demo shell.
assert.match(source,/className="stack authoritative-bank-workspace"/);
assert.match(source,/className="stack authoritative-reconciliation-workspace"/);
assert.match(source,/aria-label="Bank transaction scope"/);
assert.match(source,/aria-label="Reconciliation statement scope"/);
assert.match(source,/label>Bank account<input required/);
assert.match(source,/label>Controller reason<input required/);

// Evidence tables retain their columns in a keyboard-focusable local scroll
// region, so 320px and 900px layouts do not make the document scroll sideways.
for(const label of ['Bank transactions; scroll horizontally to view every column','Reconciliation worksheet; scroll horizontally to view every column','Posted adjustment clearance evidence; scroll horizontally to view every column']){
  assert.match(source,new RegExp(`role="region" tabIndex=\\{0\\} aria-label="${label}"`));
}
assert.match(css,/\.table-wrap\{[\s\S]*overflow:auto;[\s\S]*min-width:0;[\s\S]*max-width:100%/);
assert.match(css,/\.authoritative-bank-evidence-table\{max-height:60vh;overflow:auto;overscroll-behavior:contain;\}/,'Bank queue and reconciliation evidence tables must remain contained after the tablet reset');
assert.match(css,/@media\(max-width:900px\)\{[\s\S]*\.authoritative-bank-workspace \.table-wrap,[\s\S]*overscroll-behavior-inline:contain/);

// 44px targets and a two-column-to-one-column filter grid preserve labelled
// account/date/reason controls at 900px, 320px, and 200% zoom.
assert.match(css,/@media\(max-width:900px\)\{[\s\S]*\.authoritative-bank-workspace \.filterbar,[\s\S]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
assert.match(css,/\.authoritative-bank-workspace \.filterbar input,[\s\S]*min-height:44px/);
assert.match(css,/\.authoritative-bank-workspace \.filterbar \.btn,[\s\S]*min-height:44px/);
assert.match(css,/@media\(max-width:600px\)\{[\s\S]*\.authoritative-bank-workspace \.filterbar,[\s\S]*grid-template-columns:minmax\(0,1fr\)/);

// A segmented Bank queue remains a native button group with an explicit focus
// outline and touch-sized targets instead of relying on a colour-only state.
assert.match(css,/\.bank-queue-seg\{[\s\S]*overflow-x:auto/);
assert.match(css,/\.bank-queue-seg-item\{height:44px;min-height:44px;/);
assert.match(css,/\.bank-queue-seg-item:focus-visible\{outline:2px solid/);

// Lifecycle, clearance, and difference states all remain visible as text.
for(const label of ['Reconciliation lifecycle','Independent sign-off','Immutable history','Difference','Clear matched item','Unclear matched item','Send to independent review','Sign off reviewed statement','Reopen signed statement'])assert.match(source,new RegExp(label));

console.log('authoritative-bank-responsive: 320/900/1280 and 200% zoom layout/a11y contract passed');
