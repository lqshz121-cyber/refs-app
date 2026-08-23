import React,{useEffect,useMemo,useRef,useState} from 'react';
import {refreshAuthoritativeAiAmortizationSchedules,refreshAuthoritativeBudgetVsActual,refreshAuthoritativeCashFlowClassification,refreshAuthoritativeChartOfAccounts,refreshAuthoritativeConsolidation,refreshAuthoritativeConstructionLoanRollforward,refreshAuthoritativeCwipRollforward,refreshAuthoritativeDimensionProfitability,refreshAuthoritativeDocuments,refreshAuthoritativeFinancialStatementPeriodComparison,refreshAuthoritativeFinancialStatementSnapshot,refreshAuthoritativeFinancialStatements,refreshAuthoritativeGeneralLedger,refreshAuthoritativeIntercompanyReconciliation,refreshAuthoritativePrepaidRollforward} from './accounting-api.js';
import {Icon,StateBlock} from './ui.jsx';
import {DEFAULT_AUTHORITATIVE_LIST_VIEW,createAuthoritativeReturnContext,restoreAuthoritativeReturnContext} from './authoritative-list-context.js';
import {AuthoritativeReadFailure,AuthoritativeScopeEmpty,authoritativeReadFailurePhase} from './authoritative-read-state.jsx';
import {AuthoritativeReportsView} from './authoritative-reports-view.jsx';
import {AuthoritativeLineageDrill} from './authoritative-lineage-drill.jsx';

const REPORTS=[
  ['TRIAL_BALANCE','Trial Balance'],
  ['BALANCE_SHEET','Balance Sheet'],
  ['INCOME_STATEMENT','Profit and Loss'],
  ['CASH_FLOW','Cash activity'],
];
const REPORT_WORKBENCH_TABS=Object.freeze([
  ['STATEMENTS','Core statements','Trial balance, balance sheet, income statement, and cash activity.'],
  ['CASH_AND_CAPITAL','Cash & capital','Statement of cash flows, CWIP, construction-loan, and prepaid rollforwards.'],
  ['OPERATING_ANALYSIS','Property & project analysis','Property, project, or unit profitability and budget-versus-actual.'],
  ['GROUP_AND_COMPARISON','Group & comparison','Prior-period, intercompany, and consolidation evidence.'],
]);
// These are navigation choices, not a second report data model.  Every card
// below leads to a workspace that already has an authenticated API reader;
// unsupported legacy report names never appear as a plausible action here.
const REPORT_LIBRARY_SHORTCUTS=Object.freeze([
  ['BALANCE_SHEET','Balance Sheet','Review assets, liabilities, and equity.',['statement of financial position']],
  ['INCOME_STATEMENT','Profit and Loss','Review income and expenses.',['income statement','profit & loss','p&l']],
  ['TRIAL_BALANCE','Trial Balance','Review account balances.',['tb']],
  ['CASH_FLOW','Cash activity','Review cash-account movement.',[]],
]);
const MAPPING_BACKED_REPORT_SHORTCUTS=Object.freeze([
  ['STATEMENT_OF_CASH_FLOWS','Statement of Cash Flows','Review operating, investing, and financing cash activity.',['cash flow statement']],
]);
const DOCUMENT_REPORT_SHORTCUTS=Object.freeze([
  ['INVOICE_LIST','Invoice List','Review invoices by date.',['invoice list by date']],
]);
const JOURNAL_REPORT_SHORTCUTS=Object.freeze([
  ['JOURNAL_REPORT','Journal','Review posted journal lines.',['journal report']],
]);
const ACCOUNT_REPORT_SHORTCUTS=Object.freeze([
  ['ACCOUNT_LIST','Account List','Review accounts and balances.',['account listing']],
]);
const GENERAL_LEDGER_REPORT_SHORTCUT=Object.freeze(['GENERAL_LEDGER','General Ledger','Review posted ledger activity.',['gl']]);
const RECONCILIATION_REPORT_SHORTCUT=Object.freeze(['RECONCILIATION_REPORTS','Reconciliation Reports','Review retained reconciliation history.',['reconciliation report','reconcile reports']]);
const UNAVAILABLE_REPORT_SHORTCUTS=Object.freeze([
  ['DETAIL_1099','1099 Transaction Detail Report','Requires vendor tax identity and approved 1099-box mapping facts.',['1099 detail report','1099 transactions']],
  ['ACCOUNTS_RECEIVABLE_AGING_DETAIL','Accounts receivable aging detail','Requires an immutable as-of customer document snapshot.',['ar aging detail','a/r aging detail']],
  ['ACCOUNTS_RECEIVABLE_AGING_SUMMARY','Accounts receivable aging summary','Requires an immutable as-of customer aging snapshot.',['ar aging summary','a/r aging summary']],
  ['ACCOUNTS_PAYABLE_AGING_DETAIL','Accounts payable aging detail','Requires an immutable as-of vendor document snapshot grouped by aging bucket.',['ap aging detail','a/p aging detail']],
  ['ACCOUNTS_PAYABLE_AGING_SUMMARY','Accounts payable aging summary','Requires an immutable as-of vendor aging snapshot with five buckets.',['ap aging summary','a/p aging summary']],
  ['ADJUSTED_TRIAL_BALANCE','Adjusted Trial Balance','Requires unadjusted, adjustment, and adjusted balance columns.',['adjusted tb']],
  ['AUDIT_LOG','Audit Log','Requires a permission-scoped, cross-workflow audit-event reader.',['audit trail','change log']],
  ['BALANCE_SHEET_COMPARISON','Balance Sheet Comparison','Requires previous-year period resolution and grouped comparison totals.',['comparative balance sheet']],
  ['BALANCE_SHEET_DETAIL','Balance Sheet Detail','Requires grouped transaction rows and running balances.',['detailed balance sheet']],
  ['BALANCE_SHEET_SUMMARY','Balance Sheet Summary','Requires server-defined account-type groups and subtotals.',['summary balance sheet']],
  ['BILL_APPROVAL_STATUS','Bill Approval Status','Requires authoritative bill approval and paid-status report rows.',['bill approvals','bill approval report']],
  ['BILLS_AND_APPLIED_PAYMENTS','Bills and Applied Payments','Requires authoritative linked bill and applied-payment transaction rows.',['bill stub','vendor check stub','bills applied payments']],
  ['CHECK_DETAIL','Check Detail','Requires authoritative posted check documents and check-line facts.',['check detail report','cheque detail']],
  ['CUSTOMER_BALANCE_DETAIL','Customer Balance Detail','Requires an as-of customer transaction ledger with running balances.',['customer balance details','client balance detail']],
  ['CUSTOMER_BALANCE_SUMMARY','Customer Balance Summary','Requires authoritative as-of customer balances and totals.',['customer balance report','client balance summary']],
  ['COLLECTIONS_REPORT','Collections Report','Requires an immutable as-of customer collections snapshot.',['collections','customer collections report']],
  ['DEPOSIT_DETAIL','Deposit Detail','Requires authoritative posted deposit documents and deposit-line classification facts.',['deposit details','bank deposit detail']],
  ['PROFIT_AND_LOSS_COMPARISON','Profit and Loss Comparison','Requires previous-year period resolution and grouped comparison totals.',['income statement comparison','p&l comparison']],
  ['PROFIT_AND_LOSS_BY_CLASS','Profit and Loss by Class','Requires authoritative class-dimension statement columns and totals.',['p&l by class','income statement by class']],
  ['PROFIT_AND_LOSS_BY_TAG_GROUP','Profit and Loss by Tag Group','Requires authoritative tag-group statement columns and totals.',['p&l by tag group','income statement by tag group']],
  ['PROFIT_AND_LOSS_BY_CUSTOMER','Profit and Loss by Customer','Requires authoritative customer-dimension statement columns and totals.',['p&l by customer','income statement by customer']],
  ['PROFIT_AND_LOSS_PERCENT_TOTAL_INCOME','Profit and Loss as % of total income','Requires server-calculated percent-of-income columns and denominator totals.',['p&l percent of income','income statement percent of income']],
  ['PROFIT_AND_LOSS_DETAIL','Profit and Loss Detail','Requires an authoritative detail-report read model.',['income statement detail','p&l detail']],
  ['PURCHASES_BY_PRODUCT_SERVICE_DETAIL','Purchases by Product/Service Detail','Requires authoritative product/service-grouped purchase transaction and line facts.',['purchases by item detail','product service purchase detail']],
  ['PURCHASES_BY_VENDOR_DETAIL','Purchases by Vendor Detail','Requires authoritative vendor-grouped purchase transaction and line facts.',['vendor purchase detail','purchases by supplier detail']],
  ['QUARTERLY_PROFIT_AND_LOSS_SUMMARY','Quarterly Profit and Loss Summary','Requires authoritative quarter columns and period totals.',['quarterly income statement summary','quarterly p&l summary']],
  ['RECENT_TRANSACTIONS','Recent Transactions','Requires complete recent-transaction rows with posting, name, memo, and account facts.',['recent transaction report']],
  ['EXPENSES_BY_VENDOR_SUMMARY','Expenses by Vendor Summary','Requires server-grouped vendor expense totals.',['vendor expense summary','expenses by supplier summary']],
  ['INCOME_BY_CUSTOMER_SUMMARY','Income by Customer Summary','Requires authoritative customer-grouped income totals.',['customer income summary','income by customer']],
  ['INVOICE_APPROVAL_STATUS','Invoice Approval Status','Requires authoritative invoice approval, payment-status, and approval-date report rows.',['invoice approvals','invoice approval report']],
  ['INVALID_JOURNAL_TRANSACTIONS','Invalid Journal Transactions','Requires server-classified invalid journal lines with counterparty and FX facts.',['invalid je']],
  ['INVOICES_AND_RECEIVED_PAYMENTS','Invoices and Received Payments','Requires authoritative linked invoice and received-payment transaction rows.',['invoice payments','invoices received payments']],
  ['OPEN_INVOICES','Open Invoices','Requires an immutable as-of customer open-balance snapshot.',['open invoices report','outstanding invoices']],
  ['OPEN_PURCHASE_ORDER_LIST_BY_VENDOR','Open Purchase Order List by Vendor','Requires authoritative vendor-grouped purchase-order rows and open balances.',['open purchase order list','open po list by vendor']],
  ['STATEMENT_LIST','Statement List','Requires an immutable customer-statement snapshot and statement-list rows.',['customer statement list','statements report']],
  ['TERMS_LIST','Terms List','Requires authoritative payment-terms master data and discount schedule facts.',['payment terms list','customer terms']],
  ['UNPAID_BILLS','Unpaid Bills','Requires an as-of vendor-grouped open-balance snapshot.',['unpaid bills report','open bills report']],
  ['TRANSACTION_LIST_BY_CUSTOMER','Transaction List by Customer','Requires customer-grouped transaction and posting facts.',['customer transaction list','transactions by customer']],
  ['TRANSACTION_LIST_BY_DATE','Transaction List by Date','Requires complete transaction rows with posting, name, memo, and split facts.',['transaction list date','transactions by date']],
  ['TRANSACTION_LIST_BY_TAG_GROUP','Transaction List by Tag Group','Requires authoritative tag-group membership and complete transaction facts.',['tag group transaction list','transactions by tag group']],
  ['TRANSACTION_LIST_WITH_SPLITS','Transaction List with Splits','Requires complete transaction and split-line rows with posting and counterparty facts.',['transactions with splits','split transaction list']],
  ['TRANSACTION_LIST_BY_VENDOR','Transaction List by Vendor','Requires vendor-grouped transaction and split-account facts.',['vendor transaction list','transactions by vendor']],
  ['VENDOR_CONTACT_LIST','Vendor Contact List','Requires permission-scoped vendor contact, tax identity, and 1099 status facts.',['vendor contacts','supplier contact list']],
  ['TRANSACTION_DETAIL_BY_ACCOUNT','Transaction Detail by Account','Requires server-grouped account transactions and running balances.',['account transaction detail','transactions by account']],
  ['TRANSACTION_DRILLDOWN_REPORT','Transaction Drilldown Report','Requires an immutable custom-report definition, grouped transactions, and running balances.',['transaction drilldown','drilldown transaction report']],
  ['VENDOR_BALANCE_DETAIL','Vendor Balance Detail','Requires an as-of vendor transaction ledger with running balances.',['vendor balance details','supplier balance detail']],
  ['VENDOR_BALANCE_SUMMARY','Vendor Balance Summary','Requires authoritative as-of vendor balances and totals.',['vendor balance report','supplier balance summary']],
  ['GENERAL_LEDGER_LIST','General Ledger List','Requires server-calculated account groups and balances.',['ledger list']],
]);
// The demonstration application had a much larger property-operation menu,
// but only these report readers have an authenticated accounting-API contract
// today.  Keeping this directory explicit makes the authoritative property
// workbench discoverable without pretending that legacy project, unit, loan,
// or property-operation records are available in the browser.
const PROPERTY_REPORT_SHORTCUTS=Object.freeze([
  ['PROPERTY_PROFITABILITY','Property P&L','Review property income and expenses.','OPERATING_ANALYSIS','PROPERTY'],
  ['PROJECT_PROFITABILITY','Project P&L','Review project income and expenses.','OPERATING_ANALYSIS','PROJECT'],
  ['UNIT_PROFITABILITY','Unit profitability','Review unit income and expenses.','OPERATING_ANALYSIS','UNIT'],
  ['LOT_PROFITABILITY','Lot profitability','Review lot income and expenses.','OPERATING_ANALYSIS','LOT'],
  ['CWIP_ROLLFORWARD','CWIP rollforward','Review CWIP activity and balances.','CASH_AND_CAPITAL',null],
  ['CONSTRUCTION_LOAN_ROLLFORWARD','Construction loan rollforward','Review loan activity and balances.','CASH_AND_CAPITAL',null],
  ['PREPAID_ROLLFORWARD','Prepaid rollforward','Review prepaid activity and balances.','CASH_AND_CAPITAL',null],
  ['BUDGET_VS_ACTUAL','Budget versus actual','Compare approved budget to actual results.','OPERATING_ANALYSIS',null],
]);
const REPORT_ICON_NAMES=Object.freeze({
  TRIAL_BALANCE:'lines',DETAIL_1099:'document',ACCOUNTS_RECEIVABLE_AGING_DETAIL:'calendar',ACCOUNTS_RECEIVABLE_AGING_SUMMARY:'calendar',ACCOUNTS_PAYABLE_AGING_DETAIL:'calendar',ACCOUNTS_PAYABLE_AGING_SUMMARY:'calendar',ACCOUNT_LIST:'book',ADJUSTED_TRIAL_BALANCE:'lines',AUDIT_LOG:'shield',BALANCE_SHEET:'book',BALANCE_SHEET_COMPARISON:'book',BALANCE_SHEET_DETAIL:'book',BALANCE_SHEET_SUMMARY:'book',BILL_APPROVAL_STATUS:'wallet',BILLS_AND_APPLIED_PAYMENTS:'wallet',CHECK_DETAIL:'bank',COLLECTIONS_REPORT:'wallet',CUSTOMER_BALANCE_DETAIL:'wallet',CUSTOMER_BALANCE_SUMMARY:'wallet',DEPOSIT_DETAIL:'bank',INCOME_STATEMENT:'bars',INCOME_BY_CUSTOMER_SUMMARY:'bars',INVOICE_APPROVAL_STATUS:'wallet',INVOICE_LIST:'wallet',INVOICES_AND_RECEIVED_PAYMENTS:'wallet',JOURNAL_REPORT:'book',PROFIT_AND_LOSS_BY_CLASS:'bars',PROFIT_AND_LOSS_BY_TAG_GROUP:'bars',PROFIT_AND_LOSS_BY_CUSTOMER:'bars',PROFIT_AND_LOSS_PERCENT_TOTAL_INCOME:'bars',PROFIT_AND_LOSS_COMPARISON:'bars',PROFIT_AND_LOSS_DETAIL:'bars',PURCHASES_BY_PRODUCT_SERVICE_DETAIL:'wallet',PURCHASES_BY_VENDOR_DETAIL:'wallet',QUARTERLY_PROFIT_AND_LOSS_SUMMARY:'bars',RECENT_TRANSACTIONS:'book',EXPENSES_BY_VENDOR_SUMMARY:'wallet',INVALID_JOURNAL_TRANSACTIONS:'book',OPEN_INVOICES:'wallet',OPEN_PURCHASE_ORDER_LIST_BY_VENDOR:'wallet',STATEMENT_LIST:'document',TERMS_LIST:'document',UNPAID_BILLS:'wallet',TRANSACTION_DETAIL_BY_ACCOUNT:'book',TRANSACTION_DRILLDOWN_REPORT:'book',TRANSACTION_LIST_BY_CUSTOMER:'wallet',TRANSACTION_LIST_BY_DATE:'book',TRANSACTION_LIST_BY_TAG_GROUP:'book',TRANSACTION_LIST_WITH_SPLITS:'book',TRANSACTION_LIST_BY_VENDOR:'wallet',VENDOR_CONTACT_LIST:'wallet',VENDOR_BALANCE_DETAIL:'wallet',VENDOR_BALANCE_SUMMARY:'wallet',CASH_FLOW:'exchange',STATEMENT_OF_CASH_FLOWS:'exchange',GENERAL_LEDGER:'book',GENERAL_LEDGER_LIST:'book',
  RECONCILIATION_REPORTS:'check',STATEMENTS:'book',CASH_AND_CAPITAL:'bank',OPERATING_ANALYSIS:'bars',GROUP_AND_COMPARISON:'layers',
  PROPERTY_PROFITABILITY:'bars',PROJECT_PROFITABILITY:'bars',UNIT_PROFITABILITY:'bars',LOT_PROFITABILITY:'bars',
  CWIP_ROLLFORWARD:'cycle',CONSTRUCTION_LOAN_ROLLFORWARD:'cycle',PREPAID_ROLLFORWARD:'cycle',BUDGET_VS_ACTUAL:'bars',AR_AGING:'calendar',
});
const ReportIcon=({reportKey})=><span className="authoritative-report-icon" aria-hidden="true"><Icon name={REPORT_ICON_NAMES[reportKey]||'document'} size={20}/></span>;
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
export const findAuthoritativeMappingBackedReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return MAPPING_BACKED_REPORT_SHORTCUTS.filter(([,label,description,aliases=[]])=>
    [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle)));
};
export const findAuthoritativeDocumentReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return DOCUMENT_REPORT_SHORTCUTS.filter(([,label,description,aliases=[]])=>
    [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle)));
};
export const findAuthoritativeJournalReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return JOURNAL_REPORT_SHORTCUTS.filter(([,label,description,aliases=[]])=>
    [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle)));
};
export const findAuthoritativeAccountReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return ACCOUNT_REPORT_SHORTCUTS.filter(([,label,description,aliases=[]])=>
    [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle)));
};
export const findAuthoritativeGeneralLedgerShortcut=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  const [key,label,description,aliases]=GENERAL_LEDGER_REPORT_SHORTCUT;
  return [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle))?[[key,label,description]]:[];
};
export const findAuthoritativeReconciliationReportShortcut=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  const [key,label,description,aliases]=RECONCILIATION_REPORT_SHORTCUT;
  return [label,description,...aliases].some(value=>normalizedFinderText(value).includes(needle))?[[key,label,description]]:[];
};
export const findAuthoritativeUnavailableReportShortcuts=query=>{
  const needle=normalizedFinderText(query);
  if(!needle)return [];
  return UNAVAILABLE_REPORT_SHORTCUTS.filter(([,label,description,aliases=[]])=>
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
const DIMENSION_TYPES=Object.freeze([['PROPERTY','Property P&L'],['PROJECT','Project P&L'],['UNIT','Unit profitability'],['LOT','Lot profitability']]);
const fixed4=value=>{const match=/^(-?)([0-9]+)\.([0-9]{4})$/.exec(String(value??'0.0000'));if(!match)return 0n;return BigInt(`${match[1]}${match[2]}${match[3]}`);};
const fixed4String=value=>{const negative=value<0n,absolute=negative?-value:value,digits=absolute.toString().padStart(5,'0');return `${negative?'-':''}${digits.slice(0,-4)}.${digits.slice(-4)}`;};
const add=(...values)=>fixed4String(values.reduce((sum,value)=>sum+fixed4(value),0n));
const subtract=(left,right)=>fixed4String(fixed4(left)-fixed4(right));
const money=value=>{const units=fixed4(value),negative=units<0n,absolute=negative?-units:units,cents=(absolute+50n)/100n,whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),fraction=(cents%100n).toString().padStart(2,'0');return `${negative?'-':''}$${whole}.${fraction}`;};
const sumRows=(rows,sections=null)=>fixed4String(rows.reduce((sum,row)=>sections&&!sections.includes(row.statement_section)?sum:sum+fixed4(row.display_balance),0n));
const sumCashFlowRows=(rows,sections=null)=>fixed4String(rows.reduce((sum,row)=>sections&&!sections.includes(row.classification)?sum:sum+fixed4(row.cash_effect),0n));
const statementDebit=(report,row)=>report==='TRIAL_BALANCE'?row.ending_debit:row.period_debit;
const statementCredit=(report,row)=>report==='TRIAL_BALANCE'?row.ending_credit:row.period_credit;

export const FinancialStatementSummary=({report,rows})=>{
  if(report==='BALANCE_SHEET'){
    const assets=sumRows(rows,['ASSETS']),liabilities=sumRows(rows,['LIABILITIES']),equity=sumRows(rows,['EQUITY','CURRENT_EARNINGS']),right=add(liabilities,equity),difference=subtract(assets,right);
    return <div className="qbo-toolgrid" aria-label="Balance Sheet equation"><span><i>Assets</i><b>{money(assets)}</b></span><span><i>Liabilities</i><b>{money(liabilities)}</b></span><span><i>Equity and current earnings</i><b>{money(equity)}</b></span><span><i>Assets - liabilities - equity</i><b>{money(difference)}</b></span></div>;
  }
  if(report==='INCOME_STATEMENT'){
    const revenue=sumRows(rows,['REVENUE']),expense=sumRows(rows,['EXPENSES']);
    return <div className="qbo-toolgrid" aria-label="Profit and Loss equation"><span><i>Revenue</i><b>{money(revenue)}</b></span><span><i>Expenses</i><b>{money(expense)}</b></span><span><i>Net income</i><b>{money(subtract(revenue,expense))}</b></span></div>;
  }
  if(report==='CASH_FLOW')return <div className="qbo-toolgrid" aria-label="Cash activity summary"><span><i>Cash-account movement</i><b>{money(sumRows(rows))}</b></span><span><i>Classification boundary</i><b>Not classified as operating, investing, or financing</b></span></div>;
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
const ScopeLabel=({context,extra=''})=><span title={`Entity ID: ${context?.entityId||'Unavailable'}; Period ID: ${context?.periodId||'Unavailable'}`}>{context?.entityLabel||'Configured entity'} / {context?.periodLabel||'Configured period'}{extra}</span>;

const CashFlowDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Cash flow classification evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to statement of cash flows</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.classification==='BLOCKED'?'Blocked cash-flow classification':`${row.classification} cash flow`}</h2><p className="muted sm">Cash {row.cash_account_code} / counterpart {row.counterpart_account_code}</p></div><span className={row.mapping_status==='CLASSIFIED'?'badge badge-muted':'badge badge-danger'}>{row.mapping_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Cash effect</i><b>{money(row.cash_effect)}</b></span><span><i>Mapping snapshot</i><b>{row.mapping_snapshot_id||'Not admitted'}</b></span><span><i>Mapping version</i><b>{row.mapping_version||'Not admitted'}</b></span></div>
  <p className="muted sm">Classification basis: {row.classification_basis}.{row.mapping_snapshot_hash&&` Immutable mapping hash: ${row.mapping_snapshot_hash}.`}</p>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
  <EvidenceDrillAction row={{...row,account_code:null}} onOpenLineage={onOpenLineage}/>
</section>;

const IntercompanyDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Intercompany reconciliation evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to intercompany reconciliation</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} / {row.counterparty_account_code}</h2><p className="muted sm">Exact bidirectional intercompany mapping and POSTED-ledger evidence only.</p></div><span className={row.mapping_status==='MAPPED_INTERCOMPANY_PAIR'?'badge badge-muted':'badge badge-danger'}>{row.mapping_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Current entity</i><b>{row.current_closing_balance===null?'Blocked':money(row.current_closing_balance)}</b></span><span><i>Counterparty</i><b>{row.counterparty_closing_balance===null?'Blocked':money(row.counterparty_closing_balance)}</b></span><span><i>Difference</i><b>{row.difference_amount===null?'Blocked':money(row.difference_amount)}</b></span><span><i>Result</i><b>{row.in_balance?'Tied':'Review required'}</b></span></div>
  <p className="muted sm">{row.classification_basis}. No elimination or adjustment is created by this report.</p>
  <div className="detail-grid"><EvidenceIds label="Current journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Current sources" ids={row.source_document_ids}/><EvidenceIds label="Counterparty journal entries" ids={row.counterparty_journal_entry_ids}/><EvidenceIds label="Counterparty sources" ids={row.counterparty_source_document_ids}/></div>
  <EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/>
</section>;

const BudgetActualDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Budget versus actual evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to budget versus actual</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">Approved immutable budget snapshot compared only with same-period POSTED ledger evidence.</p></div><span className={row.report_status==='APPROVED_BUDGET_VS_ACTUAL'?'badge badge-muted':'badge badge-danger'}>{row.report_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Budget</i><b>{row.budget_amount===null?'Blocked':money(row.budget_amount)}</b></span><span><i>Actual</i><b>{row.actual_amount===null?'Blocked':money(row.actual_amount)}</b></span><span><i>Variance</i><b>{row.variance_amount===null?'Blocked':money(row.variance_amount)}</b></span><span><i>Comparison side</i><b>{row.comparison_side}</b></span></div>
  <p className="muted sm">{row.classification_basis}. Snapshot <code>{row.budget_snapshot_id}</code> v{row.budget_version}; receipt {row.budget_receipt_hash}; source {row.budget_source_ref} v{row.budget_source_version}. This read cannot create or revise a budget, journal, mapping, or adjustment.</p>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
  <EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/>
</section>;

const ConsolidationDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Consolidation evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to consolidation</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.presentation_account_code} - {row.presentation_side}</h2><p className="muted sm">Immutable member/account mapping, approved elimination evidence, and POSTED ledger only.</p></div><span className={row.report_status==='APPROVED_CONSOLIDATION_SNAPSHOT_AND_POSTED_LEDGER_EXACT'?'badge badge-muted':'badge badge-danger'}>{row.report_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Member actual</i><b>{row.member_actual_amount===null?'Blocked':money(row.member_actual_amount)}</b></span><span><i>Approved elimination</i><b>{row.elimination_amount===null?'Blocked':money(row.elimination_amount)}</b></span><span><i>Consolidated</i><b>{row.consolidated_amount===null?'Blocked':money(row.consolidated_amount)}</b></span><span><i>Members with evidence</i><b>{row.evidence_member_count}/{row.member_count}</b></span></div>
  <p className="muted sm">{row.classification_basis}. Snapshot <code>{row.consolidation_snapshot_id}</code> v{row.consolidation_version}; receipt {row.consolidation_receipt_hash}. This report creates no elimination journal or adjustment.</p>
  <div className="detail-grid"><EvidenceIds label="Member entities" ids={row.member_entity_ids}/><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
  <EvidenceDrillAction row={{...row,account_code:null}} onOpenLineage={onOpenLineage}/>
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
};

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
    <header className="card-head"><div><div className="page-eyebrow">OPERATING ANALYSIS | POSTED EVIDENCE</div><h1 className="page-h">{type} P&amp;L / {reference}</h1><p className="muted sm">This account is included only because its POSTED ledger line retained this exact dimension. The report does not infer a property, project, unit, or lot from a memo, source header, or browser state.</p></div><span className="badge badge-muted">READ ONLY</span></header>
    <div className="qbo-toolgrid" aria-label="Dimension profitability account summary"><span><i>Account</i><b>{row.account_code} / {row.account_name}</b></span><span><i>Statement section</i><b>{row.statement_section}</b></span><span><i>Period debit</i><b>{money(row.period_debit)}</b></span><span><i>Period credit</i><b>{money(row.period_credit)}</b></span><span><i>Statement balance</i><b>{money(row.display_balance)}</b></span></div>
    <section className="card" aria-label="Exact dimension scope"><div className="card-head"><div><h2>Evidence scope</h2><p className="muted sm">Retained entity, period, dimension, and classification.</p></div><span className="badge badge-muted">READ ONLY</span></div><div className="detail-grid"><div><i>Dimension type</i><b>{type}</b></div><div><i>Exact reference</i><b>{reference}</b></div><div><i>Classification basis</i><b>{row.classification_basis}</b></div><div><i>Period</i><b>{row.period_code}: {row.period_start} through {row.period_end}</b></div></div></section>
    <section className="card" aria-label="Dimension profitability retained trace"><div className="card-head"><div><h2>Retained trace</h2><p className="muted sm">These identifiers are supplied by the accounting API for an authorized server-backed evidence drill.</p></div></div><div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div><EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/></section>
  </section>;
};
const comparisonLineageRow=(row,side)=>{const prefix=side==='PRIOR'?'prior':'current';return {...row,period_id:row[`${prefix}_period_id`],period_code:row[`${prefix}_period_code`],period_start:row[`${prefix}_period_start`],period_end:row[`${prefix}_period_end`],journal_entry_ids:row[`${prefix}_journal_entry_ids`],journal_line_ids:row[`${prefix}_journal_line_ids`],ledger_line_ids:row[`${prefix}_ledger_line_ids`],source_document_ids:row[`${prefix}_source_document_ids`]};};

export const authoritativeReportLineageConfig=(config,row)=>{
  const periodId=row?.period_id||config?.periodId;
  const currentPresentation=config?.scopePresentation||{};
  const rowPeriodLabel=typeof row?.period_code==='string'&&row.period_code.trim()
    ? row.period_code.trim()
    : periodId===config?.periodId&&typeof currentPresentation.periodLabel==='string'&&currentPresentation.periodLabel.trim()
      ? currentPresentation.periodLabel.trim()
      : 'Selected report period';
  return {...config,periodId,scopePresentation:{...currentPresentation,periodLabel:rowPeriodLabel}};
};

const ComparisonDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Prior-period comparison evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to prior-period comparison</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">{row.statement_type} / {row.statement_section}</p></div><span className={row.comparison_status==='COMPARABLE_POSTED_EVIDENCE'?'badge badge-muted':'badge badge-danger'}>{row.comparison_status}</span></div>
  <div className="qbo-toolgrid"><span><i>Current period</i><b>{row.current_display_balance===null?'Evidence missing':money(row.current_display_balance)}</b></span><span><i>Prior period</i><b>{row.prior_display_balance===null?'Evidence missing':money(row.prior_display_balance)}</b></span><span><i>Current period code</i><b>{row.current_period_code}</b></span><span><i>Prior period code</i><b>{row.prior_period_code}</b></span></div>
  <div className="detail-grid"><EvidenceIds label="Current journal entries" ids={row.current_journal_entry_ids}/><EvidenceIds label="Current source documents" ids={row.current_source_document_ids}/><EvidenceIds label="Prior journal entries" ids={row.prior_journal_entry_ids}/><EvidenceIds label="Prior source documents" ids={row.prior_source_document_ids}/></div>
  <section className="stack" aria-label="Prior-period lineage choices"><div><b>Current-period lineage</b><EvidenceDrillAction row={comparisonLineageRow(row,'CURRENT')} onOpenLineage={onOpenLineage}/></div><div><b>Prior-period lineage</b><EvidenceDrillAction row={comparisonLineageRow(row,'PRIOR')} onOpenLineage={onOpenLineage}/></div></section>
</section>;

const StatementSnapshotDetail=({row,returnContext,onBack,onOpenLineage})=><section className="full-bleed qbo-transaction-report" aria-label="Financial statement snapshot lineage evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to statement snapshot</button><ScopeLabel context={returnContext}/></div>
  <div className="card-head"><div><h2>{row.statement_type} / {row.account_code}</h2><p className="muted sm">Immutable snapshot <code>{row.financial_statement_snapshot_id}</code> v{row.version}; row hash <code>{row.row_hash}</code>.</p></div><span className="badge badge-muted">READ ONLY</span></div>
  <div className="detail-grid"><EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/><EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/></div>
  <EvidenceDrillAction row={row} onOpenLineage={onOpenLineage}/>
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
export const restoreAuthoritativeReportTablePosition=(environment,context,getTable)=>{const left=Number(context?.tableX);if(!Number.isFinite(left)||left<0)return false;const restore=()=>{try{getTable?.()?.scrollTo?.({left,behavior:'auto'});}catch{}};try{environment?.setTimeout?.(restore,0);}catch{restore();}return true;};

const FULL_STATEMENT_PAGE_SIZE=25;
const REPORT_MONTHS=Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
const readableReportDate=value=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');if(!match)return '';const instant=new Date(`${value}T00:00:00.000Z`);if(!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==value)return '';const month=Number(match[2]),day=Number(match[3]);return `${REPORT_MONTHS[month-1]} ${day}, ${match[1]}`;};
export const authoritativeReportRangeCaption=(start,end)=>{const startLabel=readableReportDate(start),endLabel=readableReportDate(end);if(!startLabel||!endLabel||start>end)return '';const sameYear=start.slice(0,4)===end.slice(0,4);return sameYear?`${startLabel.replace(/, \d{4}$/,'')}–${endLabel}`:`${startLabel}–${endLabel}`;};
export const authoritativeReportPeriodCaption=(report,rows=[])=>{if(!rows.length)return '';if(['TRIAL_BALANCE','BALANCE_SHEET'].includes(report)){const ends=[...new Set(rows.map(row=>row?.period_end))];return ends.length===1&&readableReportDate(ends[0])?`As of ${readableReportDate(ends[0])}`:'';}if(report==='INCOME_STATEMENT'){const starts=[...new Set(rows.map(row=>row?.period_start))],ends=[...new Set(rows.map(row=>row?.period_end))];return starts.length===1&&ends.length===1?authoritativeReportRangeCaption(starts[0],ends[0]):'';}return '';};

export const AuthoritativeFullStatementReport=({report,rows,returnContext,onBack,onRefresh,onOpenEvidence,loading=false,tableRef,page=0,onPageChange=()=>{}})=>{
  const title=statementLabel(report);
  const periodCaption=authoritativeReportPeriodCaption(report,rows);
  const debitLabel=report==='TRIAL_BALANCE'?'Debit':'Period debit';
  const creditLabel=report==='TRIAL_BALANCE'?'Credit':'Period credit';
  const pageCount=Math.max(1,Math.ceil(rows.length/FULL_STATEMENT_PAGE_SIZE));
  const currentPage=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pageCount-1);
  const start=currentPage*FULL_STATEMENT_PAGE_SIZE;
  const visibleRows=rows.slice(start,start+FULL_STATEMENT_PAGE_SIZE);
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement" aria-label={`${title} full report`}>
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to standard reports</button></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">FINANCIAL REPORT</div><h1 className="page-h">{title}</h1>{periodCaption&&<p className="authoritative-report-period-caption">{periodCaption}</p>}<p className="page-subtitle">Review posted balances.</p></div><div className="report-period-chip"><span>Report scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={loading} onClick={onRefresh}>{loading?'Loading…':'Refresh'}</button><span className="badge badge-muted">READ ONLY</span></div>
    {!rows.length?<StateBlock tone="empty" title="No data for this period">Choose another period. Empty results do not confirm a zero balance.</StateBlock>:<><div ref={tableRef} className={`table-wrap reports-workbench-table authoritative-full-statement-table ${report==='TRIAL_BALANCE'?'trial-balance-table':''}`} role="region" tabIndex={0} aria-label={`${title} rows; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Account</th><th>{debitLabel}</th><th>{creditLabel}</th><th>Balance</th><th>Details</th></tr></thead><tbody>{visibleRows.map((row,index)=>{const focusId=`authoritative-full-report-${row.statement_type}-${row.account_code}`;const beginsSection=index===0||rows[start+index-1].statement_section!==row.statement_section;return <React.Fragment key={`${row.statement_type}:${row.account_code}`}>{beginsSection&&<tr className="report-section-row"><th colSpan="5" scope="rowgroup">{row.statement_section}</th></tr>}<tr><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(statementDebit(report,row))}</td><td className="num">{money(statementCredit(report,row))}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>onOpenEvidence(row,focusId)}>View details</button></td></tr></React.Fragment>;})}</tbody></table></div>{rows.length>FULL_STATEMENT_PAGE_SIZE&&<nav className="authoritative-coa-pagination authoritative-report-pagination" aria-label={`${title} pages`}><span>Rows {start+1}-{Math.min(start+FULL_STATEMENT_PAGE_SIZE,rows.length)} of {rows.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage===0} onClick={()=>onPageChange(currentPage-1)}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage>=pageCount-1} onClick={()=>onPageChange(currentPage+1)}>Next</button></nav>}</>}
  </section>;
};

export const AuthoritativeInvoiceListReport=({state,returnContext,onBack,onRefresh,page=0,onPageChange=()=>{}})=>{
  const rows=Array.isArray(state?.rows)?state.rows:[];
  const pageCount=Math.max(1,Math.ceil(rows.length/FULL_STATEMENT_PAGE_SIZE));
  const currentPage=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pageCount-1);
  const start=currentPage*FULL_STATEMENT_PAGE_SIZE;
  const visibleRows=rows.slice(start,start+FULL_STATEMENT_PAGE_SIZE);
  const periodCaption=authoritativeReportRangeCaption(state?.scope?.periodStart,state?.scope?.periodEnd);
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement authoritative-invoice-list-report" aria-label="Invoice List full report">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to standard reports</button></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">RECEIVABLES REPORT</div><h1 className="page-h">Invoice List by Date</h1>{periodCaption&&<p className="authoritative-report-period-caption">{periodCaption}</p>}<p className="page-subtitle">Review invoices returned for this accounting period.</p></div><div className="report-period-chip"><span>Report scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'} onClick={onRefresh}>{state?.phase==='LOADING'?'Loading…':'Refresh'}</button><span className="badge badge-muted">READ ONLY</span></div>
    {state?.phase==='LOADING'&&<StateBlock tone="loading">Loading invoice list…</StateBlock>}
    <ReadError state={state||{phase:'IDLE'}} onRetry={onRefresh}/>
    {state?.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title="No invoices found">Try another accounting period. This scoped empty result does not confirm a zero receivable balance.</StateBlock>}
    {state?.phase==='READY'&&!!rows.length&&<><div className="table-wrap reports-workbench-table authoritative-full-statement-table authoritative-invoice-list-table" role="region" tabIndex={0} aria-label="Invoice List rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Date</th><th>Transaction type</th><th>Num</th><th>Name</th><th>Memo</th><th>Due date</th><th className="ta-r">Amount</th><th className="ta-r">Open balance</th></tr></thead><tbody>{visibleRows.map(row=><tr key={`${row.business_document_id}:${row.revision}`}><td>{row.inv_date}</td><td>Invoice</td><td>{row.inv_no}</td><td>{row.customer_name}</td><td>{row.description||'Not available'}</td><td>{row.due_date||'Not available'}</td><td className="num">{money(Number(row.amount).toFixed(4))}</td><td className="num">{money(Number(row.open_balance).toFixed(4))}</td></tr>)}</tbody></table></div>{rows.length>FULL_STATEMENT_PAGE_SIZE&&<nav className="authoritative-coa-pagination authoritative-report-pagination" aria-label="Invoice List pages"><span>Rows {start+1}-{Math.min(start+FULL_STATEMENT_PAGE_SIZE,rows.length)} of {rows.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage===0} onClick={()=>onPageChange(currentPage-1)}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage>=pageCount-1} onClick={()=>onPageChange(currentPage+1)}>Next</button></nav>}</>}
  </section>;
};

export const AuthoritativeJournalReport=({state,returnContext,onBack,onRefresh,page=0,onPageChange=()=>{}})=>{
  const rows=Array.isArray(state?.rows)?state.rows:[];
  const total=Number.isSafeInteger(state?.total)?state.total:0;
  const pageCount=Math.max(1,Math.ceil(total/FULL_STATEMENT_PAGE_SIZE));
  const currentPage=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pageCount-1);
  const starts=[...new Set(rows.map(row=>row?.period_start))],ends=[...new Set(rows.map(row=>row?.period_end))];
  const periodCaption=starts.length===1&&ends.length===1?authoritativeReportRangeCaption(starts[0],ends[0]):'';
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement authoritative-journal-report" aria-label="Journal full report">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to standard reports</button></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">ACCOUNTING REPORT</div><h1 className="page-h">Journal</h1>{periodCaption&&<p className="authoritative-report-period-caption">{periodCaption}</p>}<p className="page-subtitle">Review posted journal lines.</p></div><div className="report-period-chip"><span>Report scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'} onClick={()=>onRefresh(currentPage)}>{state?.phase==='LOADING'?'Loading…':'Refresh'}</button><span className="badge badge-muted">READ ONLY</span></div>
    {state?.phase==='LOADING'&&<StateBlock tone="loading">Loading journal report…</StateBlock>}
    <ReadError state={state||{phase:'IDLE'}} onRetry={()=>onRefresh(currentPage)}/>
    {state?.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title="No journal lines found">Try another accounting period. This scoped empty result does not confirm a zero ledger balance.</StateBlock>}
    {state?.phase==='READY'&&!!rows.length&&<><div className="table-wrap reports-workbench-table authoritative-full-statement-table authoritative-journal-report-table" role="region" tabIndex={0} aria-label="Journal rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Transaction date</th><th>Num</th><th>Description</th><th>Account Name</th><th className="ta-r">Debit</th><th className="ta-r">Credit</th></tr></thead><tbody>{rows.map(row=><tr key={row.ledger_line_id}><td>{row.journal_date}</td><td>{row.journal_number}</td><td>{row.description||'Not returned'}</td><td><code>{row.account_code}</code><br/><small>{row.account_name}</small></td><td className="num">{money(row.debit_amount)}</td><td className="num">{money(row.credit_amount)}</td></tr>)}</tbody></table></div>{total>FULL_STATEMENT_PAGE_SIZE&&<nav className="authoritative-coa-pagination authoritative-report-pagination" aria-label="Journal pages"><span>Rows {currentPage*FULL_STATEMENT_PAGE_SIZE+1}-{Math.min((currentPage+1)*FULL_STATEMENT_PAGE_SIZE,total)} of {total}</span><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'||currentPage===0} onClick={()=>onPageChange(currentPage-1)}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'||currentPage>=pageCount-1} onClick={()=>onPageChange(currentPage+1)}>Next</button></nav>}</>}
    <details className="authoritative-return-context"><summary>Available columns</summary><span>Transaction type and Name are not returned by this authoritative API and are not inferred.</span></details>
  </section>;
};

export const AuthoritativeAccountListReport=({state,returnContext,onBack,onRefresh,page=0,onPageChange=()=>{},backLabel='Back to standard reports'})=>{
  const rows=Array.isArray(state?.rows)?state.rows:[];
  const pageCount=Math.max(1,Math.ceil(rows.length/FULL_STATEMENT_PAGE_SIZE));
  const currentPage=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pageCount-1);
  const start=currentPage*FULL_STATEMENT_PAGE_SIZE;
  const visibleRows=rows.slice(start,start+FULL_STATEMENT_PAGE_SIZE);
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement authoritative-account-list-report" aria-label="Account List full report">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>{backLabel}</button></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">ACCOUNTING REPORT</div><h1 className="page-h">Account List</h1><p className="page-subtitle">Review accounts and balances.</p></div><div className="report-period-chip"><span>Report scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'} onClick={onRefresh}>{state?.phase==='LOADING'?'Loading…':'Refresh'}</button><span className="badge badge-muted">READ ONLY</span></div>
    {state?.phase==='LOADING'&&<StateBlock tone="loading">Loading account list…</StateBlock>}
    <ReadError state={state||{phase:'IDLE'}} onRetry={onRefresh}/>
    {state?.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title="No accounts found">No accounts were returned for this scope. This result does not confirm a zero ledger balance.</StateBlock>}
    {state?.phase==='READY'&&!!rows.length&&<><div className="table-wrap reports-workbench-table authoritative-full-statement-table authoritative-account-list-table" role="region" tabIndex={0} aria-label="Account List rows"><table className="tbl"><thead><tr><th>Account Name</th><th>Member rule</th><th>Status</th><th>Currency</th><th className="ta-r">Ending balance</th></tr></thead><tbody>{visibleRows.map(row=><tr key={`${row.account_code}:${row.currency||'none'}`}><td><b>{row.account_name}</b><div className="muted sm"><code>{row.account_code}</code></div></td><td>{row.requires_member?row.required_member_type||'Required':'None'}</td><td>{row.active?'Active':'Inactive'}</td><td>{row.currency||'Not available'}</td><td className="num">{row.ending_balance===null?'—':money(row.ending_balance)}</td></tr>)}</tbody></table></div>{rows.length>FULL_STATEMENT_PAGE_SIZE&&<nav className="authoritative-coa-pagination authoritative-report-pagination" aria-label="Account List pages"><span>Rows {start+1}-{Math.min(start+FULL_STATEMENT_PAGE_SIZE,rows.length)} of {rows.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage===0} onClick={()=>onPageChange(currentPage-1)}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage>=pageCount-1} onClick={()=>onPageChange(currentPage+1)}>Next</button></nav>}</>}
    <details className="authoritative-return-context"><summary>Available columns</summary><span>Type, Detail type, and Description are not returned by this authoritative API and are not inferred. Balances use the configured accounting period.</span></details>
  </section>;
};

export const AuthoritativeStatementOfCashFlowsReport=({state,returnContext,periodCaption='',onBack,onRefresh,onOpenEvidence,page=0,onPageChange=()=>{}})=>{
  const rows=Array.isArray(state?.rows)?state.rows:[];
  const pageCount=Math.max(1,Math.ceil(rows.length/FULL_STATEMENT_PAGE_SIZE));
  const currentPage=Math.min(Math.max(Number.isSafeInteger(page)?page:0,0),pageCount-1);
  const start=currentPage*FULL_STATEMENT_PAGE_SIZE;
  const visibleRows=rows.slice(start,start+FULL_STATEMENT_PAGE_SIZE);
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page authoritative-full-statement" aria-label="Statement of Cash Flows full report">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to standard reports</button></div>
    <header className="accounting-page-head"><div><div className="page-eyebrow">FINANCIAL REPORT</div><h1 className="page-h">Statement of Cash Flows</h1>{periodCaption&&<p className="authoritative-report-period-caption">{periodCaption}</p>}<p className="page-subtitle">Review operating, investing, and financing cash activity.</p></div><div className="report-period-chip"><span>Report scope</span><b><ScopeLabel context={returnContext}/></b><small>READ ONLY</small></div></header>
    <div className="authoritative-full-statement-actions"><button type="button" className="btn btn-sm btn-ghost" disabled={state?.phase==='LOADING'} onClick={onRefresh}>{state?.phase==='LOADING'?'Loading…':'Refresh'}</button><span className="badge badge-muted">READ ONLY</span></div>
    {state?.phase==='LOADING'&&<StateBlock tone="loading">Loading mapped cash-flow activity…</StateBlock>}
    <ReadError state={state||{phase:'IDLE'}} onRetry={onRefresh}/>
    {state?.phase==='READY'&&!rows.length&&<StateBlock tone="empty" title="No mapped cash activity returned">This scoped empty result is not evidence of zero operating, investing, or financing cash flow.</StateBlock>}
    {state?.phase==='READY'&&!!rows.length&&!state.complete&&<StateBlock tone="error" title="BLOCKED — classification unavailable">At least one posted cash movement has no single approved mapping. Cash-flow totals are not inferred.</StateBlock>}
    {state?.phase==='READY'&&state.complete&&<div className="qbo-toolgrid" aria-label="Statement of Cash Flows totals"><span><i>Operating</i><b>{money(sumCashFlowRows(rows,['OPERATING']))}</b></span><span><i>Investing</i><b>{money(sumCashFlowRows(rows,['INVESTING']))}</b></span><span><i>Financing</i><b>{money(sumCashFlowRows(rows,['FINANCING']))}</b></span><span><i>Net change in cash</i><b>{money(sumCashFlowRows(rows))}</b></span></div>}
    {state?.phase==='READY'&&!!rows.length&&<><div className="table-wrap reports-workbench-table authoritative-full-statement-table" role="region" tabIndex={0} aria-label="Statement of Cash Flows rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Classification</th><th>Cash / counterpart</th><th>Cash effect</th><th>Mapping</th><th>Details</th></tr></thead><tbody>{visibleRows.map(row=>{const focusId=`authoritative-full-cash-flow-${row.journal_entry_ids[0]}-${row.counterpart_account_code}`;return <tr key={`${row.journal_entry_ids[0]}:${row.cash_account_code}:${row.counterpart_account_code}`}><td><b>{row.classification}</b><div className="muted sm">{row.mapping_status}</div></td><td><b>{row.cash_account_code}</b><div className="muted sm">{row.counterpart_account_code}</div></td><td className="num">{money(row.cash_effect)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>onOpenEvidence(row,focusId)}>View details</button></td></tr>;})}</tbody></table></div>{rows.length>FULL_STATEMENT_PAGE_SIZE&&<nav className="authoritative-coa-pagination authoritative-report-pagination" aria-label="Statement of Cash Flows pages"><span>Rows {start+1}-{Math.min(start+FULL_STATEMENT_PAGE_SIZE,rows.length)} of {rows.length}</span><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage===0} onClick={()=>onPageChange(currentPage-1)}>Previous</button><button type="button" className="btn btn-sm btn-ghost" disabled={currentPage>=pageCount-1} onClick={()=>onPageChange(currentPage+1)}>Next</button></nav>}</>}
  </section>;
};

export const AuthoritativeReportDetail=({row,returnContext,onBack})=>{
  const scopeMatches=reportRowMatchesReturnContext(row,returnContext);
  const lineageComplete=hasCompleteReportLineage(row);
  if(!scopeMatches)return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Financial statement account evidence">
    <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to financial statement</button><ScopeLabel context={returnContext} extra={` / ${returnContext?.report||'Report'}`}/></div>
    <StateBlock tone="blocked" title="BLOCKED: immutable report scope mismatch">This report row does not match the account, section, dimension, entity, period, and statement retained when the evidence page was opened. It remains visible for review, but cannot support a posted-evidence assertion or Journal/source drill.</StateBlock>
  </section>;
  return <section className="full-bleed qbo-transaction-report authoritative-evidence-page" aria-label="Financial statement account evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to financial statement</button><ScopeLabel context={returnContext} extra={` / ${returnContext?.report||'Report'}`}/></div>
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
  {!lineageComplete&&<StateBlock tone="blocked" title="BLOCKED: authoritative lineage unavailable">This report row remains visible as scoped statement data, but it cannot support a Journal Entry or source drill until the accounting API returns Journal Entry, Journal Line, ledger-line, and source-document identifiers together.</StateBlock>}
</section>;
};

export function AuthoritativeReportsWorkspace({config,fetcher=globalThis.fetch,environment=globalThis,initialCatalog=DEFAULT_AUTHORITATIVE_REPORTS_CATALOG,onOpenArAging=()=>{},onOpenGeneralLedger=()=>{},onOpenReconciliation=()=>{},workspaceTitle='Standard reports',workspaceEyebrow='REPORTING',workspaceDescription='Review posted financial reports.',initialDimensionType='PROPERTY',initialDimensionRef=''}){
  const entityLabel=config?.scopePresentation?.entityLabel||'Configured entity';
  const periodLabel=config?.scopePresentation?.periodLabel||'Configured period';
  const initialCatalogState=normalizeAuthoritativeReportsCatalog(initialCatalog);
  const initialDimension=DIMENSION_TYPES.some(([key])=>key===initialDimensionType)?initialDimensionType:'PROPERTY';
  const [report,setReport]=useState(initialCatalogState.preview);
  const [workbenchTab,setWorkbenchTab]=useState(initialCatalogState.category);
  const [collapsedWorkbenchTab,setCollapsedWorkbenchTab]=useState(null);
  const [catalogSearch,setCatalogSearch]=useState(initialCatalogState.query);
  const [selected,setSelected]=useState(null);
  const fullStatementTableRef=useRef(null);
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [statementSnapshotState,setStatementSnapshotState]=useState({phase:'IDLE',rows:[],error:null,scope:null,snapshotId:null,version:null});
  const [dimensionType,setDimensionType]=useState(initialDimension);
  const [dimensionRef,setDimensionRef]=useState(typeof initialDimensionRef==='string'?initialDimensionRef.trim():'');
  const [dimensionState,setDimensionState]=useState({phase:'IDLE',rows:[],error:null,scope:null});
  const [cashFlowState,setCashFlowState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [invoiceListState,setInvoiceListState]=useState({phase:'IDLE',rows:[],error:null,scope:null});
  const [journalReportState,setJournalReportState]=useState({phase:'IDLE',rows:[],total:0,error:null,scope:null});
  const [accountListState,setAccountListState]=useState({phase:'IDLE',rows:[],error:null,scope:null});
  const [cwipState,setCwipState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [constructionLoanState,setConstructionLoanState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [prepaidState,setPrepaidState]=useState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});
  const [amortizationScheduleState,setAmortizationScheduleState]=useState({phase:'IDLE',rows:[],error:null});
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
  const loadInvoiceList=async()=>{setInvoiceListState({phase:'LOADING',rows:[],error:null,scope:null});const result=await refreshAuthoritativeDocuments({config,fetcher});setInvoiceListState(result.ok?{phase:'READY',rows:result.ar.invoices,error:null,scope:result.ar.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null});};
  const loadJournalReport=async(nextPage=0)=>{setJournalReportState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeGeneralLedger({config,limit:FULL_STATEMENT_PAGE_SIZE,offset:nextPage*FULL_STATEMENT_PAGE_SIZE,fetcher});setJournalReportState(result.ok?{phase:'READY',rows:result.rows,total:result.total,error:null,scope:result.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],total:0,error:result,scope:null});};
  const loadAccountList=async()=>{setAccountListState({phase:'LOADING',rows:[],error:null,scope:null});const result=await refreshAuthoritativeChartOfAccounts({config,fetcher});setAccountListState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null});};
  const loadCwip=async()=>{setCwipState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeCwipRollforward({config,fetcher});setCwipState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadConstructionLoan=async()=>{setConstructionLoanState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeConstructionLoanRollforward({config,fetcher});setConstructionLoanState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadPrepaid=async()=>{setPrepaidState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativePrepaidRollforward({config,fetcher});setPrepaidState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadAmortizationSchedules=async()=>{setAmortizationScheduleState({phase:'LOADING',rows:[],error:null});const result=await refreshAuthoritativeAiAmortizationSchedules({config,fetcher});setAmortizationScheduleState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result});};
  const loadIntercompany=async()=>{setIntercompanyState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeIntercompanyReconciliation({config,counterpartyEntityId,counterpartyPeriodId,fetcher});setIntercompanyState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadBudget=async()=>{setBudgetState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeBudgetVsActual({config,fetcher});setBudgetState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadConsolidation=async()=>{setConsolidationState({phase:'LOADING',rows:[],error:null,scope:null,complete:false});const result=await refreshAuthoritativeConsolidation({config,groupRef:consolidationGroupRef,fetcher});setConsolidationState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope,complete:result.complete}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null,complete:false});};
  const loadComparison=async()=>{setComparisonState({phase:'LOADING',rows:[],error:null,scope:null});const result=await refreshAuthoritativeFinancialStatementPeriodComparison({config,priorPeriodId,fetcher});setComparisonState(result.ok?{phase:'READY',rows:result.rows,error:null,scope:result.scope}:{phase:authoritativeReadFailurePhase(result),rows:[],error:result,scope:null});};
  useEffect(()=>{load();},[config?.entityId,config?.periodId]);
  useEffect(()=>{if(initialDimensionRef.trim())void loadDimension();},[config?.entityId,config?.periodId,initialDimensionRef]);
  const rows=useMemo(()=>state.rows.filter(row=>row.statement_type===report),[state.rows,report]);
  const openEvidence=(row,focusId,kind='STATEMENT',title=null,detailContext=null)=>{
    const tableX=Number(environment?.document?.getElementById?.(focusId)?.closest?.('.table-wrap')?.scrollLeft)||0;
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0,tableX});
    if(base)setSelected({kind,row,title,returnContext:{...base,report,reportAccountCode:row.account_code||null,reportSection:row.statement_section||null,reportDimensionType:row.dimension_type||null,reportDimensionRef:row.dimension_ref||null,workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}),...(detailContext&&typeof detailContext==='object'?detailContext:{})}});
  };
  const openPropertyReport=(shortcut)=>{
    const [, , ,nextTab,nextDimensionType]=shortcut;
    setWorkbenchTab(nextTab);
    setCollapsedWorkbenchTab(null);
    setCatalogSearch('');
    if(nextDimensionType){
      setDimensionType(nextDimensionType);
      setDimensionState({phase:'IDLE',rows:[],error:null,scope:null});
    }
    setSelected(null);
  };
  const openFullStatement=(focusId='authoritative-open-full-statement',nextReport=report)=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({kind:'FULL_STATEMENT',page:0,rows:state.rows.filter(row=>row.statement_type===nextReport),returnContext:{...base,report:nextReport,workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:nextReport})}});
  };
  const openCashFlowReport=(focusId='authoritative-report-statement-of-cash-flows')=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(!base)return;
    setSelected({kind:'STATEMENT_OF_CASH_FLOWS',page:0,returnContext:{...base,report:'STATEMENT_OF_CASH_FLOWS',workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report})}});
    if(cashFlowState.phase==='IDLE')void loadCashFlow();
  };
  const openInvoiceListReport=(focusId='authoritative-search-result-INVOICE_LIST')=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(!base)return;
    setSelected({kind:'INVOICE_LIST',page:0,returnContext:{...base,report:'INVOICE_LIST',workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report})}});
    if(invoiceListState.phase==='IDLE')void loadInvoiceList();
  };
  const openJournalReport=(focusId='authoritative-search-result-JOURNAL_REPORT')=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(!base)return;
    setSelected({kind:'JOURNAL_REPORT',page:0,returnContext:{...base,report:'JOURNAL_REPORT',workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report})}});
    if(journalReportState.phase==='IDLE')void loadJournalReport(0);
  };
  const openAccountListReport=(focusId='authoritative-search-result-ACCOUNT_LIST')=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(!base)return;
    setSelected({kind:'ACCOUNT_LIST',page:0,returnContext:{...base,report:'ACCOUNT_LIST',workbenchTab,reportsCatalog:normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report})}});
    if(accountListState.phase==='IDLE')void loadAccountList();
  };
  const openEvidenceFromFullStatement=(row,focusId)=>{
    const parent=selected;
    if(!parent||parent.kind!=='FULL_STATEMENT')return;
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({kind:'STATEMENT',row,returnContext:{...parent.returnContext,...base,reportPage:parent.page||0,reportAccountCode:row.account_code||null,reportSection:row.statement_section||null,reportDimensionType:row.dimension_type||null,reportDimensionRef:row.dimension_ref||null,tableX:Number(fullStatementTableRef.current?.scrollLeft)||0,parentFullStatement:parent}});
  };
  const openEvidenceFromCashFlowReport=(row,focusId)=>{
    const parent=selected;
    if(!parent||parent.kind!=='STATEMENT_OF_CASH_FLOWS')return;
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({kind:'CASH_FLOW_CLASSIFICATION',row,returnContext:{...parent.returnContext,...base,reportPage:parent.page||0,parentCashFlowReport:parent}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.parentCashFlowReport?.kind==='STATEMENT_OF_CASH_FLOWS'){
      setSelected(context.parentCashFlowReport);
      restoreAuthoritativeReturnContext(environment,config,context);
      return;
    }
    if(context?.parentFullStatement?.kind==='FULL_STATEMENT'){
      setSelected(context.parentFullStatement);
      if(restoreAuthoritativeReturnContext(environment,config,context))restoreAuthoritativeReportTablePosition(environment,context,()=>fullStatementTableRef.current);
      return;
    }
    if(REPORTS.some(([key])=>key===context?.report))setReport(context.report);
    if(REPORT_WORKBENCH_TABS.some(([key])=>key===context?.workbenchTab))setWorkbenchTab(context.workbenchTab);
    const catalog=normalizeAuthoritativeReportsCatalog(context?.reportsCatalog);
    setWorkbenchTab(catalog.category);
    setCollapsedWorkbenchTab(null);
    setCatalogSearch(catalog.query);
    setReport(catalog.preview);
    if(['PROPERTY','PROJECT','UNIT','LOT'].includes(context?.dimension?.type)&&typeof context.dimension.ref==='string'&&context.dimension.ref.trim()){
      setDimensionType(context.dimension.type);
      setDimensionRef(context.dimension.ref);
    }
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context,{getTable:()=>environment?.document?.getElementById?.(context?.focusId)?.closest?.('.table-wrap')});
  };
  const openEvidenceLineage=row=>{const detail=selected;const context=detail?.returnContext;if(!detail||!context)return;setSelected({kind:'EVIDENCE_LINEAGE',row,returnTo:detail,returnContext:context,lineageConfig:authoritativeReportLineageConfig(config,row)});};
  if(selected?.kind==='EVIDENCE_LINEAGE')return <AuthoritativeLineageDrill config={selected.lineageConfig||config} fetcher={fetcher} initial={{kind:'EVIDENCE',row:selected.row,context:{entityId:config.entityId,periodId:selected.lineageConfig?.periodId||config.periodId,accountCode:selected.row.account_code||null}}} onExit={()=>setSelected(selected.returnTo)}/>;
  if(selected?.kind==='STATEMENT_OF_CASH_FLOWS')return <AuthoritativeStatementOfCashFlowsReport state={cashFlowState} returnContext={selected.returnContext} periodCaption={authoritativeReportRangeCaption(config?.scopePresentation?.periodStart,config?.scopePresentation?.periodEnd)} page={selected.page||0} onPageChange={page=>setSelected(current=>current?.kind==='STATEMENT_OF_CASH_FLOWS'?{...current,page}:current)} onBack={closeEvidence} onRefresh={loadCashFlow} onOpenEvidence={openEvidenceFromCashFlowReport}/>;
  if(selected?.kind==='INVOICE_LIST')return <AuthoritativeInvoiceListReport state={invoiceListState} returnContext={selected.returnContext} page={selected.page||0} onPageChange={page=>setSelected(current=>current?.kind==='INVOICE_LIST'?{...current,page}:current)} onBack={closeEvidence} onRefresh={loadInvoiceList}/>;
  if(selected?.kind==='JOURNAL_REPORT')return <AuthoritativeJournalReport state={journalReportState} returnContext={selected.returnContext} page={selected.page||0} onPageChange={page=>{setSelected(current=>current?.kind==='JOURNAL_REPORT'?{...current,page}:current);void loadJournalReport(page);}} onBack={closeEvidence} onRefresh={loadJournalReport}/>;
  if(selected?.kind==='ACCOUNT_LIST')return <AuthoritativeAccountListReport state={accountListState} returnContext={selected.returnContext} page={selected.page||0} onPageChange={page=>setSelected(current=>current?.kind==='ACCOUNT_LIST'?{...current,page}:current)} onBack={closeEvidence} onRefresh={loadAccountList}/>;
  if(selected?.kind==='CASH_FLOW_CLASSIFICATION')return <CashFlowDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected?.kind==='INTERCOMPANY_RECONCILIATION')return <IntercompanyDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected?.kind==='BUDGET_VS_ACTUAL')return <BudgetActualDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected?.kind==='CONSOLIDATION')return <ConsolidationDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected?.kind==='PERIOD_COMPARISON')return <ComparisonDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected?.kind==='STATEMENT_SNAPSHOT')return <StatementSnapshotDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>;
  if(selected)return selected.kind==='FULL_STATEMENT'?<AuthoritativeFullStatementReport report={selected.returnContext.report} rows={selected.rows} returnContext={selected.returnContext} page={selected.page||0} onPageChange={page=>setSelected(current=>current?.kind==='FULL_STATEMENT'?{...current,page}:current)} onBack={closeEvidence} onRefresh={load} loading={state.phase==='LOADING'} onOpenEvidence={openEvidenceFromFullStatement} tableRef={fullStatementTableRef}/>:selected.kind==='STATEMENT'&&reportRowMatchesReturnContext(selected.row,selected.returnContext)&&hasCompleteReportLineage(selected.row)?<AuthoritativeLineageDrill config={authoritativeReportLineageConfig(config,selected.row)} fetcher={fetcher} initial={{kind:'REPORT',row:selected.row,context:{entityId:config.entityId,periodId:selected.row.period_id,report:selected.row.statement_type,accountCode:selected.row.account_code,section:selected.row.statement_section}}} onExit={closeEvidence}/>:selected.kind==='EVIDENCE_LINEAGE'?<AuthoritativeLineageDrill config={config} fetcher={fetcher} initial={{kind:'EVIDENCE',row:selected.row,context:{entityId:config.entityId,periodId:config.periodId,accountCode:selected.row.account_code}}} onExit={()=>setSelected(selected.returnTo)}/>:selected.kind==='CASH_FLOW_CLASSIFICATION'?<CashFlowDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='INTERCOMPANY_RECONCILIATION'?<IntercompanyDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='BUDGET_VS_ACTUAL'?<BudgetActualDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='CONSOLIDATION'?<ConsolidationDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='PERIOD_COMPARISON'?<ComparisonDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>:selected.kind==='CWIP_ROLLFORWARD'?<CwipRollforwardDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:selected.kind==='DIMENSION_PROFITABILITY'?<DimensionProfitabilityDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:selected.kind==='ROLLFORWARD'?<RollforwardDetail title={selected.title} row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence} onOpenLineage={openEvidenceLineage}/>:<AuthoritativeReportDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>;
  const matchingWorkbenchTabs=REPORT_WORKBENCH_TABS.filter(([,label,description])=>`${label} ${description}`.toLowerCase().includes(catalogSearch.trim().toLowerCase()));
  const matchingShortcuts=findAuthoritativeReportShortcuts(catalogSearch);
  const matchingMappingBackedShortcuts=findAuthoritativeMappingBackedReportShortcuts(catalogSearch);
  const matchingDocumentReportShortcuts=findAuthoritativeDocumentReportShortcuts(catalogSearch);
  const matchingJournalReportShortcuts=findAuthoritativeJournalReportShortcuts(catalogSearch);
  const matchingAccountReportShortcuts=findAuthoritativeAccountReportShortcuts(catalogSearch);
  const matchingGeneralLedgerShortcuts=findAuthoritativeGeneralLedgerShortcut(catalogSearch);
  const matchingReconciliationShortcuts=findAuthoritativeReconciliationReportShortcut(catalogSearch);
  const matchingUnavailableShortcuts=findAuthoritativeUnavailableReportShortcuts(catalogSearch);
  const visibleMatchingWorkbenchTabs=matchingMappingBackedShortcuts.length?[]:matchingWorkbenchTabs;
  const matchingPropertyShortcuts=findAuthoritativePropertyReportShortcuts(catalogSearch);
  const totalCatalogMatches=visibleMatchingWorkbenchTabs.length+matchingShortcuts.length+matchingMappingBackedShortcuts.length+matchingDocumentReportShortcuts.length+matchingJournalReportShortcuts.length+matchingAccountReportShortcuts.length+matchingGeneralLedgerShortcuts.length+matchingReconciliationShortcuts.length+matchingUnavailableShortcuts.length+matchingPropertyShortcuts.length;
  const searching=Boolean(catalogSearch.trim());
  const statementPreviewRows=rows.slice(0,12);
  const commonReportsDirectory=<section className="authoritative-report-shortcuts authoritative-core-report-shortcuts" aria-label="Common reports"><div><span className="page-eyebrow">COMMON REPORTS</span></div><div className="authoritative-report-shortcut-grid"><button id="authoritative-report-ar-aging" type="button" className="authoritative-report-shortcut" onClick={()=>onOpenArAging('authoritative-report-ar-aging',normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}))}><ReportIcon reportKey="AR_AGING"/><span>A/R aging control totals</span></button>{REPORT_LIBRARY_SHORTCUTS.map(([key,label])=>{const focusId=`authoritative-common-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" disabled={state.phase==='LOADING'} onClick={()=>openFullStatement(focusId,key)}><ReportIcon reportKey={key}/><span>{label}</span></button>;})}<button id="authoritative-report-general-ledger" type="button" className="authoritative-report-shortcut" onClick={()=>onOpenGeneralLedger('authoritative-report-general-ledger',normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}))}><ReportIcon reportKey="GENERAL_LEDGER"/><span>General Ledger</span></button><button id="authoritative-report-statement-of-cash-flows" type="button" className="authoritative-report-shortcut" disabled={cashFlowState.phase==='LOADING'} onClick={()=>openCashFlowReport('authoritative-report-statement-of-cash-flows')}><ReportIcon reportKey="STATEMENT_OF_CASH_FLOWS"/><span>Statement of Cash Flows</span></button></div></section>;
  return <AuthoritativeReportsView className="reports-library authoritative-reports-library" eyebrow={workspaceEyebrow} title={workspaceTitle} description={workspaceDescription} scope={<div className="report-period-chip"><span>Reporting scope</span><b title={`Entity ID: ${config.entityId}; Period ID: ${config.periodId}`}>Entity {entityLabel} · Period {periodLabel}</b><small>Posted only</small></div>}>
    <section className="authoritative-report-finder" aria-label="Reports catalog"><label><span>Search reports</span><input value={catalogSearch} maxLength="120" onChange={event=>setCatalogSearch(event.target.value)} placeholder="Type report name here"/></label>{catalogSearch.trim()&&<span className="authoritative-report-match-summary">{totalCatalogMatches?`${totalCatalogMatches} ${totalCatalogMatches===1?'match':'matches'}`:'No reports found'}</span>}</section>
    {searching&&!!matchingShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching statements"><div><span className="page-eyebrow">MATCHING STATEMENTS</span></div><div className="authoritative-report-shortcut-grid">{matchingShortcuts.map(([key,label,description])=><button key={key} type="button" className={`authoritative-report-shortcut ${report===key&&workbenchTab==='STATEMENTS'?'is-current':''}`} disabled={state.phase==='LOADING'} onClick={()=>openFullStatement(`authoritative-search-result-${key}`,key)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>)}</div></section>}
    {searching&&!!matchingMappingBackedShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching classified reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingMappingBackedShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" disabled={cashFlowState.phase==='LOADING'} onClick={()=>openCashFlowReport(focusId)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingDocumentReportShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching receivables reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingDocumentReportShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" disabled={invoiceListState.phase==='LOADING'} onClick={()=>openInvoiceListReport(focusId)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingJournalReportShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching journal reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingJournalReportShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" disabled={journalReportState.phase==='LOADING'} onClick={()=>openJournalReport(focusId)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingAccountReportShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching account reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingAccountReportShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" disabled={accountListState.phase==='LOADING'} onClick={()=>openAccountListReport(focusId)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingGeneralLedgerShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching ledger reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingGeneralLedgerShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" onClick={()=>onOpenGeneralLedger(focusId,normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}))}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingReconciliationShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching reconciliation reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingReconciliationShortcuts.map(([key,label,description])=>{const focusId=`authoritative-search-result-${key}`;return <button id={focusId} key={key} type="button" className="authoritative-report-shortcut" onClick={()=>onOpenReconciliation(focusId,normalizeAuthoritativeReportsCatalog({category:workbenchTab,query:catalogSearch,preview:report}))}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section>}
    {searching&&!!matchingUnavailableShortcuts.length&&<section className="authoritative-report-shortcuts authoritative-report-finder-results" aria-label="Matching unavailable reports"><div><span className="page-eyebrow">MATCHING REPORTS</span></div><div className="authoritative-report-shortcut-grid">{matchingUnavailableShortcuts.map(([key,label,description])=><article key={key} className="authoritative-report-shortcut is-unavailable" aria-disabled="true"><ReportIcon reportKey={key}/><span>{label}</span><small>{description} <b>Not available</b></small></article>)}</div></section>}
    {!searching&&commonReportsDirectory}
    {(!searching||!!matchingPropertyShortcuts.length)&&<details className="authoritative-secondary-disclosure authoritative-property-report-directory"><summary><span>Property &amp; project reports</span><span className="badge badge-muted">{searching?matchingPropertyShortcuts.length:PROPERTY_REPORT_SHORTCUTS.length}</span></summary><section className="authoritative-report-shortcuts" aria-label="Property, project, unit, and lot report directory"><div className="authoritative-report-shortcut-grid">{PROPERTY_REPORT_SHORTCUTS.filter(shortcut=>!searching||matchingPropertyShortcuts.includes(shortcut)).map(shortcut=>{const [key,label,description,nextTab,nextDimensionType]=shortcut;const active=workbenchTab===nextTab&&(!nextDimensionType||dimensionType===nextDimensionType);return <button key={key} type="button" className={`authoritative-report-shortcut ${active?'is-current':''}`} aria-pressed={active} onClick={()=>openPropertyReport(shortcut)}><ReportIcon reportKey={key}/><span>{label}</span><small>{description}</small></button>;})}</div></section></details>}
    {(!searching||!!visibleMatchingWorkbenchTabs.length)&&<nav className="rep-grid" aria-label="Report groups">{(searching?visibleMatchingWorkbenchTabs:REPORT_WORKBENCH_TABS).map(([key,label])=>{const expanded=!searching&&workbenchTab===key&&collapsedWorkbenchTab!==key;return <h2 className="rep-group-heading" key={key}><button type="button" aria-expanded={expanded} aria-controls={`authoritative-report-group-${key}`} className={`rep-card ${expanded?'rep-on':''}`} onClick={()=>{if(!searching&&workbenchTab===key)setCollapsedWorkbenchTab(current=>current===key?null:key);else{setWorkbenchTab(key);setCollapsedWorkbenchTab(null);}setCatalogSearch('');setSelected(null);}}><ReportIcon reportKey={key}/><span className="rep-name">{label}</span><span className="rep-group-chevron" aria-hidden="true">⌄</span></button></h2>;})}</nav>}
    {!totalCatalogMatches&&searching&&<StateBlock tone="empty" title="No reports found">Try another search or clear it to view all reports. No report data was inferred.</StateBlock>}
    {!searching&&collapsedWorkbenchTab!==workbenchTab&&<section id={`authoritative-report-group-${workbenchTab}`} className="report-workbench" aria-label={`${REPORT_WORKBENCH_TABS.find(([key])=>key===workbenchTab)?.[1]} report workspace`}>{workbenchTab==='STATEMENTS'&&<div className="report-workbench-head authoritative-report-workbench-actions" aria-label="Statement actions"><button type="button" className="btn btn-sm btn-ghost" disabled={state.phase==='LOADING'} onClick={load}>{state.phase==='LOADING'?'Loading…':'Refresh'}</button></div>}
    {workbenchTab==='STATEMENTS'&&<>
    <details className="authoritative-secondary-disclosure authoritative-statement-snapshot"><summary><span>Statement snapshot</span><span className="badge badge-muted">READ ONLY</span></summary><section className="card" aria-label="Financial statement snapshot version evidence"><div className="card-head"><div><h2>Approved version</h2><p className="muted sm">Immutable statement evidence with retained GL, Journal, and source identifiers.</p></div></div><div className="qbo-filter-grid"><button type="button" className="btn" disabled={statementSnapshotState.phase==='LOADING'} onClick={loadStatementSnapshot}>{statementSnapshotState.phase==='LOADING'?'Loading…':'Load statement snapshot'}</button></div>
      {statementSnapshotState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable statement snapshot evidence...</StateBlock>}
      <ReadError state={statementSnapshotState} onRetry={loadStatementSnapshot}/>
      {statementSnapshotState.phase==='READY'&&!statementSnapshotState.rows.length&&<StateBlock tone="empty" title="No approved statement snapshot returned">No approved immutable financial-statement snapshot was returned for this entity and period. This does not change the live POSTED-ledger statement evidence.</StateBlock>}
      {statementSnapshotState.phase==='READY'&&!!statementSnapshotState.rows.length&&<><p className="muted sm">Snapshot <code>{statementSnapshotState.snapshotId}</code> v{statementSnapshotState.version}. This is frozen report evidence; it never replaces the current ledger, posts a journal, or creates an approval.</p><div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Immutable financial statement snapshot rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Statement / account</th><th className="ta-r">Balance</th><th>Version evidence</th><th>Lineage</th></tr></thead><tbody>{statementSnapshotState.rows.map(row=>{const focusId=`authoritative-snapshot-${row.statement_type}-${row.account_code}`;return <tr key={`${row.statement_type}:${row.account_code}`}><td><b>{row.account_code}</b><div className="muted sm">{row.statement_type} / {row.statement_section}</div></td><td className="num">{money(row.display_balance)}</td><td><code>{row.row_hash}</code><div className="muted sm">Prepared {row.prepared_by}; approved {row.approved_by}</div></td><td><span className="muted sm">JE {row.journal_entry_ids.length} · GL {row.ledger_line_ids.length} · Source {row.source_document_ids.length}</span><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'STATEMENT_SNAPSHOT')}>Open snapshot lineage</button></td></tr>;})}</tbody></table></div></>}
    </section></details>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative financial statements...</StateBlock>}
    <ReadError state={state} onRetry={load}/>
    {state.phase==='READY'&&<section className="card" aria-label={`${REPORTS.find(item=>item[0]===report)?.[1]} rows`}>
      <div className="card-head"><div><h2>{REPORTS.find(item=>item[0]===report)?.[1]}</h2><p className="muted sm">{rows.length} accounts</p></div><div className="row-acts"><span className="badge badge-muted">READ ONLY</span><button id="authoritative-open-full-statement" type="button" className="btn btn-sm btn-ghost" disabled={state.phase==='LOADING'} onClick={()=>openFullStatement('authoritative-open-full-statement')}>View report</button></div></div>
      {!!rows.length&&<FinancialStatementSummary report={report} rows={rows}/>}
      {report==='CASH_FLOW'&&<p className="muted sm">This view is direct cash-account movement evidence only. It is not a statement of cash flows and does not infer operating, investing, or financing activities.</p>}
      {!rows.length?<AuthoritativeScopeEmpty subject="POSTED ledger lines" requiresPosted/>:<><div className={`table-wrap reports-workbench-table ${report==='TRIAL_BALANCE'?'trial-balance-table':''}`} role="region" tabIndex={0} aria-label="Financial statement rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>{report==='TRIAL_BALANCE'?'Debit':'Period debit'}</th><th>{report==='TRIAL_BALANCE'?'Credit':'Period credit'}</th><th>Balance</th><th>Details</th></tr></thead><tbody>{statementPreviewRows.map((row,index)=>{const focusId=`authoritative-report-${row.statement_type}-${row.account_code}`;const beginsSection=index===0||statementPreviewRows[index-1].statement_section!==row.statement_section;return <React.Fragment key={`${row.statement_type}:${row.account_code}`}>{beginsSection&&<tr className="report-section-row"><th colSpan="5" scope="rowgroup">{row.statement_section}</th></tr>}<tr><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(statementDebit(report,row))}</td><td className="num">{money(statementCredit(report,row))}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId)}>View details</button></td></tr></React.Fragment>;})}</tbody></table></div>{rows.length>statementPreviewRows.length&&<p className="muted sm authoritative-report-preview-count">Showing {statementPreviewRows.length} of {rows.length} accounts. View the full report for every row.</p>}</>}
    </section>}</>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<>
    <section className="card" aria-label="Statement of cash flows evidence">
      <div className="card-head"><div><h2>Statement of cash flows</h2><p className="muted sm">Review mapped operating, investing, and financing cash activity.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={cashFlowState.phase==='LOADING'} onClick={loadCashFlow}>{cashFlowState.phase==='LOADING'?'Loading…':'Load cash flow'}</button></div>
      <details className="authoritative-secondary-disclosure authoritative-cash-flow-rules"><summary><span>Classification rules</span></summary><section><p className="muted sm">Every POSTED bank-cash counterpart requires one exact approved mapping. Labels, descriptions, and account-code prefixes are never used to infer classification; missing, ambiguous, invalid, or multi-cash mappings remain BLOCKED.</p></section></details>
      {cashFlowState.phase==='LOADING'&&<StateBlock tone="loading">Loading mapping-backed POSTED cash-flow evidence...</StateBlock>}
      <ReadError state={cashFlowState} onRetry={loadCashFlow}/>
      {cashFlowState.phase==='READY'&&!cashFlowState.rows.length&&<StateBlock tone="empty" title="No POSTED bank-cash evidence returned">This scoped empty result is not evidence of zero operating, investing, or financing cash flow.</StateBlock>}
      {cashFlowState.phase==='READY'&&!!cashFlowState.rows.length&&!cashFlowState.complete&&<StateBlock tone="error" title="BLOCKED_CASH_FLOW_CLASSIFICATION">At least one POSTED cash movement has no single valid mapping. REFS will not calculate operating, investing, or financing totals from this incomplete classification set.</StateBlock>}
      {cashFlowState.phase==='READY'&&cashFlowState.complete&&<div className="qbo-toolgrid" aria-label="Statement of cash flows totals"><span><i>Operating</i><b>{money(sumCashFlowRows(cashFlowState.rows,['OPERATING']))}</b></span><span><i>Investing</i><b>{money(sumCashFlowRows(cashFlowState.rows,['INVESTING']))}</b></span><span><i>Financing</i><b>{money(sumCashFlowRows(cashFlowState.rows,['FINANCING']))}</b></span><span><i>Net change in cash</i><b>{money(sumCashFlowRows(cashFlowState.rows))}</b></span></div>}
      {cashFlowState.phase==='READY'&&!!cashFlowState.rows.length&&<div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Statement of cash flows rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Classification</th><th>Cash / counterpart</th><th>Cash effect</th><th>Mapping</th><th>Details</th></tr></thead><tbody>{cashFlowState.rows.map(row=>{const focusId=`authoritative-cash-flow-${row.journal_entry_ids[0]}-${row.counterpart_account_code}`;return <tr key={`${row.journal_entry_ids[0]}:${row.cash_account_code}:${row.counterpart_account_code}`}><td><b>{row.classification}</b><div className="muted sm">{row.mapping_status}</div></td><td><b>{row.cash_account_code}</b><div className="muted sm">{row.counterpart_account_code}</div></td><td className="num">{money(row.cash_effect)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CASH_FLOW_CLASSIFICATION')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>
    </>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Prior-period comparison evidence">
      <div className="card-head"><div><h2>Prior-period comparison</h2><p className="muted sm">Compare posted account balances with an earlier period.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Earlier period ID<input value={priorPeriodId} maxLength="36" onChange={event=>{setPriorPeriodId(event.target.value.trim());setComparisonState({phase:'IDLE',rows:[],error:null,scope:null});}} placeholder="Enter period ID"/></label><button type="button" className="btn" disabled={comparisonState.phase==='LOADING'||!priorPeriodId||priorPeriodId===config.periodId} onClick={loadComparison}>{comparisonState.phase==='LOADING'?'Loading…':'Compare periods'}</button></div>
      <details className="authoritative-secondary-disclosure authoritative-comparison-rules"><summary><span>Comparison rules</span></summary><section><p className="muted sm">Periods cannot overlap or match. Missing balances remain missing and are never converted to zero.</p></section></details>
      {comparisonState.phase==='LOADING'&&<StateBlock tone="loading">Comparing periods…</StateBlock>}
      <ReadError state={comparisonState} onRetry={loadComparison}/>
      {comparisonState.phase==='READY'&&!comparisonState.rows.length&&<StateBlock tone="empty" title="No comparable balances found">No comparable posted balances were returned. This does not confirm no period-over-period change.</StateBlock>}
      {comparisonState.phase==='READY'&&!!comparisonState.rows.length&&<div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Prior-period comparison rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Statement / account</th><th>Current period</th><th>Prior period</th><th>Status</th><th>Details</th></tr></thead><tbody>{comparisonState.rows.map(row=>{const focusId=`authoritative-period-comparison-${row.statement_type}-${row.account_code}`;return <tr key={`${row.statement_type}:${row.account_code}`}><td><b>{row.account_code}</b><div className="muted sm">{row.statement_type} / {row.statement_section}</div></td><td className="num">{row.current_display_balance===null?'Evidence missing':money(row.current_display_balance)}</td><td className="num">{row.prior_display_balance===null?'Evidence missing':money(row.prior_display_balance)}</td><td><span className={row.comparison_status==='COMPARABLE_POSTED_EVIDENCE'?'badge badge-muted':'badge badge-danger'}>{row.comparison_status}</span></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'PERIOD_COMPARISON')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="CWIP rollforward evidence">
      <div className="card-head"><div><h2>CWIP rollforward</h2><p className="muted sm">Review mapped CWIP activity and balances.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={cwipState.phase==='LOADING'} onClick={loadCwip}>{cwipState.phase==='LOADING'?'Loading…':'Load CWIP'}</button></div>
      <details className="authoritative-secondary-disclosure authoritative-rollforward-rules"><summary><span>Report rules</span></summary><section><p className="muted sm">Only one approved CWIP mapping and posted ledger activity qualify. Debit and credit remain in ledger form; missing or blocked results do not confirm zero CWIP or a completed capitalization review.</p></section></details>
      {cwipState.phase==='LOADING'&&<StateBlock tone="loading">Loading CWIP activity…</StateBlock>}
      <ReadError state={cwipState} onRetry={loadCwip}/>
      {cwipState.phase==='READY'&&!cwipState.rows.length&&<StateBlock tone="empty" title="No CWIP activity found">No mapped, posted CWIP activity was returned for this period. This does not confirm a zero balance.</StateBlock>}
      {cwipState.phase==='READY'&&!!cwipState.rows.length&&!cwipState.complete&&<StateBlock tone="error" title="BLOCKED_CWIP_MAPPING">At least one CWIP account mapping is missing, ambiguous, or invalid. REFS will not assert a complete CWIP rollforward.</StateBlock>}
      {cwipState.phase==='READY'&&!!cwipState.rows.length&&<div className="table-wrap authoritative-property-table authoritative-cwip-table" role="region" tabIndex={0} aria-label="CWIP rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period debit</th><th>Period credit</th><th>Closing</th><th>Mapping</th><th>Details</th></tr></thead><tbody>{cwipState.rows.map(row=>{const focusId=`authoritative-cwip-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_debit===null?'Blocked':money(row.period_debit)}</td><td className="num">{row.period_credit===null?'Blocked':money(row.period_credit)}</td><td className="num">{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CWIP_ROLLFORWARD','CWIP rollforward')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="Construction loan rollforward evidence">
      <div className="card-head"><div><h2>Construction loan rollforward</h2><p className="muted sm">Review mapped draws, repayments, and balances.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={constructionLoanState.phase==='LOADING'} onClick={loadConstructionLoan}>{constructionLoanState.phase==='LOADING'?'Loading…':'Load loan activity'}</button></div>
      <details className="authoritative-secondary-disclosure authoritative-rollforward-rules"><summary><span>Report rules</span></summary><section><p className="muted sm">Only one approved construction-loan mapping and posted ledger activity qualify. Credits are draws and debits are repayments; missing or blocked results do not confirm zero debt or a completed lender reconciliation.</p></section></details>
      {constructionLoanState.phase==='LOADING'&&<StateBlock tone="loading">Loading loan activity…</StateBlock>}
      <ReadError state={constructionLoanState} onRetry={loadConstructionLoan}/>
      {constructionLoanState.phase==='READY'&&!constructionLoanState.rows.length&&<StateBlock tone="empty" title="No loan activity found">No mapped, posted construction-loan activity was returned for this period. This does not confirm a zero balance.</StateBlock>}
      {constructionLoanState.phase==='READY'&&!!constructionLoanState.rows.length&&!constructionLoanState.complete&&<StateBlock tone="error" title="BLOCKED_CONSTRUCTION_LOAN_MAPPING">At least one construction-loan account mapping is missing, ambiguous, or invalid. REFS will not assert a complete construction-loan rollforward.</StateBlock>}
      {constructionLoanState.phase==='READY'&&!!constructionLoanState.rows.length&&<div className="table-wrap authoritative-property-table" role="region" tabIndex={0} aria-label="Construction loan rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period draws</th><th>Period repayments</th><th>Closing</th><th>Mapping</th><th>Details</th></tr></thead><tbody>{constructionLoanState.rows.map(row=>{const focusId=`authoritative-construction-loan-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_draws===null?'Blocked':money(row.period_draws)}</td><td className="num">{row.period_repayments===null?'Blocked':money(row.period_repayments)}</td><td className="num">{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'ROLLFORWARD','Construction loan rollforward')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="Prepaid rollforward evidence">
      <div className="card-head"><div><h2>Prepaid rollforward</h2><p className="muted sm">Review mapped additions, amortization, and balances.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={prepaidState.phase==='LOADING'} onClick={loadPrepaid}>{prepaidState.phase==='LOADING'?'Loading…':'Load prepaid activity'}</button></div>
      <details className="authoritative-secondary-disclosure authoritative-rollforward-rules"><summary><span>Report rules</span></summary><section><p className="muted sm">Only one approved prepaid mapping and posted ledger activity qualify. Debits are additions and credits are amortization; missing or blocked results do not confirm zero prepaid assets or a completed insurance review.</p></section></details>
      {prepaidState.phase==='LOADING'&&<StateBlock tone="loading">Loading prepaid activity…</StateBlock>}
      <ReadError state={prepaidState} onRetry={loadPrepaid}/>
      {prepaidState.phase==='READY'&&!prepaidState.rows.length&&<StateBlock tone="empty" title="No prepaid activity found">No mapped, posted prepaid activity was returned for this period. This does not confirm a zero balance.</StateBlock>}
      {prepaidState.phase==='READY'&&!!prepaidState.rows.length&&!prepaidState.complete&&<StateBlock tone="error" title="BLOCKED_PREPAID_MAPPING">At least one prepaid account mapping is missing, ambiguous, or invalid. REFS will not assert a complete prepaid rollforward.</StateBlock>}
      {prepaidState.phase==='READY'&&!!prepaidState.rows.length&&<div className="table-wrap authoritative-property-table" role="region" tabIndex={0} aria-label="Prepaid rollforward rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Opening</th><th>Period additions</th><th>Period amortization</th><th>Closing</th><th>Mapping</th><th>Details</th></tr></thead><tbody>{prepaidState.rows.map(row=>{const focusId=`authoritative-prepaid-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.opening_balance===null?'Blocked':money(row.opening_balance)}</td><td className="num">{row.period_additions===null?'Blocked':money(row.period_additions)}</td><td className="num">{row.period_amortization===null?'Blocked':money(row.period_amortization)}</td><td>{row.closing_balance===null?'Blocked':money(row.closing_balance)}</td><td>{row.mapping_snapshot_id?<><code>{row.mapping_snapshot_id}</code><div className="muted sm">v{row.mapping_version}</div></>:'Not admitted'}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'ROLLFORWARD','Prepaid rollforward')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='CASH_AND_CAPITAL'&&<section className="card" aria-label="AI amortization schedule proposals">
      <div className="card-head"><div><h2>AI amortization schedule proposals</h2><p className="muted sm">Persisted, source-bound proposal evidence only. A proposal is not a monthly Journal Entry and has not been reviewed, approved, or posted.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={amortizationScheduleState.phase==='LOADING'} onClick={loadAmortizationSchedules}>{amortizationScheduleState.phase==='LOADING'?'Loading…':'Load proposed schedules'}</button></div>
      <p className="muted sm">REFS shows only explicit coverage dates, source hash, accounts, member trace, reason, and monthly proposed allocation returned by the authenticated accounting API. It never infers coverage from a label, creates a schedule, or dispatches accounting activity from this page.</p>
      {amortizationScheduleState.phase==='LOADING'&&<StateBlock tone="loading">Loading retained AI amortization proposal evidence...</StateBlock>}
      <ReadError state={amortizationScheduleState} onRetry={loadAmortizationSchedules}/>
      {amortizationScheduleState.phase==='READY'&&!amortizationScheduleState.rows.length&&<StateBlock tone="empty" title="No retained AI amortization proposals returned">The authoritative API returned no persisted proposals for this entity. This does not mean no prepaids exist or that coverage has been assessed.</StateBlock>}
      {amortizationScheduleState.phase==='READY'&&!!amortizationScheduleState.rows.length&&<div className="table-wrap authoritative-property-table" role="region" tabIndex={0} aria-label="AI amortization schedule proposal rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Source and coverage</th><th>Accounts</th><th>Original amount</th><th>Member trace</th><th>Reason and confidence</th><th>Monthly proposal</th></tr></thead><tbody>{amortizationScheduleState.rows.map(row=><tr key={row.ai_amortization_schedule_id}><td><code>{row.source_document_id}</code><div className="muted sm">{row.coverage_start} to {row.coverage_end}</div><div className="muted sm">v{row.source_document_version} · {row.source_payload_hash}</div></td><td><b>{row.prepaid_account_code}</b><div className="muted sm">to expense {row.expense_account_code}</div></td><td className="num">{money(row.original_amount)} {row.currency}</td><td>{row.member_trace.allocation_basis}<div className="muted sm">Project: {row.member_trace.project_ref||'None'} · Property: {row.member_trace.property_ref||'None'}</div></td><td>{row.proposal_reason}<div className="muted sm">Confidence {Math.round(row.confidence*100)}% · {row.rule_id}</div></td><td>{row.schedule_lines.map(line=><div key={line.line_no} className="muted sm">{line.amortization_month}: {money(line.amount)} {row.currency}</div>)}</td></tr>)}</tbody></table></div>}
    </section>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Intercompany reconciliation evidence">
      <div className="card-head"><div><h2>Intercompany reconciliation</h2><p className="muted sm">Two distinct entity scopes, exactly aligned periods, bidirectional approved mappings, and POSTED-ledger evidence are required.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Counterparty entity ID<input value={counterpartyEntityId} maxLength="36" onChange={event=>{setCounterpartyEntityId(event.target.value.trim());setIntercompanyState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="UUID of the counterparty entity"/></label><label>Counterparty period ID<input value={counterpartyPeriodId} maxLength="36" onChange={event=>{setCounterpartyPeriodId(event.target.value.trim());setIntercompanyState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="UUID with the same period dates"/></label><button type="button" className="btn" disabled={intercompanyState.phase==='LOADING'||!counterpartyEntityId||!counterpartyPeriodId||counterpartyEntityId===config.entityId} onClick={loadIntercompany}>{intercompanyState.phase==='LOADING'?'Loading…':'Load reconciliation evidence'}</button></div>
      <p className="muted sm">A shared account code, memo, vendor, or amount is never enough. The API separately verifies report authority for the counterparty entity and rejects unaligned period boundaries. No elimination or adjustment is created by this report.</p>
      {intercompanyState.phase==='LOADING'&&<StateBlock tone="loading">Loading bidirectional intercompany POSTED evidence...</StateBlock>}
      <ReadError state={intercompanyState} onRetry={loadIntercompany}/>
      {intercompanyState.phase==='READY'&&!intercompanyState.rows.length&&<StateBlock tone="empty" title="No admitted intercompany evidence returned">This scoped empty result is not evidence of no intercompany balance, no elimination requirement, or a completed consolidation review.</StateBlock>}
      {intercompanyState.phase==='READY'&&!!intercompanyState.rows.length&&!intercompanyState.complete&&<StateBlock tone="error" title="BLOCKED_INTERCOMPANY_EVIDENCE">At least one account pair lacks an exact bidirectional mapping or retained POSTED evidence. REFS will not assert an intercompany conclusion.</StateBlock>}
      {intercompanyState.phase==='READY'&&!!intercompanyState.rows.length&&<div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Intercompany reconciliation rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account pair</th><th className="ta-r">Current</th><th className="ta-r">Counterparty</th><th className="ta-r">Difference</th><th>Result</th><th>Details</th></tr></thead><tbody>{intercompanyState.rows.map(row=>{const focusId=`authoritative-intercompany-${row.account_code}-${row.counterparty_account_code}`;return <tr key={`${row.account_code}:${row.counterparty_account_code}`}><td><b>{row.account_code}</b><div className="muted sm">Counterparty: {row.counterparty_account_code}</div><div className="muted sm">{row.mapping_status}</div></td><td className="num">{row.current_closing_balance===null?'Blocked':money(row.current_closing_balance)}</td><td className="num">{row.counterparty_closing_balance===null?'Blocked':money(row.counterparty_closing_balance)}</td><td className="num">{row.difference_amount===null?'Blocked':money(row.difference_amount)}</td><td><span className={row.in_balance?'badge badge-ok':'badge badge-warn'}>{row.in_balance?'Tied':'Review required'}</span></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'INTERCOMPANY_RECONCILIATION')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='OPERATING_ANALYSIS'&&<section className="card" aria-label="Budget versus actual evidence">
      <div className="card-head"><div><h2>Budget versus actual</h2><p className="muted sm">Latest approved immutable budget snapshot versus same-entity, same-period, same-currency POSTED ledger evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><button type="button" className="btn" disabled={budgetState.phase==='LOADING'} onClick={loadBudget}>{budgetState.phase==='LOADING'?'Loading…':'Load budget evidence'}</button></div>
      <p className="muted sm">A comparison side is declared by the approved budget line; REFS never infers it from an account name, code, prior actual, WBS status, or a browser fixture. Missing snapshot, account, currency, or POSTED evidence remains BLOCKED and is never converted to zero.</p>
      {budgetState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable budget and POSTED actual evidence...</StateBlock>}
      <ReadError state={budgetState} onRetry={loadBudget}/>
      {budgetState.phase==='READY'&&!budgetState.rows.length&&<StateBlock tone="empty" title="No approved budget snapshot returned">No approved immutable budget snapshot was returned for this entity and period. This scoped empty result is not zero budget or zero actual.</StateBlock>}
      {budgetState.phase==='READY'&&!!budgetState.rows.length&&!budgetState.complete&&<StateBlock tone="error" title="BLOCKED_BUDGET_ACTUAL_EVIDENCE">At least one budget line lacks an active account, same-currency POSTED actual, or complete immutable budget evidence. REFS will not calculate a budget conclusion for that line.</StateBlock>}
      {budgetState.phase==='READY'&&!!budgetState.rows.length&&<div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Budget versus actual rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Account</th><th>Side</th><th className="ta-r">Budget</th><th className="ta-r">Actual</th><th className="ta-r">Variance</th><th>Snapshot</th><th>Details</th></tr></thead><tbody>{budgetState.rows.map(row=>{const focusId=`authoritative-budget-${row.account_code}`;return <tr key={row.account_code}><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div><div className="muted sm">{row.report_status}</div></td><td>{row.comparison_side}</td><td className="num">{row.budget_amount===null?'Blocked':money(row.budget_amount)}</td><td className="num">{row.actual_amount===null?'Blocked':money(row.actual_amount)}</td><td className="num">{row.variance_amount===null?'Blocked':money(row.variance_amount)}</td><td><code>{row.budget_snapshot_id}</code><div className="muted sm">v{row.budget_version}</div></td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'BUDGET_VS_ACTUAL')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='GROUP_AND_COMPARISON'&&<section className="card" aria-label="Consolidation evidence">
      <div className="card-head"><div><h2>Consolidation and elimination evidence</h2><p className="muted sm">An approved immutable consolidation snapshot must explicitly name every member, account presentation mapping, and elimination evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Consolidation group<input value={consolidationGroupRef} maxLength="160" onChange={event=>{setConsolidationGroupRef(event.target.value);setConsolidationState({phase:'IDLE',rows:[],error:null,scope:null,complete:false});}} placeholder="Canonical approved group reference"/></label><button type="button" className="btn" disabled={consolidationState.phase==='LOADING'||!consolidationGroupRef.trim()} onClick={loadConsolidation}>{consolidationState.phase==='LOADING'?'Loading…':'Load consolidation evidence'}</button></div>
      <p className="muted sm">REFS never assumes that matching account codes, amounts, or entity names form a consolidation. Missing member scope, aligned period/currency, posted ledger, mapping, or elimination evidence is BLOCKED. This view cannot create an elimination journal.</p>
      {consolidationState.phase==='LOADING'&&<StateBlock tone="loading">Loading immutable consolidation and POSTED ledger evidence...</StateBlock>}
      <ReadError state={consolidationState} onRetry={loadConsolidation}/>
      {consolidationState.phase==='READY'&&!consolidationState.rows.length&&<StateBlock tone="empty" title="No approved consolidation snapshot returned">No approved immutable consolidation snapshot was returned for this reporting entity, period, and group. This scoped empty result is not evidence of zero eliminations or a completed consolidation.</StateBlock>}
      {consolidationState.phase==='READY'&&!!consolidationState.rows.length&&!consolidationState.complete&&<StateBlock tone="error" title="BLOCKED_CONSOLIDATION_EVIDENCE">At least one presented account lacks member scope, aligned period/currency, POSTED ledger, or approved elimination evidence. REFS will not calculate a consolidation conclusion.</StateBlock>}
      {consolidationState.phase==='READY'&&!!consolidationState.rows.length&&<div className="table-wrap authoritative-report-workbench-table" role="region" tabIndex={0} aria-label="Consolidation rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Presentation account</th><th>Members</th><th className="ta-r">Member actual</th><th className="ta-r">Elimination</th><th className="ta-r">Consolidated</th><th>Details</th></tr></thead><tbody>{consolidationState.rows.map(row=>{const focusId=`authoritative-consolidation-${row.presentation_account_code}-${row.presentation_side}`;return <tr key={`${row.presentation_account_code}:${row.presentation_side}`}><td><b>{row.presentation_account_code}</b><div className="muted sm">{row.presentation_side}</div><div className="muted sm">{row.report_status}</div></td><td>{row.evidence_member_count}/{row.member_count}</td><td className="num">{row.member_actual_amount===null?'Blocked':money(row.member_actual_amount)}</td><td className="num">{row.elimination_amount===null?'Blocked':money(row.elimination_amount)}</td><td className="num">{row.consolidated_amount===null?'Blocked':money(row.consolidated_amount)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'CONSOLIDATION')}>View details</button></td></tr>;})}</tbody></table></div>}
    </section>}
    {workbenchTab==='OPERATING_ANALYSIS'&&<section className="card" aria-label="Dimension profitability evidence">
      <div className="card-head"><div><h2>Dimension profitability</h2><p className="muted sm">Property, Project, Unit, and Lot P&amp;L use only exact dimensions retained on POSTED ledger lines.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-filter-grid"><label>Dimension type<select value={dimensionType} onChange={event=>{setDimensionType(event.target.value);setDimensionState({phase:'IDLE',rows:[],error:null,scope:null});}}>{DIMENSION_TYPES.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label>Exact reference<input value={dimensionRef} maxLength="160" onChange={event=>setDimensionRef(event.target.value)} placeholder={`e.g. ${dimensionType}-01`}/></label><button type="button" className="btn" disabled={dimensionState.phase==='LOADING'||!dimensionRef.trim()} onClick={loadDimension}>{dimensionState.phase==='LOADING'?'Loading…':'Load profitability evidence'}</button></div>
      <p className="muted sm">A blank result is not zero profitability: it means no retained POSTED ledger line carries this exact dimension for the selected period. The report never infers a dimension from a memo, bank account, or source header.</p>
      {dimensionState.phase==='LOADING'&&<StateBlock tone="loading">Loading exact-dimension POSTED ledger evidence...</StateBlock>}
      <ReadError state={dimensionState} onRetry={loadDimension}/>
      {dimensionState.phase==='READY'&&!dimensionState.rows.length&&<StateBlock tone="empty" title="No exact-dimension POSTED ledger evidence returned">This scoped empty result is not evidence of zero property, project, unit, or lot profitability.</StateBlock>}
      {dimensionState.phase==='READY'&&!!dimensionState.rows.length&&<><DimensionProfitabilitySummary rows={dimensionState.rows} dimensionType={dimensionType} dimensionRef={dimensionRef}/><div className="table-wrap authoritative-profitability-table" role="region" tabIndex={0} aria-label="Dimension profitability rows; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Section</th><th>Account</th><th>Period debit</th><th>Period credit</th><th>Balance</th><th>Details</th></tr></thead><tbody>{dimensionState.rows.map(row=>{const focusId=`authoritative-dimension-${row.dimension_type}-${row.dimension_ref}-${row.account_code}`;return <tr key={`${row.dimension_type}:${row.dimension_ref}:${row.statement_section}:${row.account_code}`}><td>{row.statement_section}</td><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(row.period_debit)}</td><td className="num">{money(row.period_credit)}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId,'DIMENSION_PROFITABILITY',null,{dimension:{type:dimensionType,ref:dimensionRef}})}>View details</button></td></tr>;})}</tbody></table></div></>}
    </section>}
    </section>}
  </AuthoritativeReportsView>;
}
