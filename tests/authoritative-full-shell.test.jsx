import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTHORITATIVE_API_ROUTES, AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES } from '../src/authoritative-navigation.js';
import { AuthoritativeNavigationShell } from '../src/authoritative-navigation-shell.jsx';
import { AuthoritativeDemoTopbar } from '../src/authoritative-demo-shell.jsx';
import { AuthoritativeDemoView, AuthoritativeDemoWorkspaceHeader } from '../src/authoritative-demo-view.jsx';
import { AuthoritativeUnavailableWorkspace } from '../src/authoritative-unavailable-workspace.jsx';

assert.ok(AUTHORITATIVE_NAVIGATION.length >= 10, 'the production catalog keeps the complete major workspace taxonomy discoverable');
assert.ok(AUTHORITATIVE_ROUTES.includes('project-cost-cwip'));
assert.ok(AUTHORITATIVE_ROUTES.includes('ai-audit'));
assert.deepEqual([...AUTHORITATIVE_API_ROUTES].sort(), ['account-inquiry', 'amortization', 'bank', 'chart-of-accounts', 'consolidation', 'construction-loan', 'general-ledger', 'intercompany', 'journals', 'overview', 'payables', 'project-cost-cwip', 'receivables', 'reconciliation', 'reports', 'source-documents', 'wbs-autorec-evidence'].sort());
assert.equal(new Set(AUTHORITATIVE_ROUTES).size, AUTHORITATIVE_ROUTES.length, 'each catalog route must be stable and unique');
const navMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="bank" expandedGroup="Auto Reconciliation" navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
const reportNavMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="reports" expandedGroup="Reports" navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
assert.match(navMarkup, /Control Center/); assert.match(navMarkup, /Accounting Operations/); assert.match(reportNavMarkup, /Reports/);
assert.match(navMarkup, /nav-rail/); assert.match(navMarkup, /nav-panel/);
assert.match(navMarkup, /API/); assert.match(navMarkup, /Unavailable/);
assert.match(navMarkup, /nav-rail/); assert.match(navMarkup, /nav-panel/);
assert.match(navMarkup, /No authorised create action is available in this workspace/);
assert.match(navMarkup, /aria-label="Accounting workspace groups"/);
const topbarMarkup = renderToStaticMarkup(<AuthoritativeDemoTopbar navOpen={false} entityLabel="WBHO WB Home LLC" periodLabel="2026-07" theme="light" navOpenerRef={{current:null}} onOpenNavigation={() => {}} onRefresh={() => {}} onToggleTheme={() => {}} onSignOut={() => {}}/>);
assert.match(topbarMarkup, /WBHO WB Home LLC/);
assert.match(topbarMarkup, /Search or jump/, 'the authoritative topbar must retain the demo command-slot geometry');
assert.match(topbarMarkup, /Search is unavailable until an authorised server-backed discovery contract exists/,
  'the visually retained command slot must fail closed until an API contract exists');
assert.match(topbarMarkup, /Period/);
assert.match(topbarMarkup, /Authoritative/);
assert.match(topbarMarkup, /Authenticated/);
assert.doesNotMatch(fs.readFileSync('src/authoritative-demo-shell.jsx', 'utf8'), /seed\.js|repo\.js|localStorage|legacy-demo-app/,
  'the copied visual shell must accept authoritative slots only');
const demoViewMarkup = renderToStaticMarkup(<AuthoritativeDemoView area="Reports"><AuthoritativeDemoWorkspaceHeader eyebrow="AUTHORITATIVE | REPORTING" title="Reports center" description="API-backed report facts only."/><div>API-owned report content</div></AuthoritativeDemoView>);
assert.match(demoViewMarkup, /Reports workspace/);
assert.match(demoViewMarkup, /AUTHORITATIVE \| REPORTING/);
assert.match(demoViewMarkup, /API-owned report content/);
const demoViewSource = fs.readFileSync('src/authoritative-demo-view.jsx', 'utf8');
assert.doesNotMatch(demoViewSource, /seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js/,
  'the reusable demo presentation frame must not import or persist demonstration accounting state');
const unavailableMarkup = renderToStaticMarkup(<AuthoritativeUnavailableWorkspace item={{label:'Source Documents',requirements:['Entity-scoped source-document list and immutable detail endpoints.','Separate authorised attachment-read contract.']}} config={{entityId:'entity-1',periodId:'period-1'}}/>);
assert.match(unavailableMarkup, /Source Documents is not available/);
assert.match(unavailableMarkup, /No browser-stored or substitute data is shown/);
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
assert.match(appSource, /route === 'construction-loan'/, 'Construction Loan must mount its existing API rollforward rather than a demo route');
assert.match(appSource, /route === 'amortization'/, 'Amortization Center must mount its existing API prepaid rollforward rather than a demo route');
assert.match(appSource, /Loan register, lender, commitment, and draw-management workflows remain unavailable/, 'the construction-loan reader must not overstate unavailable operational contracts');
assert.match(appSource, /Schedule authoring, posting, and browser-local amortization calculations remain unavailable/, 'the amortization reader must not recreate a browser-side accounting workflow');
assert.match(appSource, /route === 'intercompany'/, 'Intercompany must mount its existing two-entity API evidence reader rather than a demo route');
assert.match(appSource, /route === 'consolidation'/, 'Consolidation must mount existing snapshot evidence rather than a browser workbook');
assert.match(appSource, /Elimination, adjustment, and intercompany posting workflows remain unavailable/, 'the intercompany surface must not overstate unavailable posting contracts');
assert.match(appSource, /Elimination creation, group maintenance, and browser-side consolidation workbooks remain unavailable/, 'the consolidation surface must not recreate a browser-side workbook');
assert.match(appSource, /AuthoritativeWbsTransitionWorkspace/, 'WBS evidence must mount an API-backed signed-contract verifier, not a demo workspace');
assert.match(appSource, /authoritative-topbar/, 'the formal app must use the complete workbench-style top bar rather than the old title-only header');
assert.match(appSource, /AuthoritativeDemoTopbar/, 'the production app must reuse the complete demonstration topbar structure rather than reimplement a divergent header');
assert.match(appSource, /Authoritative entity \$\{config\.entityId\}/, 'the top bar must expose the configured API entity as scope, not a local selector');
assert.match(appSource, /Authoritative period \$\{config\.periodId\}/, 'the top bar must expose the configured API period as scope');
assert.match(appSource, /Refresh authoritative accounting evidence/, 'the top-bar refresh control must name its real GET-only outcome');
assert.match(appSource, /Authenticated OIDC session/, 'the user chip must describe an authenticated session without fabricating a demo user');
assert.match(appSource, /onClick=\{logout\}>Sign out/, 'the visual shell keeps the real OIDC sign-out command');
const styles = fs.readFileSync('index.html', 'utf8');
assert.match(styles, /\.authoritative-entity-chip\{/, 'the authoritative entity scope needs the complete-shell selector treatment');
assert.match(styles, /\.authoritative-mode-chip\{/, 'the top bar must disclose authoritative mode rather than demonstration mode');
assert.match(styles, /@media \(max-width:1180px\) and \(min-width:769px\)/, 'the demo shell must release its rail before evidence is squeezed on narrow desktops');
console.log('authoritative full shell: complete catalog renders API routes and unavailable workspaces fail closed');
