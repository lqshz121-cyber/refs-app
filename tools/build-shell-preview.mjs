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

// [label, remaining, total] - mirrors the QueueTile component in src/ui.jsx.
// Both numbers are always counted from the same records; a tile with no
// derivable total would render without a meter rather than invent one.
const TILES = [
  ['Bank transactions for review', 3, 41],
  ['Bills pending approval', 1, 18],
  ['JEs pending review/approval', 0, 26],
  ['Missing mappings', 2, 9],
  ['Open exceptions', 4, 21],
  ['Close tasks remaining', 5, 14],
];
const tile = ([label, remaining, total]) => {
  const done = total - remaining;
  const clear = remaining === 0;
  const pct = Math.round((done / total) * 100);
  const spoken = `${label}: ${remaining} remaining, ${done} of ${total} done`;
  return `
          <div class="todo-item${clear ? ' is-clear' : ''}" role="button" tabindex="0" aria-label="${spoken}">
            <span class="todo-n ${clear ? 'ok' : 'warn'}" aria-hidden="true">${clear ? '&#10003;' : remaining}</span>
            <span class="todo-l" aria-hidden="true">${label}</span>
            <span class="todo-meter" aria-hidden="true"><span style="width:${pct}%"></span></span>
            <span class="todo-done" aria-hidden="true">${clear ? `All ${total} done` : `${done} of ${total} done`}</span>
          </div>`;
};

const body = `
<div class="app">
  <aside id="primary-navigation" class="sidebar">
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
      <button class="mobile-nav-btn" aria-label="Open navigation" aria-controls="primary-navigation" aria-expanded="false">&#9776;</button>
      <label class="sw"><select><option>All entities</option></select></label>
      <button class="cmdk">&#8984;K Search or jump</button>
      <div class="top-right">
        <span class="period-chip"><span class="period-label">Period</span><b>2026-07</b><span class="badge badge-ok">OPEN</span></span>
        <button class="icon-btn" title="Help">?</button>
        <button class="icon-btn" aria-pressed="false" title="Switch to dark theme">&#9790;</button>
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
        <div class="todo-grid" style="margin-bottom:26px">${TILES.map(tile).join('')}
        </div>

        <div class="sec-title"><h3>Round 3 &middot; workflow marks, readable in greyscale</h3></div>
        <div class="card" style="margin-bottom:26px">
          <div class="card-h">Every stage differs by mark geometry, not only by hue</div>
          <div class="row-acts" style="margin:10px 0 14px">
            <span class="badge badge-muted badge-s-draft">DRAFT</span>
            <span class="badge badge-warn badge-s-progress">PENDING_REVIEW</span>
            <span class="badge badge-warn badge-s-progress">PENDING_APPROVAL</span>
            <span class="badge badge-ok badge-s-approved">APPROVED</span>
            <span class="badge badge-ok badge-s-posted">POSTED</span>
            <span class="badge badge-bad badge-s-reversed">REVERSED</span>
          </div>
          <div class="row-acts preview-grey" style="margin-bottom:6px">
            <span class="badge badge-muted badge-s-draft">DRAFT</span>
            <span class="badge badge-warn badge-s-progress">PENDING_REVIEW</span>
            <span class="badge badge-warn badge-s-progress">PENDING_APPROVAL</span>
            <span class="badge badge-ok badge-s-approved">APPROVED</span>
            <span class="badge badge-ok badge-s-posted">POSTED</span>
            <span class="badge badge-bad badge-s-reversed">REVERSED</span>
          </div>
          <p class="muted sm" style="margin:0">The second row is the same markup with the colour removed
            (<code>filter:grayscale(1)</code>, preview-only). Ring / half ring / filled circle / square / bar
            still separate the five stages. A badge is a statement of state and is never a control.</p>
        </div>

        <div class="sec-title"><h3>Round 3 &middot; three numeric readings</h3></div>
        <div class="table-wrap" style="margin-bottom:26px">
          <table class="tbl">
            <thead><tr><th>Line</th><th>Account</th><th class="ta-r">Debits</th><th class="ta-r">Credits</th><th>Reading</th></tr></thead>
            <tbody>
              <tr><td class="muted">1</td><td>1010 Operating Cash</td><td class="ta-r"><span class="num">$412,880.00</span></td><td class="ta-r"><span class="num num-nil">&ndash;</span></td><td class="muted sm">Debit line: the credit side does not apply</td></tr>
              <tr class="tr-hi"><td class="muted">2</td><td>4010 Rental Revenue</td><td class="ta-r"><span class="num num-nil">&ndash;</span></td><td class="ta-r"><span class="num">$412,880.00</span></td><td class="muted sm">Pointer hover &mdash; quiet canvas tint</td></tr>
              <tr class="tr-kb"><td class="muted">3</td><td>1310 Prepaid Insurance</td><td class="ta-r"><span class="num num-zero">$0.00</span></td><td class="ta-r"><span class="num num-zero">$0.00</span></td><td class="muted sm">Keyboard row &mdash; accent tint + inset marker; a recorded zero, not an absence</td></tr>
              <tr><td class="muted">4</td><td>2010 Accounts Payable</td><td class="ta-r"><span class="num num-nil">&ndash;</span></td><td class="ta-r"><span class="num num-neg">($8,420.00)</span></td><td class="muted sm">Negative in parentheses, same tabular width</td></tr>
            </tbody>
          </table>
        </div>

        <div class="sec-title"><h3>Round 3 &middot; loading skeleton at the geometry of the real table</h3></div>
        <div style="margin-bottom:26px">
          <div class="table-wrap" role="status" aria-live="polite" aria-busy="true" aria-label="Loading records">
            <div class="skel-table" aria-hidden="true">
              <div class="skel-head"><span class="skel-cell skel-wide"></span><span class="skel-cell"></span><span class="skel-cell skel-num"></span><span class="skel-cell"></span><span class="skel-cell skel-num"></span></div>
              ${Array.from({length:5},()=>`<div class="skel-row"><span class="skel-cell skel-wide"></span><span class="skel-cell"></span><span class="skel-cell skel-num"></span><span class="skel-cell"></span><span class="skel-cell skel-num"></span></div>`).join('')}
            </div>
          </div>
          <p class="muted sm" style="margin:8px 0 0">40px header, 44px rows, same wrapper hairline and radius as the
            loaded table, so nothing shifts when the read resolves. The sweep disappears entirely under
            <code>prefers-reduced-motion: reduce</code> &mdash; set that in your OS and reload to check.</p>
        </div>

        <div class="sec-title"><h3>Approvals (0)</h3><button class="btn btn-ghost btn-sm">View all</button></div>
        <div class="empty empty-state state-block state-empty state-cleared"><b>Nothing is waiting on you.</b>Every journal entry in scope has cleared review and approval. Posted evidence stays reachable from the Journal Entry workspace.</div>
        <p class="muted sm" style="margin:8px 0 0">Compare the neutral empty state, which means &ldquo;no records in scope&rdquo;:</p>
        <div class="empty empty-state state-block state-empty" style="margin-top:8px"><b>No records to display.</b>Adjust the filters above to widen the scope.</div>
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
.preview-toggle{display:inline-flex;align-items:center;gap:8px;margin-top:8px;margin-right:8px;
  min-height:32px;padding:0 12px;border:1px solid #C3CED5;border-radius:6px;
  background:#FFF;color:#21262A;font:500 13px/1 inherit;cursor:pointer;}
/* preview-only: proves the status marks survive with the colour removed */
.preview-grey{filter:grayscale(1);}
body.preview-grey-all .app{filter:grayscale(1);}
</style>
</head>
<body>
<script>
/* preview-only: the static file has no bundle, so it mirrors what
   src/theme-preference.js does at boot - operating system first, and an
   explicit class either way so the prefers-color-scheme rule in the product
   stylesheet has something to stand down for. */
document.body.className = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
</script>
${body}
<div class="preview-note">
  <b>Static preview.</b> Hand-written markup that mirrors what the React shell renders, with the
  product stylesheet inlined verbatim from <code>index.html</code>. Nothing here is interactive
  except the theme toggle. Independent implementation informed by measurement; no QuickBooks
  markup, CSS, icon, image or font asset is used, and no claim of QuickBooks equivalence is made.
  <div><b>Off-canvas drawer.</b> Narrow the window below 1024px and the sidebar slides out of the
  viewport. In the product it also becomes <code>inert</code> at that point, so its 20 controls leave
  the tab order and the accessibility tree instead of sitting invisibly in front of the page - press
  Tab from the address bar and the first stop must be the &#9776; button, never something you cannot
  see. Use &ldquo;Toggle the off-canvas drawer&rdquo; below to see the open state and the same
  inert/aria-hidden pair the React shell writes. Escape closes it and returns focus to &#9776;.</div>
  <div><b>Theme.</b> The theme now follows your operating system on first load, and the &#9790;
  control overrules it for good once you press it. This static preview has no bundle, so use the
  toggle below to compare the two palettes by eye.</div>
  <div><b>Round 3</b> adds, below the dashboard cards: the workflow mark alphabet (with a greyscale copy),
  the three numeric readings with a hover row and a keyboard row side by side, the loading skeleton at the
  geometry of the real table, and the cleared-queue state next to the neutral empty state. To judge the
  motion story, turn on your operating system's &ldquo;reduce motion&rdquo; setting and reload: the skeleton
  sweep must stop completely and every hover tint must become instant.</div>
  <div>
    <button class="preview-toggle" onclick="var d=!document.body.classList.contains('dark');document.body.className=(d?'dark':'light')+(document.body.classList.contains('preview-grey-all')?' preview-grey-all':'')">Toggle dark mode</button>
    <button class="preview-toggle" onclick="document.body.classList.toggle('preview-grey-all')">Toggle greyscale</button>
    <button class="preview-toggle" onclick="var a=document.getElementById('primary-navigation'),o=a.classList.toggle('mobile-open'),b=document.querySelector('.mobile-nav-btn');if(o){a.removeAttribute('inert');a.removeAttribute('aria-hidden');}else{a.setAttribute('inert','');a.setAttribute('aria-hidden','true');}b.setAttribute('aria-expanded',String(o));">Toggle the off-canvas drawer</button>
  </div>
</div>
</body>
</html>
`;

mkdirSync(resolve(root, 'docs/preview'), { recursive: true });
writeFileSync(resolve(root, 'docs/preview/shell-preview.html'), out, 'utf8');
console.log('wrote docs/preview/shell-preview.html');
