import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTHORITATIVE_API_ROUTES, AUTHORITATIVE_NAVIGATION, AUTHORITATIVE_ROUTES } from '../src/authoritative-navigation.js';
import { AuthoritativeNavigationShell } from '../src/authoritative-navigation-shell.jsx';
import { AuthoritativeTopbar } from '../src/authoritative-topbar.jsx';
import { AuthoritativeAccessStatus } from '../src/authoritative-access-status.jsx';
import { AuthoritativeWorkspaceView, AuthoritativeWorkspaceHeader } from '../src/authoritative-workbench-view.jsx';
import { AuthoritativeUnavailableWorkspace } from '../src/authoritative-unavailable-workspace.jsx';
import { watchRetainedRoute } from '../src/authoritative-app.jsx';

assert.ok(AUTHORITATIVE_NAVIGATION.length >= 10, 'the production catalog keeps the complete major workspace taxonomy discoverable');
assert.ok(AUTHORITATIVE_ROUTES.includes('project-cost-cwip'));
assert.ok(AUTHORITATIVE_ROUTES.includes('ai-audit'));
assert.deepEqual([...AUTHORITATIVE_API_ROUTES].sort(), ['account-inquiry', 'ai-audit', 'amortization', 'bank', 'bank-batch-pipeline', 'chart-of-accounts', 'consolidation', 'construction-loan', 'general-ledger', 'intercompany', 'journals', 'overview', 'payables', 'project-cost-cwip', 'property-ops-pickup', 'receivables', 'reconciliation', 'reports', 'source-documents', 'unit-cost-ledger', 'wbs-autorec-evidence', 'wbs-payable-review'].sort());
assert.equal(new Set(AUTHORITATIVE_ROUTES).size, AUTHORITATIVE_ROUTES.length, 'each catalog route must be stable and unique');
const navMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="bank" expandedGroups={['Auto Reconciliation','Source & Staging']} navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
const reportNavMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="reports" expandedGroups={['Reports']} navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
const routeWinsMarkup = renderToStaticMarkup(<AuthoritativeNavigationShell navigation={AUTHORITATIVE_NAVIGATION} route="wbs-autorec-evidence" expandedGroups={['General Ledger']} navOpen={false} drawerAttributes={{}} onSelectGroup={() => {}} onSelectItem={() => {}} onClose={() => {}}/>);
assert.match(navMarkup, /Control Center/); assert.match(navMarkup, /Accounting Operations/); assert.match(reportNavMarkup, /Reports/);
assert.match(navMarkup, /nav-rail/); assert.match(navMarkup, /nav-panel/);
assert.match(navMarkup, /Bank transaction matching/); assert.match(navMarkup, /aria-label="Auto Reconciliation"/);
assert.match(navMarkup, /Source Documents/, 'multiple selected workspace groups remain open at once');
assert.doesNotMatch(navMarkup, />API</); assert.doesNotMatch(navMarkup, />Unavailable</);
assert.match(navMarkup, /nav-rail/); assert.match(navMarkup, /nav-panel/);
assert.doesNotMatch(navMarkup, /authoritative-new-disabled|\+ New/);
assert.match(navMarkup, /aria-label="Accounting workspace groups"/);
assert.match(routeWinsMarkup, /<span>Auto Reconciliation<\/span>/,
  'the current route must select its navigation group even when an old expanded group remains');

const routeListeners = new Map();
const routeEnvironment = {
  location:{hash:'#/bank'},
  addEventListener:(name,listener)=>routeListeners.set(name,listener),
  removeEventListener:(name,listener)=>{ if(routeListeners.get(name)===listener) routeListeners.delete(name); },
};
let mountedRoute='bank';
const stopWatchingRoute=watchRetainedRoute(routeEnvironment,next=>{ mountedRoute=next; });
assert.equal(routeListeners.has('hashchange'),true,'a mounted authoritative app must subscribe to browser hash navigation');
routeEnvironment.location.hash='#/wbs-autorec-evidence';routeListeners.get('hashchange')();
assert.equal(mountedRoute,'wbs-autorec-evidence','mounted Bank must switch to WBS when the known hash changes');
routeEnvironment.location.hash='#/unknown-authoritative-route';routeListeners.get('hashchange')();
assert.equal(mountedRoute,'wbs-autorec-evidence','an unknown hash must fail closed without changing the mounted workspace');
stopWatchingRoute();
assert.equal(routeListeners.has('hashchange'),false,'the authoritative app must remove its hash listener on unmount');
const topbarMarkup = renderToStaticMarkup(<AuthoritativeTopbar navOpen={false} entityLabel="WBHO WB Home LLC" periodLabel="2026-07" theme="light" navOpenerRef={{current:null}} onOpenNavigation={() => {}} onRefresh={() => {}} onToggleTheme={() => {}} onSignOut={() => {}}/>);
assert.match(topbarMarkup, /WBHO WB Home LLC/);
assert.doesNotMatch(topbarMarkup, /Search or jump|Help is unavailable|Notifications are unavailable|disabled=/,
  'the authoritative topbar must not render inert product controls');
assert.match(topbarMarkup, /Period/);
assert.match(topbarMarkup, /Authoritative/);
assert.match(topbarMarkup, /Authenticated/);
const accessRow={tenant_id:'55555555-5555-4555-8555-555555555555',entity_id:'11111111-1111-4111-8111-111111111111',actor_id:'auth0|current-user',grant_set_version:7,permissions:['AP.VIEW','WBS.PAYABLE.REVIEW'],configured_permissions:['AP.VIEW','GL.REPORT.VIEW','WBS.PAYABLE.REVIEW'],session_refresh_required:true};
const accessMarkup=renderToStaticMarkup(<AuthoritativeAccessStatus state={{status:'READY',row:accessRow}}/>);
assert.match(accessMarkup,/Access<\/b> Changed - sign in again/);
assert.match(accessMarkup,/AP\.VIEW, WBS\.PAYABLE\.REVIEW/);
assert.match(accessMarkup,/GL\.REPORT\.VIEW/);
assert.match(accessMarkup,/Grant revision/);
assert.match(accessMarkup,/Technical scope/);
const accessErrorMarkup=renderToStaticMarkup(<AuthoritativeAccessStatus state={{status:'ERROR',code:'AUTHORIZATION_DENIED',message:'Denied'}}/>);
assert.match(accessErrorMarkup,/diagnostic read failure, not an empty permission set/);
const accessEmptyMarkup=renderToStaticMarkup(<AuthoritativeAccessStatus state={{status:'READY',row:{...accessRow,permissions:[],configured_permissions:[],session_refresh_required:false}}}/>);
assert.match(accessEmptyMarkup,/Session permissions current/);assert.match(accessEmptyMarkup,/None in this session/);assert.match(accessEmptyMarkup,/None configured/);
assert.match(renderToStaticMarkup(<AuthoritativeAccessStatus state={{status:'LOADING'}}/>),/Checking current session/);
assert.doesNotMatch(fs.readFileSync('src/authoritative-topbar.jsx', 'utf8'), /seed\.js|repo\.js|localStorage|legacy-demo-app|disabled/,
  'the authoritative shell must accept API/OIDC slots only and expose no inert actions');
const workspaceViewMarkup = renderToStaticMarkup(<AuthoritativeWorkspaceView area="Reports"><AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE | REPORTING" title="Reports center" description="API-backed report facts only."/><div>API-owned report content</div></AuthoritativeWorkspaceView>);
assert.match(workspaceViewMarkup, /Reports workspace/);
assert.match(workspaceViewMarkup, /AUTHORITATIVE \| REPORTING/);
assert.match(workspaceViewMarkup, /API-owned report content/);
const workspaceViewSource = fs.readFileSync('src/authoritative-workbench-view.jsx', 'utf8');
assert.doesNotMatch(workspaceViewSource, /seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js/,
  'the reusable authoritative presentation frame must not import or persist local accounting state');
const unavailableMarkup = renderToStaticMarkup(<AuthoritativeUnavailableWorkspace item={{label:'Source Documents',requirements:['Entity-scoped source-document list and immutable detail endpoints.','Separate authorised attachment-read contract.']}} config={{entityId:'entity-1',periodId:'period-1'}}/>);
assert.doesNotMatch(unavailableMarkup, /Entity-scoped source-document list|attachment-read contract/,
  'customer-facing setup pages must not expose implementation contracts');
assert.match(unavailableMarkup, /Your finance administrator/);
assert.match(unavailableMarkup, /For now:/);
assert.match(unavailableMarkup, /Source Documents is being prepared/);
assert.match(unavailableMarkup, /Nothing to review here yet/);
assert.match(unavailableMarkup, /What happens next/);
assert.doesNotMatch(unavailableMarkup, /SETUP REQUIRED|SETUP NEEDED/);
assert.doesNotMatch(unavailableMarkup, /localStorage|seed\.js|Create/);
const appSource = fs.readFileSync('src/authoritative-app.jsx', 'utf8');
assert.match(appSource,/refreshCurrentActorAccess\(\{config,fetcher:boundFetcher\}\)/,'READY shell must read the current authenticated actor through the self-only API');
assert.match(appSource,/AuthoritativeAccessStatus state=\{accessState\}/,'the entity and period scope bar must expose the current session access diagnostic');
assert.doesNotMatch(fs.readFileSync('src/authoritative-access-status.jsx','utf8'),/activateAuthoritative|reconcileActorGrant|revokeActor|localStorage|sessionStorage|fetch\(/,'the access status is presentation-only and cannot grant, revoke, persist, or fetch authority');
const firstConditionalRender=appSource.indexOf("if (!configured) return");
for(const scopeHook of [
  'useEffect(()=>{let current=true;if(phase!==\'READY\')',
  'const scopePresentation=useMemo(',
  'const displayConfig=useMemo('
])assert.ok(appSource.indexOf(scopeHook)>0&&appSource.indexOf(scopeHook)<firstConditionalRender,`${scopeHook} must execute before every conditional render so OIDC phase changes cannot alter the React hook order`);
assert.match(appSource, /Accounting records are read only from the authenticated API in this mode/,
  'the sign-in surface must describe the sole authoritative source of accounting records');
assert.match(appSource, /display name not returned by API/,
  'a missing entity display name must be explained without promoting its internal UUID to primary text');
assert.match(appSource, /period details not returned by API/,
  'a missing period label must be explained without presenting an internal ID as the period');
assert.doesNotMatch(appSource, /No demo identity/,
  'the authoritative sign-in surface must not expose retired product terminology');
const runtimeErrorSource = fs.readFileSync('src/runtime-error-page.jsx', 'utf8');
assert.match(runtimeErrorSource, /No browser-stored or substitute data is shown in place of accounting data/,
  'runtime errors must describe the fail-closed data boundary without a second product label');
assert.doesNotMatch(runtimeErrorSource, /public demonstration build|demonstration data set|No demonstration or browser-stored data/,
  'runtime errors must not present a retired product surface to authoritative users');
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
assert.match(appSource, /AuthoritativeDocumentWorkspace[\s\S]*?kind="AP"[\s\S]*?config=\{displayConfig\}/,
  'the embedded WBS Payables observation must receive the same readable scope presentation as the authoritative shell');
assert.match(appSource, /route === 'ai-audit'[\s\S]*?AuthoritativeAiAuditWorkspace[\s\S]*?config=\{displayConfig\}/,
  'AI Audit must receive the authoritative entity and period presentation rather than expose raw scope IDs');
assert.match(appSource, /route === 'wbs-autorec-evidence'[\s\S]*?AuthoritativeWbsTransitionWorkspace[\s\S]*?config=\{displayConfig\}/,
  'WBS evidence must receive the authoritative entity display name from the scope reader');
assert.match(appSource, /route === 'reports'[\s\S]*?AuthoritativeReportsWorkspace[\s\S]*?config=\{displayConfig\}/,
  'Reports and drill-back context must retain authoritative human-readable scope labels');
assert.match(appSource, /route === 'project-cost-cwip'/, 'Project Cost & CWIP must mount existing authenticated report readers rather than an unavailable demo route');
assert.match(appSource, /route === 'unit-cost-ledger'/, 'Unit Cost Ledger must mount the authenticated Unit profitability reader rather than an unavailable demo route');
assert.match(appSource, /initialDimensionType="UNIT"/, 'Unit Cost Ledger must require exact Unit-scoped POSTED ledger evidence');
assert.match(appSource, /route === 'property-ops-pickup'/, 'Property Ops Pickup must mount the authenticated Property P&L reader rather than an unavailable demo route');
assert.match(appSource, /Property operating P&amp;L/, 'Property Ops Pickup must identify its read-only Property P&L scope');
assert.match(appSource, /initialDimensionType="PROJECT"/, 'the direct Project Cost & CWIP entry must default only its existing API-backed profitability reader to Project');
assert.match(appSource, /Cost-code, vendor, and project transaction registers remain unavailable/, 'the direct workspace may not pretend that the legacy transaction register has an API contract');
assert.match(appSource, /route === 'construction-loan'/, 'Construction Loan must mount its existing API rollforward rather than a demo route');
assert.match(appSource, /route === 'amortization'[\s\S]*?AuthoritativeAmortizationWorkspace[\s\S]*?config=\{config\}/, 'Amortization Center must mount its server-backed coverage and schedule evidence workspace rather than a demo route');
assert.match(appSource, /Loan register, lender, commitment, and draw-management workflows remain unavailable/, 'the construction-loan reader must not overstate unavailable operational contracts');
assert.doesNotMatch(fs.readFileSync('src/authoritative-amortization-workspace.jsx','utf8'), /localStorage|seed\.js|repo\.js|legacy-demo-app|module-amortization-accrual/i, 'the amortization reader must not recreate a browser-side accounting workflow');
assert.match(appSource, /route === 'intercompany'/, 'Intercompany must mount its existing two-entity API evidence reader rather than a demo route');
assert.match(appSource, /route === 'consolidation'/, 'Consolidation must mount existing snapshot evidence rather than a browser workbook');
assert.match(appSource, /Elimination, adjustment, and intercompany posting workflows remain unavailable/, 'the intercompany surface must not overstate unavailable posting contracts');
assert.match(appSource, /Elimination creation, group maintenance, and browser-side consolidation workbooks remain unavailable/, 'the consolidation surface must not recreate a browser-side workbook');
assert.match(appSource, /AuthoritativeWbsTransitionWorkspace/, 'WBS evidence must mount an API-backed signed-contract verifier, not a demo workspace');
assert.match(appSource, /AuthoritativeWbsPayableReviewWorkspace/, 'WBS Payable Review must mount the signed-and-admitted evidence queue rather than an unavailable or browser-backed route');
assert.match(appSource, /AuthoritativeAiAuditWorkspace/, 'AI Audit Center must mount the authenticated server-backed finding reader rather than a browser-backed audit model');
assert.match(appSource, /route === 'ai-audit'/, 'AI Audit Center must mount at its stable authoritative route');
assert.match(appSource, /'ai-audit','wbs-autorec-evidence'/, 'AI Audit Center must not fall through to the unavailable workspace after mounting');
assert.match(appSource, /route === 'wbs-payable-review'/, 'the WBS Payable Review entry must have a stable authoritative route');
assert.match(appSource, /AuthoritativeBankBatchPipelineWorkspace/, 'Bank Batch Pipeline must compose existing authoritative Bank and Reconciliation readers rather than fail closed as an unavailable route');
assert.match(appSource, /route === 'bank-batch-pipeline'/, 'the API-backed Bank Batch Pipeline must mount at its stable navigation route');
assert.match(appSource, /authoritative-topbar/, 'the formal app must use the complete workbench-style top bar rather than the old title-only header');
assert.match(appSource, /AuthoritativeTopbar/, 'the production app must use the dedicated authoritative topbar');
assert.match(appSource, /Authoritative entity \$\{config\.entityId\}/, 'the top bar must expose the configured API entity as scope, not a local selector');
assert.match(appSource, /Authoritative period \$\{config\.periodId\}/, 'the top bar must expose the configured API period as scope');
assert.match(appSource, /Refresh authoritative accounting evidence/, 'the top-bar refresh control must name its real GET-only outcome');
assert.match(appSource, /Authenticated OIDC session/, 'the user chip must describe an authenticated session without fabricating a demo user');
assert.match(appSource, /onClick=\{logout\}>Sign out/, 'the visual shell keeps the real OIDC sign-out command');
const styles = fs.readFileSync('index.html', 'utf8');
assert.match(styles, /\.authoritative-entity-chip\{/, 'the authoritative entity scope needs the complete-shell selector treatment');
assert.match(styles, /\.authoritative-mode-chip\{/, 'the top bar must disclose authoritative mode rather than demonstration mode');
assert.match(styles, /@media \(max-width:900px\) and \(min-width:769px\)/, 'the authoritative shell must release its rail only at tablet widths');
console.log('authoritative full shell: complete catalog renders API routes and unavailable workspaces fail closed');
