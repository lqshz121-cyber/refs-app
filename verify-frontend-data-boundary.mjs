// ===========================================================================
// Frontend data boundary gate (Phase 2a)
//
// REFS is converging two frontends onto one. The authoritative frontend reads
// the accounting API; the legacy demo frontend reads src/seed.js and keeps
// business state in localStorage. That migration is finished page by page in
// Phase 2b, once the accounting API is deployed. Until then this gate does two
// things:
//
//   1. It stops the boundary from moving backwards. No new page may take a
//      dependency on seed data, write business state to the browser, or bring
//      back a decorative "observed QuickBooks surface" shell.
//   2. It makes the remaining migration countable. Every page still on seed
//      data is listed below with the reason it is still there. Phase 2b
//      deletes entries one at a time and this gate proves the progress: an
//      allowlist entry that is no longer needed is a hard failure, so the list
//      can only ever shrink.
//
// This gate is static analysis over src/. It proves what the source says, not
// what a browser renders.
// ===========================================================================
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const srcRoot = join(root, 'src');

const failures = [];
const fail = (rule, message) => failures.push(`[${rule}] ${message}`);

const listSourceFiles = dir => readdirSync(dir).flatMap(name => {
  const full = join(dir, name);
  if (statSync(full).isDirectory()) return listSourceFiles(full);
  return /\.(jsx?|mjs)$/.test(name) ? [full] : [];
});
const files = listSourceFiles(srcRoot)
  .map(full => ({ id: relative(root, full).split(sep).join('/'), text: readFileSync(full, 'utf8') }))
  .sort((a, b) => a.id.localeCompare(b.id));

// ---------------------------------------------------------------------------
// RULE 1 - seed data may not reach a business workspace module.
//
// src/seed.js is browser-resident demonstration data. It is not an accounting
// record and it has no entity, period, approval or posting authority. Only the
// modules named here may still import it, and each one says why.
// PHASE 2B: delete an entry the moment its page reads the accounting API.
// ---------------------------------------------------------------------------
const SEED_ALLOWLIST = {
  'src/app.jsx':
    'Legacy demo shell. Seeds the whole LOCAL_MOCK store (journals, exceptions, close ' +
    'tasks, bank transactions, FY2026 opening balances) that every legacy workspace reads. ' +
    'This is the last entry to remove: it is deleted when app.jsx stops mounting the ' +
    'LOCAL_MOCK tree at all and authoritative-app.jsx becomes the only root.',
  'src/module-sourcedocs.jsx':
    'Source Documents page. Renders SOURCE_DOCS. There is no source-document read on the ' +
    'accounting API yet, so this page has nothing authoritative to bind to.',
  'src/module-unitcost.jsx':
    'Unit Cost Ledger page. Renders SOURCE_DOCS as the cost source. Blocked on the same ' +
    'missing source-document read as module-sourcedocs.jsx.',
  'src/modules-core.jsx':
    'Property Ops Pickup and Closing Accounting pages. Read PM_ROWS, CLOSINGS, LOAN_TXNS, ' +
    'IC_TXNS, UNIT_OWNERS and SOURCE_DOCS. No property-management, closing or ownership ' +
    'endpoint is specified in the OpenAPI contract yet.',
  'src/modules-more.jsx':
    'Loan Register, Intercompany, Project Cost and Integration Hub pages. Read LOAN_TXNS, ' +
    'IC_TXNS, CLOSINGS, PM_ROWS and SOURCE_DOCS. Same missing endpoints as modules-core.jsx.',
};

const SEED_IMPORT = /(?:from|require\()\s*['"]\.\/seed(?:\.js)?['"]/;
const seenSeed = new Set();
for (const file of files) {
  if (!SEED_IMPORT.test(file.text)) continue;
  seenSeed.add(file.id);
  if (SEED_ALLOWLIST[file.id]) continue;
  fail('SEED_IMPORT', [
    `${file.id} imports ./seed.js and is not on the legacy allowlist.`,
    'src/seed.js is browser demonstration data, not an accounting record.',
    'Read the page data from src/accounting-api.js instead. If this page genuinely cannot',
    'move yet, add it to SEED_ALLOWLIST in this file with the page name and the specific',
    'API read it is waiting on - and expect to be asked to delete that entry.',
  ].join(' '));
}
for (const id of Object.keys(SEED_ALLOWLIST)) {
  if (seenSeed.has(id)) continue;
  fail('SEED_ALLOWLIST_STALE', [
    `${id} no longer imports ./seed.js, so its SEED_ALLOWLIST entry is stale.`,
    'Delete that entry from verify-frontend-data-boundary.mjs. The allowlist only shrinks;',
    'leaving a satisfied entry in place hides how much of the migration is actually done.',
  ].join(' '));
}

// ---------------------------------------------------------------------------
// RULE 2 - business state may not be written to localStorage.
//
// How a UI preference is distinguished from business state: it is NOT inferred.
// Every permitted write is enumerated below by its exact key expression as it
// appears in source. A key expression that is not in this table is business
// state by default, including every dynamically built key - a key such as
// `'refs_' + k` cannot be proven to hold a preference, so it is not treated as
// one. That default is the point: the gate fails closed.
//
// A UI-preference key stores how the reader is looking at a page (sort order,
// column visibility, density, saved filter scope, theme, navigation). It never
// stores a journal, bill, invoice, bank transaction, account, approval, period
// or identity - those are accounting records and belong to the API.
// ---------------------------------------------------------------------------
const UI_PREFERENCE_WRITES = {
  "src/ui.jsx::'refs_view_'+k":
    'Data-grid view preference: sort column, sort direction, text filter and row density ' +
    'for one table. Presentation only; holds no record.',
  "src/module-ap.jsx::'refs_expense_columns'":
    'Expense table column visibility. Presentation only; holds no record.',
  "src/modules-more.jsx::'refs_local_report_scopes'":
    'Saved report scope labels (entity / period / dimension the reader last chose). ' +
    'A filter selection, not a report result and not an accounting record.',
};

// PHASE 2B: delete an entry the moment its page stops writing business state.
const BUSINESS_STATE_ALLOWLIST = {
  "src/app.jsx::'refs_seedv'":
    'LOCAL_MOCK seed version stamp. Exists only to invalidate the legacy demo store when ' +
    'seed.js changes. Removed together with the legacy store itself.',
  "src/app.jsx::'refs_'+k":
    'Legacy demo persistence for the whole LOCAL_MOCK store: journals, exceptions, close ' +
    'tasks, AP, bank, chart of accounts, AR and the selected demo user. This is business ' +
    'state in the browser and it is the single largest item Phase 2b removes.',
  'src/repo.js::NS+k':
    'Legacy repository used by the LOCAL_MOCK store, including its audit log. Deleted with ' +
    'src/repo.js when the last legacy workspace stops calling repo.save().',
};

const SET_ITEM = /localStorage\s*\.\s*setItem\s*\(\s*([^,]+?)\s*,/g;
const normalizeKey = expression => expression.replace(/\s+/g, '');
const seenWrites = new Set();
for (const file of files) {
  for (const match of file.text.matchAll(SET_ITEM)) {
    const site = `${file.id}::${normalizeKey(match[1])}`;
    seenWrites.add(site);
    if (UI_PREFERENCE_WRITES[site] || BUSINESS_STATE_ALLOWLIST[site]) continue;
    fail('LOCAL_STORAGE_WRITE', [
      `${file.id} writes localStorage key expression ${normalizeKey(match[1])}, which is not`,
      'a declared UI preference and is not on the legacy business-state allowlist.',
      'Business records (journals, bills, invoices, bank items, accounts, approvals, periods,',
      'identity) belong to the accounting API, never to the browser. If this write really is a',
      'presentation preference - sort, columns, density, saved filter scope, theme, navigation -',
      'add its exact key expression to UI_PREFERENCE_WRITES in this file and say what it holds.',
      'A dynamically built key can never qualify: make the key a literal first.',
    ].join(' '));
  }
}
for (const [site, reason] of [...Object.entries(UI_PREFERENCE_WRITES), ...Object.entries(BUSINESS_STATE_ALLOWLIST)]) {
  if (seenWrites.has(site)) continue;
  const table = UI_PREFERENCE_WRITES[site] ? 'UI_PREFERENCE_WRITES' : 'BUSINESS_STATE_ALLOWLIST';
  fail('LOCAL_STORAGE_ALLOWLIST_STALE', [
    `${site} is listed in ${table} but no longer exists in src/.`,
    `Delete that entry from verify-frontend-data-boundary.mjs. (It was kept for: ${reason})`,
  ].join(' '));
}

// ---------------------------------------------------------------------------
// RULE 3 - no demonstration shell describing another product's surface.
//
// These were decorative reproductions of QuickBooks screens: navigation strips,
// column-name grids and marketing panels carrying no REFS data. They implied a
// capability REFS does not have and a parity REFS does not claim. There is no
// allowlist here; the correct number is zero.
// ---------------------------------------------------------------------------
const DEMO_SHELL_PATTERNS = [
  [/Observed QBO/, 'an "Observed QBO ..." shell caption'],
  [/Observed QuickBooks/, 'an "Observed QuickBooks ..." shell label'],
  [/Observed in QuickBooks/, 'an "Observed in QuickBooks only" chip'],
  [/Observed column/, 'an "Observed column" placeholder grid'],
  [/Observed KPI row/, 'an "Observed KPI row" placeholder'],
  [/Observed access\/status text/, 'an "Observed access/status text" placeholder'],
  [/Observed Published list shell|Observed Drafts view|Observed dashboard|Observed Standard reports tip/,
    'an observed report/dashboard list shell'],
  [/QUICKBOOKS RECONCILE/, 'a QuickBooks marketing panel'],
];
for (const file of files) {
  for (const [pattern, description] of DEMO_SHELL_PATTERNS) {
    const hit = pattern.exec(file.text);
    if (!hit) continue;
    const line = file.text.slice(0, hit.index).split('\n').length;
    fail('DEMO_SHELL', [
      `${file.id}:${line} reintroduces ${description} ("${hit[0]}").`,
      'A decorative reproduction of another product\'s screen is not REFS functionality: it',
      'shows controls that do nothing and implies a parity REFS does not claim. Delete the',
      'block. Do not replace it with a disabled control - if the capability does not exist,',
      'the page should say so in prose or say nothing at all.',
    ].join(' '));
  }
}

// ---------------------------------------------------------------------------
// RULE 4 - a control that can never be enabled must not render as a control.
//
// A hard-disabled <button>/<Btn> (bare `disabled`, not `disabled={expression}`)
// can never become clickable. Rendering one as a control invites a click that
// will never work and reads to a screen reader as an action. Export, Print,
// Email, Save and Customize were the whole population of these. Use the
// <Unavailable> statement from src/ui.jsx instead, or delete the affordance.
//
// A conditionally disabled control - `disabled={!canPost}` - is a real action
// that happens to be unavailable right now, and stays a control.
// ---------------------------------------------------------------------------
const HARD_DISABLED = /<(button|Btn)\b((?:[^>]|\n)*?)\bdisabled(?!\s*=)((?:[^>]|\n)*?)>([^<{][^<]*)</g;
const DEAD_CONTROL_LABEL = /^\s*(export|print|email|share|download|save|save as|customize|insights|more|create|new)\b/i;
for (const file of files) {
  for (const match of file.text.matchAll(HARD_DISABLED)) {
    const label = match[4].trim();
    if (!DEAD_CONTROL_LABEL.test(label)) continue;
    const line = file.text.slice(0, match.index).split('\n').length;
    fail('DEAD_CONTROL', [
      `${file.id}:${line} renders "${label}" as a permanently disabled <${match[1]}>.`,
      'It can never be enabled, so it must not be a control. Replace it with the',
      '<Unavailable reason="...">label</Unavailable> statement from src/ui.jsx, which is',
      'announced as aria-disabled and is not focusable, or delete it if it carries no',
      'information. If this control CAN become available, make the condition explicit:',
      'disabled={expression} plus a title saying why it is unavailable now.',
    ].join(' '));
  }
}

// ---------------------------------------------------------------------------
if (failures.length) {
  for (const failure of failures) console.error(`FAIL ${failure}`);
  console.error(`\nFrontend data boundary: ${failures.length} violation(s).`);
  process.exit(1);
}

const seedPages = Object.keys(SEED_ALLOWLIST).length;
const businessWrites = Object.keys(BUSINESS_STATE_ALLOWLIST).length;
console.log(
  `PASS: frontend data boundary holds. Seed-data allowlist ${seedPages} module(s); ` +
  `legacy localStorage business writes ${businessWrites}; declared UI-preference writes ` +
  `${Object.keys(UI_PREFERENCE_WRITES).length}; demo shells 0; permanently disabled ` +
  'export/print/save controls 0.',
);
