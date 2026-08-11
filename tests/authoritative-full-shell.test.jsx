import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTHORITATIVE_API_ROUTES, AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES } from '../src/authoritative-navigation.js';
import { AuthoritativeNavigationShell } from '../src/authoritative-navigation-shell.jsx';
import { AuthoritativeUnavailableWorkspace } from '../src/authoritative-unavailable-workspace.jsx';

assert.ok(AUTHORITATIVE_NAVIGATION.length >= 10, 'the production catalog keeps the complete major workspace taxonomy discoverable');
assert.ok(AUTHORITATIVE_ROUTES.includes('project-cost-cwip'));
assert.ok(AUTHORITATIVE_ROUTES.includes('ai-audit'));
assert.deepEqual([...AUTHORITATIVE_API_ROUTES].sort(), ['account-inquiry', 'bank', 'chart-of-accounts', 'general-ledger', 'journals', 'overview', 'payables', 'project-cost-cwip', 'receivables', 'reconciliation', 'reports', 'source-documents'].sort());
assert.equal(new Set(AUTHORITATIVE_ROUTES).size, AUTHORITATIVE_ROUTES.length, 'each catalog route must be stable and unique');
const navMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="bank" expandedGroup="Auto Reconciliation" navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
const reportNavMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="reports" expandedGroup="Reports" navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
assert.match(navMarkup, /Control Center/); assert.match(navMarkup, /Accounting Operations/); assert.match(reportNavMarkup, /Reports/);
assert.match(navMarkup, /nav-rail/); assert.match(navMarkup, /nav-panel/);
assert.match(navMarkup, /API/); assert.match(navMarkup, /Unavailable/); assert.match(navMarkup, /Workspace/);
assert.match(navMarkup, /aria-label="Accounting workspace groups"/);
const unavailableMarkup = renderToStaticMarkup(<AuthoritativeUnavailableWorkspace item={{label:'Source Documents',requirements:['Entity-scoped source-document list and immutable detail endpoints.','Separate authorised attachment-read contract.']}} config={{entityId:'entity-1',periodId:'period-1'}}/>);
assert.match(unavailableMarkup, /Source Documents is not available/);
assert.match(unavailableMarkup, /No browser or demonstration data is shown/);
assert.match(unavailableMarkup, /Required authoritative read contract/);
assert.match(unavailableMarkup, /attachment-read contract/);
assert.doesNotMatch(unavailableMarkup, /localStorage|seed\.js|Create/);
const appSource = fs.readFileSync('src/authoritative-app.jsx', 'utf8');
assert.match(appSource, /const \[reportsNavigationVersion, setReportsNavigationVersion\] = useState\(0\)/,
  'a direct Reports navigation needs a route-local revision when React would otherwise retain an already-mounted catalog');
assert.match(appSource, /if \(next === 'reports'\) setReportsNavigationVersion\(current => current \+ 1\)/,
  'a direct Reports selection must reset the catalog even when Reports is already the active route');
assert.match(appSource, /key=\{`reports-\$\{workspaceRefreshVersion\}-\$\{reportsNavigationVersion\}`\}/,
  'the reports workspace must consume its direct-navigation revision without creating a browser-side catalog store');
assert.match(appSource, /openReportAgingEvidence/,
  'the Reports shortcut must open the existing API-backed A\/R aging surface rather than a local report implementation');
assert.match(appSource, /initialCatalog=\{reportCatalogReturn\|\|DEFAULT_AUTHORITATIVE_REPORTS_CATALOG\}/,
  'A\/R aging Back must restore the exact Reports catalog without browser storage');
assert.match(appSource, /backLabel="Back to Reports"/,
  'the A\/R aging full page must name its actual Reports parent on Back');
assert.match(appSource, /AuthoritativeGeneralLedgerWorkspace/);
assert.match(appSource, /route === 'project-cost-cwip'/, 'Project Cost & CWIP must mount existing authenticated report readers rather than an unavailable demo route');
assert.match(appSource, /initialDimensionType="PROJECT"/, 'the direct Project Cost & CWIP entry must default only its existing API-backed profitability reader to Project');
assert.match(appSource, /Cost-code, vendor, and project transaction registers remain unavailable/, 'the direct workspace may not pretend that the legacy transaction register has an API contract');
console.log('authoritative full shell: complete catalog renders API routes and unavailable workspaces fail closed');
