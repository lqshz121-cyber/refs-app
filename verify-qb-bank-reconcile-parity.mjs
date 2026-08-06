import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BANK_WORKSPACE_URL_DEFAULTS,
  bankWorkspaceNavContext,
  bankWorkspaceUrlSearch,
  decodeBankWorkspaceUrlState,
  encodeBankWorkspaceUrlState,
  hasBankWorkspaceUrlState,
  normalizeBankWorkspaceUrlState,
} from './src/bank-workspace-url-state.js';
import { bankQueueSummary, formatQueueCount, BANK_QUEUE_DIMENSION_NOTE } from './src/bank-queue-summary.js';
import { bankActionVisibility, BANK_WORKFLOW_ACTIONS, BANK_ACTION_READ_ONLY_STATEMENT } from './src/bank-action-visibility.js';
import { bankReconciliationSummary } from './src/bank-reconciliation-summary.js';

const read = file => readFileSync(new URL(file, import.meta.url), 'utf8');
const bankTx = read('./src/module-banktx.jsx');
const bankRec = read('./src/module-bankrec.jsx');
const styles = read('./index.html');

// ---------------------------------------------------------------- URL state
{
  const state = {
    acctCode:'BA-001', entityId:'2', queue:'Posted', query:'vendor wire',
    dateRange:'Custom range', dateFrom:'2026-05-01', dateTo:'2026-07-31',
    type:'Money out', page:3, bankTxnId:'44',
  };
  const encoded = encodeBankWorkspaceUrlState(state);
  assert.equal(encoded, 'acct=BA-001&entity=2&queue=Posted&q=vendor%20wire&dates=Custom%20range&from=2026-05-01&to=2026-07-31&type=Money%20out&page=3&txn=44',
    'Bank workspace URL state must encode every filter, the queue, the page and the focused item.');
  assert.deepEqual(decodeBankWorkspaceUrlState(`?${encoded}`), normalizeBankWorkspaceUrlState(state),
    'Encoding then decoding a Bank workspace scope must round-trip exactly.');
  assert.equal(bankWorkspaceUrlSearch(BANK_WORKSPACE_URL_DEFAULTS), '',
    'A default Bank workspace view must not pollute the address bar.');
  assert.equal(hasBankWorkspaceUrlState(''), false, 'An empty query string must not overwrite in-app navigation context.');
  assert.equal(hasBankWorkspaceUrlState('?queue=Posted'), true, 'A Bank workspace query string must be recognised.');
}
{
  // Fail closed: unknown or hostile parameters collapse to the default scope.
  const hostile = decodeBankWorkspaceUrlState('?queue=Signed&type=Everything&dates=Forever&page=-9&from=not-a-date&to=2026-13-99');
  assert.equal(hostile.queue, 'Review', 'An unknown queue must fail closed to Pending.');
  assert.equal(hostile.type, 'All transactions', 'An unknown transaction type must fail closed.');
  assert.equal(hostile.dateRange, 'All dates', 'An unknown date range must fail closed.');
  assert.equal(hostile.page, 1, 'A negative page must fail closed to page 1.');
  assert.equal(hostile.dateFrom, '', 'A malformed from date must be discarded.');
  assert.equal(hostile.dateTo, '', 'A malformed to date must be discarded.');
  const context = bankWorkspaceNavContext({acctCode:'BA-003', queue:'Excluded', page:2});
  assert.equal(context.route, 'banktx', 'Deep-link state must produce a banktx navigation context.');
  assert.ok(!('matched' in context) && !('cleared' in context) && !('posted' in context),
    'URL state must never carry a match, clearing or posting assertion.');
}

// ------------------------------------------------------------ queue summary
{
  assert.equal(formatQueueCount(1402), '1,402', 'Queue counts use grouped thousands like the observed QuickBooks control.');
  const rows = [
    {_state:'Review'}, {_state:'Review'}, {_state:'Posted'}, {_state:'Excluded'}, {_state:'Nonsense'},
  ];
  const summary = bankQueueSummary(rows, 'Posted');
  assert.deepEqual(summary.segments.map(s => s.inlineLabel), ['Pending (2)', 'Posted (1)', 'Excluded (1)'],
    'Queue counts must render inside the segment label.');
  assert.deepEqual(summary.segments.map(s => s.selected), [false, true, false], 'Exactly one segment is selected.');
  assert.equal(summary.unclassified, 1, 'A row outside the three queues must be reported, never silently folded in.');
  assert.equal(bankQueueSummary(rows, 'Signed off').activeQueue, 'Review', 'An unknown active queue fails closed to Pending.');
  assert.match(BANK_QUEUE_DIMENSION_NOTE, /separate dimension/, 'Queue and reconciliation dimensions must be stated as independent.');
}

// -------------------------------------------------------- role visibility
{
  const controller = bankActionVisibility({can:() => true, roleCode:'CONTROLLER'});
  assert.deepEqual(controller.visible.map(a => a.label), ['Match', 'Categorize', 'Exclude', 'Undo'],
    'A Controller must see the precise QuickBooks queue verbs.');
  assert.equal(controller.visible.every(a => a.executable === false), true,
    'No bank queue verb may be executable on the read-only evidence surface.');
  assert.equal(controller.anyExecutable, false, 'The visibility model must never report an executable action.');

  const readOnly = bankActionVisibility({can:() => false, roleCode:'READ_ONLY'});
  assert.deepEqual(readOnly.visible, [], 'A read-only role must see no bank queue verb at all.');
  assert.equal(readOnly.readOnly, true, 'A role without permission is reported as read-only.');
  assert.equal(readOnly.statement, BANK_ACTION_READ_ONLY_STATEMENT, 'A read-only role gets an explicit statement, not a greyed control.');
  assert.deepEqual(readOnly.hidden.map(a => a.label), ['Match', 'Categorize', 'Exclude', 'Undo'],
    'Withheld verbs are enumerated for audit but not rendered.');

  const partial = bankActionVisibility({can:permission => permission === 'CASH.BANKTX.EXCLUDE', roleCode:'STAFF_ACCT'});
  assert.deepEqual(partial.visible.map(a => a.label), ['Exclude'], 'Visibility follows the caller permission exactly.');
  assert.equal(BANK_WORKFLOW_ACTIONS.every(a => a.permission.startsWith('CASH.BANKTX.')), true,
    'Bank queue verbs must be gated by explicit permission codes.');
}

// ------------------------------------------------- reconciliation summary
{
  const transactions = [
    {bank_txn_id:1, cleared:true, amount:100, direction:'CREDIT', txn_date:'2026-07-01', match_status:'MATCHED', matched_je:'JE-1'},
    {bank_txn_id:2, cleared:false, amount:85, direction:'DEBIT', txn_date:'2026-07-31', match_status:'UNMATCHED'},
    {bank_txn_id:3, amount:250, direction:'CREDIT', txn_date:'2026-07-31', match_status:'UNMATCHED'},
  ];
  const summary = bankReconciliationSummary({bookBalance:1000, bankBalance:1000, difference:0, transactions, unverifiedMatchCount:1});
  assert.equal(summary.book, 1000, 'Book balance is passed through, never recomputed.');
  assert.equal(summary.bank, 1000, 'Bank balance is passed through, never recomputed.');
  assert.equal(summary.balanced, true, 'A zero difference is reported as balanced.');
  assert.equal(summary.clearedCount, 1, 'Cleared items are counted from the retained cleared flag.');
  assert.equal(summary.unclearedCount, 2, 'A missing cleared flag counts as uncleared, never as cleared.');
  assert.equal(summary.uncleared.length, 2, 'Uncleared detail rows are surfaced for review.');
  assert.equal(summary.unresolvedCount, 3, 'Unresolved items include uncleared items and unverified matches.');
  assert.equal(summary.signOffPrecondition, 'NOT_MET',
    'A zero difference alone must never satisfy the sign-off precondition.');

  const clean = bankReconciliationSummary({bookBalance:5, bankBalance:5, difference:0, transactions:[{bank_txn_id:9, cleared:true}]});
  assert.equal(clean.signOffPrecondition, 'MET', 'Difference zero plus zero unresolved items meets the precondition.');
  const drifted = bankReconciliationSummary({bookBalance:5, bankBalance:6, difference:1, transactions:[{bank_txn_id:9, cleared:true}]});
  assert.equal(drifted.signOffPrecondition, 'NOT_MET', 'A non-zero difference always blocks sign-off.');
  assert.ok(drifted.signOffBlockers.includes('Difference is not zero'), 'Blockers must name the non-zero difference.');
}

// --------------------------------------------------- Bank workspace render
for (const text of [
  'bank-queue-seg',
  'aria-label="Bank transaction queue status"',
  'segment.inlineLabel',
  'aria-label="Bank account"',
  'aria-label="Entity"',
  'aria-label="Date from"',
  'aria-label="Date to"',
  'Custom range',
  'bankWorkspaceUrlSearch',
  'decodeBankWorkspaceUrlState',
  'hasBankWorkspaceUrlState',
  'aria-label="Bank transaction evidence fields"',
  'aria-label="Bank workflow action availability"',
  'aria-label="Bank queue action availability"',
  '<i>Payee</i>',
  '<i>Description</i>',
  '<i>Linked GL account</i>',
  '<i>Linked journal entry</i>',
  '<i>Match evidence</i>',
  '<i>Queue status</i>',
  'scrollY:navContext.scrollY || 0',
  'Entity filter excludes this bank account',
]) assert.ok(bankTx.includes(text), `Bank transactions workspace is missing the parity contract: ${text}`);

assert.ok(!/aria-label="Bank workflow action availability"[\s\S]{0,1400}<Btn/u.test(bankTx),
  'The action availability panel must not render buttons; unavailable actions may not look executable.');
assert.ok(!/aria-label="Bank queue action availability"[\s\S]{0,900}<Btn/u.test(bankTx),
  'The queue action availability panel must not render buttons.');
assert.ok(bankTx.includes('Retained local bank evidence is read-only; no categorize, match, exclude, restore, or posting action is available.'),
  'The read-only bank evidence boundary statement must remain visible.');
for (const banned of ['autoMatch(', 'autoCategorize(', 'Split transaction', 'Connect bank', 'Import transactions', 'Auto-post']) {
  assert.ok(!bankTx.includes(banned), `Bank transactions must not add an out-of-scope capability: ${banned}`);
  assert.ok(!bankRec.includes(banned), `Reconciliation must not add an out-of-scope capability: ${banned}`);
}

// --------------------------------------------------- Reconciliation render
for (const text of [
  'aria-label="Reconciliation book bank difference summary"',
  'Book / Bank / Difference',
  'bankReconciliationSummary(',
  'reconSummary.unclearedCount',
  'reconSummary.signOffPrecondition',
  'No uncleared bank item is retained for this statement.',
  '>Open Match review<',
  '>Categorize<',
  '>Exclude<',
  '>Reconcile<',
]) assert.ok(bankRec.includes(text), `Reconciliation worksheet is missing the parity contract: ${text}`);

for (const gone of ['Categorization unavailable', 'Hold unavailable', '>Sign-off unavailable<', 'Review exact source']) {
  assert.ok(!bankRec.includes(gone), `Reconciliation still uses an imprecise or executable-looking label: ${gone}`);
}
assert.ok(bankRec.includes('Adjusted Bank must equal Adjusted Book and all retained items must be handled before sign-off.'),
  'The sign-off precondition statement must remain visible and must not be loosened.');
assert.ok(bankRec.includes("disabled={!can('CASH.RECON.SIGNOFF')}"),
  'Existing reconciliation authorization behaviour must remain unchanged.');

// -------------------------------------------------------------- Styling
for (const text of [
  '.bank-queue-seg{display:inline-flex;gap:2px;padding:2px;background:#e2e9ed;border-radius:6px;}',
  '.bank-queue-seg-item{appearance:none;border:0;height:32px;padding:0 16px;border-radius:5px;background:transparent;color:#4c555b;font:400 16px/1.2 inherit;cursor:pointer;white-space:nowrap;}',
  'box-shadow:0 1px 4px rgba(76,85,91,.2);',
  '.bank-action-item,.bank-action-chip{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border:1px dashed #c3ced5;',
  '.recon-summary-grid{display:grid;',
]) assert.ok(styles.includes(text), `Bank/reconciliation parity styling is missing: ${text}`);
assert.ok(!/\.bank-queue-seg-item:hover\{[^}]*transform/u.test(styles), 'Hover must be a background tint only, with no lift.');

console.log('PASS: Bank queue status, filters, URL deep-link state, evidence detail fields, role visibility and reconciliation Book/Bank/Difference are read-only and fail closed');
