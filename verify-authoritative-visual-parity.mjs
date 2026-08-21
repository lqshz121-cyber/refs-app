import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8');
const css = read('index.html');
const app = read('src/authoritative-app.jsx');
const nav = read('src/authoritative-navigation-shell.jsx');
const topbar = read('src/authoritative-topbar.jsx');
const overview = read('src/authoritative-overview.jsx');
const documents = read('src/authoritative-workspace.jsx');
const bank = read('src/authoritative-bank-workspace.jsx');
const reports = read('src/authoritative-reports-workspace.jsx');
const journals = read('src/authoritative-journal-workspace.jsx');
const sourceDocuments = read('src/authoritative-source-documents-workspace.jsx');
const coa = read('src/authoritative-coa-register-workspace.jsx');
const ledger = read('src/authoritative-general-ledger-workspace.jsx');

const contains = (source, token, message) => assert.ok(source.includes(token), message || `missing ${token}`);
const matches = (source, pattern, message) => assert.match(source, pattern, message);

// Desktop contract — 1440px and above.  The authority runtime must keep the
// same measured shell geometry as the complete demonstration rather than
// collapsing into a bespoke admin rail.
for (const token of ['--qb-rail-w:74px;', '--qb-navpanel-w:236px;', '--nav-w:calc(var(--qb-rail-w) + var(--qb-navpanel-w));']) {
  contains(css, token, `desktop shell token missing: ${token}`);
}
matches(css, /\.sidebar\{[\s\S]*?width:var\(--nav-w\); flex:0 0 var\(--nav-w\);[\s\S]*?height:100vh;/,
  'desktop shell must retain the demo rail-and-panel width');
matches(css, /\.nav-rail\{[\s\S]*?flex:0 0 var\(--qb-rail-w\); width:var\(--qb-rail-w\);/,
  'desktop rail must remain a fixed 74px track');
matches(css, /\.nav-panel\{display:flex; flex-direction:column; flex:1 1 auto; min-width:0;/,
  'desktop panel must be the demo shell’s flexible second column');
matches(css, /\.topbar\{[\s\S]*?height:58px; padding:0 24px;/,
  'desktop topbar must retain the demo control rhythm');
matches(css, /\.main\{[\s\S]*?flex:1; min-width:0;[\s\S]*?margin:6px 6px 6px 0;/,
  'desktop canvas must remain shrinkable beside navigation');
matches(css, /\.authoritative-app\{height:100vh;height:100dvh;min-height:0;overflow:hidden;\}/,
  'the authoritative product shell must stay fixed to the visible viewport');
matches(css, /\.authoritative-app \.main\{height:calc\(100vh - 12px\);height:calc\(100dvh - 12px\);min-height:0;overflow:hidden;\}/,
  'the inset authoritative canvas must not grow beyond its visible border');
matches(css, /\.authoritative-app \.content\{flex:1 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-gutter:stable;\}/,
  'long authoritative workspaces must scroll inside the fixed product canvas');
for (const token of ['className="nav-rail"', 'className="nav-panel"', 'className="topbar authoritative-topbar"', 'className="qbo-home-hero"', 'className="qbo-quicklinks"', 'className="qbo-grid"']) {
  contains(`${nav}\n${topbar}\n${overview}`, token, `desktop visual adapter missing ${token}`);
}

// Phone/tablet contract — no squeezed three-column shell, and accounting
// tables stay inside their scroll region rather than widening the page.
matches(css, /@media \(max-width:900px\) and \(min-width:769px\)\{[\s\S]*?\.authoritative-app \.sidebar\{position:fixed;[\s\S]*?transform:translateX\(-100%\);/,
  'tablet authority navigation must leave the canvas before it is squeezed without hiding zoomed desktop navigation');
matches(css, /@media\(max-width:1024px\)\{[\s\S]*?\.sidebar\{position:fixed;[\s\S]*?width:min\(88vw,320px\);/,
  'mobile demo-derived drawer must remain readable and off-canvas');
contains(css, '@media(max-width:720px){', 'phone layout breakpoint must remain defined');
matches(css, /\.authoritative-list-filters\{grid-template-columns:minmax\(0,1fr\);/,
  'phone filters must stack to one column');
matches(css, /\.table-wrap\{[\s\S]*?overflow:auto;/,
  'wide accounting tables must use a contained scroll region');
for (const [name, source] of Object.entries({documents, bank, reports, journals, sourceDocuments, coa, ledger})) {
  contains(source, 'table-wrap', `${name} must retain a contained table region for narrow layouts`);
}
contains(reports, 'aria-label="Report groups"', 'Reports must expose compact vertical report groups');
contains(reports, 'aria-expanded={expanded}', 'Report-group controls must announce the visible group');
contains(reports, 'aria-controls={`authoritative-report-group-${key}`}', 'Report-group controls must identify their full workspace');
contains(reports, '<h2 className="rep-group-heading"', 'each report group must use the observed level-two heading structure');
contains(reports, 'setCollapsedWorkbenchTab(current=>current===key?null:key)', 'an expanded report group must be collapsible without changing report data');
assert.doesNotMatch(reports, /role="tab"|aria-selected=\{workbenchTab===key\}/, 'report groups must not claim unsupported tab keyboard behavior');
matches(css, /\.rep-grid,\.rep-grid-featured\{display:grid;grid-template-columns:minmax\(0,1fr\);/, 'Reports groups must stack vertically instead of scrolling as a horizontal tab strip');
matches(css, /\.rep-card\{display:grid;grid-template-columns:20px minmax\(0,1fr\) 20px;/, 'each Reports group must share the compact icon-label-chevron row');

// Primary API routes must use the extracted presentation boundaries, not a
// second page chrome.  This is visual-only: it does not test API results.
contains(app, '<AuthoritativeOverview', 'overview route must mount the demo-derived dashboard presentation');
contains(documents, "from './authoritative-ap-ar-view.jsx'", 'AP/AR must mount the authoritative workspace presentation');
contains(documents, '<AuthoritativeApArView', 'AP/AR must use the authoritative KPI/tabs hierarchy');
for (const [name, source] of Object.entries({bank, reports, journals, sourceDocuments, coa, ledger})) {
  assert.ok(source.includes('AuthoritativeWorkspaceView') || source.includes('table-wrap'), `${name} must keep the shared visual workspace or contained evidence table`);
}

console.log('authoritative visual parity: desktop rail/panel/topbar/dashboard and mobile drawer/filter/table contracts pass for primary API workspaces');
