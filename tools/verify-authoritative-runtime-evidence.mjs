import {existsSync, readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

export const AUTHORITATIVE_PAGES=Object.freeze({
  Dashboard:['/ap/bills','/ar/invoices','/journal-entries'],
  Payables:['/ap/bills','/ap/adjustments','/ap/aging','/ap/control-totals'],
  Receivables:['/ar/invoices','/ar/adjustments','/ar/aging','/ar/control-totals'],
  Journals:['/journal-entries','/journal-workflow/capabilities'],
  BankBatchPipeline:['/bank/reconciliations/admitted-statements'],
  Bank:['/bank/transactions'],
  Reconciliation:['/bank/reconciliations','/bank/reconciliations/*/worksheet'],
  WbsPayableReview:['/wbs/inbound/payables/review-candidates','/wbs/inbound/payables/reviews'],
  AiAudit:['/ai/findings/wbs-exceptions'],
  WbsAutoRecEvidence:['/wbs/live-pilot','/wbs/auto-reconciliation/review-candidates'],
  Reports:['/reports/financial-statements','/reports/financial-statement-snapshot','/reports/financial-statement-period-comparison','/reports/cash-flow-classification','/reports/cwip-rollforward','/reports/construction-loan-rollforward','/reports/prepaid-rollforward','/reports/budget-vs-actual'],
  ProjectCostCwip:['/reports/dimension-profitability','/reports/cwip-rollforward','/reports/construction-loan-rollforward','/reports/prepaid-rollforward','/reports/budget-vs-actual'],
  UnitLotProfitability:['/reports/dimension-profitability'],
  PropertyOperatingPnl:['/reports/dimension-profitability'],
  ConstructionLoan:['/reports/construction-loan-rollforward'],
  Amortization:['/reports/prepaid-rollforward'],
  Intercompany:['/reports/intercompany-reconciliation'],
  Consolidation:['/reports/consolidation'],
  SourceDocuments:['/source-documents'],
  ChartOfAccounts:['/chart-of-accounts'],
  AccountInquiry:['/account-register'],
  GeneralLedger:['/general-ledger/entries'],
});

const forbidden=/[\p{Script=Han}\uFFFD\u0080-\u009F]/u;
const sha=value=>/^[0-9a-f]{40}$/i.test(String(value||''));
const httpsOrigin=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.origin===url.toString().replace(/\/$/,'')?url.origin:null;}catch{return null;}};
const fail=(code,detail)=>{console.error(`${code}: ${detail}`);process.exitCode=2;return false;};
const readJson=(path,label)=>{if(!existsSync(path))return fail('AUTHORITATIVE_EVIDENCE_MISSING',`${label}=${path}`);try{return JSON.parse(readFileSync(path,'utf8'));}catch{return fail('AUTHORITATIVE_EVIDENCE_INVALID',`${label} is not JSON`);}};
const under=(candidate,root)=>{const file=resolve(candidate),base=resolve(root);return file===base||file.startsWith(`${base}\\`)||file.startsWith(`${base}/`);};
const requiredPathMatches=(pathname,requiredPath)=>{
  if(!requiredPath.includes('*'))return pathname.endsWith(requiredPath);
  const escaped=requiredPath.split('*').map(part=>part.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('[^/]+');
  return new RegExp(`${escaped}$`).test(pathname);
};

export function verifyAuthoritativeRuntimeEvidence(environment=process.env){
  const manifestPath=String(environment.REFS_AUTHORITATIVE_E2E_MANIFEST||'').trim();
  const expectedSha=String(environment.REFS_RELEASE_SHA||'').trim();
  if(!manifestPath||!sha(expectedSha))return fail('AUTHORITATIVE_GATE_CONFIG_MISSING','REFS_AUTHORITATIVE_E2E_MANIFEST and a full REFS_RELEASE_SHA are required');
  const manifest=readJson(resolve(manifestPath),'manifest');if(!manifest)return false;
  const evidenceRoot=resolve(manifestPath,'..');
  if(manifest.schema!=='refs.authoritative-runtime-evidence/v1'||manifest.frozen_sha!==expectedSha||manifest.worktree_clean!==true)return fail('AUTHORITATIVE_SHA_OR_CLEAN_INVALID','manifest must bind the exact clean frozen SHA');
  const webOrigin=httpsOrigin(manifest.web_origin),apiOrigin=httpsOrigin(manifest.api_origin);
  if(!webOrigin||!apiOrigin||webOrigin===apiOrigin)return fail('AUTHORITATIVE_ORIGIN_INVALID','distinct HTTPS web and API origins are required');
  const stamp=manifest.build_stamp||{};
  if(stamp.sha!==expectedSha&&stamp.sha!==expectedSha.slice(0,7))return fail('AUTHORITATIVE_BUILD_STAMP_MISMATCH','live build stamp does not identify the frozen SHA');
  if(stamp.channel!=='AUTHORITATIVE'||stamp.authoritative!==true)return fail('AUTHORITATIVE_BUILD_CHANNEL_INVALID','build stamp must be authoritative');
  if(manifest.runtime_mode!=='REQUIRES_AUTHORITATIVE_API'||manifest.demo_fallback_possible!==false)return fail('AUTHORITATIVE_RUNTIME_MODE_INVALID','runtime must require the API and forbid demo fallback');
  const apiRelease=manifest.api_release||{};
  if(apiRelease.status!==200||apiRelease.release!==expectedSha)return fail('AUTHORITATIVE_API_RELEASE_MISMATCH','the API readiness receipt must identify the exact frozen SHA');

  const oidc=manifest.oidc||{},renewal=oidc.renewal||{};
  if(manifest.authenticated!==true||!httpsOrigin(oidc.issuer)||!oidc.audience||!oidc.subject)return fail('AUTHORITATIVE_OIDC_INCOMPLETE','authenticated issuer, audience and subject evidence are required');
  if(renewal.verified!==true||renewal.mode!=='prompt_none_pkce'||renewal.subject_before!==oidc.subject||renewal.subject_after!==oidc.subject||!renewal.token_hash_before||!renewal.token_hash_after||renewal.token_hash_before===renewal.token_hash_after||!(Number(renewal.expires_at_after)>Number(renewal.expires_at_before)))return fail('AUTHORITATIVE_OIDC_RENEWAL_INCOMPLETE','subject-bound prompt=none PKCE renewal with a later expiry is required');

  const smoke=manifest.api_smoke||{};
  if(smoke.base_url!==apiOrigin||smoke.authenticated_status!==200||smoke.anonymous_status!==401||![403,404].includes(smoke.cross_entity_status)||![403,404].includes(smoke.cross_tenant_status))return fail('AUTHORITATIVE_API_SMOKE_INCOMPLETE','authenticated 200, anonymous 401, and cross-scope denial evidence are required');
  const refresh=manifest.refresh||{};
  if(refresh.performed!==true||refresh.subject_before!==oidc.subject||refresh.subject_after!==oidc.subject||refresh.route_before!==refresh.route_after||!AUTHORITATIVE_PAGES[refresh.route_after]||!(Number(refresh.api_gets_after)>0))return fail('AUTHORITATIVE_REFRESH_INCOMPLETE','refresh must retain identity and route and perform a fresh API GET');

  for(const [page,requiredPaths] of Object.entries(AUTHORITATIVE_PAGES)){
    const row=manifest.pages?.[page];
    if(!row||row.authenticated!==true||row.web_origin!==webOrigin||row.api_origin!==apiOrigin)return fail('AUTHORITATIVE_PAGE_INCOMPLETE',page);
    const screenshot=String(row.screenshot||''),visibleText=String(row.visible_text||''),networkFile=String(row.network_log||'');
    if(!under(screenshot,evidenceRoot)||!under(visibleText,evidenceRoot)||!under(networkFile,evidenceRoot)||![screenshot,visibleText,networkFile].every(existsSync))return fail('AUTHORITATIVE_ARTIFACT_INVALID',`${page} artifacts must exist under the manifest directory`);
    const text=readFileSync(visibleText,'utf8');
    if(!text.trim()||forbidden.test(text)||/LOCAL_MOCK|DEMO_DATA_ONLY|Observed QBO/i.test(text))return fail('AUTHORITATIVE_VISIBLE_TEXT_INVALID',page);
    const network=readJson(networkFile,`${page}.network_log`);if(!Array.isArray(network))return false;
    const successfulGets=network.filter(entry=>entry?.method==='GET'&&entry?.status===200&&typeof entry.url==='string'&&entry.url.startsWith(`${apiOrigin}/api/v1/entities/`)&&entry.authenticated===true);
    if(!requiredPaths.every(path=>successfulGets.some(entry=>requiredPathMatches(new URL(entry.url).pathname,path))))return fail('AUTHORITATIVE_PAGE_API_READ_MISSING',`${page}: ${requiredPaths.join(',')}`);
  }
  const pageCount=Object.keys(AUTHORITATIVE_PAGES).length;
  console.log(`authoritative-runtime-e2e: ${pageCount}/${pageCount} pages, OIDC renewal, API scope and refresh evidence verified at ${expectedSha}`);
  return true;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!verifyAuthoritativeRuntimeEvidence())process.exitCode||=1;
}
