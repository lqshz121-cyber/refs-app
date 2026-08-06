/* Generates docs/preview/shell-preview.html - a single self-contained file with
   no build step, so the shell and home rhythm can be judged in a browser
   without running the app. The <style> block is copied verbatim from
   index.html and the icon paths are read from src/ui.jsx, so the preview
   cannot drift from the product stylesheet or the product icon set.
   Regenerate with: node tools/build-shell-preview.mjs                       */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const ui = readFileSync(resolve(root, 'src/ui.jsx'), 'utf8');

const css = html.match(/<style>([\s\S]*?)<\/style>/)[1];
const iconLiteral = ui.match(/const ICON_PATHS = (\{[\s\S]*?\n\});/)[1];
const ICON = new Function(`return ${iconLiteral}`)();

const icon = (name, size = 24) => {
  const paths = ICON[name] || ICON.document;
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor"`
    + ` stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">`
    + paths.map(d => `<path d="${d}"/>`).join('') + `</svg>`;
};

// [full name, rail label, glyph, is current route's group, hairline before, expanded]
// A singleton group (Journal Entry, Reports, Close) has no aria-expanded at all.
const RAIL = [
  ['Control Center', 'Control', 'gauge', true, false, true],
  ['Accounting Settings', 'Settings', 'gear', false, false, false],
  ['Source &amp; Staging', 'Sources', 'inbox', false, false, false],
  ['Auto Reconciliation', 'Reconcile', 'cycle', false, false, true],
  ['Journal Entry', 'Journals', 'document', false, false, null],
  ['General Ledger', 'Ledger', 'lines', false, false, false],
  ['Accounting Operations', 'Operations', 'layers', false, false, false],
  ['Close', 'Close', 'calendar', false, false, null],
  ['Reports', 'Reports', 'bars', false, true, null],
  ['Admin', 'Admin', 'shield', false, false, false],
  ['Payables &amp; Receivables', 'AP / AR', 'exchange', false, false, false],
];

const railItems = RAIL.map(([full, short, glyph, on, brk, expanded]) => `
        <div class="nav-group">${brk ? '<span class="rail-sep" aria-hidden="true"></span>' : ''}
          <button class="nav-group-h${on ? ' rail-on' : ''}" title="${full}"${expanded === null ? '' : ` aria-expanded="${expanded}"`}>
            <span class="rail-glyph" aria-hidden="true">${icon(glyph)}</span>
            <span class="rail-label">${short}</span>
          </button>
        </div>`).join('');

const panelGroup = (title, tone, items) => `
        <div class="nav-panel-group nav-tone-${tone}">
          <div class="nav-panel-title">${title}</div>
          <div class="nav-group-items">${items.map(([label, on]) => `
            <button class="nav-item nav-sub${on ? ' nav-on' : ''}"${on ? ' aria-current="page"' : ''}>
              <span class="nav-badge" aria-hidden="true">${label[0].toUpperCase()}</span>
              <span class="nav-item-label">${label}</span>
              <span class="nav-chev" aria-hidden="true">&rsaquo;</span>
            </button>`).join('')}
          </div>
        </div>`;

const CHIPS = [
  ['Accounting', 'book'], ['Expenses &amp; Pay Bills', 'wallet'],
  ['Banking', 'bank'], ['Reports', 'bars'], ['Close', 'check'],
];
const QUEUE_PILLS = ['Action Required', 'Bank transaction matching', 'Reconciliation worksheet',
  'Mapping exceptions', 'Month-end close'];

const body = `
<div class="app">
  <aside class="sidebar">
    <div class="nav-rail">
      <span class="rail-logo" aria-hidden="true">&#9672;</span>${railItems}
    </div>
    <div class="nav-panel">
      <div class="brand"><span class="logo">&#9672;</span> REFS<span class="brand-sub">WanBridge</span></div>
      <button class="new-btn">&#65291; New</button>
      <nav aria-label="Workspace pages">
        ${panelGroup('Control Center', 0, [['Dashboard', true], ['Action Required', false], ['AI Audit Center', false], ['AI JE Workbench', false]])}
        ${panelGroup('Auto Reconciliation', 3, [['Bank Batch Pipeline', false], ['Bank Transaction Matching', false], ['Reconciliation Worksheet', false], ['Checks &amp; Payments', false]])}
      </nav>
    </div>
  </aside>
  <div class="main">
    <header class="topbar">
      <label class="sw"><select><option>All entities</option></select></label>
      <button class="cmdk">&#8984;K Search or jump</button>
      <div class="top-right">
        <span class="period-chip"><span class="period-label">Period</span><b>2026-07</b><span class="badge badge-ok">OPEN</span></span>
        <button class="icon-btn" title="Help">?</button>
        <button class="icon-btn" title="Light / dark">&#9790;</button>
        <div class="user-chip"><span class="user-av">R</span><span class="user-nm">Ricky<span class="muted sm"> &middot; CONTROLLER</span></span><button class="link-btn">Sign out</button></div>
      </div>
    </header>
    <main class="content">
      <div class="qb-home">
        <div class="qbo-home-hero">
          <div class="qb-greet-spacer" aria-hidden="true"></div>
          <div class="qb-greet">
            <h2 class="qb-greeting">Good afternoon, Ricky</h2>
            <p class="qb-greet-sub">The work that needs attention, your live financial position, and a clean path back to source records.</p>
          </div>
          <div class="qbo-home-actions">
            <button class="btn btn-default">Create journal entry</button>
            <button class="btn btn-ghost">Open reports</button>
            <button class="btn btn-ghost">See all activity</button>
          </div>
        </div>
        <div class="qbo-quicklinks" aria-label="Quick links">${CHIPS.map(([l, g]) => `
          <button type="button"><i aria-hidden="true">${icon(g, 18)}</i><span>${l}</span></button>`).join('')}
        </div>
        <div class="qb-actionhead">
          <h3 class="qb-sec">Create actions</h3>
          <span class="muted sm">Expenses, invoices and accounts stay read-only retained evidence.</span>
        </div>
        <div class="qb-actionrow"><button class="btn btn-default">Journal entry</button></div>
        <h3 class="qb-sec qb-home-section">Open a queue</h3>
        <div class="qb-actionrow">${QUEUE_PILLS.map(l => `<button class="btn btn-default">${l}</button>`).join('')}</div>
        <h3 class="qb-sec qb-home-section">Business at a glance</h3>
        <div class="qbo-grid">
          <div class="qbo-card">
            <h4>Profit &amp; Loss &mdash; 2026-07</h4>
            <div class="qbo-big">$412,880.00</div>
            <div class="qbo-sub">Net income &mdash; Revenue $1,240,500.00 &minus; Expense $827,620.00</div>
            <div class="qbo-bars"><span class="qbo-bar" style="height:34%"></span><span class="qbo-bar" style="height:56%"></span><span class="qbo-bar" style="height:28%"></span><span class="qbo-bar" style="height:72%"></span><span class="qbo-bar" style="height:48%"></span><span class="qbo-bar" style="height:88%"></span><span class="qbo-bar" style="height:61%"></span></div>
          </div>
          <div class="qbo-card">
            <h4>Bank Accounts</h4>
            <div class="bank-row"><span>BA-003 &mdash; Pacific Bank</span><span class="num">$163,650.00</span></div>
            <div class="bank-row"><span>BA-001 &mdash; First National Bank</span><span class="num">$910,000.00</span></div>
            <div class="qbo-sub" style="margin-top:8px">3 unmatched bank transactions &middot; review reconciliation</div>
          </div>
          <div class="qbo-card">
            <h4>Exceptions &mdash; Open</h4>
            <div class="qbo-big num-neg">4</div>
            <div class="qbo-sub">1 high &middot; 2 medium &middot; oldest aging 12 days</div>
          </div>
        </div>
        <div class="sec-title"><h3>Needs attention &middot; REFS local queue</h3></div>
        <div class="todo-grid" style="margin-bottom:26px">
          <div class="todo-item"><span class="todo-n warn">3</span><span class="todo-l">Bank transactions for review</span></div>
          <div class="todo-item"><span class="todo-n warn">1</span><span class="todo-l">Bills pending approval</span></div>
          <div class="todo-item"><span class="todo-n ok">0</span><span class="todo-l">JEs pending review/approval</span></div>
          <div class="todo-item"><span class="todo-n warn">2</span><span class="todo-l">Open exceptions</span></div>
          <div class="todo-item"><span class="todo-n warn">5</span><span class="todo-l">Close tasks remaining</span></div>
        </div>
        <div class="sec-title"><h3>Approvals (0)</h3><button class="btn btn-ghost btn-sm">View all</button></div>
        <div class="empty empty-state"><b>No journal entries are pending approval.</b>Approved and posted evidence stays reachable from the Journal Entry workspace.</div>
      </div>
    </main>
  </div>
</div>`;

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>REFS shell preview (static, no build step)</title>
<style>${css}
/* preview-only chrome, not part of the product stylesheet */
.preview-note{max-width:900px;margin:12px auto 0;padding:12px 16px;background:#FFF;
  border:0.8px solid #E2E9ED;border-radius:8px;color:#4C555B;font:400 13px/1.6
  "Avenir Next","Segoe UI",-apple-system,sans-serif;}
.preview-note b{color:#21262A;}
.preview-toggle{display:inline-flex;align-items:center;gap:8px;margin-top:8px;
  min-height:32px;padding:0 12px;border:1px solid #C3CED5;border-radius:6px;
  background:#FFF;color:#21262A;font:500 13px/1 inherit;cursor:pointer;}
</style>
</head>
<body>
${body}
<div class="preview-note">
  <b>Static preview.</b> Hand-written markup that mirrors what the React shell renders, with the
  product stylesheet inlined verbatim from <code>index.html</code>. Nothing here is interactive
  except the theme toggle. Independent implementation informed by measurement; no QuickBooks
  markup, CSS, icon, image or font asset is used, and no claim of QuickBooks equivalence is made.
  <div><button class="preview-toggle" onclick="document.body.classList.toggle('dark')">Toggle dark mode</button></div>
</div>
</body>
</html>
`;

mkdirSync(resolve(root, 'docs/preview'), { recursive: true });
writeFileSync(resolve(root, 'docs/preview/shell-preview.html'), out, 'utf8');
console.log('wrote docs/preview/shell-preview.html');
