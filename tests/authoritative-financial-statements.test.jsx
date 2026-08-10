import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {refreshAuthoritativeConsolidation,refreshAuthoritativeFinancialStatementPeriodComparison,refreshAuthoritativeFinancialStatements} from '../src/accounting-api.js';
import {AuthoritativeReportsWorkspace,FinancialStatementSummary} from '../src/authoritative-reports-workspace.jsx';

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
  assert.match(markup,/Financial statements/);assert.match(markup,/Trial Balance/);assert.match(markup,/Balance Sheet/);assert.match(markup,/Income Statement/);assert.match(markup,/Cash movement evidence/);assert.doesNotMatch(markup,/>Cash Flow</);assert.match(markup,/Statement of cash flows/);assert.match(markup,/exact approved immutable mapping/);assert.match(markup,/Browser seed data and local storage are not used/);assert.match(markup,/Prior-period comparison/);assert.match(markup,/Absence on either side is never converted to zero/);assert.match(markup,/Intercompany reconciliation/);assert.match(markup,/bidirectional approved mappings/);assert.match(markup,/No elimination or adjustment is created by this report/);assert.match(markup,/Budget versus actual/);assert.match(markup,/Latest approved immutable budget snapshot/);assert.match(markup,/Missing snapshot, account, currency, or POSTED evidence remains BLOCKED/);assert.match(markup,/Consolidation and elimination evidence/);assert.match(markup,/approved immutable consolidation snapshot/);assert.match(markup,/This view cannot create an elimination journal/);
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
  const cashMarkup=renderToStaticMarkup(<FinancialStatementSummary report="CASH_FLOW" rows={[{...row,statement_type:'CASH_FLOW',statement_section:'DIRECT_CASH_MOVEMENT',display_balance:'-2.0050'}]}/>);
  assert.match(cashMarkup,/Direct cash-account movement/);assert.match(cashMarkup,/Not classified as operating, investing, or financing/);assert.match(cashMarkup,/-\$2\.01/);
  const workspace=fs.readFileSync('src/authoritative-reports-workspace.jsx','utf8');
  assert.match(workspace,/full-bleed qbo-transaction-report/,'report detail must replace the full workspace rather than append a card');
  assert.match(workspace,/restoreAuthoritativeReturnContext/,'report detail Back must restore its evidence opener and scroll position');
  assert.match(workspace,/authoritative-report-\$\{row\.statement_type\}/,'report evidence controls need stable focus targets');
  console.log('authoritative financial statement contract tests passed');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
