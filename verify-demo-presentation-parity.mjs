import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const demoShell = read('src/legacy-demo-app.jsx');
const demoDashboard = read('src/modules-core.jsx');
const authorityApp = read('src/authoritative-app.jsx');
const authorityShell = read('src/authoritative-navigation-shell.jsx');
const authorityTopbar = read('src/authoritative-topbar.jsx');
const authorityOverview = read('src/authoritative-overview.jsx');
const authorityApAr = read('src/authoritative-demo-ap-ar-view.jsx');
const authorityView = read('src/authoritative-demo-view.jsx');
const styles = read('index.html');

const has = (source, value, message) => assert.ok(source.includes(value), message || `missing ${value}`);
const forbid = (source, pattern, message) => assert.doesNotMatch(source, pattern, message);

// The production root owns state and API/OIDC calls only.  Its visual shell
// must be supplied by the extracted demo presentation boundaries.
has(authorityApp, "from './authoritative-navigation-shell.jsx'", 'authoritative root must mount the shared demo-derived navigation shell');
has(authorityApp, "from './authoritative-topbar.jsx'", 'authoritative root must mount the authoritative topbar');
has(authorityApp, '<AuthoritativeNavigationShell', 'authoritative root must use the shared navigation presentation');
has(authorityApp, '<AuthoritativeTopbar', 'authoritative root must use the shared topbar presentation');
forbid(authorityApp, /from ['"]\.\/legacy-demo-app/, 'the runtime must never import the demo controller');

// These identifiers are the demo's actual shell hierarchy, not a separately
// designed authority replacement.  Keeping them together catches a future
// split into an unrelated rail, panel, or header surface.
for (const token of ['className="app"', 'sidebar ${mobileNav', 'className="nav-rail"', 'className="nav-panel"', 'className="brand"', 'className="new-btn', 'className="topbar"', 'className="content"']) {
  has(demoShell, token, `demo shell baseline must retain ${token}`);
}
for (const token of ['sidebar authoritative-sidebar', 'className="nav-rail"', 'className="nav-panel"', 'className="brand"', 'className="new-btn authoritative-new-disabled"']) {
  has(authorityShell, token, `authority navigation must retain demo shell structure: ${token}`);
}
for (const token of ['className="topbar authoritative-topbar"', 'className="top-right authoritative-top-actions"', 'className="period-chip authoritative-period-chip"', 'className="user-chip authoritative-user-chip"']) {
  has(authorityTopbar, token, `authority topbar must retain demo shell structure: ${token}`);
}

// Dashboard and AP/AR must continue to use the exact class hierarchy already
// exercised by the complete demonstration UI.  The values and actions may be
// different (they are API/OIDC-owned), but the presentational contract is one.
for (const token of ['className="qb-home"', 'className="qbo-home-hero"', 'className="qbo-quicklinks"', 'className="qbo-grid"']) {
  has(demoDashboard, token, `demo dashboard baseline must retain ${token}`);
  has(authorityOverview, token.replace('className="', '').replace('"', ''), `authority overview must reuse ${token}`);
}
for (const token of ['className={`accounting-page-head', 'className="page-eyebrow"', 'className="page-h"', 'className="page-subtitle"', 'className="kpi-row"', 'className="tabs"']) {
  has(authorityApAr, token, `authority AP/AR must retain demo hierarchy: ${token}`);
}
// The copied presentation modules are slots only: no demo data, browser
// persistence, repository, or controller can leak into the authority bundle.
for (const [name, source] of Object.entries({authorityShell, authorityTopbar, authorityOverview, authorityApAr, authorityView})) {
  forbid(source, /legacy-demo-app|seed\.js|repo\.js|data\.js|localStorage/, `${name} must remain presentation-only`);
}
forbid(authorityTopbar, /disabled|Search or jump|Help is unavailable|Notifications are unavailable/, 'the authoritative toolbar must not retain inert demo controls');

// One CSS vocabulary supplies both products.  Each shared class must have its
// canonical definition in the common stylesheet; authority-only variants may
// add data-state affordances but may not replace the structural classes.
// qb-home is a semantic page hook in both trees; its visual geometry is
// provided by the nested demo qbo-* selectors below, so it intentionally has
// no standalone CSS declaration to duplicate.
for (const selector of ['app', 'sidebar', 'nav-rail', 'nav-panel', 'topbar', 'content', 'qbo-home-hero', 'qbo-quicklinks', 'qbo-grid', 'accounting-page-head', 'kpi-row', 'tabs']) {
  assert.match(styles, new RegExp(`\\.${selector}(?:[\\s,:{>])`), `shared presentation stylesheet must define .${selector}`);
}

console.log('demo presentation parity: authority root uses the demo-derived shell, dashboard, and AP/AR class hierarchy without demo state');
