import React,{useEffect,useMemo,useState} from 'react';
import {refreshAuthoritativeBudgetVsActual,refreshAuthoritativeCashFlowClassification,refreshAuthoritativeConsolidation,refreshAuthoritativeConstructionLoanRollforward,refreshAuthoritativeCwipRollforward,refreshAuthoritativeDimensionProfitability,refreshAuthoritativeFinancialStatementPeriodComparison,refreshAuthoritativeFinancialStatementSnapshot,refreshAuthoritativeFinancialStatements,refreshAuthoritativeIntercompanyReconciliation,refreshAuthoritativePrepaidRollforward} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {DEFAULT_AUTHORITATIVE_LIST_VIEW,createAuthoritativeReturnContext,restoreAuthoritativeReturnContext} from './authoritative-list-context.js';
import {AuthoritativeReadFailure,authoritativeReadFailurePhase} from './authoritative-read-state.jsx';
import {AuthoritativeDemoReportsView} from './authoritative-demo-reports-view.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';

const REPORTS=[
  ['TRIAL_BALANCE','Trial Balance'],
  ['BALANCE_SHEET','Balance Sheet'],
  ['INCOME_STATEMENT','Income Statement'],
  ['CASH_FLOW','Cash movement evidence'],
];
const REPORT_WORKBENCH_TABS=Object.freeze([
  ['STATEMENTS','Core statements','Trial balance, balance sheet, income statement, and direct cash evidence.'],
  ['CASH_AND_CAPITAL','Cash & capital','Statement of cash flows, CWIP, construction-loan, and prepaid rollforwards.'],
  ['OPERATING_ANALYSIS','Property & project analysis','Property, project, or unit profitability and budget-versus-actual.'],
  ['GROUP_AND_COMPARISON','Group & comparison','Prior-period, intercompany, and consolidation evidence.'],
]);
// These are navigation choices, not a second report data model.  Every card
// below leads to a workspace that already has an authenticated API reader;
// unsupported legacy report names never appear as a plausible action here.
const REPORT_LIBRARY_SHORTCUTS=Object.freeze([
  ['TRIAL_BALANCE','Trial Balance','Control all retained account balances.',['tb']],
  ['BALANCE_SHEET','Balance Sheet','Review assets, liabilities, and equity.',['statement of financial position']],
  ['INCOME_STATEMENT','Income Statement','Review period revenue and expenses.',['profit and loss','profit & loss','p&l']],
  ['CASH_FLOW','Cash movement evidence','Review direct cash evidence without inferred classifications.',['statement of cash flows']],
]);
// The demonstration application had a much larger property-operation menu,
// but only these report readers have an authenticated accounting-API contract
// today.  Keeping this directory explicit makes the authoritative property
// workbench discoverable without pretending that legacy project, unit, loan,
// or property-operation records are available in the browser.
const PROPERTY_REPORT_SHORTCUTS=Object.freeze([
  ['PROPERTY_PROFITABILITY','Property P&L','Exact retained Property dimension on POSTED ledger lines.','OPERATING_ANALYSIS','PROPERTY'],
  ['PROJECT_PROFITABILITY','Project P&L','Exact retained Project dimension on POSTED ledger lines.','OPERATING_ANALYSIS','PROJECT'],
  ['UNIT_PROFITABILITY','Unit profitability','Exact retained Unit dimension on POSTED ledger lines.','OPERATING_ANALYSIS','UNIT'],
  ['CWIP_ROLLFORWARD','CWIP rollforward','Approved CWIP mappings and POSTED ledger movement.','CASH_AND_CAPITAL',null],
  ['CONSTRUCTION_LOAN_ROLLFORWARD','Construction loan rollforward','Approved loan mappings and POSTED ledger movement.','CASH_AND_CAPITAL',null],
  ['PREPAID_ROLLFORWARD','Prepaid rollforward','Approved prepaid mappings and POSTED ledger movement.','CASH_AND_CAPITAL',null],
  ['BUDGET_VS_ACTUAL','Budget versus actual','Approved immutable budget snapshot versus POSTED actual.','OPERATING_ANALYSIS',null],
]);
const normalizedFinderText=value=>String(value??'').trim().toLowerCase();
// These aliases are labels for the same four authenticated API readers above,
// not new report definitions.  In particular, Profit and Loss maps to the
// existing Income Statement reader; it does not infer a new statement, read a
// demonstration fixture, or change the accounting basis.
export const findAuthoritativeReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return REPORT_LIBRARY_SHORTCUTS.filter(([,label,description,aliases=[]])=>
    [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle)));
};
export const findAuthoritativePropertyReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return PROPERTY_REPORT_SHORTCUTS.filter(([,label,description])=>
    `${label} ${description}`.toLowerCase().includes(needle));
};
export const DEFAULT_AUTHORITATIVE_REPORTS_CATALOG=Object.freeze({category:'STATEMENTS',query:'',preview:'TRIAL_BALANCE'});
export const normalizeAuthoritativeReportsCatalog=value=>{
  const candidate=value&&typeof value==='object'?value:{};
  const category=REPORT_WORKBENCH_TABS.some(([key])=>key===candidate.category)?candidate.category:DEFAULT_AUTHORITATIVE_REPORTS_CATALOG.category;
  const query=typeof candidate.query==='string'?candidate.query.slice(0,120):'';
  const preview=REPORTS.some(([key])=>key===candidate.preview)?candidate.preview:DEFAULT_AUTHORITATIVE_REPORTS_CATALOG.preview;
  return {category,query,preview};
};
const DIMENSION_TYPES=Object.freeze([['PROPERTY','Property P&L'],['PROJECT','Project P&L'],['UNIT','Unit profitability']]);
const fixed4=value=>{const match=/^(-?)([0-9]+)\.([0-9]{4})$/.exec(String(value??'0.0000'));if(!match)return 0n;return BigInt(`${match[1]}${match[2]}${match[3]}`);};
const fixed4String=value=>{const negative=value<0n,absolute=negative?-value:value,digits=absolute.toString().padStart(5,'0');return `${negative?'-':''}${digits.slice(0,-4)}.${digits.slice(-4)}`;};
const add=(...values)=>fixed4String(values.reduce((sum,value)=>sum+fixed4(value),0n));
const subtract=(left,right)=>fixed4String(fixed4(left)-fixed4(right));
const money=value=>{const units=fixed4(value),negative=units<0n,absolute=negative?-units:units,cents=(absolute+50n)/100n,whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),fraction=(cents%100n).toString().padStart(2,'0');return `${negative?'-':''}$${whole}.${fraction}`;};
const sumRows=(rows,sections=null)=>fixed4String(rows.reduce((sum,row)=>sections&&!sections.includes(row.statement_section)?sum:sum+fixed4(row.display_balance),0n));
const sumCashFlowRows=(rows,sections=null)=>fixed4String(rows.reduce((sum,row)=>sections&&!sections.includes(row.classification)?sum:sum+fixed4(row.cash_effect),0n));

export const FinancialStatementSummary=({report,rows})=>{
  if(report==='BALANCE_SHEET'){
    const assets=sumRows(rows,['ASSETS']),liabilities=sumRows(rows,['LIABILITIES']),equity=sumRows(rows,['EQUITY','CURRENT_EARNINGS']),right=add(liabilities,equity),difference=subtract(assets,right);
    return <div className="qbo-toolgrid" aria-label="Balance Sheet equation"><span><i>Assets</i><b>{money(assets)}</b></span><span><i>Liabilities</i><b>{money(liabilities)}</b></span><span><i>Equity and current earnings</i><b>{money(equity)}</b></span><span><i>Assets - liabilities - equity</i><b>{money(difference)}</b></span></div>;
  }
  if(report==='INCOME_STATEMENT'){
    const revenue=sumRows(rows,['REVENUE']),expense=sumRows(rows,['EXPENSES']);
    return <div className="qbo-toolgrid" aria-label="Income Statement equation"><span><i>Revenue</i><b>{money(revenue)}</b></span><span><i>Expenses</i><b>{money(expense)}</b></span><span><i>Net income</i><b>{money(subtract(revenue,expense))}</b></span></div>;
  }
  if(report==='CASH_FLOW')return <div className="qbo-toolgrid" aria-label="Direct cash movement evidence"><span><i>Direct cash-account movement</i><b>{money(sumRows(rows))}</b></span><span><i>Classification boundary</i><b>Not classified as operating, investing, or financing</b></span></div>;
  return <div className="qbo-toolgrid" aria-label="Trial Balance control"><span><i>Net debit balance</i><b>{money(sumRows(rows))}</b></span></div>;
};

// Property, project, and unit reporting must stay scoped to an exact retained
// dimension.  This summary deliberately uses the same fixed-point evidence
// rows that power the table below; it never looks up a browser-side property
// record or derives a dimension from a description.
export const DimensionProfitabilitySummary=({rows,dimensionType,dimensionRef})=>{
  const revenue=sumRows(rows,['REVENUE']);
  const expenses=sumRows(rows,['EXPENSES']);
  return <div className="qbo-toolgrid authoritative-profitability-summary" aria-label={`${dimensionType} profitability summary for ${dimensionRef}`}>
    <span><i>Exact {dimensionType.toLowerCase()} reference</i><b>{dimensionRef}</b></span>
    <span><i>Revenue</i><b>{money(revenue)}</b></span>
    <span><i>Expenses</i><b>{money(expenses)}</b></span>
    <span><i>Net income</i><b>{money(subtract(revenue,expenses))}</b></span>
  </div>;
};

const EvidenceIds=({label,ids=[]})=><div><b>{label}</b>{ids.length?<ul className="evidence-id-list">{ids.map(id=><li key={id}><code>{id}</code></li>)}</ul>:<p className="muted sm">No retained identifier.</p>}</div>;
const ReadError=({state,onRetry,label='Retry read'})=><AuthoritativeReadFailure state={state} onRetry={onRetry} retryLabel={label}/>;
const ScopeLabel=({context,extra=''})=><span title={`Entity ID: ${context?.entityId||'Unavailable'}; Period ID: ${context?.periodId||'Unavailable'}`}>Configured entity ? Configured period{extra}</span>;

const CashFlowDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Cash flow classification evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to statement of cash flows</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.classification==='BLOCKED'?'Blocked cash-flow classification':`${row.classification} cash flow`}</h2><p className="muted sm">Cash {row.cash_account_code} ? Counterpart {row.counterpart_account_code}</p></div><span className={row.mapping_status==='CLASSIFIED'?'badge badge-muted':'badge badge-danger'}>{row.mapping_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Cash effect</i><b>{money(row.cash_effect)}</b></span><span><i>Mapping snapshot</i><b>{row.mapping_snapshot_id||'Not admitted'}</b></span><span><i>Mapping version</i><b>{row.mapping_version||'Not admitted'}</b></span></div>
  <p className="muted sm">Classification basis: {row.classification_basis}.{row.mapping_snapshot_hash&&` Immutable mapping hash: ${row.mapping_snapshot_hash}.`}</p>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
</section>;

const IntercompanyDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Intercompany reconciliation evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to intercompany reconciliation</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} ? {row.counterparty_account_code}</h2><p className="muted sm">Exact bidirectional intercompany mapping and POSTED-ledger evidence only.</p></div><span className={row.mapping_status==='MAPPED_INTERCOMPANY_PAIR'?'badge badge-muted':'badge badge-danger'}>{row.mapping_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Current entity</i><b>{row.current_closing_balance===null?'Blocked':money(row.current_closing_balance)}</b></span><span><i>Counterparty</i><b>{row.counterparty_closing_balance===null?'Blocked':money(row.counterparty_closing_balance)}</b></span><span><i>Difference</i><b>{row.difference_amount===null?'Blocked':money(row.difference_amount)}</b></span><span><i>Result</i><b>{row.in_balance?'Tied':'Review required'}</b></span></div>
  <p className="muted sm">{row.classification_basis}. No elimination or adjustment is created by this report.</p>
  <div className="detail-grid"><EvidenceIds label="Current journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Current sources" ids={row.source_document_ids}/><EvidenceIds label="Counterparty journal entries" ids={row.counterparty_journal_entry_ids}/><EvidenceIds label="Counterparty sources" ids={row.counterparty_source_document_ids}/></div>
</section>;

const BudgetActualDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Budget versus actual evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to budget versus actual</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">Approved immutable budget snapshot compared only with same-period POSTED ledger evidence.</p></div><span className={row.report_status==='APPROVED_BUDGET_VS_ACTUAL'?'badge badge-muted':'badge badge-danger'}>{row.report_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Budget</i><b>{row.budget_amount===null?'Blocked':money(row.budget_amount)}</b></span><span><i>Actual</i><b>{row.actual_amount===null?'Blocked':money(row.actual_amount)}</b></span><span><i>Variance</i><b>{row.variance_amount===null?'Blocked':money(row.variance_amount)}</b></span><span><i>Comparison side</i><b>{row.comparison_side}</b></span></div>
  <p className="muted sm">{row.classification_basis}. Snapshot <code>{row.budget_snapshot_id}</code> v{row.budget_version}; receipt {row.budget_receipt_hash}; source {row.budget_source_ref} v{row.budget_source_version}. This read cannot create or revise a budget, journal, mapping, or adjustment.</p>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
</section>;

const ConsolidationDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Consolidation evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to consolidation</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.presentation_account_code} - {row.presentation_side}</h2><p className="muted sm">Immutable member/account mapping, approved elimination evidence, and POSTED ledger only.</p></div><span className={row.report_status==='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT'?'badge badge-muted':'badge badge-danger'}>{row.report_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Member actual</i><b>{row.member_actual_amount===null?'Blocked':money(row.member_actual_amount)}</b></span><span><i>Approved elimination</i><b>{row.elimination_amount===null?'Blocked':money(row.elimination_amount)}</b></span><span><i>Consolidated</i><b>{row.consolidated_amount===null?'Blocked':money(row.consolidated_amount)}</b></span><span><i>Members with evidence</i><b>{row.evidence_member_count}/{row.member_count}</b></span></div>
  <p className="muted sm">{row.classification_basis}. Snapshot <code>{row.consolidation_snapshot_id}</code> v{row.consolidation_version}; receipt {row.consolidation_receipt_hash}. This report creates no elimination journal or adjustment.</p>
  <div className="detail-grid"><EvidenceIds label="Member entities" ids={row.member_entity_ids}/><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
</section>;

const EvidenceDrillAction=({row,onOpenLineage})=>hasCompleteReportLineage(row)?<div className="row-acts"><button type="button" className="btn btn-sm" onClick={()=>onOpenLineage(row)}>Open GL / Journal / source drill</button></div>:<StateBlock tone="blocked" title="BLOCKED - authoritative lineage unavailable">This evidence row cannot open a drill until the accounting API returns Journal Entry, Journal Line, ledger-line, and source-document identifiers together.</StateBlock>;

const RollforwardDetail=({title,row,returnContext,onBack,onOpenLineage})=>{
  const movements=row.period_draws!==undefined?[['Period draws',row.period_draws],['Period repayments',row.period_repayments]]:row.period_additions!==undefined?[['Period additions',row.period_additions],['Period amortization',row.period_amortization]]:[['Period debit',row.period_debit],['Period credit',row.period_credit]];
  return <section className="full-bleed qbo-transaction-report" aria-label={`${title} evidence`}>
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to {title.toLowerCase()}</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">{title} is shown only from retained mapping and POSTED-ledger evidence.</p></div><span className={row.mapping_status?.startsWith('MAPPED')?'badge badge-muted':'badge badge-danger'}>{row.mapping_status||'BLOCKED'}</span></div>
  <div className="qbo-toolgrid"><span><i>Opening</i><b>{row.opening_balance===null?'Blocked':money(row.opening_balance)}</b></span>{movements.map(([label,value])=><span key={label}><i>{label}</i><b>{value===null?'Blocked':value===undefined?'Not supplied':money(value)}</b></span>)}<span><i>Closing</i><b>{row.closing_balance===null?'Blocked':money(row.closing_balance)}</b></span></div>
  <p className="muted sm">Mapping snapshot {row.mapping_snapshot_id||'not admitted'} v{row.mapping_version||'?'}. This read creates no capitalization, loan, prepaid, journal, or adjustment.</p>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
  <EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/>
</section>;

// CWIP is a property-accounting control, not merely a balance presentation.
// Keep its evidence page specific so a controller can see the immutable
// mapping decision and every retained trace without navigating through a
// demonstration-only project-cost screen.
const CwipRollforwardDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report authoritative-cwip-detail" aria-label="CWIP rollforward account evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to CWIP rollforward</button><ScopeLabel context={returnContext}/></div>
  <header className="card-head"><div><div className="page-eyebrow">CASH &amp; CAPITAL | POSTED EVIDENCE</div><h1 className="page-h">{row.account_code} - {row.account_name}</h1><p className="muted sm">CWIP account movement is admitted only from one approved mapping snapshot and exact POSTED ledger evidence.</p></div><span className={row.mapping_status==='MAPPED_CWIP_ACCOUNT'?'badge badge-muted':'badge badge-danger'}>{row.mapping_status||'BLOCKED'}</span></header>
  <div className="qbo-toolgrid" aria-label="CWIP rollforward movement"><span><i>Opening</i><b>{row.opening_balance===null?'Blocked':money(row.opening_balance)}</b></span><span><i>Period debit</i><b>{row.period_debit===null?'Blocked':money(row.period_debit)}</b></span><span><i>Period credit</i><b>{row.period_credit===null?'Blocked':money(row.period_credit)}</b></span><span><i>Closing</i><b>{row.closing_balance===null?'Blocked':money(row.closing_balance)}</b></span></div>
  <section className="card authoritative-cwip-mapping" aria-label="CWIP mapping scope"><div className="card-head"><div><h2>Evidence scope</h2><p className="muted sm">This is a retained classification decision, not an inferred capitalization conclusion.</p></div><span className="badge badge-muted">READ ONLY</span></div><div className="detail-grid"><div><i>Mapping snapshot</i><b>{row.mapping_snapshot_id||'Not admitted'}</b></div><div><i>Mapping version</i><b>{row.mapping_version||'Not admitted'}</b></div><div><i>Mapping hash</i><b><code>{row.mapping_snapshot_hash||'Not admitted'}</code></b></div><div><i>Classification basis</i><b>{row.classification_basis||'Not admitted'}</b></div></div></section>
  <p className="muted sm">This read never creates capitalization, a transfer, a write-off, a journal, or an adjustment. Missing, ambiguous, or invalid mapping evidence remains blocked.</p>
  <section className="card" aria-label="CWIP retained trace"><div className="card-head"><div><h2>Retained trace</h2><p className="muted sm">Use these immutable identifiers to continue an authorized server-backed evidence drill.</p></div></div><div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div><EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/></section>
</section>;

const DimensionProfitabilityDetail=({row,returnContext,onBack,onOpenLineage})=>{
  const dimension=returnContext?.dimension;
  const type=row.dimension_type||dimension?.type||'DIMENSION';
  const reference=row.dimension_ref||dimension?.ref||'Unavailable';
  return <section className="full-bleed qbo-transaction-report authoritative-profitability-detail" aria-label={`${type} profitability account evidence`}>
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to {type.toLowerCase()} profitability</button><ScopeLabel context={returnContext}/></div>
    <header className="card-head"><div><div className="page-eyebrow">OPERATING ANALYSIS | POSTED EVIDENCE</div><h1 className="page-h">{type} P&amp;L ? {reference}</h1><p className="muted sm">This account is included only because its POSTED ledger line retained this exact dimension. The report does not infer a property, project, or unit from a memo, source header, or browser state.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    <div className="qbo-toolgrid" aria-label="Dimension profitability account summary"><span><i>Account</i><b>{row.account_code} ? {row.account_name}</b></span><span><i>Statement section</i><b>{row.statement_section}</b></span><span><i>Period debit</i><b>{money(row.period_debit)}</b></span><span><i>Period credit</i><b>{money(row.period_credit)}</b></span><span><i>Statement balance</i><b>{money(row.display_balance)}</b></span></div>
    <section className="card" aria-label="Exact dimension scope"><div className="card-head"><div><h2>Evidence scope</h2><p className="muted sm">The API returned this immutable entity, period, dimension, and classification boundary.</p></div><span className="badge badge-muted">API GET</span></div><div className="detail-grid"><div><i>Dimension type</i><b>{type}</b></div><div><i>Exact reference</i><b>{reference}</b></div><div><i>Classification basis</i><b>{row.classification_basis}</b></div><div><i>Period</i><b>{row.period_code} ? {row.period_start} through {row.period_end}</b></div></div></section>
    <section className="card" aria-label="Dimension profitability retained trace"><div className="card-head"><div><h2>Retained trace</h2><p className="muted sm">These identifiers are supplied by the accounting API for an authorized server-backed evidence drill.</p></div></div><div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div><EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/></section>
  </section>;
};
};

const ComparisonDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Prior-period comparison evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to prior-period comparison</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">{row.statement_type} / {row.statement_section}</p></div><span className={row.comparison_status==='COMPARABLE_POSTED_EVIDENCE'?'badge badge-muted':'badge badge-danger'}>{row.comparison_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Current period</i><b>{row.current_display_balance===null?'Evidence missing':money(row.current_display_balance)}</b></span><span><i>Prior period</i><b>{row.prior_display_balance===null?'Evidence missing':money(row.prior_display_balance)}</b></span><span><i>Current period code</i><b>{row.current_period_code}</b></span><span><i>Prior period code</i><b>{row.prior_period_code}</b></span></div>
  <div className="detail-grid"><EvidenceIds label="Current journal entries" ids={row.current_journal_entry_ids}/><EvidenceIds label="Current source documents" ids={row.current_source_document_ids}/><EvidenceIds label="Prior journal entries" ids={row.prior_journal_entry_ids}/><EvidenceIds label="Prior source documents" ids={row.prior_source_document_ids}/></div>
</section>;

const hasCompleteReportLineage=row=>['journal_entry_ids','journal_line_ids','ledger_line_ids','source_document_ids'].every(field=>Array.isArray(row?.[field])&&row[field].length>0);
const reportRowMatchesReturnContext=(row,context)=>Boolean(
  row && context
  && row.period_id===context.periodId
  && row.statement_type===context.report
  && row.account_code===context.reportAccountCode
  && row.statement_section===context.reportSection
  && (row.dimension_type||null)===(context.reportDimensionType||null)
  && (row.dimension_ref||null)===(context.reportDimensionRef||null),
);

const statementLabel=report=>REPORTS.find(([key])=>key===report)?.[1]||'Financial statement';

// The report API returns account rows and their declared statement sections; it
// does not return a report-builder document, configurable columns, or saved
// totals.  Keep this full page deliberately narrow: it is a readable view of
// that one authenticated response, not a browser-side reconstruction of a
// demonstration report.
export const AuthoritativeFullStatementReport=({report,rows,returnContext,onBack,onRefresh,onOpenEvidence,loading=false})=>{
  const title=statementLabel(report);
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement" aria-label={`${title} full report`}>
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to Reports</button><ScopeLabel context={returnContext} extra={` ? ${title}`}/></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">POSTED EVIDENCE | API GET</div><h1 className="page-h">{title}</h1><p className="page-subtitle">Entity- and period-scoped statement evidence from the authenticated accounting API. This page has no saved layout, export, delivery, or browser data fallback.</p></div><div className="report-period-chip"><span>Evidence scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={onRefresh}>Refresh statement evidence</button><span className="badge badge-muted">GET ONLY</span></div>
    {!rows.length?<StateBlock tone="empty" title="No POSTED ledger evidence returned">No POSTED ledger evidence was returned for this statement and period.</StateBlock>:<div className={`table-wrap reports-workbench-table authoritative-full-statement-table ${report==='TRIAL_BALANCE'?'trial-balance-table':''}`} tabIndex={0} aria-label={`${title} rows; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Section</th><th>Account</th><th>Period debit</th><th>Period credit</th><th>Balance</th><th>Evidence</th></tr></thead><tbody>{rows.map((row,index)=>{const focusId=`authoritative-full-report-${row.statement_type}-${row.account_code}`;const beginsSection=index===0||rows[index-1].statement_section!==row.statement_section;return <React.Fragment key={`${row.statement_type}:${row.account_code}`}>{beginsSection&&<tr className="report-section-row"><th colSpan="6" scope="rowgroup">{row.statement_section}</th></tr>}<tr><td>{row.statement_section}</td><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(row.period_debit)}</td><td className="num">{money(row.period_credit)}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>onOpenEvidence(row,focusId)}>Open evidence</button></td></tr></React.Fragment>;})}</tbody></table></div>}
  </section>;
};

export const AuthoritativeReportDetail=({row,returnContext,onBack})=>{
  const scopeMatches=reportRowMatchesReturnContext(row,returnContext);
  const lineageComplete=hasCompleteReportLineage(row);
  if(!scopeMatches)return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Financial statement account evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to financial statement</button><ScopeLabel context={returnContext} extra={` ? ${returnContext?.report||'Report'}`}/></div>
    <StateBlock tone="blocked" title="BLOCKED ? immutable report scope mismatch">This report row does not match the account, section, dimension, entity, period, and statement retained when the evidence page was opened. It remains visible for review, but cannot support a posted-evidence assertion or Journal/source drill.</StateBlock>
  </section>;
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Financial statement account evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to financial statement</button><ScopeLabel context={returnContext} extra={` ? ${returnContext?.report||'Report'}`}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">{row.statement_type} / {row.statement_section}</p></div><span className={lineageComplete?'badge badge-muted':'badge badge-danger'}>{lineageComplete?'POSTED EVIDENCE':'BLOCKED'}</span></div>
  <div className="qbo-toolgrid">
    {row.opening_debit!==undefined&&<><span><i>Opening debits</i><b>{money(row.opening_debit)}</b></span><span><i>Opening credits</i><b>{money(row.opening_credit)}</b></span></>}
    <span><i>Period debits</i><b>{money(row.period_debit)}</b></span><span><i>Period credits</i><b>{money(row.period_credit)}</b></span>
    <span><i>Statement balance</i><b>{money(row.display_balance)}</b></span>
  </div>
  <p className="muted sm">Classification basis: {row.classification_basis}. Period {row.period_code}, {row.period_start} through {row.period_end}.{row.dimension_type&&` Exact ${row.dimension_type.toLowerCase()} ${row.dimension_ref}.`}</p>
  <div className="detail-grid">
    <EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/>
    <EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/>
  </div>
  {!lineageComplete&&<StateBlock tone="blocked" title="BLOCKED ? authoritative lineage unavailable">This report row remains visible as scoped statement data, but it cannot support a Journal Entry or source drill until the accounting API returns Journal Entry, Journal Line, ledger-line, and source-document identifiers together.</StateBlock>}
</section>;
};

export function AuthoritativeReportsWorkspace({config,fetcher=globalThis.fetch,environment=globalThis,initialCatalog=DEFAULT_AUTHORITATIVE_REPORTS_CATALOG,onOpenArAging=()=>{},workspaceTitle='Reports center',workspaceEyebrow='AUTHORITATIVE ? REPORTING',workspaceDescription='OIDC-authenticated, entity-and-period-scoped POSTED ledger evidence. Every displayed report reads the accounting API; no browser data is used.',initialDimensionType='PROPERTY'}){
  const entityLabel=config?.scopePresentation?.entityLabel||'Configured entity';
  const periodLabel=config?.scopePresentation?.periodLabel||'Configured period';
  const initialCatalogState=normalizeAuthoritativeReportsCatalog(initialCatalog);
  const initialDimension=DIMENSION_TYPES.some(([key])=>key===initialDimensionType)?initialDimensionType:'PROPERTY';
  const [report,setReport]=useState(initialCatalogState.preview);
  const [workbenchTab,setWorkbenchTab]=useState(initialCatalogState.category);
  const [catalogSearch,setCatalogSearch]=useState(initialCatalogState.query);
  const [selected,setSelected]=useState(null);
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [statementSnapshotState,setStatementSnapshotState]=useState({phase:'IDLE',rows:[],error:null,scope:null,snapshotId:null,version:null});
  const [dimensionType,setDimensionType]=useState(initialDimension);
  const [dimensionRef,setDimensionRef]=useState('');
  const [dimensionState,setDimensionState]=useState({phase:'IDLE',rows:[],error:null,scope:null});
  const [cashFlowState,setCashFlowState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [cwipState,setCwipState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [constructionLoanState,setConstructionLoanState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [prepaidState,setPrepaidState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [counterpartyEntityId,setCounterpartyEntityId]=useState('');
  const [counterpartyPeriodId,setCounterpartyPeriodId]=useState('');
  const [intercompanyState,setIntercompanyState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [budgetState,setBudgetState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [consolidationGroupRef,setConsolidationGroupRef]=useState('');
  const [consolidationState,setConsolidationState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [priorPeriodId,setPriorPeriodId]=useState('');
  const [comparisonState,setComparisonState]=useState({phase:'IDLE',rows:[],error:null,scope:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeFinancialStatements({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result});};
  const loadStatementSnapshot=async()=>{setStatementSnapshotState({phase:'LOADING',rows:[],error:null,scope:null,snapshotId:null,version:null});const result=await refreshAuthoritativeFinancialStatementSnapshot({config,fetcher});setStatementSnapshotState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,snapshotId:result.snapshotId,version:result.version}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,snapshotId:null,version:null});};
  const loadDimension=async()=>{setDimensionState({phase:'LOADING',rows:[],error:null,scope:null});const result=await refreshAuthoritativeDimensionProfitability({config,dimensionType,dimensionRef,fetcher});setDimensionState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null});};
  const loadCashFlow=async()=>{setCashFlowState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeCashFlowClassification({config,fetcher});setCashFlowState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadCwip=async()=>{setCwipState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeCwipRollforward({config,fetcher});setCwipState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadConstructionLoan=async()=>{setConstructionLoanState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeConstructionLoanRollforward({config,fetcher});setConstructionLoanState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadPrepaid=async()=>{setPrepaidState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativePrepaidRollforward({config,fetcher});setPrepaidState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadIntercompany=async()=>{setIntercompanyState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeIntercompanyReconciliation({config,counterpartyEntityId,counterpartyPeriodId,fetcher});setIntercompanyState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadBudget=async()=>{setBudgetState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeBudgetVsActual({config,fetcher});setBudgetState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadConsolidation=async()=>{setConsolidationState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeConsolidation({config,groupRef:consolidationGroupRef,fetcher});setConsolidationState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadComparison=async()=>{setComparisonState({phase:'LOADING',rows:[],error:null,scope:null});const result=await refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId,fetcher});setComparisonState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null});};
  useEffect(()=>{load();},[config?.entityId,config?.periodId]);
  const rows=useMemo(()=>state.rows.filter(row=>row.statement_type===report),[state.rows,report]);
  const openEvidence=(row,focusId,kind='STATEMENT',title=null,detailContext=null)=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({kind,row,title,returnContext:{...base,report,reportAccountCode:row.account_code||null,reportSection:row.statement_section||null,reportDimensionType:row.dimension_type||null,reportDimensionRef:row.dimension_ref||null,workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}),...(detailContext&&typeof detailContext==='object'?detailContext:{})}});
  };
  const openPropertyReport=(shortcut)=>{
    const [, , ,nextTab,nextDimensionType]=shortcut;
    setWorkbenchTab(nextTab);
    if(nextDimensionType){
      setDimensionType(nextDimensionType);
      setDimensionState({phase:'IDLE',rows:[],error:null,scope:null});
    }
    setSelected(null);
  };
  const openFullStatement=(focusId='authoritative-open-full-statement')=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({kind:'FULL_STATEMENT',rows,returnContext:{...base,report,workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report})}});
  };
  const openEvidenceFromFullStatement=(row,focusId)=>{
    const parent=selected;
    if(!parent||parent.kind!=='FULL_STATEMENT')return;
    setSelected({kind:'STATEMENT',row,returnContext:{...parent.returnContext,reportAccountCode:row.account_code||null,reportSection:row.statement_section||null,reportDimensionType:row.dimension_type||null,reportDimensionRef:row.dimension_ref||null,focusId,parentFullStatement:parent}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.parentFullStatement?.kind==='FULL_STATEMENT'){
      setSelected(context.parentFullStatement);
      return;
    }
    if(REPORTS.some(([key])=>key===context?.report))setReport(context.report);
    if(REPORT_WORKBENCH_TABS.some(([key])=>key===context?.workbenchTab))setWorkbenchTab(context.workbenchTab);
    const catalog=normalizeAuthoritativeReportsCatalog(context?.reportsCatalog);
    setWorkbenchTab(catalog.category);
    setCatalogSearch(catalog.query);
    setReport(catalog.preview);
    if(['PROPERTY','PROJECT','UNIT'].includes(context?.dimension?.type)&&typeof context.dimension.ref==='string'&&context.dimension.ref.trim()){
      setDimensionType(context.dimension.type);
      setDimensionRef(context.dimension.ref);
    }
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  };
  const openEvidenceLineage=row=>{const detail=selected;const context=detail?.returnContext;if(!detail||!context)return;setSelected({kind:'EVIDENCE_LINEAGE',row,returnTo:detail,returnContext:context});};
  if(selected)return selected.kind==='FULL_STATEMENT'?<AuthoritativeFullStatementReport report={selected.returnContext.report} rows={rows} returnContext={selected.returnContext} onBack={closeEvidence} onRefresh={load} loading={state.phase==='LOADING'} onOpenEvidence={openEvidenceFromFullStatement}/>:selected.kind==='STATEMENT'&&reportRowMatchesReturnContext(selected.row,selected.returnContext)&&hasCompleteReportLineage(selected.row)?<AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'REPORT',row:selected.row,context:{entityId:config.entityId,periodId:config.periodId,report:selected.row.statement_type,accountCode:selected.row.account_code,section:selected.row.statement_section}}} onExit={closeEvidence}/>:selected.kind==='EVIDENCE_LINEAGE'?<AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'EVIDENCE',row:selected.row,context:{entityId:config.entityId,periodId:config.periodId,accountCode:selected.row.account_code}}} onExit={()=>setSelected(selected.returnTo)}/>:selected.kind==='CASH_FLOW_CLASSIFICATION'?<CashFlowDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='INTERCOMPANY_RECONCILIATION'?<IntercompanyDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='BUDGET_VS_ACTUAL'?<BudgetActualDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='CONSOLIDATION'?<ConsolidationDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='PERIOD_COMPARISON'?<ComparisonDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='CWIP_ROLLFORWARD'?<CwipRollforwardDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:selected.kind==='DIMENSION_PROFITABILITY'?<DimensionProfitabilityDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:selected.kind==='ROLLFORWARD'?<RollforwardDetail title={selected.title} row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:<AuthoritativeReportDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>;
  const matchingWorkbenchTabs=REPORT_WORKBENCH_TABS.filter(([,label,description])=>`${label} ${description}`.toLowerCase().includes(catalogSearch.trim().toLowerCase()));
  const matchingShortcuts=findAuthoritativeReportShortcuts(catalogSearch);
  const matchingPropertyShortcuts=findAuthoritativePropertyReportShortcuts(catalogSearch);
  const visibleWorkbenchTabs=catalogSearch.trim()?matchingWorkbenchTabs:REPORT_WORKBENCH_TABS;
  return <AuthoritativeDemoReportsView className="reports-library authoritative-reports-library" eyebrow={workspaceEyebrow} title={workspaceTitle} description={workspaceDescription} scope={<div className="report-period-chip"><span>Reporting scope</span><b title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}>Entity {entityLabel} · Period {periodLabel}</b><small>POSTED ledger evidence</small></div>}>
    <div className="authoritative-workbench-rail" aria-label="Reports workspace structure"><span><b>1</b> Find</span><span><b>2</b> Read API evidence</span><span><b>3</b> Open full report</span></div>
    <section className="card authoritative-report-finder" aria-label="Authoritative reports catalog"><div className="card-head"><div><h2>Find a report</h2><p className="muted sm">Browse report families or use the finder. A direct Reports entry starts from this catalog; an evidence Back returns to the same category, query, and statement preview.</p></div><span className="badge badge-muted">API READS ONLY</span></div><label>Find a report<input value={catalogSearch} maxLength="120" onChange={event=>setCatalogSearch(event.target.value)} placeholder="e.g. balance sheet, profit and loss, cash, budget"/></label>{catalogSearch.trim()&&<p className="muted sm">{matchingWorkbenchTabs.length?matchingWorkbenchTabs.map(([,label])=>label).join(' ? '):matchingShortcuts.length?`Matching statement: ${matchingShortcuts.map(([,label])=>label).join(', ')}.`:'No API-backed report category matches this search.'}</p>}</section>
    {!!catalogSearch.trim()&&!!matchingShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching API-backed statements"><div><span className="page-eyebrow">MATCHING STATEMENTS</span><p className="muted sm">These links select an existing authenticated statement reader. They do not create a favorite or save a browser report state.</p></div><div className="authoritative-report-shortcut-grid">{matchingShortcuts.map(([key,label,description])=><button key={key} type="button" className={`authoritative-report-shortcut ${report===key&&workbenchTab==='STATEMENTS'?'is-current':''}`} aria-pressed={report===key&&workbenchTab==='STATEMENTS'} onClick={()=>{setWorkbenchTab('STATEMENTS');setReport(key);setSelected(null);}}><span>{label}</span><small>{description}</small></button>)}</div></section>}
    <section className="authoritative-report-shortcuts authoritative-property-report-directory" aria-label="Property and project report directory"><div><span className="page-eyebrow">PROPERTY &amp; PROJECT REPORTS</span><p className="muted sm">Open an existing API-backed workbench. A selected Property, Project, or Unit report still requires its exact retained dimension reference before any data is read.</p></div><div className="authoritative-report-shortcut-grid">{PROPERTY_REPORT_SHORTCUTS.filter(shortcut=>!catalogSearch.trim()||matchingPropertyShortcuts.includes(shortcut)).map(shortcut=>{const [key,label,description,nextTab,nextDimensionType]=shortcut;const active=workbenchTab===nextTab&&(!nextDimensionType||dimensionType===nextDimensionType);return <button key={key} type="button" className={`authoritative-report-shortcut ${active?'is-current':''}`} aria-pressed={active} onClick={()=>openPropertyReport(shortcut)}><span>{label}</span><small>{description}</small></button>;})}</div></section>
    <div className="rep-grid" role="tablist" aria-label="Reports workbench">{(catalogSearch.trim()?matchingWorkbenchTabs:REPORT_WORKBENCH_TABS).map(([key,label,description])=><button type="button" role="tab" aria-selected={workbenchTab===key} className={`rep-card ${workbenchTab===key?'rep-on':''}`} key={key} onClick={()=>{setWorkbenchTab(key);setSelected(null);}}><span className="rep-main"><span className="rep-name">{label}</span><span className="rep-desc">{description}</span></span><span className="rep-tag"><span>API</span><span aria-hidden="true">?</span></span></button>)}</div>
    {!matchingWorkbenchTabs.length&&catalogSearch.trim()&&<StateBlock tone="empty" title="No API-backed report category matches">Clear the report finder to view all report families. No report data has been inferred or loaded from a browser cache.</StateBlock>}
    <section className="report-workbench" aria-label={`${REPORT_WORKBENCH_TABS.find(([key])=>key===workbenchTab)?.[1]} report workspace`}><div className="report-workbench-head"><div><b>{REPORT_WORKBENCH_TABS.find(([key])=>key===workbenchTab)?.[1]}</b><div className="page-subtitle">{REPORT_WORKBENCH_TABS.find(([key])=>key===workbenchTab)?.[2]} Each read is a real API GET; no browser-stored accounting data is used.</div></div>{workbenchTab==='STATEMENTS'?<button type="button" className="btn btn-sm btn-ghost" disabled={state.phase==='LOADING'} onClick={load}>Refresh statement evidence</button>:<span className="badge badge-muted">READ ONLY</span>}</div>
    {workbenchTab==='STATEMENTS'&&<>
    <section className="authoritative-report-shortcuts" aria-label="Core statement shortcuts"><div><span className="page-eyebrow">CORE REPORTS</span><p className="muted sm">Open a statement view from the same authenticated API response.</p></div><div className="authoritative-report-shortcut-grid">{REPORT_LIBRARY_SHORTCUTS.map(([key,label,description])=><button key={key} type="button" className={`authoritative-report-shortcut ${report===key?'is-current':''}`} aria-pressed={report===key} onClick={()=>{setReport(key);setSelected(null);}}><span>{label}</span><small>{description}</small></button>)}</div></section>
    <section className="card authoritative-statement-snapshot" aria-label="Financial statement snapshot version evidence"><div className="card-head"><div><h2>Statement snapshot / version</h2><p className="muted sm">Read the latest approved immutable statement version separately from the live POSTED-ledger view. Snapshot rows retain the exact GL, Journal, and source identifiers that were frozen with the version.</p></div><span className="badge badge-muted">GET ONLY</span></div><div className="qbo-filter-grid"><button type="button" className="btn" disabled={statementSnapshotState.phase==='LOADING'} onClick={loadStatementSnapshot}>Load statement snapshot</button></div>
      {statementSnapshotState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable statement snapshot evidence...</StateBlock>}
      <ReadError state={statementSnapshotState} onRetry={loadStatementSnapshot}/>
      {statementSnapshotState.phase==='READY'&&!statementSnapshotState.rows.length&&<StateBlock tone="empty" title="No approved statement snapshot returned">No approved immutable financial-statement snapshot was returned for this entity and period. This does not change the live POSTED-ledger statement evidence.</StateBlock>}
      {statementSnapshotState.phase==='READY'&&!!statementSnapshotState.rows.length&&<><p className="muted sm">Snapshot <code>{statementSnapshotState.snapshotId}</code> v{statementSnapshotState.version}. This is frozen report evidence; it never replaces the current ledger, posts a journal, or creates an approval.</p><div className="table-wrap" tabIndex={0} aria-label="Immutable financial statement snapshot rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Statement / account</th><th className="ta-r">Balance</th><th>Version evidence</th><th>Lineage</th></tr></thead><tbody>{statementSnapshotState.rows.map(row=><tr key={`${row.statement_type}:${row.account_code}`}><td><b>{row.account_code}</b><div className="muted sm">{row.statement_type} / {row.statement_section}</div></td><td className="num">{money(row.display_balance)}</td><td><code>{row.row_hash}</code><div className="muted sm">Prepared {row.prepared_by}; approved {row.approved_by}</div></td><td><span className="muted sm">JE {row.journal_entry_ids.length} · GL {row.ledger_line_ids.length} · Source {row.source_document_ids.length}</span></td></tr>)}</tbody></table></div></>}
    </section>
    <section className="card authoritative-aging-launch" aria-label="Accounts receivable aging summary shortcut"><div className="card-head"><div><h2>Accounts receivable aging summary</h2><p className="muted sm">Open the existing full-page, OIDC-authenticated aging evidence report. Back restores this Reports catalog, finder, and statement preview.</p></div><span className="badge badge-muted">READ ONLY</span></div><button id="authoritative-report-ar-aging" type="button" className="btn" onClick={()=>onOpenArAging('authoritative-report-ar-aging',normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}))}>Open aging report</button></section>
    <div className="tabs" role="tablist" aria-label="Financial statements">{REPORTS.map(([key,label])=><button type="button" role="tab" aria-selected={report===key} className={report===key?'tab active':'tab'} key={key} onClick={()=>{setReport(key);setSelected(null);}}>{label}</button>)}</div>
    <p className="muted sm" title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}>Entity {entityLabel} | Period {periodLabel} | Read only</p>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative financial statements...</StateBlock>}
    <ReadError state={state} onRetry={load}/>
    {state.phase==='READY'&&<section className="card" aria-label={`${REPORTS.find(item=>item[0]===report)?.[1]} rows`}>
      <div className="card-head"><div><h2>{REPORTS.find(item=>item[0]===report)?.[1]}</h2><p className="muted sm">{rows.length} accounts in retained evidence.</p></div><div className="row-acts"><span className="badge badge-muted">READ ONLY</span><button id="authoritative-open-full-statement" type="button" className="btn btn-sm btn-ghost" disabled={state.phase==='LOADING'} onClick={()=>openFullStatement('authoritative-open-full-statement')}>Open full report</button></div></div>
      {!!rows.length&&<FinancialStatementSummary report={report} rows={rows}/>}
      {report==='CASH_FLOW'&&<p className="muted sm">This view is direct cash-account movement evidence only. It is not a statement of cash flows and does not infer operating, investing, or financing activities.</p>}
      {!rows.length?<StateBlock tone="empty" title="No POSTED ledger evidence returned">No POSTED ledger evidence was returned for this statement and period.</StateBlock>:<div className={`table-wrap reports-workbench-table ${report==='TRIAL_BALANCE'?'trial-balance-table':''}`}><table className="tbl"><thead><tr><th>Section</th><th>Account</th><th>Period debit</th><th>Period credit</th><th>Balance</th><th>Evidence</th></tr></thead><tbody>{rows.map((row,index)=>{const focusId=`authoritative-report-${row.statement_type}-${row.account_code}`;const beginsSection=index===0||rows[index-1].statement_section!==row.statement_section;return <React.Fragment key={`${row.statement_type}:${row.account_code}`}>{beginsSection&&<tr className="report-section-row"><th colSpan="6" scope="rowgroup">{row.statement_section}</th></tr>}<tr><td>{row.statement_section}</td><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(row.period_debit)}</td><td className="num">{money(row.period_credit)}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId)}>Open evidence</button></td></tr></React.Fragment>;})}</tbody></table></div>}
    </section>}</>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<>
    <section className="card" aria-label="Statement of cash flows evidence">
      <div className="card-head"><div><h2>Statement of cash flows</h2><p className="muted sm">Operating, investing, and financing classification requires an exact approved immutable mapping for every POSTED bank-cash journal counterpart.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" onClick={loadCashFlow}>Load mapped cash-flow evidence</button></div>
      <p className="muted sm">No source label, account description, or account-code prefix is used to infer a classification. A missing, ambiguous, invalid, or multi-cash mapping stays BLOCKED and prevents statement totals from being asserted.</p>
      {cashFlowState.phase==='LOADING'&&<StateBlock tone="loading">Loading mapping-backed POSTED cash-flow evidence...</StateBlock>}
      <ReadError state={cashFlowState} onRetry={loadCashFlow}/>
      {cashFlowState.phase==='READY'&&!cashFlowState.rows.length&&<StateBlock tone="empty" title="No POSTED bank-cash evidence returned">This scoped empty result is not evidence of zero operating, investing, or financing cash flow.</StateBlock>}
      {cashFlowState.phase==='READY'&&!!cashFlowState.rows.length&&!cashFlowState.complete&&<StateBlock tone="error" title="BLOCKED_CASH_FLOW_CLASSIFICATION">At least one POSTED cash movement has no single valid mapping. REFS will not calculate operating, investing, or financing totals from this incomplete classification set.</StateBlock>}
      {cashFlowState.phase==='READY'&&cashFlowState.complete&&<div className="qbo-toolgrid" aria-label="Statement of cash flows totals"><span><i>Operating</i><b>{money(sumCashFlowRows(cashFlowState.rows,['OPERATING']))}</b></span><span><i>Investing</i><b>{money(sumCashFlowRows(cashFlowState.rows,['INVESTING']))}</b></span><span><i>Financing</i><b>{money(sumCashFlowRows(cashFlowState.rows,['FINANCING']))}</b></span><span><i>Net change in cash</i><b>{money(sumCashFlowRows(cashFlowState.rows))}</b></span></div>}
      {cashFlowState.phase==='READY'&&!!cashFlowState.rows.length&&<div className="table-wrap"><table className="tbl"><thead><tr><th>Classification</th><th>Cash / counterpart</th><th>Cash effect</th><th>Mapping</th><th>Evidence</th></tr></thead><tbody>{cashFlowState.rows.map(row=>{const focusId=`authoritative-cash-flow-${row.journal_entry_ids[0]}-${row.counterpart_account_code}`;return <tr key={`${row.journal_entry_ids[0]}:${row.cash_account_code}:${row.counterpart_account_code}`}><td><b>{row.classification}</b><div className="muted sm">{row.mapping_status}</div></td><td><b>{row.cash_account_code}</b><div className="muted sm">{row.counterpart_account_code}</div></td><td className="num">{money(row.cash_effect)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CASH_FLOW_CLASSIFICATION')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>
    </>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Prior-period comparison evidence">
      <div className="card-head"><div><h2>Prior-period comparison</h2><p className="muted sm">Compares current POSTED statement evidence with one explicit, earlier entity-scoped period. Absence on either side is never converted to zero.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Prior period ID<input value={priorPeriodId} maxLength="36" onChange={event=>{setPriorPeriodId(event.target.value.trim());setComparisonState({phase:'IDLE',rows:[],error:null,scope:null});}} placeholder="UUID of an earlier period"/></label><button type="button" className="btn" disabled={!priorPeriodId||priorPeriodId===config.periodId} onClick={loadComparison}>Load comparison evidence</button></div>
      <p className="muted sm">The API rejects overlapping or same-period comparisons. A row marked missing requires retained POSTED evidence before it can support a comparison conclusion.</p>
      {comparisonState.phase==='LOADING'&&<StateBlock tone="loading">Loading two-period POSTED statement evidence...</StateBlock>}
      <ReadError state={comparisonState} onRetry={loadComparison}/>
      {comparisonState.phase==='READY'&&!comparisonState.rows.length&&<StateBlock tone="empty" title="No comparable POSTED evidence returned">This scoped empty result is not evidence of no period-over-period change.</StateBlock>}
      {comparisonState.phase==='READY'&&!!comparisonState.rows.length&&<div className="table-wrap"><table className="tbl"><thead><tr><th>Statement / account</th><th>Current period</th><th>Prior period</th><th>Evidence status</th><th>Evidence</th></tr></thead><tbody>{comparisonState.rows.map(row=>{const focusId=`authoritative-period-comparison-${row.statement_type}-${row.account_code}`;return <tr key={`${row.statement_type}:${row.account_code}`}><td><b>{row.account_code}</b><div className="muted sm">{row.statement_type} / {row.statement_section}</div></td><td className="num">{row.current_display_balance===null?'Evidence missing':money(row.current_display_balance)}</td><td className="num">{row.prior_display_balance===null?'Evidence missing':money(row.prior_display_balance)}</td><td><span className={row.comparison_status==='COMPARABLE_POSTED_EVIDENCE'?'badge badge-muted':'badge badge-danger'}>{row.comparison_status}</span></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'PERIOD_COMPARISON')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="CWIP rollforward evidence">
      <div className="card-head"><div><h2>CWIP rollforward</h2><p className="muted sm">Exact approved CWIP-account mappings plus POSTED ledger evidence. Debit and credit movement stay in ledger form; REFS does not infer capitalization, transfers, or write-offs.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" onClick={loadCwip}>Load CWIP rollforward evidence</button></div>
      <p className="muted sm">An account enters this view only through one immutable mapping snapshot with classification CWIP. An empty or blocked result is not evidence of zero CWIP, zero construction activity, or a completed capitalization review.</p>
      {cwipState.phase==='LOADING'&&<StateBlock tone="loading">Loading mapping-backed CWIP ledger evidence...</StateBlock>}
      <ReadError state={cwipState} onRetry={loadCwip}/>
      {cwipState.phase==='READY'&&!cwipState.rows.length&&<StateBlock tone="empty" title="No admitted CWIP ledger evidence returned">No immutable CWIP account mapping with retained POSTED ledger evidence was returned for this period. This scoped empty result is not zero CWIP.</StateBlock>}
      {cwipState.phase==='READY'&&!!cwipState.rows.length&&!cwipState.complete&&<StateBlock tone="error" title="BLOCKED_CWIP_MAPPING">At least one CWIP account mapping is missing, ambiguous, or invalid. REFS will not assert a complete CWIP rollforward.</StateBlock>}
      {cwipState.phase==='READY'&&!!cwipState.rows.length&&<div className="table-wrap authoritative-property-table authoritative-cwip-table" tabIndex={0} aria-label="CWIP rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period debit</th><th>Period credit</th><th>Closing</th><th>Mapping</th><th>Evidence</th></tr></thead><tbody>{cwipState.rows.map(row=>{const focusId=`authoritative-cwip-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_debit===null?'Blocked':money(row.period_debit)}</td><td className="num">{row.period_credit===null?'Blocked':money(row.period_credit)}</td><td className="num">{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CWIP_ROLLFORWARD','CWIP rollforward')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="Construction loan rollforward evidence">
      <div className="card-head"><div><h2>Construction loan rollforward</h2><p className="muted sm">Exact approved construction-loan account mappings plus POSTED ledger evidence. Credit is shown as a draw and debit as a repayment; this view never infers lender, commitment, interest capitalization, or construction activity from account labels or source text.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" onClick={loadConstructionLoan}>Load construction-loan evidence</button></div>
      <p className="muted sm">An account enters this view only through one immutable mapping snapshot with classification CONSTRUCTION_LOAN. An empty or blocked result is not evidence of zero debt, zero draws, zero repayments, or a completed lender reconciliation.</p>
      {constructionLoanState.phase==='LOADING'&&<StateBlock tone="loading">Loading mapping-backed construction-loan ledger evidence...</StateBlock>}
      <ReadError state={constructionLoanState} onRetry={loadConstructionLoan}/>
      {constructionLoanState.phase==='READY'&&!constructionLoanState.rows.length&&<StateBlock tone="empty" title="No admitted construction-loan ledger evidence returned">No immutable construction-loan account mapping with retained POSTED ledger evidence was returned for this period. This scoped empty result is not zero construction debt.</StateBlock>}
      {constructionLoanState.phase==='READY'&&!!constructionLoanState.rows.length&&!constructionLoanState.complete&&<StateBlock tone="error" title="BLOCKED_CONSTRUCTION_LOAN_MAPPING">At least one construction-loan account mapping is missing, ambiguous, or invalid. REFS will not assert a complete construction-loan rollforward.</StateBlock>}
      {constructionLoanState.phase==='READY'&&!!constructionLoanState.rows.length&&<div className="table-wrap authoritative-property-table" tabIndex={0} aria-label="Construction loan rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period draws</th><th>Period repayments</th><th>Closing</th><th>Mapping</th><th>Evidence</th></tr></thead><tbody>{constructionLoanState.rows.map(row=>{const focusId=`authoritative-construction-loan-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_draws===null?'Blocked':money(row.period_draws)}</td><td className="num">{row.period_repayments===null?'Blocked':money(row.period_repayments)}</td><td className="num">{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'ROLLFORWARD','Construction loan rollforward')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="Prepaid rollforward evidence">
      <div className="card-head"><div><h2>Prepaid rollforward</h2><p className="muted sm">Exact approved prepaid-account mappings plus POSTED ledger evidence. Debit is shown as an addition and credit as amortization; this view never infers insurance coverage, policy period, useful life, or amortization schedule from an account label or source text.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" onClick={loadPrepaid}>Load prepaid evidence</button></div>
      <p className="muted sm">An account enters this view only through one immutable mapping snapshot with classification PREPAID. An empty or blocked result is not evidence of zero prepaid assets, zero amortization, or a complete insurance review.</p>
      {prepaidState.phase==='LOADING'&&<StateBlock tone="loading">Loading mapping-backed prepaid ledger evidence...</StateBlock>}
      <ReadError state={prepaidState} onRetry={loadPrepaid}/>
      {prepaidState.phase==='READY'&&!prepaidState.rows.length&&<StateBlock tone="empty" title="No admitted prepaid ledger evidence returned">No immutable prepaid account mapping with retained POSTED ledger evidence was returned for this period. This scoped empty result is not zero prepaid assets.</StateBlock>}
      {prepaidState.phase==='READY'&&!!prepaidState.rows.length&&!prepaidState.complete&&<StateBlock tone="error" title="BLOCKED_PREPAID_MAPPING">At least one prepaid account mapping is missing, ambiguous, or invalid. REFS will not assert a complete prepaid rollforward.</StateBlock>}
      {prepaidState.phase==='READY'&&!!prepaidState.rows.length&&<div className="table-wrap authoritative-property-table" tabIndex={0} aria-label="Prepaid rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period additions</th><th>Period amortization</th><th>Closing</th><th>Mapping</th><th>Evidence</th></tr></thead><tbody>{prepaidState.rows.map(row=>{const focusId=`authoritative-prepaid-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_additions===null?'Blocked':money(row.period_additions)}</td><td className="num">{row.period_amortization===null?'Blocked':money(row.period_amortization)}</td><td>{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'ROLLFORWARD','Prepaid rollforward')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Intercompany reconciliation evidence">
      <div className="card-head"><div><h2>Intercompany reconciliation</h2><p className="muted sm">Two distinct entity scopes, exactly aligned periods, bidirectional approved mappings, and POSTED-ledger evidence are required.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Counterparty entity ID<input value={counterpartyEntityId} maxLength="36" onChange={event=>{setCounterpartyEntityId(event.target.value.trim());setIntercompanyState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="UUID of the counterparty entity"/></label><label>Counterparty period ID<input value={counterpartyPeriodId} maxLength="36" onChange={event=>{setCounterpartyPeriodId(event.target.value.trim());setIntercompanyState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="UUID with the same period dates"/></label><button type="button" className="btn" disabled={!counterpartyEntityId||!counterpartyPeriodId||counterpartyEntityId===config.entityId} onClick={loadIntercompany}>Load reconciliation evidence</button></div>
      <p className="muted sm">A shared account code, memo, vendor, or amount is never enough. The API separately verifies report authority for the counterparty entity and rejects unaligned period boundaries. No elimination or adjustment is created by this report.</p>
      {intercompanyState.phase==='LOADING'&&<StateBlock tone="loading">Loading bidirectional intercompany POSTED evidence...</StateBlock>}
      <ReadError state={intercompanyState} onRetry={loadIntercompany}/>
      {intercompanyState.phase==='READY'&&!intercompanyState.rows.length&&<StateBlock tone="empty" title="No admitted intercompany evidence returned">This scoped empty result is not evidence of no intercompany balance, no elimination requirement, or a completed consolidation review.</StateBlock>}
      {intercompanyState.phase==='READY'&&!!intercompanyState.rows.length&&!intercompanyState.complete&&<StateBlock tone="error" title="BLOCKED_INTERCOMPANY_EVIDENCE">At least one account pair lacks an exact bidirectional mapping or retained POSTED evidence. REFS will not assert an intercompany conclusion.</StateBlock>}
      {intercompanyState.phase==='READY'&&!!intercompanyState.rows.length&&<div className="table-wrap"><table className="tbl"><thead><tr><th>Account pair</th><th className="ta-r">Current</th><th className="ta-r">Counterparty</th><th className="ta-r">Difference</th><th>Result</th><th>Evidence</th></tr></thead><tbody>{intercompanyState.rows.map(row=>{const focusId=`authoritative-intercompany-${row.account_code}-${row.counterparty_account_code}`;return <tr key={`${row.account_code}:${row.counterparty_account_code}`}><td><b>{row.account_code}</b><div className="muted sm">? {row.counterparty_account_code}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.current_closing_balance===null?'Blocked':money(row.current_closing_balance)}</td><td className="num">{row.counterparty_closing_balance===null?'Blocked':money(row.counterparty_closing_balance)}</td><td className="num">{row.difference_amount===null?'Blocked':money(row.difference_amount)}</td><td><span className={row.in_balance?'badge badge-ok':'badge badge-warn'}>{row.in_balance?'Tied':'Review required'}</span></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'INTERCOMPANY_RECONCILIATION')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='OPERATING_ANALYSIS'&&<section className="card" aria-label="Budget versus actual evidence">
      <div className="card-head"><div><h2>Budget versus actual</h2><p className="muted sm">Latest approved immutable budget snapshot versus same-entity, same-period, same-currency POSTED ledger evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" onClick={loadBudget}>Load budget evidence</button></div>
      <p className="muted sm">A comparison side is declared by the approved budget line; REFS never infers it from an account name, code, prior actual, WBS status, or a browser fixture. Missing snapshot, account, currency, or POSTED evidence remains BLOCKED and is never converted to zero.</p>
      {budgetState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable budget and POSTED actual evidence...</StateBlock>}
      <ReadError state={budgetState} onRetry={loadBudget}/>
      {budgetState.phase==='READY'&&!budgetState.rows.length&&<StateBlock tone="empty" title="No approved budget snapshot returned">No approved immutable budget snapshot was returned for this entity and period. This scoped empty result is not zero budget or zero actual.</StateBlock>}
      {budgetState.phase==='READY'&&!!budgetState.rows.length&&!budgetState.complete&&<StateBlock tone="error" title="BLOCKED_BUDGET_ACTUAL_EVIDENCE">At least one budget line lacks an active account, same-currency POSTED actual, or complete immutable budget evidence. REFS will not calculate a budget conclusion for that line.</StateBlock>}
      {budgetState.phase==='READY'&&!!budgetState.rows.length&&<div className="table-wrap"><table className="tbl"><thead><tr><th>Account</th><th>Side</th><th className="ta-r">Budget</th><th className="ta-r">Actual</th><th className="ta-r">Variance</th><th>Snapshot</th><th>Evidence</th></tr></thead><tbody>{budgetState.rows.map(row=>{const focusId=`authoritative-budget-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.report_status}</div></td><td>{row.comparison_side}</td><td className="num">{row.budget_amount===null?'Blocked':money(row.budget_amount)}</td><td className="num">{row.actual_amount===null?'Blocked':money(row.actual_amount)}</td><td className="num">{row.variance_amount===null?'Blocked':money(row.variance_amount)}</td><td><code>{row.budget_snapshot_id}</code><div className="muted sm">v{row.budget_version}</div></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'BUDGET_VS_ACTUAL')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Consolidation evidence">
      <div className="card-head"><div><h2>Consolidation and elimination evidence</h2><p className="muted sm">An approved immutable consolidation snapshot must explicitly name every member, account presentation mapping, and elimination evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Consolidation group<input value={consolidationGroupRef} maxLength="160" onChange={event=>{setConsolidationGroupRef(event.target.value);setConsolidationState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="Canonical approved group reference"/></label><button type="button" className="btn" disabled={!consolidationGroupRef.trim()} onClick={loadConsolidation}>Load consolidation evidence</button></div>
      <p className="muted sm">REFS never assumes that matching account codes, amounts, or entity names form a consolidation. Missing member scope, aligned period/currency, posted ledger, mapping, or elimination evidence is BLOCKED. This view cannot create an elimination journal.</p>
      {consolidationState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable consolidation and POSTED ledger evidence...</StateBlock>}
      <ReadError state={consolidationState} onRetry={loadConsolidation}/>
      {consolidationState.phase==='READY'&&!consolidationState.rows.length&&<StateBlock tone="empty" title="No approved consolidation snapshot returned">No approved immutable consolidation snapshot was returned for this reporting entity, period, and group. This scoped empty result is not evidence of zero eliminations or a completed consolidation.</StateBlock>}
      {consolidationState.phase==='READY'&&!!consolidationState.rows.length&&!consolidationState.complete&&<StateBlock tone="error" title="BLOCKED_CONSOLIDATION_EVIDENCE">At least one presented account lacks member scope, aligned period/currency, POSTED ledger, or approved elimination evidence. REFS will not calculate a consolidation conclusion.</StateBlock>}
      {consolidationState.phase==='READY'&&!!consolidationState.rows.length&&<div className="table-wrap"><table className="tbl"><thead><tr><th>Presentation account</th><th>Members</th><th className="ta-r">Member actual</th><th className="ta-r">Elimination</th><th className="ta-r">Consolidated</th><th>Evidence</th></tr></thead><tbody>{consolidationState.rows.map(row=>{const focusId=`authoritative-consolidation-${row.presentation_account_code}-${row.presentation_side}`;return <tr key={`${row.presentation_account_code}:${row.presentation_side}`}><td><b>{row.presentation_account_code}</b><div className="muted sm">{row.presentation_side}</div><div className="muted sm">{row.report_status}</div></td><td>{row.evidence_member_count}/{row.member_count}</td><td className="num">{row.member_actual_amount===null?'Blocked':money(row.member_actual_amount)}</td><td className="num">{row.elimination_amount===null?'Blocked':money(row.elimination_amount)}</td><td className="num">{row.consolidated_amount===null?'Blocked':money(row.consolidated_amount)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CONSOLIDATION')}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='OPERATING_ANALYSIS'&&<section className="card" aria-label="Dimension profitability evidence">
      <div className="card-head"><div><h2>Dimension profitability</h2><p className="muted sm">Property, Project, and Unit P&amp;L use only exact dimensions retained on POSTED ledger lines.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Dimension type<select value={dimensionType} onChange={event=>{setDimensionType(event.target.value);setDimensionState({phase:'IDLE',rows:[],error:null,scope:null});}}>{DIMENSION_TYPES.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Exact reference<input value={dimensionRef} maxLength="160" onChange={event=>setDimensionRef(event.target.value)} placeholder="e.g. PROPERTY-01"/></label><button type="button" className="btn" disabled={!dimensionRef.trim()} onClick={loadDimension}>Load profitability evidence</button></div>
      <p className="muted sm">A blank result is not zero profitability: it means no retained POSTED ledger line carries this exact dimension for the selected period. The report never infers a dimension from a memo, bank account, or source header.</p>
      {dimensionState.phase==='LOADING'&&<StateBlock tone="loading">Loading exact-dimension POSTED ledger evidence...</StateBlock>}
      <ReadError state={dimensionState} onRetry={loadDimension}/>
      {dimensionState.phase==='READY'&&!dimensionState.rows.length&&<StateBlock tone="empty" title="No exact-dimension POSTED ledger evidence returned">This scoped empty result is not evidence of zero property, project, or unit profitability.</StateBlock>}
      {dimensionState.phase==='READY'&&!!dimensionState.rows.length&&<><DimensionProfitabilitySummary rows={dimensionState.rows} dimensionType={dimensionType} dimensionRef={dimensionRef}/><div className="table-wrap authoritative-profitability-table" tabIndex={0} aria-label="Dimension profitability rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Section</th><th>Account</th><th>Period debit</th><th>Period credit</th><th>Balance</th><th>Evidence</th></tr></thead><tbody>{dimensionState.rows.map(row=>{const focusId=`authoritative-dimension-${row.dimension_type}-${row.dimension_ref}-${row.account_code}`;return <tr key={`${row.dimension_type}:${row.dimension_ref}:${row.statement_section}:${row.account_code}`}><td>{row.statement_section}</td><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(row.period_debit)}</td><td className="num">{money(row.period_credit)}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'DIMENSION_PROFITABILITY',null,{dimension:{type:dimensionType,ref:dimensionRef}})}>Open evidence</button></td></tr>;})}</tbody></table></div></>}
    </section>}
    </section>
  </AuthoritativeDemoReportsView>;
}
