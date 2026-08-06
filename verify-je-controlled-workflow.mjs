import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const core = readFileSync(new URL('./src/modules-core.jsx', import.meta.url), 'utf8');
const workflow = readFileSync(new URL('./src/je-workflow.js', import.meta.url), 'utf8');
const engine = readFileSync(new URL('./src/engine.js', import.meta.url), 'utf8');

assert.match(core, /Journal No\./, 'JE list must expose the journal number.');
assert.match(core, /Memo \/ Description/, 'JE list must expose memo/description.');
assert.match(core, /Payee \/ Name/, 'JE list must expose the controlled counterparty/member field.');
assert.match(core, /Attachment/, 'JE list must expose retained attachment evidence.');
assert.match(core, /<th[^>]*>ACCOUNT<\/th>.*<th[^>]*>DEBITS<\/th>.*<th[^>]*>CREDITS<\/th>.*<th>DESCRIPTION<\/th>.*<th[^>]*>NAME<\/th>/s, 'JE detail must expose QBO-like line evidence fields.');
assert.match(core, /Workflow history/, 'JE detail must show retained workflow history without requiring a secondary action.');
assert.match(core, /Drafts do not affect reporting\./, 'JE workflow history must state the Draft reporting boundary.');
assert.match(core, /!hasScopedReturn && <button className="crumb"/, 'A scoped JE drill must not offer a conflicting generic list Back button.');
assert.doesNotMatch(core, /Run Batch Templates|Post All \(|Cancel Post/, 'JE UI must not expose batch/direct posting or post cancellation.');
// Phase 2a: a capability that can never execute is stated, not rendered as a
// disabled control. The label must stay visible; it must not stay a <button>.
assert.match(core, /Make recurring<\/Unavailable>/, 'Recurring affordance must remain a visible non-executable statement.');
assert.doesNotMatch(core, /Make recurring<\/Btn>|Make recurring<\/button>/, 'Recurring must not render as a control.');
assert.match(core, /reason="Recurring entries are outside the controlled Journal Entry evidence workflow"/, 'Recurring must state why it is unavailable.');

assert.match(engine, /DRAFT:\s+\{next:'PENDING_REVIEW'/, 'Workflow must begin with Draft review.');
assert.match(engine, /PENDING_REVIEW:\s+\{next:'PENDING_APPROVAL'/, 'Workflow must preserve separate review.');
assert.match(engine, /PENDING_APPROVAL:\s+\{next:'APPROVED'/, 'Workflow must preserve a separate approval.');
assert.match(engine, /APPROVED:\s+\{next:'POSTED'/, 'Only approved JEs can be posted.');
assert.match(workflow, /JE_SOD_MAKER/, 'Workflow must enforce maker separation.');
assert.match(workflow, /JE_SOD_APPROVER_POSTER/, 'Workflow must enforce approver/poster separation.');
assert.match(workflow, /JE_IMMUTABLE/, 'Workflow must prevent silent edits to posted entries.');

console.log('PASS: JE fields, full-page scoped Back, visible workflow history, and controlled Draft→Review→Approve→Post boundary are retained.');
