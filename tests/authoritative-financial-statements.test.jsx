import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {refreshAuthoritativeConsolidation,refreshAuthoritativeFinancialStatementPeriodComparison,refreshAuthoritativeFinancialStatementSnapshot,refreshAuthoritativeFinancialStatements} from '../src/accounting-api.js';
import {AuthoritativeFullStatementReport,AuthoritativeReportDetail,AuthoritativeReportsWorkspace,DimensionProfitabilitySummary,FinancialStatementSummary,DEFAULT_AUTHORITATIVE_REPORTS_CATALOG,authoritativeReportLineageConfig,findAuthoritativePropertyReportShortcuts,findAuthoritativeReportShortcuts,normalizeAuthoritativeReportsCatalog,restoreAuthoritativeReportTablePosition} from '../src/authoritative-reports-workspace.jsx';

const entityId='00000000-0000-4000-8000-000000000101',periodId='00000000-0000-4000-8000-000000000102';
const config={baseUrl:'https://accounting.example',entityId,periodId,getAccessToken:async()=>'oidc.token.value-123456789'};
const row={period_id:periodId,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',statement_type:'TRIAL_BALANCE',statement_section:'ALL_ACCOUNTS',classification_basis:'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',account_code:'111000',account_name:'Operating Cash',opening_debit:'100.0000',opening_credit:'0.0000',period_debit:'25.0000',period_credit:'5.0000',ending_debit:'125.0000',ending_credit:'5.0000',display_balance:'120.0000',journal_entry_ids:['00000000-0000-4000-8000-000000000201'],journal_line_ids:['00000000-0000-4000-8000-000000000202'],ledger_line_ids:['00000000-0000-4000-8000-000000000203'],source_document_ids:['00000000-0000-4000-8000-000000000204']};
const requests=[];
const fetcher=async(url,init)=>{requests.push({url,init});return new Response(JSON.stringify({ok:true,data:[row]}),{status:200,headers:{'content-type':'application/json'}});};

async function main(){
  const result=await refreshAuthoritativeFinancialStatements({config,fetcher});
  assert.equal(result.ok,true);assert.equal(result.rows[0].display_balance,'120.0000');
  assert.equal(requests[0].url,`https://accounting.example/api/v1/entities/${entityId}/reports/financial-statements?periodId=${periodId}`);
  assert.equal(requests[0].init.method,'GET');assert.equal(requests[0].init.cache,'no-store');assert.equal(requests[0].init.headers.authorization,'Bearer oidc.token.value-123456789');assert.equal(requests[0].init.body,undefined);
  const malformed=await refreshAuthoritativeFinancialStatements({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[{...row,source_document_ids:['not-a-uuid']}]}),{status:200})});
  assert.equal(malformed.ok,false);assert.equal(malformed.code,'ACCOUNTING_API_PROTOCOL');
  const displayConfig={...config,scopePresentation:{entityLabel:'REFS US Staging',periodLabel:'July 2026'}};
  assert.deepEqual(authoritativeReportLineageConfig(displayConfig,{period_id:periodId,period_code:'2026-07'}).scopePresentation,{entityLabel:'REFS US Staging',periodLabel:'2026-07'});
  assert.deepEqual(authoritativeReportLineageConfig(displayConfig,{period_id:'00000000-0000-4000-8000-000000000103',period_code:'2026-06'}).scopePresentation,{entityLabel:'REFS US Staging',periodLabel:'2026-06'},'prior-period lineage must not reuse the current period label');
  assert.equal(authoritativeReportLineageConfig(displayConfig,{period_id:'00000000-0000-4000-8000-000000000103'}).scopePresentation.periodLabel,'Selected report period','a non-current period without a readable code must use an honest neutral label');
  const snapshotRow={financial_statement_snapshot_id:'00000000-0000-4000-8000-000000000205',version:'2',currency:'USD',snapshot_hash:`sha256:${'a'.repeat(64)}`,ledger_evidence_hash:`sha256:${'b'.repeat(64)}`,prepared_by:'snapshot-maker',approved_by:'snapshot-approver',approved_at:'2026-07-31T23:59:00.000Z',captured_at:'2026-08-01T00:01:00.000Z',statement_type:'TRIAL_BALANCE',statement_section:'ALL_ACCOUNTS',classification_basis:'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',account_code:'111000',account_name:'Operating Cash',opening_debit:'100.0000',opening_credit:'0.0000',period_debit:'25.0000',period_credit:'5.0000',ending_debit:'125.0000',ending_credit:'5.0000',display_balance:'120.0000',journal_entry_ids:row.journal_entry_ids,journal_line_ids:row.journal_line_ids,ledger_line_ids:row.ledger_line_ids,source_document_ids:row.source_document_ids,row_hash:`sha256:${'c'.repeat(64)}`};
  const snapshot=await refreshAuthoritativeFinancialStatementSnapshot({config,fetcher:async(url,init)=>{assert.match(url,/reports\/financial-statement-snapshot\?periodId=/);assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');return new Response(JSON.stringify({ok:true,data:[snapshotRow]}),{status:200});}});
  assert.equal(snapshot.ok,true);assert.equal(snapshot.version,'2');assert.equal(snapshot.rows[0].display_balance,'120.0000');
  const mixedSnapshot=await refreshAuthoritativeFinancialStatementSnapshot({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[snapshotRow,{...snapshotRow,financial_statement_snapshot_id:'00000000-0000-4000-8000-000000000206',account_code:'610000'}]}),{status:200})});
  assert.equal(mixedSnapshot.ok,false);assert.equal(mixedSnapshot.code,'ACCOUNTING_API_PROTOCOL');
  for(const invalid of [
    {...row,period_code:'July 2026'},
    {...row,period_start:'2026-02-30'},
    {...row,period_end:'2026-08-01'},
    {...row,classification_basis:'INFERRED'},
    {...row,statement_section:'ASSETS'},
    {...row,display_balance:'90071992547409920.0000'},
  ]){
    const rejected=await refreshAuthoritativeFinancialStatements({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[invalid]}),{status:200})});
    assert.equal(rejected.ok,false);assert.equal(rejected.code,'ACCOUNTING_API_PROTOCOL');
  }
  const duplicate=await refreshAuthoritativeFinancialStatements({config,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[row,row]}),{status:200})});
  assert.equal(duplicate.ok,false);assert.equal(duplicate.code,'ACCOUNTING_API_PROTOCOL');
  const noToken=await refreshAuthoritativeFinancialStatements({config:{...config,getAccessToken:async()=>''},fetcher});assert.equal(noToken.code,'AUTHENTICATION_REQUIRED');
  const priorPeriodId='00000000-0000-4000-8000-000000000103';
  const comparisonRow={current_period_id:periodId,current_period_code:'2026-07',current_period_start:'2026-07-01',current_period_end:'2026-07-31',prior_period_id:priorPeriodId,prior_period_code:'2026-06',prior_period_start:'2026-06-01',prior_period_end:'2026-06-30',statement_type:'TRIAL_BALANCE',statement_section:'ALL_ACCOUNTS',classification_basis:'ACCOUNT_CODE_PREFIX_AND_BANK_MEMBER',account_code:'111000',account_name:'Operating Cash',comparison_status:'COMPARABLE_POSTED_EVIDENCE',current_display_balance:'120.0000',prior_display_balance:'100.0000',current_journal_entry_ids:row.journal_entry_ids,current_journal_line_ids:row.journal_line_ids,current_ledger_line_ids:row.ledger_line_ids,current_source_document_ids:row.source_document_ids,prior_journal_entry_ids:row.journal_entry_ids,prior_journal_line_ids:row.journal_line_ids,prior_ledger_line_ids:row.ledger_line_ids,prior_source_document_ids:row.source_document_ids};
  const comparison=await refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId,fetcher:async(url,init)=>{assert.match(url,/financial-statement-period-comparison\?currentPeriodId=/);assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');return new Response(JSON.stringify({ok:true,data:[comparisonRow]}),{status:200});}});
  assert.equal(comparison.ok,true);assert.equal(comparison.rows[0].current_display_balance,'120.0000');
  const missingEvidence=await refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId,fetcher:async()=>new Response(JSON.stringify({ok:true,data:[{...comparisonRow,comparison_status:'MISSING_PRIOR_EVIDENCE',prior_display_balance:null,prior_journal_entry_ids:null,prior_journal_line_ids:null,prior_ledger_line_ids:null,prior_source_document_ids:null}]}),{status:200})});
  assert.equal(missingEvidence.ok,true);assert.equal(missingEvidence.rows[0].prior_display_balance,null);
  assert.equal((await refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId:periodId,fetcher})).code,'ACCOUNTING_API_SCOPE_INVALID');
  const consolidationRow={group_ref:'GROUP-2026-07',period_id:periodId,period_code:'2026-07',period_start:'2026-07-01',period_end:'2026-07-31',currency:'USD',presentation_account_code:'IC-100',presentation_side:'CREDIT',report_status:'APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT',classification_basis:'APPROVED_IMMUTABLE_GROUP_MEMBER_MAPPING_ELIMINATION_AND_POSTED_LEDGER_EXACT',member_count:2,evidence_member_count:2,member_actual_amount:'0.0000',elimination_amount:'0.0000',consolidated_amount:'0.0000',consolidation_snapshot_id:'00000000-0000-4000-8000-000000000205',consolidation_version:'1',consolidation_snapshot_hash:`sha256:${'a'.repeat(64)}`,consolidation_receipt_hash:`sha256:${'b'.repeat(64)}`,consolidation_source_ref:'approved-consolidation-2026-07',consolidation_source_version:'1',member_entity_ids:[entityId,'00000000-0000-4000-8000-000000000206'],journal_entry_ids:row.journal_entry_ids,journal_line_ids:row.journal_line_ids,ledger_line_ids:row.ledger_line_ids,source_document_ids:row.source_document_ids,elimination_refs:['approved-elimination-2026-07']};
  const consolidation=await refreshAuthoritativeConsolidation({config,groupRef:'GROUP-2026-07',fetcher:async(url,init)=>{assert.match(url,/reports\/consolidation\?periodId=/);assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');return new Response(JSON.stringify({ok:true,data:[consolidationRow]}),{status:200});}});
  assert.equal(consolidation.ok,true);assert.equal(consolidation.complete,true);assert.equal(consolidation.rows[0].consolidated_amount,'0.0000');
  assert.equal((await refreshAuthoritativeConsolidation({config,groupRef:'\u0000',fetcher})).code,'ACCOUNTING_API_SCOPE_INVALID');
  const invalidConsolidation=await refreshAuthoritativeConsolidation({config,groupRef:'GROUP-2026-07',fetcher:async()=>new Response(JSON.stringify({ok:true,data:[{...consolidationRow,member_actual_amount:'0.00001'}]}),{status:200})});
  assert.equal(invalidConsolidation.ok,false);assert.equal(invalidConsolidation.code,'ACCOUNTING_API_PROTOCOL');
  const markup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher}/>);
  assert.match(markup,/REPORTING/);assert.match(markup,/Reports center/);assert.match(markup,/Review posted financial reports\./);assert.match(markup,/Reporting scope/);assert.match(markup,/POSTED ledger evidence/);assert.match(markup,/Core statements/);assert.match(markup,/Cash &amp; capital/);assert.match(markup,/Property &amp; project analysis/);assert.match(markup,/Group &amp; comparison/);assert.match(markup,/Search reports/);assert.match(markup,/Core statement shortcuts/);assert.match(markup,/Trial Balance/);assert.match(markup,/Balance Sheet/);assert.match(markup,/Income Statement/);assert.match(markup,/Cash movement evidence/);assert.doesNotMatch(markup,/Posted reports from the accounting API|>Cash Flow</);assert.match(markup,/rep-grid/);assert.match(markup,/rep-card/);assert.match(markup,/report-workbench/);
  assert.equal((markup.match(/Entity Configured entity/g)||[]).length,1,'Reports Center must present its entity and period once in the Reporting scope chip');
  assert.doesNotMatch(markup,/\| Read only/,'the workbench must not repeat the reporting scope above statement results');
  assert.doesNotMatch(markup,/>\?</,'Reports must not render placeholder question-mark chrome in the authoritative product surface');
  assert.match(markup,/authoritative-workbench-shell/);assert.doesNotMatch(markup,/Reports workspace structure/);assert.doesNotMatch(markup,/Read API evidence/);
  assert.match(markup,/Property &amp; project reports/);assert.match(markup,/authoritative-secondary-disclosure authoritative-property-report-directory/);assert.match(markup,/Property P&amp;L/);assert.match(markup,/Project P&amp;L/);assert.match(markup,/Unit profitability/);assert.match(markup,/CWIP rollforward/);assert.match(markup,/Construction loan rollforward/);assert.match(markup,/Prepaid rollforward/);assert.match(markup,/Budget versus actual/);
  assert.match(markup,/>Loading…</);assert.match(markup,/<button type="button" class="btn btn-sm btn-ghost" disabled="">Loading…<\/button>/,'Reports must expose one disabled in-progress read state');assert.doesNotMatch(markup,/Each read is a real API GET/,'the compact Reports surface must not repeat implementation notes above the report data');assert.doesNotMatch(markup,/class="rep-desc"/,'report categories must be compact tabs rather than tall explanatory cards');
  assert.match(markup,/authoritative-secondary-disclosure authoritative-statement-snapshot/);assert.match(markup,/Statement snapshot/);assert.match(markup,/Load statement snapshot/);assert.match(markup,/Immutable statement evidence/);
  assert.match(markup,/COMMON REPORTS/);assert.match(markup,/Accounts receivable aging/);assert.match(markup,/id="authoritative-report-ar-aging"/);assert.doesNotMatch(markup,/authoritative-aging-launch/,'AR aging belongs in the compact common-report list instead of a second large launch card');
  assert.match(markup,/Review account balances\./);assert.match(markup,/Review income and expenses\./);assert.match(markup,/Review cash activity\./);
  assert.doesNotMatch(markup,/FAVORITES|Control all retained account balances|Review period revenue and expenses|inferred classifications|GET ONLY/);
  const profitLossSearchMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'STATEMENTS',query:'profit and loss',preview:'TRIAL_BALANCE'}}/>);
  assert.match(profitLossSearchMarkup,/1 match/);assert.match(profitLossSearchMarkup,/MATCHING STATEMENTS/);assert.match(profitLossSearchMarkup,/Income Statement/);
  assert.match(profitLossSearchMarkup,/aria-label="Matching statements"/);assert.doesNotMatch(profitLossSearchMarkup,/Matching API-backed statements/);
  assert.doesNotMatch(profitLossSearchMarkup,/COMMON REPORTS/,'an active report search must not append the unfiltered common-report list below its matching results');
  assert.doesNotMatch(profitLossSearchMarkup,/id="authoritative-favorite-/,'filtered results must not duplicate matching reports through the unfiltered shortcut controls');
  assert.doesNotMatch(profitLossSearchMarkup,/class="report-workbench"/,'a report search is a concise result page, not a result followed by the previous workbench');
  assert.doesNotMatch(profitLossSearchMarkup,/authoritative-property-report-directory/,'a statement-only search must not render an empty property report directory');
  assert.doesNotMatch(profitLossSearchMarkup,/role="tablist" aria-label="Report categories"/,'a statement-only search must not leave an empty report-category tablist');
  assert.doesNotMatch(profitLossSearchMarkup,/No reports found/,'a matching statement alias must not render a contradictory empty state');
  const noReportSearchMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'STATEMENTS',query:'no-such-authoritative-report',preview:'TRIAL_BALANCE'}}/>);
  assert.equal((noReportSearchMarkup.match(/No reports found/g)||[]).length,2,'the finder summary and actionable empty state must agree only when every API-backed result family is empty');
  assert.match(noReportSearchMarkup,/Try another search or clear it to view all reports/);assert.match(noReportSearchMarkup,/No report data was inferred/);
  const projectCostMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'OPERATING_ANALYSIS',query:'',preview:'TRIAL_BALANCE'}} initialDimensionType="PROJECT" workspaceEyebrow="AUTHORITATIVE / ACCOUNTING OPERATIONS" workspaceTitle="Project Cost & CWIP" workspaceDescription="Existing API readers only."/>);
  assert.match(projectCostMarkup,/Project Cost &amp; CWIP/);assert.match(projectCostMarkup,/AUTHORITATIVE[\s\S]*ACCOUNTING OPERATIONS/);assert.match(projectCostMarkup,/Project P&amp;L/);assert.match(projectCostMarkup,/CWIP rollforward/);assert.match(projectCostMarkup,/Dimension type/);assert.match(projectCostMarkup,/value="PROJECT" selected=""/);
  const lotMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'OPERATING_ANALYSIS',query:'lot',preview:'TRIAL_BALANCE'}} initialDimensionType="LOT" workspaceTitle="Lot profitability" workspaceDescription="Exact retained LOT evidence only."/>);
  assert.match(lotMarkup,/Lot profitability/);assert.match(lotMarkup,/Exact retained Lot dimension on POSTED ledger lines/);assert.match(lotMarkup,/authoritative-property-report-directory/);assert.doesNotMatch(lotMarkup,/Dimension type/,'a property search result must not append the full profitability workbench before selection');
  const capitalMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'CASH_AND_CAPITAL',query:'',preview:'TRIAL_BALANCE'}} workspaceTitle="Construction Loan" workspaceDescription="Existing API readers only."/>);
  assert.match(capitalMarkup,/Construction Loan/);assert.match(capitalMarkup,/Statement of cash flows/);assert.match(capitalMarkup,/CWIP rollforward/);assert.match(capitalMarkup,/Construction loan rollforward/);assert.match(capitalMarkup,/Prepaid rollforward/);assert.match(capitalMarkup,/AI amortization schedule proposals/);assert.match(capitalMarkup,/Load proposed schedules/);assert.match(capitalMarkup,/not a monthly Journal Entry/);
  const groupMarkup=renderToStaticMarkup(<AuthoritativeReportsWorkspace config={config} fetcher={fetcher} initialCatalog={{category:'GROUP_AND_COMPARISON',query:'',preview:'TRIAL_BALANCE'}} workspaceTitle="Consolidation" workspaceDescription="Existing API readers only."/>);
  assert.match(groupMarkup,/Consolidation/);assert.match(groupMarkup,/Prior-period comparison/);assert.match(groupMarkup,/Intercompany reconciliation/);assert.match(groupMarkup,/Consolidation and elimination evidence/);
  assert.deepEqual(DEFAULT_AUTHORITATIVE_REPORTS_CATALOG,{category:'STATEMENTS',query:'',preview:'TRIAL_BALANCE'},'a direct Reports entry must reset the catalog rather than recover a browser cache');
  assert.deepEqual(normalizeAuthoritativeReportsCatalog({category:'GROUP_AND_COMPARISON',query:'cash',preview:'BALANCE_SHEET'}),{category:'GROUP_AND_COMPARISON',query:'cash',preview:'BALANCE_SHEET'},'a full-page evidence drill must retain its catalog category, query, and preview for Back');
  assert.deepEqual(normalizeAuthoritativeReportsCatalog({category:'not-a-category',query:42,preview:'unknown'}),DEFAULT_AUTHORITATIVE_REPORTS_CATALOG,'malformed Back context must fail back to the explicit Reports default');
  assert.deepEqual(findAuthoritativeReportShortcuts('profit and loss').map(([key])=>key),['INCOME_STATEMENT'],'the report finder must map the observed Profit and Loss label to the existing Income Statement API reader');
  assert.deepEqual(findAuthoritativeReportShortcuts('P&L').map(([key])=>key),['INCOME_STATEMENT'],'the report finder must recognize the common P&L abbreviation without creating a report alias state');
  assert.deepEqual(findAuthoritativeReportShortcuts('profitability'),[],'finder aliases must not over-claim a property/project/unit report reader without an exact dimension scope');
  assert.deepEqual(findAuthoritativePropertyReportShortcuts('property').map(([key])=>key),['PROPERTY_PROFITABILITY'],'the catalog must make the exact Property P&L reader discoverable without inventing a reference');
  assert.deepEqual(findAuthoritativePropertyReportShortcuts('lot').map(([key])=>key),['LOT_PROFITABILITY'],'the catalog must route Lot profitability to the exact LOT dimension reader');
  assert.deepEqual(findAuthoritativePropertyReportShortcuts('construction loan').map(([key])=>key),['CONSTRUCTION_LOAN_ROLLFORWARD'],'the catalog must only route loan work to its existing API-backed rollforward reader');
  const balanceMarkup=renderToStaticMarkup(<FinancialStatementSummary report="BALANCE_SHEET" rows={[
    {...row,statement_type:'BALANCE_SHEET',statement_section:'ASSETS',display_balance:'125.1000'},
    {...row,statement_type:'BALANCE_SHEET',statement_section:'LIABILITIES',account_code:'291001',display_balance:'25.0500'},
    {...row,statement_type:'BALANCE_SHEET',statement_section:'EQUITY',account_code:'310000',display_balance:'90.0000'},
    {...row,statement_type:'BALANCE_SHEET',statement_section:'CURRENT_EARNINGS',account_code:'399999',display_balance:'10.0500'},
  ]}/>);
  assert.match(balanceMarkup,/Assets/);assert.match(balanceMarkup,/Liabilities/);assert.match(balanceMarkup,/Equity and current earnings/);assert.match(balanceMarkup,/\$0\.00/);
  const incomeMarkup=renderToStaticMarkup(<FinancialStatementSummary report="INCOME_STATEMENT" rows={[
    {...row,statement_type:'INCOME_STATEMENT',statement_section:'REVENUE',display_balance:'120.1000'},
    {...row,statement_type:'INCOME_STATEMENT',statement_section:'EXPENSES',account_code:'610000',display_balance:'20.0500'},
  ]}/>);
  assert.match(incomeMarkup,/Revenue/);assert.match(incomeMarkup,/Expenses/);assert.match(incomeMarkup,/Net income/);assert.match(incomeMarkup,/\$100\.05/);
  const profitabilityMarkup=renderToStaticMarkup(<DimensionProfitabilitySummary dimensionType="PROPERTY" dimensionRef="PROPERTY-01" rows={[
    {...row,statement_type:'INCOME_STATEMENT',statement_section:'REVENUE',dimension_type:'PROPERTY',dimension_ref:'PROPERTY-01',display_balance:'120.1000'},
    {...row,statement_type:'INCOME_STATEMENT',statement_section:'EXPENSES',account_code:'610000',dimension_type:'PROPERTY',dimension_ref:'PROPERTY-01',display_balance:'20.0500'},
  ]}/>);
  assert.match(profitabilityMarkup,/Exact property reference/);assert.match(profitabilityMarkup,/PROPERTY-01/);assert.match(profitabilityMarkup,/Revenue/);assert.match(profitabilityMarkup,/Expenses/);assert.match(profitabilityMarkup,/Net income/);assert.match(profitabilityMarkup,/\$100\.05/);
  const cashMarkup=renderToStaticMarkup(<FinancialStatementSummary report="CASH_FLOW" rows={[{...row,statement_type:'CASH_FLOW',statement_section:'DIRECT_CASH_MOVEMENT',display_balance:'-2.0050'}]}/>);
  assert.match(cashMarkup,/Direct cash-account movement/);assert.match(cashMarkup,/Not classified as operating, investing, or financing/);assert.match(cashMarkup,/-\$2\.01/);
  const reportReturnContext={entityId,periodId,report:'TRIAL_BALANCE',reportAccountCode:row.account_code,reportSection:row.statement_section,reportDimensionType:null,reportDimensionRef:null};
  const completeDetail=renderToStaticMarkup(<AuthoritativeReportDetail row={row} returnContext={reportReturnContext} onBack={()=>{}}/>);
  assert.match(completeDetail,/POSTED EVIDENCE/);assert.doesNotMatch(completeDetail,/authoritative lineage unavailable/);
  const incompleteDetail=renderToStaticMarkup(<AuthoritativeReportDetail row={{...row,ledger_line_ids:[]}} returnContext={reportReturnContext} onBack={()=>{}}/>);
  assert.match(incompleteDetail,/BLOCKED[\s\S]*authoritative lineage unavailable/);assert.match(incompleteDetail,/Back to financial statement/);assert.match(incompleteDetail,/scoped statement data/);
  const mismatchedRowIdentity=renderToStaticMarkup(<AuthoritativeReportDetail row={{...row,account_code:'999999'}} returnContext={reportReturnContext} onBack={()=>{}}/>);
  assert.match(mismatchedRowIdentity,/BLOCKED[\s\S]*immutable report scope mismatch/);assert.doesNotMatch(mismatchedRowIdentity,/POSTED EVIDENCE/,'a row from the same report and period must still match the frozen account identity');
  const fullReport=renderToStaticMarkup(<AuthoritativeFullStatementReport report="TRIAL_BALANCE" rows={[row]} returnContext={{entityId,periodId,report:'TRIAL_BALANCE'}} onBack={()=>{}} onRefresh={()=>{}} onOpenEvidence={()=>{}}/>);
  assert.match(fullReport,/Trial Balance/);assert.match(fullReport,/Back to Reports/);assert.match(fullReport,/Reports center/);assert.match(fullReport,/FINANCIAL REPORT/);assert.match(fullReport,/Review posted balances\./);assert.match(fullReport,/Report scope/);assert.match(fullReport,/>Refresh</);assert.match(fullReport,/READ ONLY/);assert.doesNotMatch(fullReport,/POSTED EVIDENCE \| API GET|from the accounting API|Refresh statement evidence|GET ONLY/);assert.match(fullReport,/report-section-row/);assert.match(fullReport,/scope="rowgroup"/);assert.match(fullReport,/authoritative-full-report-TRIAL_BALANCE-111000/);assert.match(fullReport,/authoritative-evidence-page/);
  const loadingFullReport=renderToStaticMarkup(<AuthoritativeFullStatementReport report="TRIAL_BALANCE" rows={[row]} returnContext={{entityId,periodId,report:'TRIAL_BALANCE'}} onBack={()=>{}} onRefresh={()=>{}} onOpenEvidence={()=>{}} loading/>);
  assert.match(loadingFullReport,/<button type="button" class="btn btn-sm btn-ghost" disabled="">Loading…<\/button>/,'the full statement must not retain an apparently idle refresh label during a read');
  assert.equal((fullReport.match(/Configured entity/g)||[]).length,1,'the full statement must present its entity and period once in Report scope, not repeat them beside Back');
  assert.doesNotMatch(fullReport,/This page has no saved layout, export, delivery, or browser data fallback/);
  const workspace=fs.readFileSync('src/authoritative-reports-workspace.jsx','utf8');
  const lineage=fs.readFileSync('src/authoritative-lineage-drill.jsx','utf8');
  const reportsView=fs.readFileSync('src/authoritative-reports-view.jsx','utf8');
  assert.doesNotMatch(reportsView,/seed\.js|repo\.js|localStorage|legacy-demo-app|data\.js|accounting-api/,'the Reports presentation extraction must receive authoritative facts as slots');
  assert.doesNotMatch(reportsView,/report-shelf/,'the Reports header must not repeat the interactive category tabs as a second static shelf');
  assert.match(markup,/authoritative-reports-presentation/);
  assert.match(workspace,/full-bleed qbo-transaction-report/,'report detail must replace the full workspace rather than append a card');
  assert.match(workspace,/AuthoritativeFullStatementReport/,'each core statement needs an API-backed full-page report rather than only an account evidence view');
  assert.match(workspace,/View report/,'the catalog statement preview must expose a concise full-page report action');
  assert.match(workspace,/View details/,'statement rows must use the same concise detail action in preview and full-report views');
  assert.doesNotMatch(workspace,/accounts in retained evidence|Open full report/,'the first-screen report presentation must not expose internal evidence language');
  assert.match(workspace,/onClick=\{\(\)=>openFullStatement\(focusId,key\)\}/,'a core report shortcut must replace the catalog with the existing full-page report in one click');
  assert.match(workspace,/report=\{selected\.returnContext\.report\} rows=\{selected\.rows\}/,'a one-click report must render the rows frozen for that exact selected report, not the previous preview rows');
  assert.doesNotMatch(workspace,/aria-label="Financial statements"/,'the report preview must not repeat Favorites as a second statement tab row');
  assert.match(workspace,/parentFullStatement/,'a row evidence Back from the full report must return to the full report before it returns to the Reports catalog');
  assert.match(workspace,/createAuthoritativeReturnContext\(\{config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number\(environment\?\.scrollY\)\|\|0\}\)/,'a nested full-report drill must freeze its own current page position instead of reusing the Reports catalog position');
  assert.match(workspace,/tableX:Number\(fullStatementTableRef\.current\?\.scrollLeft\)\|\|0/,'a nested full-report drill must freeze the contained report table position');
  assert.match(workspace,/restoreAuthoritativeReturnContext\(environment,config,context\)\)restoreAuthoritativeReportTablePosition/,'nested Back must restore exact full-report page, table and row focus context');
  const reportTableCalls=[];const reportTable={scrollTo:options=>reportTableCalls.push(options)};const reportEnvironment={setTimeout:callback=>callback()};
  assert.equal(restoreAuthoritativeReportTablePosition(reportEnvironment,{tableX:310},()=>reportTable),true);
  assert.deepEqual(reportTableCalls,[{left:310,behavior:'auto'}]);
  assert.equal(restoreAuthoritativeReportTablePosition(reportEnvironment,{tableX:-1},()=>reportTable),false,'invalid report table positions must fail closed');
  assert.match(workspace,/Back to Reports/,'the full report must provide an explicit catalog Back action');
  assert.match(workspace,/restoreAuthoritativeReturnContext/,'report detail Back must restore its evidence opener and scroll position');
  assert.match(workspace,/getElementById\?\.\(focusId\)\?\.closest\?\.\('\.table-wrap'\)\?\.scrollLeft/,'every API-backed report evidence opener must freeze its own contained table position');
  assert.match(workspace,/createAuthoritativeReturnContext\(\{config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number\(environment\?\.scrollY\)\|\|0,tableX\}\)/,'report evidence must retain its table position in the immutable entity and period return context');
  assert.match(workspace,/getTable:\(\)=>environment\?\.document\?\.getElementById\?\.\(context\?\.focusId\)\?\.closest\?\.\('\.table-wrap'\)/,'Back must locate the remounted originating report table from the frozen opener ID');
  assert.match(workspace,/authoritative-report-\$\{row\.statement_type\}/,'report evidence controls need stable focus targets');
  assert.match(workspace,/refreshAuthoritativeFinancialStatementSnapshot/,'statement snapshots must use a separate authoritative API reader, not a live-ledger browser copy');
  assert.match(workspace,/authoritative-statement-snapshot/,'the statement version reader must be discoverable from the reports workspace');
  assert.match(workspace,/reportsCatalog:normalizeAuthoritativeReportsCatalog/,'full-page report evidence must retain exact catalog context for Back');
  assert.match(workspace,/reportRowMatchesReturnContext/,'report rows must fail closed when the immutable return identity differs');
  assert.match(workspace,/row\.account_code===context\.reportAccountCode/);
  assert.match(workspace,/reportAccountCode:row\.account_code\|\|null/,'the parent context must freeze the opened account identity');
  assert.match(workspace,/authoritative-cwip-\$\{row\.account_code\}/,'rollforward rows must also open full-page evidence instead of leaving a dead-end table');
  assert.match(workspace,/CwipRollforwardDetail/,'CWIP must have a dedicated authoritative evidence page instead of reusing a generic presentation');
  assert.match(workspace,/CWIP_ROLLFORWARD/,'CWIP evidence controls must select the dedicated API-backed workbench');
  assert.match(workspace,/authoritative-cwip-table/,'CWIP rows must use a contained table region rather than scrolling the page');
  for(const label of [
    'Financial statement rows',
    'Statement of cash flows rows',
    'Prior-period comparison rows',
    'Intercompany reconciliation rows',
    'Budget versus actual rows',
    'Consolidation rows',
  ]){
    assert.match(workspace,new RegExp(`role="region" tabIndex=\\{0\\} aria-label="${label}; scroll horizontally to view every column"`),`${label} must remain a named keyboard-focusable horizontal scroll region at Stage 5 phone widths`);
  }
  assert.match(workspace,/role="region" tabIndex=\{0\} aria-label=\{`\$\{title\} rows; scroll horizontally to view every column`\}/,'the full-page statement must expose the same accessible narrow-width table contract');
  assert.match(workspace,/role="region" tabIndex=\{0\} aria-label="Immutable financial statement snapshot rows; scroll horizontally to view every column"/,'immutable snapshot rows must remain keyboard-scrollable at narrow widths');
  assert.match(workspace,/mapping_snapshot_hash/,'CWIP evidence must retain the immutable mapping hash in its full-page scope');
  assert.match(workspace,/Open GL \/ Journal \/ source drill/,'CWIP, prepaid, construction-loan, and exact-dimension evidence must expose the same server-backed GL-to-Journal-to-source drill instead of presenting identifiers as a dead end');
  assert.match(workspace,/kind:'EVIDENCE_LINEAGE'/,'non-statement report evidence must enter the shared immutable lineage reader rather than a browser-side reconstruction');
  assert.match(lineage,/readLedgerFromEvidence/,'the shared lineage reader must re-read GL for rollforward and profitability evidence before opening Journal or source details');
  for(const detail of ['CashFlowDetail','IntercompanyDetail','BudgetActualDetail','ConsolidationDetail','ComparisonDetail','StatementSnapshotDetail']){
    assert.match(workspace,new RegExp(`const ${detail}=\\(\\{row,returnContext,onBack,onOpenLineage\\}\\)`),`${detail} must expose the shared immutable lineage action from its real evidence row`);
  }
  for(const kind of ['CASH_FLOW_CLASSIFICATION','INTERCOMPANY_RECONCILIATION','BUDGET_VS_ACTUAL','CONSOLIDATION','PERIOD_COMPARISON','STATEMENT_SNAPSHOT']){
    assert.match(workspace,new RegExp(`selected\\?\\.kind==='${kind}'[\\s\\S]*?onOpenLineage=\\{openEvidenceLineage\\}`),`${kind} must wire its full-page detail to the shared lineage reader`);
  }
  assert.match(workspace,/comparisonLineageRow\(row,'CURRENT'\)/,'period comparison must retain current-period evidence as a distinct lineage choice');
  assert.match(workspace,/comparisonLineageRow\(row,'PRIOR'\)/,'period comparison must retain prior-period evidence as a distinct lineage choice');
  assert.match(workspace,/lineageConfig:authoritativeReportLineageConfig\(config,row\)/,'lineage re-read must use the exact evidence period and its presentation scope instead of silently using the current selector');
  assert.match(workspace,/config=\{authoritativeReportLineageConfig\(config,selected\.row\)\}/,'core statement lineage must retain the selected report period and readable presentation scope');
  assert.match(workspace,/Open snapshot lineage/,'each immutable snapshot row must provide an explicit lineage action');
  assert.match(lineage,/const accountCode=typeof evidence\.account_code/,'shared evidence lineage must explicitly distinguish exact-account and retained multi-account evidence');
  assert.match(lineage,/accountCode&&item\.account_code!==accountCode/,'multi-account report evidence must not invent an account filter');
  assert.match(lineage,/evidence\.currency&&item\.currency!==evidence\.currency/,'shared lineage must enforce currency only when the authoritative row supplied one');
  assert.match(workspace,/DimensionProfitabilityDetail/,'property, project, unit, and lot P&L rows must open a dedicated authoritative evidence page');
  assert.match(workspace,/DIMENSION_PROFITABILITY/,'dimension rows must select the dedicated API-backed workbench instead of a generic statement detail');
  assert.match(workspace,/\['LOT_PROFITABILITY','Lot profitability',[\s\S]*?'LOT'\]/,'the Reports directory must expose the server-backed LOT profitability contract');
  assert.match(workspace,/const DIMENSION_TYPES=Object\.freeze\(\[\['PROPERTY','Property P&L'\][^\n]*\['LOT','Lot profitability'\]\]\);/,'the dimension selector must retain LOT as a declared API scope');
  assert.match(workspace,/\['PROPERTY','PROJECT','UNIT','LOT'\]\.includes\(context\?\.dimension\?\.type\)/,'Back must restore an exact LOT dimension scope instead of falling back to Property');
  assert.match(workspace,/authoritative-profitability-table/,'dimension rows must use a contained table region rather than scrolling the page');
  assert.match(workspace,/dimension:\{type:dimensionType,ref:dimensionRef\}/,'Back must retain the exact API dimension type and reference');
  assert.match(workspace,/authoritative-period-comparison-\$\{row\.statement_type\}/,'comparison rows must also open full-page evidence');
  assert.match(workspace,/reportsCatalog:normalizeAuthoritativeReportsCatalog/,'Back must restore the exact report category, finder query, and preview');
  assert.match(workspace,/reports-library authoritative-reports-library/,'the authoritative Reports hierarchy must use the shared reports-library presentation, not the legacy application');
  assert.match(workspace,/rep-card/,'report families must be discoverable as report cards while remaining API-backed');
  assert.match(workspace,/REPORT_LIBRARY_SHORTCUTS/,'the Reports Center must offer API-backed core statement shortcuts without importing legacy report state');
  assert.match(workspace,/PROPERTY_REPORT_SHORTCUTS/,'the Reports Center must expose actual property, project, unit, CWIP, loan, prepaid, and budget readers from one authoritative directory');
  assert.match(workspace,/Property, project, unit, and lot report directory/,'the complete dimension report directory must be discoverable before a user knows the legacy navigation');
  assert.match(workspace,/openPropertyReport/,'property report shortcuts must only select an existing report workspace; they may not manufacture report rows');
  assert.match(workspace,/findAuthoritativeReportShortcuts/,'the Reports finder must resolve only declared aliases for existing API statement readers');
  assert.match(workspace,/Matching statements/,'a recognized statement alias must be actionable from the finder without a favorite or report mutation');
  assert.match(workspace,/authoritative-report-shortcut/,'core statement shortcuts must retain an explicit visual and focusable control contract');
  assert.match(workspace,/onOpenArAging\('authoritative-report-ar-aging'/,'the A\/R aging report entry must be an explicit read-only Reports shortcut, not a favorite mutation');
  assert.match(workspace,/trial-balance-table/,'the Trial Balance table needs its dedicated narrow-table layout contract');
  assert.match(workspace,/const statementPreviewRows=rows\.slice\(0,12\)/,'the catalog must cap its statement preview instead of creating an arbitrarily long page');
  assert.match(workspace,/Showing \{statementPreviewRows\.length\} of \{rows\.length\} accounts\. View the full report for every row\./,'a capped preview must direct users to the existing full-page report');
  assert.match(workspace,/report-section-row/,'statement rows must retain a readable section boundary instead of presenting a flat account list');
  assert.match(workspace,/scope="rowgroup"/,'each visible statement section must expose table grouping semantics');
  assert.match(workspace,/<thead><tr><th>Account<\/th><th>Period debit<\/th><th>Period credit<\/th><th>Balance<\/th><th>Details<\/th><\/tr><\/thead>/,'financial statements must use the section group row instead of repeating a Section column on every account');
  assert.match(workspace,/className="report-section-row"><th colSpan="5" scope="rowgroup">/,'section group headings must span the compact five-column statement table');
  assert.match(workspace,/disabled=\{state\.phase==='LOADING'\} onClick=\{load\}>\{state\.phase==='LOADING'\?'Loading…':'Refresh'\}<\/button>/,'statement refresh must remain an API-read control with an explicit in-progress state');
  for(const [stateName,loadName] of [
    ['statementSnapshotState','loadStatementSnapshot'],['cashFlowState','loadCashFlow'],['comparisonState','loadComparison'],['cwipState','loadCwip'],['constructionLoanState','loadConstructionLoan'],['prepaidState','loadPrepaid'],['amortizationScheduleState','loadAmortizationSchedules'],['intercompanyState','loadIntercompany'],['budgetState','loadBudget'],['consolidationState','loadConsolidation'],['dimensionState','loadDimension'],
  ])assert.match(workspace,new RegExp(`disabled=\\{${stateName}\\.phase==='LOADING'[\\s\\S]{0,240}onClick=\\{${loadName}\\}>\\{${stateName}\\.phase==='LOADING'\\?'Loading…'`),`${loadName} must block duplicate GETs and show one in-progress label`);
  assert.match(workspace,/AuthoritativeReadFailure/,'Reports must use the shared explicit authoritative read failure state.');
  assert.match(workspace,/authoritativeReadFailurePhase\(result\)/,'Reports must classify only authentication, configuration, scope, and protocol failures as BLOCKED.');
  assert.match(workspace,/const ScopeLabel=/,'all report details must reuse one readable scope presentation');
  assert.match(workspace,/context\?\.entityLabel\|\|'Configured entity'/,'report details must preserve the authoritative entity display name in Back context');
  assert.match(workspace,/context\?\.periodLabel\|\|'Configured period'/,'report details must preserve the authoritative period code in Back context');
  assert.match(workspace,/period_code:row\[`\$\{prefix\}_period_code`\]/,'comparison lineage rows must carry the selected current or prior period code');
  assert.doesNotMatch(workspace,/Entity \{returnContext\?\.entityId\}|Period \{returnContext\?\.periodId\}/,'report Back and evidence headers must not expose raw entity or period UUIDs as visible text');
  assert.match(workspace,/title=\{`Entity ID: \$\{context\?\.entityId/,'full identifiers remain available as audit tooltips instead of visible page copy');
  assert.doesNotMatch(workspace,/Save As|Customize|<button[^>]*>Email|<button[^>]*>Print|<button[^>]*>Export/,'authoritative reports must not expose QBO save, customize, email, print, or export controls');
  assert.doesNotMatch(workspace,/from ['"]\.\/(?:legacy-demo-app|data|seed|repo)/,'authoritative reports must never import local demonstration state');
  assert.doesNotMatch(workspace,/localStorage/,'authoritative reports must never persist report business state in browser storage');
  assert.match(workspace,/workspaceTitle='Reports center'/,'the API-only reports workspace must allow a formal direct authority entry without importing a demo component');
  assert.match(workspace,/authoritative-report-workbench-actions" aria-label="Statement actions"/,'Statements must keep one compact refresh action row');
  assert.doesNotMatch(workspace,/<div className="report-workbench-head"><b>\{REPORT_WORKBENCH_TABS\.find/,'the selected report category tab must not be repeated as another visible workbench heading');
  assert.match(workspace,/initialDimensionType='PROPERTY'/,'the direct authority entry must select only a declared API-backed dimension type');
  const css=fs.readFileSync('index.html','utf8');
  assert.match(css,/authoritative-report-shortcuts/,'Reports shortcuts must stack without clipping at narrow widths');
  assert.match(css,/\.authoritative-report-workbench-actions\{justify-content:flex-end;\}/,'the remaining Statements action row must align without a duplicate category title');
  assert.match(css,/\.authoritative-core-report-shortcuts \.authoritative-report-shortcut\{min-height:44px/,'favorite reports must use one compact, consistent row height');
  assert.match(css,/@media\(max-width:720px\).*\.authoritative-core-report-shortcuts \.authoritative-report-shortcut small\{display:none;\}/s,'narrow Reports favorites must remove secondary copy instead of producing tall wrapped rows');
  assert.match(css,/authoritative-property-table/,'property rollforward tables must use contained horizontal scrolling rather than expanding the page');
  assert.match(css,/@media\(max-width:720px\).*authoritative-report-shortcuts/s,'Reports shortcut controls need an explicit narrow-screen layout');
  assert.match(css,/@media\(max-width:720px\)\{\.authoritative-reports-library \.table-wrap\{max-height:min\(64vh,560px\);overscroll-behavior:contain;\}\}/,'narrow Reports tables must remain locally scrollable instead of lengthening the full page');
  console.log('authoritative financial statement contract tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
