import { useEffect, useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Drawer, Field, SectionTitle, Tabs, ApprovalTimeline } from './ui.jsx';
import { VENDORS, PROPERTIES, PROJECTS, COA } from './data.js';
import { acct, money, sum } from './engine.js';
import { DEFAULT_EXPENSE_COLUMNS, filterExpenseEvidence, normalizeExpenseColumnVisibility } from './expense-listing.js';
import { localExpenseTransactionRows } from './expense-transaction-listing.js';
import { filterLocalPaymentHistory, isLocalPaymentHistoryEmpty } from './payment-history-listing.js';
import { findBillForApDrill } from './ap-drill.js';
import { filterLocalBillQueue, LOCAL_BILL_QUEUE_VIEWS } from './bill-queue-view.js';
import { filterLocalVendors, localVendorEvidence, localVendorWorkflowTarget } from './vendor-listing.js';
import { AP_AGING_BUCKETS, DEFAULT_AP_AGING_AS_OF, localApAgingRows } from './ap-aging.js';
import { localPaymentEvidenceDrill } from './payment-evidence-drill.js';
import { localBillEvidenceTrace } from './bill-evidence-trace.js';
import { localBillPaymentEvidence } from './bill-payment-evidence.js';
import { localBillVoidEvidence } from './bill-void-evidence.js';
import { localVendorCreditEvidence } from './vendor-credit-evidence.js';
import { LOCAL_AGING_BUCKETS, localApAgingEvidenceRows, localAgingControl, localAgingGlReconciliation, localAgingControlDifferenceEvidence } from './aging-local-evidence.js';
import { localExpenseReviewExceptions } from './expense-review-exceptions.js';
import { localExpenseDetailReturnScope } from './expense-detail-return.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localExpenseFeatureState } from './expense-business-scope.js';
import { localPaymentReportDrillContext } from './payment-return-context.js';
import { localApAgingReturnContext, localApAgingReturnScopeLabel } from './ap-aging-return-context.js';
import { localVendorCreditLinkedBillReturn, localVendorCreditJournalReturnContext } from './vendor-credit-return.js';
import { localReconciliationJournalReturnScopeLabel } from './reconciliation-journal-return.js';

// AP closed loop: Bill(lines) -> duplicate check -> approval -> JE(Dr Exp/CIP, Cr AP) -> Payment run -> JE(Dr AP, Cr Cash) -> aging
export function APWorkspace({ctx}) {
  const {ap, actions, toast, can, user, navContext, jes, bank} = ctx;             // ap: {bills:[...]}
  const [tab, setTab] = useState('Bills');
  const [showNew, setShowNew] = useState(false);
  const [newBillVendorId, setNewBillVendorId] = useState('');
  const [sel, setSel] = useState(null);
  const [selectedBillPaymentId, setSelectedBillPaymentId] = useState(null);
  const [selectedCreditKey, setSelectedCreditKey] = useState(null);
  const [billReturnCreditKey, setBillReturnCreditKey] = useState(null);
  const [selectedExceptionId, setSelectedExceptionId] = useState(null);
  const [vendorEvidenceReturnId, setVendorEvidenceReturnId] = useState(null);
  const [detailReturnScope, setDetailReturnScope] = useState(null);
  const [agingDetailScope, setAgingDetailScope] = useState(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [transactionType, setTransactionType] = useState('ALL');
  const [dateRange, setDateRange] = useState('LAST_12_MONTHS');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [vendorId, setVendorId] = useState('ALL');
  const [categoryCode, setCategoryCode] = useState('ALL');
  const [billQueueView, setBillQueueView] = useState('All');
  const [columnVisibility, setColumnVisibility] = useState(()=>{
    try { return normalizeExpenseColumnVisibility(JSON.parse(localStorage.getItem('refs_expense_columns') || '{}')); }
    catch { return {...DEFAULT_EXPENSE_COLUMNS}; }
  });
  const [shellPanel, setShellPanel] = useState(null);
  const [showPayrollPromo, setShowPayrollPromo] = useState(true);
  const [showExpertAssisted, setShowExpertAssisted] = useState(true);
  const [showPrintCheckSetup, setShowPrintCheckSetup] = useState(false);
  const bankTransactions = Object.entries(bank?.accounts || {}).flatMap(([bank_account_code, account]) => (account.txns || []).map(transaction => ({...transaction, bank_account_code})));
  const bills = ap.bills.map(bill => ({...bill,paymentEvidence:localBillPaymentEvidence(bill,jes || [],bankTransactions),voidEvidence:localBillVoidEvidence(bill,jes || [],bankTransactions)}));
  const vendorCredits = localVendorCreditEvidence({bills,journals:jes || [],bankTransactions});
  const expenseReviewExceptions = localExpenseReviewExceptions({bills,vendorCredits,vendors:VENDORS,coa:COA});
  const selectedCredit = vendorCredits.find(credit => credit.journal.je_number === selectedCreditKey) || null;
  const selectedException = expenseReviewExceptions.find(exception => exception.exception_id === selectedExceptionId) || null;
  const localTabFor = value => ({Payments:'Payments','AP Aging':'AP Aging',Vendors:'Vendors'})[value] || value;
  const queueBills = filterLocalBillQueue(bills, billQueueView);
  const visibleBills = filterExpenseEvidence(queueBills, {transactionType, dateRange, status:statusFilter, query, fromDate, toDate, vendorId, categoryCode});
  const expenseTransactionRows = localExpenseTransactionRows({bills:visibleBills,vendorCredits});
  useEffect(() => {
    if (navContext?.route !== 'ap') return;
    if (['Bills','Payments','Vendors','AP Aging'].includes(navContext.tab)) setTab(localTabFor(navContext.tab));
  }, [navContext?.route, navContext?.tab]);
  useEffect(()=>{ try { localStorage.setItem('refs_expense_columns', JSON.stringify(columnVisibility)); } catch {} }, [columnVisibility]);
  const toggleColumn = key => setColumnVisibility(current=>({...current, [key]:!current[key]}));
  const billColumns = [
    {key:'DATE',h:'Date',k:'bill_date'},
    {key:'TYPE',h:'Type',render:r=>r.status==='PAID'&&r.pay_je_number?'Bill payment':'Bill'},
    {key:'NUMBER',h:'No.',k:'bill_no'},
    {key:'PAYEE',h:'Payee',render:r=>r.vendor_name, csv:r=>r.vendor_name},
    {key:'CATEGORY',h:'Category',render:r=>r.account_code},
    {key:'DUE_DATE',h:'Due date',k:'due_date'},
    {key:'TOTAL',h:'Total',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
    {key:'BILL_APPROVAL',h:'Bill Approval',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status},
    {key:'LOCAL_PROOF',h:'Local proof',render:r=><Badge tone={r.paymentEvidence.billState==='VALID_POSTED_AP'?'ok':r.paymentEvidence.billState==='NOT_POSTED_TO_AP'?'muted':'warn'}>{r.paymentEvidence.billState}</Badge>,csv:r=>r.paymentEvidence.billState},
  ].filter(column=>columnVisibility[column.key]);
  const open = bills.filter(b=>!['PAID','VOID'].includes(b.status));
  const bill = bills.find(b=>b.bill_id===sel);
  const captureDetailScope = () => setDetailReturnScope(current => current || localExpenseDetailReturnScope({tab,query,statusFilter,transactionType,dateRange,fromDate,toDate,vendorId,categoryCode,billQueueView}));
  const restoreDetailScope = () => {
    if (!detailReturnScope) return;
    setTab(detailReturnScope.tab); setQuery(detailReturnScope.query); setStatusFilter(detailReturnScope.statusFilter); setTransactionType(detailReturnScope.transactionType); setDateRange(detailReturnScope.dateRange); setFromDate(detailReturnScope.fromDate); setToDate(detailReturnScope.toDate); setVendorId(detailReturnScope.vendorId); setCategoryCode(detailReturnScope.categoryCode); setBillQueueView(detailReturnScope.billQueueView); setDetailReturnScope(null);
  };
  const openBillDetail = (billId, agingScope = null) => {
    captureDetailScope();
    if (agingScope) setAgingDetailScope(localApAgingReturnContext(agingScope));
    setSel(billId);
  };
  const openVendorBillDetail = (billId, vendorEvidenceId) => {
    captureDetailScope();
    setVendorEvidenceReturnId(String(vendorEvidenceId));
    setTab('Bills');
    setVendorId(String(vendorEvidenceId));
    setQuery('');
    setStatusFilter('ALL');
    setTransactionType('ALL');
    setDateRange('ALL');
    setFromDate('');
    setToDate('');
    setCategoryCode('ALL');
    setBillQueueView('All');
    setSel(billId);
  };
  const openCreditDetail = creditKey => { captureDetailScope(); setSelectedCreditKey(creditKey); };
  const openAgingCreditDetail = (creditKey, scope) => { setAgingDetailScope(localApAgingReturnContext(scope)); openCreditDetail(creditKey); };
  const openExceptionDetail = exceptionId => { captureDetailScope(); setSelectedExceptionId(exceptionId); };
  const closeDetail = () => { setSel(null); setSelectedCreditKey(null); setSelectedExceptionId(null); restoreDetailScope(); };
  useEffect(() => {
    if (navContext?.route !== 'ap') return;
    if (navContext.tab) setTab(localTabFor(navContext.tab));
    if (navContext.vendorId != null) {
      setVendorId(String(navContext.vendorId));
      setQuery('');
      setStatusFilter('ALL');
      setTransactionType('ALL');
      setDateRange('ALL');
      setFromDate('');
      setToDate('');
      setCategoryCode('ALL');
      setBillQueueView('All');
    }
    if (navContext.creditKey) {
      setSelectedCreditKey(String(navContext.creditKey));
      setSel(null);
      setBillReturnCreditKey(null);
      setTab('Bills');
    }
    const matchedBill = findBillForApDrill(bills, navContext);
    if (matchedBill && navContext.paymentBillDetail) {
      captureDetailScope();
      setSel(matchedBill.bill_id);
      setSelectedBillPaymentId(matchedBill.bill_id);
      setTab('Bills');
    }
    if (matchedBill && navContext.tab !== 'Payments') {
      openBillDetail(matchedBill.bill_id);
      setTab(navContext.tab || 'Bills');
    }
  }, [navContext?.route, navContext?.tab, navContext?.vendorId, navContext?.creditKey, navContext?.billId, navContext?.billNo, navContext?.jeNumber, navContext?.paymentBillDetail, bills]);

  const closeBillDetail = () => {
    setSel(null);
    setSelectedBillPaymentId(null);
    if (billReturnCreditKey) { setSelectedCreditKey(billReturnCreditKey); setBillReturnCreditKey(null); return; }
    if (vendorEvidenceReturnId) {
      const vendorEvidenceId = vendorEvidenceReturnId;
      setVendorEvidenceReturnId(null);
      setDetailReturnScope(null);
      ctx.goto('ap',{route:'ap',tab:'Vendors',vendorEvidenceId});
      return;
    }
    closeDetail();
  };
  useEffect(() => {
    if (tab !== 'AP Aging') setAgingDetailScope(null);
  }, [tab]);
  const selectedBillPayment = bills.find(candidate => candidate.bill_id === selectedBillPaymentId) || null;
  if (selectedBillPayment) return <PaymentEvidenceDetail bill={selectedBillPayment} paymentReturn={{route:'ap',tab:'Bills',billId:selectedBillPayment.bill_id,billDetail:true}} onClose={()=>setSelectedBillPaymentId(null)} backLabel="Back to Bill" ctx={ctx} />;
  if (bill) return <BillDetail bill={bill} onClose={closeBillDetail} onOpenPayment={()=>setSelectedBillPaymentId(bill.bill_id)} agingReturn={agingDetailScope} vendorReturnId={vendorEvidenceReturnId} ctx={ctx} />;
  if (selectedCredit) return <VendorCreditDetail credit={selectedCredit} agingReturn={agingDetailScope} onClose={closeDetail} onOpenBill={billId=>{setBillReturnCreditKey(localVendorCreditLinkedBillReturn(selectedCreditKey));setSelectedCreditKey(null);openBillDetail(billId);}} ctx={ctx} />;
  if (selectedException) return <ExpenseReviewExceptionDetail exception={selectedException} onClose={closeDetail} onOpenSource={()=>{
    setSelectedExceptionId(null);
    if (selectedException.source_kind === 'BILL') openBillDetail(selectedException.source_id);
    else openCreditDetail(selectedException.source_id);
  }} ctx={ctx} />;

  const kpis = <div className="kpi-row">
    <KPI label="Open bills" value={open.length} sub={money(sum(open,b=>b.amount))} tone={open.length?'warn':'ok'} />
    <KPI label="Pending approval" value={bills.filter(b=>b.status==='PENDING_APPROVAL').length} />
    <KPI label="Paid this period" value={bills.filter(b=>b.status==='PAID').length} sub={money(sum(bills.filter(b=>b.status==='PAID'),b=>b.amount))} tone="ok" />
    <KPI label="Duplicate blocks" value={ap.dupBlocked||0} tone={ap.dupBlocked?'bad':'ok'} />
  </div>;

  const clearBillFilters = () => { setQuery(''); setStatusFilter('ALL'); setTransactionType('ALL'); setDateRange('LAST_12_MONTHS'); setFromDate(''); setToDate(''); setVendorId('ALL'); setCategoryCode('ALL'); setBillQueueView('All'); };
  // QBO read-only evidence: Status, Delivery method, Date, From/To, Payee and Category.
  // Only Status and Date below are locally connected; other fields remain evidence-only.
  return <div>
    {navContext?.reportCenterReturn?.route==='reports' && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('reports')}>Back to reports</button><span>{navContext.reportCenterReturn.reportName || 'A/P Aging'}</span></div>}
    {navContext?.reportReturn?.route==='gl' && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    {navContext?.reconciliationReturn?.route==='bankrec' && <div className="qbo-report-back"><button type="button" onClick={()=>ctx.goto('bankrec',navContext.reconciliationReturn)}>Back to reconciliation</button><span>{localReconciliationJournalReturnScopeLabel(navContext.reconciliationReturn)}</span></div>}
    <div className="accounting-page-head"><div><div className="page-eyebrow">EXPENSES · PAY BILLS</div><h2 className="page-h">Expenses</h2><div className="page-subtitle">Local Bills & Expenses evidence: supplier bills, payment evidence and vendor credits in one transaction queue.</div></div></div>
    <nav aria-label="Observed QuickBooks Expenses navigation" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
      {['Expense transactions','Vendors','Bills','Bill payments','Contractors','1099s'].map(label=><span key={label} className="badge muted">{label}</span>)}
    </nav>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QBO Expenses navigation shell. REFS coverage is currently limited to its local Bills, Payments, Aging, and Vendors workspaces below.</p>
    {kpis}
    {showPayrollPromo && <section aria-label="Payroll promotion" style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',padding:'14px 16px',margin:'0 0 14px',border:'1px solid #d8e5f3',borderRadius:8,background:'#f4f9fd'}}>
      <div><b>Ready to get same-day direct deposit?</b><p className="muted sm" style={{margin:'4px 0 0'}}>Hold onto your cash longer with same-day direct deposit. You can run payroll and pay your team the same day.</p><span className="muted sm">Observed QBO promotional shell; payroll route remains unavailable in REFS.</span></div>
      <div style={{display:'flex',gap:8,alignItems:'center',whiteSpace:'nowrap'}}><Btn size="sm" disabled>Explore payroll</Btn><Btn size="sm" variant="ghost" onClick={()=>setShowPayrollPromo(false)}>Close</Btn></div>
    </section>}
    {showExpertAssisted && <section aria-label="Intuit Expert Assisted offer" style={{display:'flex',justifyContent:'space-between',gap:16,alignItems:'center',padding:'14px 16px',margin:'0 0 14px',border:'1px solid #d8e5f3',borderRadius:8,background:'#f4f9fd'}}>
      <div><b>Need extra help categorizing transactions?</b><p className="muted sm" style={{margin:'4px 0 0'}}>Start your 30-day free trial of Intuit Expert Assisted now. Cancel anytime. Terms apply.</p><span className="muted sm">Observed QBO offer shell; enrollment, eligibility, and destination behavior remain unavailable in REFS.</span></div>
      <div style={{display:'flex',gap:8,alignItems:'center',whiteSpace:'nowrap'}}><Btn size="sm" disabled>Learn more</Btn><Btn size="sm" variant="ghost" onClick={()=>setShowExpertAssisted(false)}>Close</Btn></div>
    </section>}
    <Tabs tabs={['Bills','Payments','AP Aging','Vendors']} active={tab} onChange={setTab} />
    {tab==='Bills' && <>
      <div role="tablist" aria-label="Observed QuickBooks Bills queues" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
        {['All', ...LOCAL_BILL_QUEUE_VIEWS].map(view=><button key={view} type="button" role="tab" aria-selected={billQueueView===view} className={billQueueView===view?'btn btn-sm':'btn btn-ghost btn-sm'} onClick={()=>{setBillQueueView(view);setStatusFilter('ALL');}}>{view}</button>)}
        <button type="button" className="btn btn-ghost btn-sm" disabled title="Recurring bills are not established by local evidence">Recurring</button>
      </div>
      <p className="muted sm" style={{margin:'-4px 0 10px'}}>Local queue mapping only: For review = pending approval; Unpaid = draft or approved; Paid = paid. Recurring remains unavailable.</p>
      <div className="expense-toolbar" style={{marginBottom:12}}><label className="expense-search"><span>⌕</span><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search bills, vendors or invoice #" /></label><label><span>Transaction type</span><select aria-label="Transaction Type" value={transactionType} onChange={e=>setTransactionType(e.target.value)}><option value="ALL">All transactions</option><option value="BILLS">Bills — local evidence</option><option value="BILL_PAYMENTS">Bill payments — local evidence</option>{['Expense','Check','Purchase order','Recently paid','Vendor credit','Item Receipt','Expense (Receipt reminder)'].map(label=><option key={label} value={label} disabled>{label}</option>)}</select></label><label><span>Dates</span><select value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="LAST_12_MONTHS">Last 12 months</option><option value="THIS_MONTH">This month</option><option value="ALL">All dates</option></select></label><label><span>Status</span><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{['DRAFT','PENDING_APPROVAL','APPROVED','PAID','VOID'].map(s=><option key={s}>{s}</option>)}</select></label><span className="result-count"><b>{expenseTransactionRows.length}</b> local evidence rows</span><Btn variant="ghost" disabled title={localExpenseFeatureState('Purchase notifications').reason}>Purchase notifications</Btn><Btn variant="ghost" onClick={()=>setShowPrintCheckSetup(true)}>Print Checks</Btn><Btn variant="primary" onClick={()=>{setNewBillVendorId('');setShowNew(true);}} disabled={!can('AP.INVOICE.CREATE')}>+ New transaction</Btn><Btn variant="ghost" onClick={()=>setShellPanel(shellPanel==='Filter'?null:'Filter')}>Filter</Btn><Btn variant="ghost" disabled title="Printing is not adopted for the local evidence view">Print</Btn><Btn variant="ghost" disabled title="Exporting business data is not adopted for the local evidence view">Export to Excel</Btn><Btn variant="ghost" onClick={()=>setShellPanel(shellPanel==='Settings'?null:'Settings')}>Settings</Btn><Btn variant="ghost" onClick={clearBillFilters}>Clear</Btn></div>
      {showPrintCheckSetup && <section className="expense-shell-panel" role="dialog" aria-modal="false" aria-label="Print checks setup"><div><b>Print checks setup</b><span>Observed QBO setup flow. This local shell does not alter printer, check, or payment settings.</span></div><div className="expense-filter-evidence"><div><b>1. Print Sample</b><p>Select a check type and print a sample.</p><label><input type="radio" checked disabled readOnly/> Voucher</label><label><input type="radio" disabled readOnly/> Standard</label><p className="muted sm">Load blank paper in your printer. The setup preview shows sample data, not real check data.</p></div><div><b>2. Set up PDF Reader</b><p className="muted sm">Observed as the second setup step.</p></div><div><b>3. Adjust Alignment</b><p className="muted sm">Align numbers to the amount box and verify printed fields.</p></div></div><div className="expense-shell-actions"><button type="button" disabled>View preview and print sample</button><button type="button" disabled>No, continue setup</button><button type="button" disabled>Yes, I’m finished with setup</button><button type="button" onClick={()=>setShowPrintCheckSetup(false)}>Cancel</button><button type="button" onClick={()=>setShowPrintCheckSetup(false)}>Close</button></div></section>}
      {shellPanel && <div className="expense-shell-panel" role="region" aria-label={`${shellPanel} options`}><div><b>{shellPanel}</b><span>{shellPanel==='Filter'?'Observed QBO filter fields are represented below. Local evidence supports Status, Date, From/To, Payee, and Category only.':'Observed QBO columns are represented below. Local evidence-backed columns are configurable and persist in this browser.'}</span></div>{shellPanel==='Filter'&&<><div className="expense-filter-evidence"><label>Status <select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}><option value="ALL">All statuses</option>{['DRAFT','PENDING_APPROVAL','APPROVED','PAID','VOID'].map(s=><option key={s}>{s}</option>)}</select></label><label>Delivery method <select disabled><option>Any — unverified</option></select></label><label>Date <select value={dateRange} onChange={e=>setDateRange(e.target.value)}><option value="LAST_12_MONTHS">Last 12 months</option><option value="THIS_MONTH">This month</option><option value="ALL">All dates</option></select></label><label>From <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)} placeholder="mm/dd/yyyy" /></label><label>To <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)} placeholder="mm/dd/yyyy" /></label><label>Payee <select value={vendorId} onChange={e=>setVendorId(e.target.value)}><option value="ALL">All payees</option>{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}</option>)}</select></label><label>Category <select value={categoryCode} onChange={e=>setCategoryCode(e.target.value)}><option value="ALL">All categories</option>{COA.filter(a=>['EXPENSE','ASSET'].includes(a.account_type)).map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}</select></label></div><div className="expense-shell-actions"><button type="button" onClick={()=>setShellPanel(null)}>Apply</button><button type="button" onClick={clearBillFilters}>Reset</button><button type="button" onClick={()=>setShellPanel(null)}>Close</button></div></>}{shellPanel==='Settings'&&<><div className="expense-filter-evidence">{[['Date','DATE'],['Type','TYPE'],['No.','NUMBER'],['Payee','PAYEE'],['Class',null],['Location',null],['Status',null],['Method',null],['Source',null],['Category','CATEGORY'],['Memo',null],['Due date','DUE_DATE'],['Balance',null],['Total','TOTAL'],['Attachments',null],['Bill Approval','BILL_APPROVAL']].map(([label,key])=><label key={label}><input type="checkbox" checked={key?columnVisibility[key]:false} disabled={!key} onChange={key?()=>toggleColumn(key):undefined}/> {label}{!key&&<small className="muted"> — unavailable</small>}</label>)}<label>Rows <select disabled value="50" onChange={()=>{}}><option>50</option></select></label></div><div className="expense-shell-actions"><button type="button" onClick={()=>setColumnVisibility({...DEFAULT_EXPENSE_COLUMNS})}>Restore local defaults</button><button type="button" onClick={()=>setShellPanel(null)}>Close</button></div></>}</div>}
      <Table rowKey="key" features={{exportable:false}} onRow={row=>row.kind==='BILL' ? openBillDetail(row.record.bill_id) : openCreditDetail(row.record.journal.je_number)} cols={[
        {h:'Date',k:'date'}, {h:'Type',k:'type'}, {h:'No.',k:'number'}, {h:'Payee',k:'payee'}, {h:'Category',k:'category'},
        {h:'Property / Project',render:row=>`${row.property_id || '—'} / ${row.project_id || '—'}`}, {h:'Total',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},
        {h:'Balance',num:true,render:row=><Money v={row.balance}/>,sortVal:row=>row.balance}, {h:'State',render:row=><Badge tone={String(row.state).includes('REVIEW') || row.state==='PENDING_APPROVAL'?'warn':'ok'}>{row.state}</Badge>},
        {h:'Local proof',render:row=><Badge tone={String(row.source_state).includes('VALID') || String(row.source_state).includes('POSTED')?'ok':'warn'}>{row.source_state}</Badge>},
      ]} rows={expenseTransactionRows} empty="No expenses found. Try to change some filters to see more results." />
      <p className="muted sm" style={{marginTop:10}}>The unified list is local evidence only. Click a Bill for its retained trace, or a Vendor credit for its retained JE. Capitalized/CWIP, prepaid, tax/insurance/HOA, related-party, escrow and loan-related spend remain separately classified and review-bound.</p>
      <section className="report-workbench" aria-label="Vendor credit application evidence" style={{marginTop:12}}>
        <div className="report-workbench-head"><div><b>Vendor credit application evidence</b><div className="page-subtitle">A retained AP credit needs an explicit posted application before it can reduce a linked local bill.</div></div><Badge tone={vendorCredits.some(row=>row.canReduceAging)?'ok':'warn'}>{vendorCredits.length?'LOCAL_CREDIT_REVIEW':'NO_RETAINED_VENDOR_CREDITS'}</Badge></div>
        <Table rowKey="journal.je_number" cols={[
          {h:'Credit JE',render:r=><Btn size="sm" variant="ghost" onClick={()=>openCreditDetail(r.journal.je_number)}>{r.journal.je_number}</Btn>},
          {h:'Linked bill',render:r=>r.bill?<Btn size="sm" variant="ghost" onClick={()=>{setBillReturnCreditKey(localVendorCreditLinkedBillReturn(r.journal.je_number));openBillDetail(r.bill.bill_id);}}>{r.bill.bill_no}</Btn>:(r.billRef||'—')},
          {h:'Entity',render:r=>r.entityId||'—'},{h:'Property / project',render:r=><span className="muted sm">{[...r.creditDimensions.propertyIds,...r.creditDimensions.projectIds].join(' · ')||'Unassigned'}</span>},{h:'Paid before credit',num:true,render:r=><Money v={r.paymentEvidence.paidAmount}/>,sortVal:r=>r.paymentEvidence.paidAmount},{h:'Credit',num:true,render:r=><Money v={r.creditAmount}/>,sortVal:r=>r.creditAmount},
          {h:'Applied',num:true,render:r=><Money v={r.applicationAmount}/>,sortVal:r=>r.applicationAmount},{h:'State',render:r=><Badge tone={r.canReduceAging?'ok':r.state==='POSTED_UNAPPLIED_CREDIT'?'warn':'bad'}>{r.state}</Badge>},{h:'Audit',render:r=><Badge tone={r.auditState==='POSTED_AUDIT_RETAINED'?'ok':'warn'}>{r.auditState}</Badge>},
        ]} rows={vendorCredits} empty="No retained local AP_CREDIT journal evidence. Creating vendor credits, refunds, or external payments is unavailable." />
        <p className="muted sm" style={{margin:'10px 0 0'}}>Unapplied and review credits do not change AP Aging. Property/project mismatch, capitalized or prepaid sources without retained origin evidence, and related-party credits without reason plus approval history are held for review. This table cannot create, apply, refund, void, or pay a credit.</p>
      </section>
      <section className="report-workbench" aria-label="Local expense review exceptions" style={{marginTop:12}}>
        <div className="report-workbench-head"><div><b>Expense review exceptions</b><div className="page-subtitle">Retained local evidence requiring controller review; no resolution, categorization, posting or adjustment occurs here.</div></div><Badge tone={expenseReviewExceptions.length?'warn':'ok'}>{expenseReviewExceptions.length ? 'LOCAL REVIEW REQUIRED' : 'NO LOCAL EXCEPTIONS'}</Badge></div>
        <Table rowKey="exception_id" features={{exportable:false}} onRow={row=>openExceptionDetail(row.exception_id)} cols={[
          {h:'Exception',render:r=><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();openExceptionDetail(r.exception_id)}}>{r.source_label}</Btn>},
          {h:'Reason',render:r=><Badge tone={r.severity==='HIGH'?'bad':'warn'}>{r.reason}</Badge>},
          {h:'Entity / vendor',render:r=><span>{r.entity_id || 'Unproven'}<br/><small>{r.vendor_name || 'Unidentified'}</small></span>},
          {h:'Property / project',render:r=><span>{r.property_id || '—'} / {r.project_id || '—'}</span>},
          {h:'Amount / open',num:true,render:r=><span><Money v={r.amount}/><br/><small><Money v={r.outstanding_amount}/></small></span>},
          {h:'Evidence',render:r=><Badge tone="warn">{r.evidence_state}</Badge>},
          {h:'Workflow',render:r=><Badge tone={r.workflow_state==='HELD'?'bad':'warn'}>{r.workflow_state}</Badge>},
        ]} rows={expenseReviewExceptions} empty="No retained local expense exceptions match this scope." />
      </section>
    </>}
    {tab==='Payments' && <PaymentRun ctx={ctx} />}
    {tab==='AP Aging' && <Aging bills={bills} journals={jes || []} bankTransactions={bankTransactions} vendorCredits={vendorCredits} entityId={ctx.entity || null} vendorId={vendorId} initialAsOfDate={agingDetailScope?.asOfDate || navContext?.asOfDate} initialBucket={agingDetailScope?.agingBucket || navContext?.agingBucket} onOpen={openBillDetail} onOpenCredit={(creditKey,scope)=>openAgingCreditDetail(creditKey,scope)} onScopeChange={scope=>setAgingDetailScope(localApAgingReturnContext(scope))} onOpenJournal={(jeNumber,scope)=>ctx.goto('je',{jeNumber,expenseReturn:localApAgingReturnContext({vendorId,...scope})})} />}
    {tab==='Vendors' && <VendorWorkspace bills={bills} journals={jes || []} bankTransactions={bankTransactions} initialVendorId={navContext?.vendorEvidenceId} onCreateBill={vendorId=>{setNewBillVendorId(vendorId);setShowNew(true);}} onOpenJournal={jeNumber=>ctx.goto('je',{jeNumber})} onOpenBill={(billId,vendorEvidenceId)=>openVendorBillDetail(billId,vendorEvidenceId)} onOpenVendor={(vendorId, targetTab)=>{const target=localVendorWorkflowTarget(vendorId,targetTab); if(target) ctx.goto(target.route,target.context);}} />}
    <NewBill open={showNew} initialVendorId={newBillVendorId} onClose={()=>{setShowNew(false);setNewBillVendorId('');}} ctx={ctx} />
  </div>;
}
function VendorWorkspace({bills, journals, bankTransactions, initialVendorId, onCreateBill, onOpenJournal, onOpenBill, onOpenVendor}) {
  const [query, setQuery] = useState('');
  const [selectedVendorId, setSelectedVendorId] = useState(null);
  const vendors = filterLocalVendors(VENDORS, query).map(vendor => ({...vendor, localEvidence:localVendorEvidence(vendor, bills, journals, bankTransactions)}));
  const unpaid = bills.filter(bill=>!['PAID','VOID'].includes(bill.status));
  const paidThisPeriod = bills.filter(bill=>bill.status==='PAID' && String(bill.paid_date || '').startsWith('2026-07'));
  const selectedVendor = vendors.find(vendor=>vendor.vendor_id===selectedVendorId) || null;
  useEffect(()=>{ if (initialVendorId != null) setSelectedVendorId(Number(initialVendorId)); }, [initialVendorId]);
  if (selectedVendor) return <div className="full-bleed qbo-transaction-report"><div className="qbo-report-back"><button type="button" onClick={()=>setSelectedVendorId(null)}>Back to Vendors</button><span>Vendor evidence detail</span></div><h2 className="page-h">{selectedVendor.vendor_name}</h2><div className="gl-drill-head"><div><div className="gl-drill-crumb">Local vendor master and AP evidence</div><h3>{selectedVendor.vendor_code || 'Vendor code not retained'}</h3><div className="gl-drill-account">{selectedVendor.is_related_party ? 'Related party — review required' : 'Independent vendor evidence'}</div></div><Badge tone={selectedVendor.localEvidence.state==='ENTITY_SCOPED_LOCAL_VENDOR'?'ok':'warn'}>{selectedVendor.localEvidence.state}</Badge></div><div className="qbo-drill-summary"><span><i>Open balance</i><b><Money v={selectedVendor.localEvidence.open_balance}/></b></span><span><i>Tax review</i><b>{selectedVendor.localEvidence.taxState}</b></span><span><i>Entities</i><b>{selectedVendor.localEvidence.byEntity.map(row=>row.entity_id).join(', ') || 'No posted evidence'}</b></span><span><i>Local sources</i><b>{selectedVendor.localEvidence.evidenceBills.length}</b></span></div><Table rowKey="key" features={{exportable:false}} cols={[{h:'Bill',render:row=><Btn size="sm" variant="ghost" onClick={()=>onOpenBill(row.bill.bill_id,selectedVendor.vendor_id)}>{row.bill.bill_no}</Btn>},{h:'Date',render:row=>row.bill.bill_date},{h:'Account',render:row=>row.bill.account_code},{h:'Amount',num:true,render:row=><Money v={row.bill.amount}/>},{h:'Status',render:row=><Badge tone={row.proof.billState==='VALID_POSTED_AP'?'ok':'warn'}>{row.bill.status}</Badge>},{h:'Posted evidence',render:row=><Badge tone={row.proof.billState==='VALID_POSTED_AP'?'ok':'warn'}>{row.proof.billState}</Badge>},{h:'Drill',render:row=>row.proof.apJournal?<Btn size="sm" variant="ghost" onClick={()=>onOpenJournal(row.proof.apJournal.je_number)}>Open retained JE</Btn>:<Btn size="sm" variant="ghost" disabled>No posted JE</Btn>}]} rows={selectedVendor.localEvidence.evidenceBills.map(row=>({...row,key:row.bill.bill_id}))} empty="No retained local Bill or Payment evidence for this vendor."/><div className="row-acts" style={{marginTop:12}}><Btn size="sm" variant="ghost" onClick={()=>onOpenVendor(selectedVendor.vendor_id,'Bills')}>Open local bills</Btn><Btn size="sm" variant="ghost" disabled={!selectedVendor.localEvidence.open_balance} onClick={()=>onOpenVendor(selectedVendor.vendor_id,'璐﹂緞 Aging')}>Open AP aging</Btn><Btn size="sm" variant="primary" onClick={()=>onCreateBill(selectedVendor.vendor_id)}>Create local bill</Btn></div><p className="muted sm" style={{marginTop:10}}>This local evidence detail does not send email, accept a supplier connection, pay a vendor, create a tax filing, synchronize a portal, or aggregate balances across entities. Missing source, dimensions, approval or POSTED evidence remains unavailable for drill.</p></div>;
  return <div>
    <div className="accounting-page-head"><div><div className="page-eyebrow">EXPENSES / VENDORS</div><h3 className="page-h" style={{fontSize:22}}>Vendors</h3><p className="page-subtitle">Local vendor evidence and bill-entry access.</p></div></div>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QBO shell includes Pay vendors, New vendor, unpaid/paid summaries, and a vendor list. REFS exposes only existing local master data and posted AP/payment proof; vendor creation and QBO payments remain unavailable.</p>
    <div className="kpi-row" style={{marginBottom:12}}>
      <KPI label="Unpaid last 365 days" value={money(sum(unpaid,bill=>bill.amount))} sub={unpaid.length+' local open bills'} tone={unpaid.length?'warn':'ok'} />
      <KPI label="Paid" value={money(sum(paidThisPeriod,bill=>bill.amount))} sub={paidThisPeriod.length+' paid in local reference month'} tone="ok" />
    </div>
    <div className="expense-toolbar" style={{marginBottom:12}}>
      <label className="expense-search"><span>⌕</span><input aria-label="Search local vendors" value={query} onChange={event=>setQuery(event.target.value)} placeholder="Search vendor name or code" /></label>
      <span className="result-count"><b>{vendors.length}</b> local vendors</span>
      <Btn variant="ghost" disabled>Print</Btn><Btn variant="ghost" disabled>Export</Btn><Btn variant="ghost" disabled>Settings</Btn><Btn variant="ghost" disabled>Pay vendors</Btn><Btn variant="ghost" disabled>New vendor</Btn>
    </div>
    <Table exportName="vendors" rowKey="vendor_id" cols={[
      {h:'Vendor',render:r=><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();setSelectedVendorId(r.vendor_id)}}>{r.vendor_name}</Btn>}, {h:'Company name',render:r=>r.vendor_name},
      {h:'Phone',render:()=> <span className="muted">—</span>}, {h:'Email',render:()=> <span className="muted">—</span>},
      {h:'Related party',render:r=>r.is_related_party?<Badge tone="warn">Related party</Badge>:<span className="muted">—</span>},
      {h:'1099 review',render:r=><Badge tone={r.localEvidence.taxState==='POSSIBLE_1099_REVIEW'?'warn':'muted'}>{r.localEvidence.taxState}</Badge>},
      {h:'Entity proof',render:r=><Badge tone={r.localEvidence.state==='ENTITY_SCOPED_LOCAL_VENDOR'?'ok':'muted'}>{r.localEvidence.state}</Badge>},
      {h:'Open balance',num:true,render:r=><Money v={r.localEvidence.open_balance}/>,sortVal:r=>r.localEvidence.open_balance},
      {h:'Action',render:r=>{const balance=r.localEvidence.open_balance; return <span className="row-acts"><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();setSelectedVendorId(r.vendor_id);}}>View evidence</Btn><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();onOpenVendor(r.vendor_id,'Bills');}}>Open local bills</Btn><Btn size="sm" variant="ghost" disabled={!balance} onClick={event=>{event.stopPropagation();onOpenVendor(r.vendor_id,'璐﹂緞 Aging');}}>Open aging</Btn><Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();onCreateBill(r.vendor_id);}}>Create local bill</Btn></span>;}},
    ]} rows={vendors} empty="No local vendors match the current search." />
  </div>;
}

function NewBill({open, onClose, ctx, initialVendorId}) {
  const {actions, toast} = ctx;
  const [f, setF] = useState({vendor_id:'', invoice_no:'', bill_date:'2026-07-31', due_date:'2026-08-30', property_id:''});
  const [lines, setLines] = useState([{account_code:'612900', description:'', amount:'', cost_code:''}]);
  useEffect(()=>{ if (open) setF(current=>({...current, vendor_id:initialVendorId ? String(initialVendorId) : current.vendor_id})); }, [open, initialVendorId]);
  const set=(k,v)=>setF(s=>({...s,[k]:v}));
  const setL=(i,k,v)=>setLines(ls=>ls.map((l,x)=>x===i?{...l,[k]:v}:l));
  const total = lines.reduce((s,l)=>s+(+l.amount||0),0);
  const submit = () => {
    if(!f.vendor_id||!f.invoice_no||total<=0){ toast('Vendor, invoice number and a positive line amount are required.','bad'); return; }
    if(lines.some(l=>!l.account_code)){ toast('Every line requires an account.','bad'); return; }
    const r = actions.addBill({...f, vendor_id:+f.vendor_id, amount:total, account_code:lines[0].account_code,
      property_id:f.property_id?+f.property_id:null, lines: lines.map(l=>({...l, amount:+l.amount||0}))});
    if (r.dup) { toast('Duplicate invoice blocked [4004]: '+r.dup+' already exists for this vendor.','bad'); return; }
    toast('Bill created with '+lines.length+' lines totaling $'+total.toLocaleString()+'.'); onClose();
    setLines([{account_code:'612900', description:'', amount:'', cost_code:''}]);
  };
  return <Drawer open={open} onClose={onClose} title="褰曞叆 Bill 路 Category Details" width={640}
    actions={<><Btn onClick={onClose}>鍙栨秷</Btn><Btn variant="primary" onClick={submit}>鍒涘缓 Bill (${total.toLocaleString()})</Btn></>}>
    <div className="two-col">
      <Field label="Vendor" required><select value={f.vendor_id} onChange={e=>set('vendor_id',e.target.value)}>
        <option value="">— Select —</option>{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}{v.is_related_party?' (RP)':''}</option>)}</select></Field>
      <Field label="鍙戠エ鍙?Invoice #" required><input value={f.invoice_no} onChange={e=>set('invoice_no',e.target.value)}/></Field>
    </div>
    <div className="two-col">
      <Field label="Bill 鏃ユ湡"><input type="date" value={f.bill_date} onChange={e=>set('bill_date',e.target.value)}/></Field>
      <Field label="Due date"><input type="date" value={f.due_date} onChange={e=>set('due_date',e.target.value)}/></Field>
    </div>
    <SectionTitle right={<Btn size="sm" onClick={()=>setLines(ls=>[...ls,{account_code:'',description:'',amount:'',cost_code:''}])}>+ Add line</Btn>}>Category Details ({lines.length} lines)</SectionTitle>
    <table className="tbl tbl-dense"><thead><tr><th>#</th><th>Category / 绉戠洰</th><th>Description</th><th>Cost Code</th><th className="ta-r">Amount</th><th></th></tr></thead>
      <tbody>{lines.map((l,i)=><tr key={i}>
        <td className="muted">{i+1}</td>
        <td><select value={l.account_code} onChange={e=>setL(i,'account_code',e.target.value)} style={{maxWidth:210}}>
          <option value="">閫夋嫨绉戠洰</option>{COA.filter(a=>['EXPENSE','ASSET'].includes(a.account_type)).map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}</select></td>
        <td><input className="desc-line" value={l.description} onChange={e=>setL(i,'description',e.target.value)}/></td>
        <td><input className="date-in" style={{width:80}} placeholder="Cost code" value={l.cost_code} onChange={e=>setL(i,'cost_code',e.target.value)}/></td>
        <td className="ta-r"><input className="num-in" type="number" value={l.amount} onChange={e=>setL(i,'amount',e.target.value)}/></td>
        <td>{lines.length>1&&<button className="x-sm" onClick={()=>setLines(ls=>ls.filter((_,x)=>x!==i))}>脳</button>}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>Total</td><td className="ta-r"><b>${total.toLocaleString()}</b></td><td/></tr></tfoot>
    </table>
    <p className="muted sm">After approval, lines post Dr expense or cost code / Cr accounts payable. Cost codes support CWIP and expense classification.</p>
  </Drawer>;
}

function BillDetail({bill, onClose, onOpenPayment, agingReturn, vendorReturnId, ctx}) {
    const {actions, toast, can, user, goto, jes, bank} = ctx;
    if (!bill) return null;
    const trace = localBillEvidenceTrace(bill, jes);
  const steps = [
    {label:'鍒涘缓 Maker', done:true, who:bill.created_by},
    {label:'瀹℃壒 Approver', done:['APPROVED','PAID'].includes(bill.status), who:bill.approved_by},
    {label:'鍏ヨ处 Dr 璐圭敤 / Cr AP', done:!!bill.je_number, who:bill.je_number},
    {label:'浠樻 Dr AP / Cr Cash', done:bill.status==='PAID', who:bill.pay_je_number},
  ];
  const approve = () => {
    if (bill.created_by===user.user_id && user.role_code!=='CONTROLLER'){ toast('SoD block [4009]: preparer cannot approve this bill.','bad'); return; }
    actions.approveBill(bill.bill_id); toast('Bill approved and AP entry created.');
  };
  return <div className="full-bleed qbo-transaction-report" aria-label="Local bill evidence detail">
    <div className="qbo-report-back"><button type="button" onClick={onClose}>{agingReturn?.tab === 'AP Aging' ? 'Back to AP Aging' : vendorReturnId ? 'Back to Vendor evidence' : 'Back to Expenses'}</button><span>{agingReturn?.tab === 'AP Aging' ? localApAgingReturnScopeLabel(agingReturn) : vendorReturnId ? 'Vendor → Bill · retained same-vendor local evidence' : 'Bill · retained local evidence'}</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Expenses / Bill detail</div><h2 className="page-h">{bill.bill_no} · {bill.vendor_name}</h2><div className="gl-drill-account">{bill.bill_date} · due {bill.due_date} · local entity evidence only</div></div>{bill.status==='PENDING_APPROVAL' && can('AP.INVOICE.APPROVE') ? <Btn variant="primary" onClick={approve}>瀹℃壒 + 鐢熸垚鍒嗗綍</Btn> : <Badge tone="muted">{bill.status}</Badge>}</div>
    <div className="kv"><span>Invoice #</span><b>{bill.invoice_no}</b></div>
    <div className="kv"><span>閲戦</span><Money v={bill.amount} bold/></div>
    <div className="kv"><span>绉戠洰</span><b>{bill.account_code} {acct(bill.account_code).account_name}</b></div>
    <div className="kv"><span>Status</span><Badge>{bill.status}</Badge></div>
    <div className="kv"><span>Local AP proof</span><Badge tone={bill.paymentEvidence?.billState==='VALID_POSTED_AP'?'ok':'warn'}>{bill.paymentEvidence?.billState || 'UNVERIFIED'}</Badge></div>
    <div className="kv"><span>Payment / bank proof</span><Badge tone={bill.paymentEvidence?.bankState==='BANK_MATCHED'?'ok':bill.paymentEvidence?.bankState==='POSTED_UNMATCHED'?'warn':'muted'}>{bill.paymentEvidence?.bankState || 'NO_LOCAL_PAYMENT'}</Badge></div>
    <div className="kv"><span>Void / reversal evidence</span><Badge tone={bill.voidEvidence?.state==='VOID_EVIDENCE_RETAINED'?'ok':'warn'}>{bill.voidEvidence?.state || 'UNVERIFIED'}</Badge></div>
    {(bill.je_number||bill.pay_je_number) && <div className="row-acts" style={{margin:'10px 0'}}>
      {bill.je_number&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:bill.je_number,expenseReturn:{route:'ap',tab:'Bills',billId:bill.bill_id}})}>Open AP JE</Btn>}
      {bill.pay_je_number&&<Btn size="sm" variant="ghost" onClick={onOpenPayment}>Open payment detail</Btn>}
      {bill.pay_je_number&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:bill.pay_je_number,expenseReturn:{route:'ap',tab:'Bills',billId:bill.bill_id}})}>Open payment JE</Btn>}
      {bill.voidEvidence?.apReversals?.[0]&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:bill.voidEvidence.apReversals[0].je_number,expenseReturn:{route:'ap',tab:'Bills',billId:bill.bill_id}})}>Open reversal JE</Btn>}
    </div>}
    <SectionTitle>Local evidence trace</SectionTitle>
    <div className="qbo-drill-summary"><span><i>AP JE</i><b>{trace.apJournal ? `${trace.apJournal.je_number} · ${trace.apJournal.posting_status}` : 'No retained local AP JE'}</b></span><span><i>Payment JE</i><b>{trace.paymentJournal ? `${trace.paymentJournal.je_number} · ${trace.paymentJournal.posting_status}` : 'No retained local payment JE'}</b></span><span><i>Source document</i><b>{trace.sourceDocId || 'No retained local source document'}</b></span></div>
    {trace.canOpenSourceDocument && <div className="row-acts" style={{margin:'10px 0'}}><Btn size="sm" variant="ghost" onClick={()=>goto('sourcedocs',{route:'sourcedocs',docId:trace.sourceDocId,jeNumber:trace.apJournal.je_number,sourceSystem:trace.apJournal.source_system,expenseReturn:{route:'ap',tab:'Bills',billId:bill.bill_id}})}>Open local source document</Btn></div>}
    <p className="muted sm" style={{margin:'8px 0 0'}}>This trace reads local retained evidence only. It cannot upload, autofill, create, approve, edit, or pay a QBO bill.</p>
    <p className="muted sm" style={{margin:'8px 0 0'}}>Void/reversal is evidence-only. {bill.voidEvidence?.canRequest ? 'A posted, unpaid AP source may enter controller review, but this UI cannot create a reversal.' : 'Paid/partially paid, bank-matched, CWIP/prepaid, related-party, restricted/escrow/loan, cross-entity, or ambiguous cases require exception/reopen review; no bill or payment is deleted.'}</p>
    <SectionTitle>澶勭悊閾捐矾</SectionTitle>
    <ApprovalTimeline steps={steps} />
  </div>;
}

function ExpenseReviewExceptionDetail({exception, onClose, onOpenSource, ctx}) {
  const {goto} = ctx;
  return <div className="full-bleed qbo-transaction-report" aria-label="Local expense review exception detail">
    <div className="qbo-report-back"><button type="button" onClick={onClose}>Back to Expenses</button><span>Retained local review exception</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Expenses / review exception</div><h2 className="page-h">{exception.source_label}</h2><div className="gl-drill-account">{exception.source_kind} · discovered {exception.discovered_on || 'date not retained'}</div></div><Badge tone={exception.severity==='HIGH'?'bad':'warn'}>{exception.workflow_state}</Badge></div>
    <div className="qbo-drill-summary"><span><i>Exception / severity</i><b>{exception.reason} / {exception.severity}</b></span><span><i>Entity / vendor</i><b>{exception.entity_id || 'Unproven'} / {exception.vendor_name || 'Unidentified'}</b></span><span><i>Property / project</i><b>{exception.property_id || '—'} / {exception.project_id || '—'}</b></span><span><i>Account / cash scope</i><b>{exception.account_code || 'Not retained'} / {exception.cash_scope || 'Unproven'}</b></span><span><i>Amount / open</i><b>{money(exception.amount)} / {money(exception.outstanding_amount)}</b></span><span><i>Evidence</i><b>{exception.evidence_state}</b></span></div>
    <section className="report-workbench" aria-label="Local exception review audit"><div className="report-workbench-head"><div><b>Local review audit</b><div className="page-subtitle">The review lifecycle is independent from approval, posting, match, clearance and reconciliation.</div></div><Badge tone="warn">{exception.workflow_state}</Badge></div><div className="qbo-toolgrid"><span><i>Owner</i><b>{exception.owner}</b></span><span><i>History</i><b>{exception.review_history}</b></span><span><i>Resolution</i><b>{exception.can_resolve ? 'Retained evidence supports review' : 'BLOCKED — no automatic resolution'}</b></span></div><p className="muted sm" style={{margin:'10px 0 0'}}>This exception cannot create a correcting entry, change a bill or credit, apply/refund/void a credit, classify a payment, post, match, clear, sign off, export, notify, connect or synchronize external services.</p></section>
    <div className="row-acts" style={{marginTop:12}}>
      <Btn size="sm" variant="ghost" onClick={onOpenSource}>Open retained {exception.source_kind === 'BILL' ? 'Bill' : 'Vendor Credit'}</Btn>
      {exception.source_id && <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:exception.source_kind === 'VENDOR_CREDIT' ? exception.source_id : undefined})} disabled={exception.source_kind !== 'VENDOR_CREDIT'}>Open retained credit JE</Btn>}
      <Btn size="sm" variant="ghost" disabled>Resolve locally</Btn>
    </div>
  </div>;
}

function VendorCreditDetail({credit, agingReturn, onClose, onOpenBill, ctx}) {
  if (!credit) return null;
  const {goto} = ctx;
  const bankLink = credit.creditBankEvidence?.links?.[0] || null;
  const bankAccountCode = bankLink?.bank_account_code || bankLink?.account_code || null;
  const dimensions = [
    ...credit.creditDimensions?.propertyIds?.map(id=>`Property ${id}`) || [],
    ...credit.creditDimensions?.projectIds?.map(id=>`Project ${id}`) || [],
  ];
  return <div className="full-bleed qbo-transaction-report" aria-label="Local vendor credit evidence detail">
    <div className="qbo-report-back"><button type="button" onClick={onClose}>{agingReturn?.tab === 'AP Aging' ? 'Back to AP Aging' : 'Back to Expenses'}</button><span>{agingReturn?.tab === 'AP Aging' ? localApAgingReturnScopeLabel(agingReturn) : 'Retained local credit evidence'}</span></div>
    <div className="kv"><span>Vendor / payee</span><b>{credit.bill?.vendor_name || credit.journal.payee || 'Unlinked local credit evidence'}</b></div>
    <div className="kv"><span>Entity</span><b>{credit.entityId || 'Not retained'}</b></div>
    <div className="kv"><span>Credit amount</span><Money v={credit.creditAmount} bold/></div>
    <div className="kv"><span>Applied / unapplied</span><span><Money v={credit.applicationAmount}/> / <Money v={credit.unappliedAmount}/></span></div>
    <div className="kv"><span>Credit state</span><Badge tone={credit.canReduceAging?'ok':'warn'}>{credit.state}</Badge></div>
    <div className="kv"><span>Audit history</span><Badge tone={credit.auditState==='POSTED_AUDIT_RETAINED'?'ok':'warn'}>{credit.auditState}</Badge></div>
    <div className="kv"><span>Bank / reconcile evidence</span><Badge tone={String(credit.creditBankEvidence?.state).includes('MATCHED')?'ok':'muted'}>{credit.creditBankEvidence?.state || 'NO_RETAINED_BANK_LINK'}</Badge></div>
    <SectionTitle>Scope and linked evidence</SectionTitle>
    <div className="qbo-drill-summary"><span><i>Property / project</i><b>{dimensions.join(' · ') || 'Unassigned — review required'}</b></span><span><i>Linked bill</i><b>{credit.bill?.bill_no || credit.billRef || 'No retained bill link'}</b></span><span><i>Payment before credit</i><b><Money v={credit.paymentEvidence?.paidAmount || 0}/></b></span><span><i>Bank links</i><b>{credit.creditBankEvidence?.links?.length || 0}</b></span></div>
    <div className="row-acts" style={{margin:'12px 0'}}>
      <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:credit.journal.je_number,expenseReturn:localVendorCreditJournalReturnContext(credit.journal.je_number)})}>Open credit JE</Btn>
      {credit.bill ? <Btn size="sm" variant="ghost" onClick={()=>onOpenBill(credit.bill.bill_id)}>Open linked Bill</Btn> : <Btn size="sm" variant="ghost" disabled>No linked local Bill</Btn>}
      {bankAccountCode ? <Btn size="sm" variant="ghost" onClick={()=>goto('bankrec',{route:'bankrec',acctCode:bankAccountCode,bankTxnId:bankLink?.bank_txn_id || null})}>Open local reconcile evidence</Btn> : <Btn size="sm" variant="ghost" disabled>No retained bank drill</Btn>}
    </div>
    <p className="muted sm">This is a retained local AP-credit detail only. It does not create, apply, refund, void, pay, export, email or synchronize a vendor credit. A credit reduces AP Aging only when its exact posted application, entity/vendor, property/project, capital/prepaid source and related-party audit boundaries pass the evidence checks above.</p>
  </div>;
}

function PaymentEvidenceDetail({bill, paymentReturn, onClose, backLabel = 'Back to Bill payments', ctx}) {
  const payment = bill?.paymentEvidence || {};
  const paymentDetailReturn = {...paymentReturn, paymentDetail:true, ...(paymentReturn?.billDetail ? {paymentBillDetail:true} : {})};
  const bankDebit = payment.exactBankDebits?.[0] || null;
  const paymentIsPosted = payment.paymentState === 'VALID_POSTED_PAYMENT';
  const bankState = !paymentIsPosted ? 'NO_POSTED_PAYMENT_EVIDENCE' : !bankDebit ? 'NO_EXACT_LOCAL_BANK_DEBIT' : bankDebit.lifecycle?.reconciliationState === 'SIGNED_OFF' ? 'SIGNED_RECONCILIATION_RETAINED' : 'NO_ELIGIBLE_RECONCILIATION_RECORD';
  const message = bankState === 'NO_POSTED_PAYMENT_EVIDENCE' ? 'No posted local payment evidence. This does not mean the bill was paid.' : bankState === 'NO_EXACT_LOCAL_BANK_DEBIT' ? 'No exact local Bank DEBIT evidence. A posted payment is not treated as bank-cleared or reconciled.' : bankState === 'NO_ELIGIBLE_RECONCILIATION_RECORD' ? 'Exact local Bank DEBIT retained, but no eligible signed reconciliation record.' : 'Exact local Bank DEBIT and a signed reconciliation record are retained.';
  return <div className="full-bleed qbo-transaction-report" aria-label="Local payment evidence detail">
    <div className="qbo-report-back"><button type="button" onClick={onClose}>{backLabel}</button><span>{paymentReturn?.billDetail ? `Retained Bill scope · ${paymentReturn.billId || 'unselected'}` : localPaymentReturnScopeLabel(paymentReturn)}</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Expenses / Payment detail</div><h2 className="page-h">{bill?.bill_no} · {bill?.vendor_name}</h2><div className="gl-drill-account">{bill?.paid_date || 'Payment date not retained'} · {bill?.entity_id || 'Entity not retained'} · {bill?.property_id ? `Property ${bill.property_id}` : 'Property unassigned'} · {bill?.project_id ? `Project ${bill.project_id}` : 'Project unassigned'}</div></div><Badge tone={bankState === 'SIGNED_RECONCILIATION_RETAINED' ? 'ok' : 'warn'}>{bankState}</Badge></div>
    <div className="qbo-drill-summary"><span><i>Payment JE</i><b>{payment.paymentJournal?.je_number || bill?.pay_je_number || 'No retained payment JE'}</b></span><span><i>POSTED state</i><b>{payment.paymentJournal?.posting_status || payment.paymentState}</b></span><span><i>Amount / method</i><b>{money(bill?.amount)} / {bill?.payment_method || 'Not retained'}</b></span><span><i>Bank debit</i><b>{bankDebit ? `${bankDebit.external_id || bankDebit.bank_txn_id} · ${money(bankDebit.amount)}` : 'No exact local Bank DEBIT'}</b></span><span><i>Cleared / reconcile</i><b>{bankDebit ? `${bankDebit.lifecycle?.clearingState || 'NOT_CLEARED'} / ${bankDebit.lifecycle?.reconciliationState || 'NOT_SIGNED_OFF'}` : 'Unproven / unproven'}</b></span></div>
    <section className="expense-shell-panel" aria-label="Payment bank evidence state" style={{marginTop:12}}><div><b>{bankState}</b><span>{message}</span></div><p className="muted sm" style={{margin:0}}>Cash scope: {bankDebit?.local_evidence?.cashScope || 'Unmapped — review required'}. CWIP/prepaid, escrow/restricted cash, loan deductions, related-party, cross-entity and same-amount multi-candidate cases never become operating-cash or reconciliation facts automatically.</p></section>
    <div className="row-acts" style={{marginTop:12}}>{payment.paymentJournal?.je_number ? <><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('je',{jeNumber:payment.paymentJournal.je_number,paymentReturn:paymentDetailReturn})}>Open payment JE</Btn><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('gl',localPaymentReportDrillContext({tab:'GL Detail',entityId:bill?.entity_id,drillLabel:payment.paymentJournal.je_number,paymentReturn:paymentDetailReturn}))}>Open GL Detail</Btn><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('gl',localPaymentReportDrillContext({tab:'Trial Balance',entityId:bill?.entity_id,drillLabel:payment.paymentJournal.je_number,paymentReturn:paymentDetailReturn}))}>Open Trial Balance</Btn></> : <Btn size="sm" variant="ghost" disabled>No posted payment JE</Btn>}{bankDebit?.bank_account_code ? <Btn size="sm" variant="ghost" onClick={()=>ctx.goto('banktx',{route:'banktx',acctCode:bankDebit.bank_account_code,bankTxnId:bankDebit.bank_txn_id,paymentReturn:paymentDetailReturn})}>Open local bank evidence</Btn> : <Btn size="sm" variant="ghost" disabled>No exact local Bank DEBIT</Btn>}</div>
    <p className="muted sm" style={{marginTop:12}}>Read-only local evidence detail. It cannot pay, import a feed, match, clear, sign off, post, reverse, refund, export, connect or synchronize an external service.</p>
  </div>;
}

function PaymentRun({ctx}) {
    const {ap, jes, bank, actions, toast, can, goto, entity, navContext} = ctx;
  const [checked, setChecked] = useState({});
  const [view, setView] = useState('Payments');
  const [paymentDate, setPaymentDate] = useState('All dates');
  const [selectedPayment, setSelectedPayment] = useState(null);
  useEffect(() => {
    if (navContext?.route !== 'ap' || navContext.tab !== 'Payments') return;
    if (['All dates','This month'].includes(navContext.paymentDate)) setPaymentDate(navContext.paymentDate);
  }, [navContext?.route, navContext?.tab, navContext?.paymentDate]);
  const bankTransactions = Object.entries(bank?.accounts || {}).flatMap(([bank_account_code, account]) => (account.txns || []).map(transaction => ({...transaction, bank_account_code})));
  const bills = ap.bills.map(bill => ({...bill,paymentEvidence:localBillPaymentEvidence(bill,jes || [],bankTransactions)}));
  useEffect(() => {
    if (!navContext?.paymentDetail || !navContext?.billId) return;
    const retainedPayment = bills.find(bill => String(bill.bill_id) === String(navContext.billId));
    if (retainedPayment) setSelectedPayment(retainedPayment);
  }, [navContext?.paymentDetail, navContext?.billId]);
  const payable = bills.filter(bill=>bill.paymentEvidence.paymentAllowed);
  const pendingApproval = bills.filter(bill=>bill.status==='PENDING_APPROVAL');
  const payments = filterLocalPaymentHistory(bills, {paymentDate, currentMonth:'2026-07'});
  const paymentHistoryEmpty = isLocalPaymentHistoryEmpty(bills, {paymentDate, currentMonth:'2026-07'});
  const openBankEvidence = bill => {
    const bankTxn = bill.paymentEvidence?.exactBankDebits?.[0];
    if (!bankTxn?.bank_account_code) return;
    goto('banktx',{route:'banktx',acctCode:bankTxn.bank_account_code,bankTxnId:bankTxn.bank_txn_id,paymentReturn:{route:'ap',tab:'Payments',billId:bill.bill_id,paymentDate}});
  };
  const selectedPaymentReturn = selectedPayment ? {route:'ap',tab:'Payments',billId:selectedPayment.bill_id,paymentDate} : null;
  if (selectedPayment) return <PaymentEvidenceDetail bill={selectedPayment} paymentReturn={selectedPaymentReturn} onClose={()=>setSelectedPayment(null)} ctx={ctx} />;
  const ids = Object.keys(checked).filter(id=>checked[id]).map(Number);
  const total = sum(payable.filter(b=>ids.includes(b.bill_id)), b=>b.amount);
  const run = () => {
    if (!ids.length) return toast('Select at least one bill to pay.','warn');
    actions.payBills(ids);
    toast(`Payment batch completed: ${ids.length} bills, ${money(total)}.`);
    setChecked({});
  };
  return <div className="bill-payments-workspace">
    <div className="accounting-page-head"><div><div className="page-eyebrow">EXPENSES / BILL PAYMENTS</div><h3 className="page-h" style={{fontSize:22}}>Bill payments</h3><p className="page-subtitle">Review approval readiness, payment history, and local payment-run evidence.</p></div></div>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Observed QBO shell: Bill payments displays only payments made through QuickBooks Bill Pay. REFS lists local AP evidence below; payment-network behavior is not claimed equivalent.</p>
    <div className="report-shelf" role="tablist" aria-label="Bill payment queues">
      {['Pending approval','Payments'].map(label=><button key={label} role="tab" aria-selected={view===label} type="button" className={`report-shelf-chip ${view===label?'report-shelf-chip-on':''}`} onClick={()=>setView(label)}>{label}{label==='Pending approval'&&pendingApproval.length>0?` (${pendingApproval.length})`:''}</button>)}
      <span className="report-shelf-spacer" />
      <Btn size="sm" variant="ghost" onClick={()=>setPaymentDate('All dates')}>Filters</Btn>
      <label className="muted sm">Payment date&nbsp;<select aria-label="Payment date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)}><option>All dates</option><option>This month</option></select></label>
    </div>
    {view==='Pending approval' ? <Table rowKey="bill_id" onRow={r=>goto('ap',{route:'ap',tab:'Bills',billId:r.bill_id})} cols={[
      {h:'Bill #',k:'bill_no'},{h:'Vendor',render:r=>r.vendor_name},{h:'Due date',k:'due_date'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},{h:'Status',render:r=><Badge tone="warn">{r.status}</Badge>},
      {h:'Action',render:r=><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();goto('ap',{route:'ap',tab:'Bills',billId:r.bill_id});}}>Open bill</Btn>},
    ]} rows={pendingApproval} empty="No bills are pending approval."/> : <>
      <Table rowKey="bill_id" onRow={r=>setSelectedPayment(r)} cols={[
        {h:'Payment date',render:r=>r.paid_date||'—'},{h:'Bill #',k:'bill_no'},{h:'Vendor',render:r=>r.vendor_name},
        {h:'Method',render:r=>r.payment_method||'—'},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},
        {h:'JE',render:r=>r.pay_je_number?<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();goto('je',{jeNumber:r.pay_je_number,paymentReturn:{route:'ap',tab:'Payments',billId:r.bill_id,paymentDate}});}}>{r.pay_je_number}</Btn>:'—'},
        {h:'Local bank proof',render:r=><Badge tone={r.paymentEvidence.bankState==='BANK_MATCHED'?'ok':r.paymentEvidence.bankState==='POSTED_UNMATCHED'?'warn':'bad'}>{r.paymentEvidence.bankState}</Badge>},
        {h:'Drill',render:r=>{const drill=localPaymentEvidenceDrill(r,jes); const paymentReturn={route:'ap',tab:'Payments',billId:r.bill_id,paymentDate}; return <span className="row-acts"><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();setSelectedPayment(r);}}>Details</Btn>{drill.eligible&&<><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();goto('gl',localPaymentReportDrillContext({tab:'GL Detail',entityId:entity,drillLabel:drill.journalNumber,paymentReturn}));}}>GL</Btn><Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();goto('gl',localPaymentReportDrillContext({tab:'Trial Balance',entityId:entity,drillLabel:drill.journalNumber,paymentReturn}));}}>TB</Btn></>}{r.paymentEvidence.exactBankDebits?.[0]?.bank_account_code?<Btn size="sm" variant="ghost" onClick={e=>{e.stopPropagation();openBankEvidence(r);}}>Bank</Btn>:<Btn size="sm" variant="ghost" disabled>No exact Bank DEBIT</Btn>}</span>;}},
      ]} rows={payments} empty="No payment evidence matches the selected date."/>
      {paymentHistoryEmpty && <section aria-label="Observed QuickBooks Bill Pay empty state" className="expense-shell-panel" style={{marginTop:12}}><div><b>Make payments easy with QuickBooks Bill Pay</b><span>When you use QuickBooks Bill Pay, you’ll find all your payment details here.</span></div><p className="muted sm" style={{margin:0}}>Observed QBO empty-state copy. This local payment run is separate from QBO Bill Pay and does not schedule a network payment.</p></section>}
      <SectionTitle>REFS local payment run</SectionTitle>
    <Table rowKey="bill_id" cols={[
      {h:'',w:36,render:r=><input type="checkbox" checked={!!checked[r.bill_id]} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(c=>({...c,[r.bill_id]:e.target.checked}))}/>},
      {h:'Bill #',k:'bill_no'},{h:'Vendor',render:r=>r.vendor_name},{h:'Due date',k:'due_date'},
      {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},
      {h:'AP proof',render:r=><Badge tone={r.paymentEvidence.billState==='VALID_POSTED_AP'?'ok':'bad'}>{r.paymentEvidence.billState}</Badge>},
    ]} rows={payable} empty="No approved bills are ready for payment."/>
    <div style={{marginTop:12,display:'flex',alignItems:'center',gap:14}}>
      <Btn variant="primary" onClick={run} disabled={!can('AP.PAYMENT.CREATE')||!ids.length}>Pay selected ({ids.length} · {money(total)})</Btn>
      <span className="muted sm">Posts Dr AP / Cr Cash, stores payment date/method, and preserves the payment audit trail.</span>
    </div>
    </>}
  </div>;
}
function Aging({bills,journals,bankTransactions,vendorCredits,entityId,vendorId,initialAsOfDate,initialBucket,onOpen,onOpenCredit,onScopeChange,onOpenJournal}) {
  return <AgingDetail bills={bills} journals={journals} bankTransactions={bankTransactions} vendorCredits={vendorCredits} entityId={entityId} vendorId={vendorId} initialAsOfDate={initialAsOfDate} initialBucket={initialBucket} onOpen={onOpen} onOpenCredit={onOpenCredit} onScopeChange={onScopeChange} onOpenJournal={onOpenJournal} />;
}

function AgingDetail({bills,journals,bankTransactions,vendorCredits = [],entityId,vendorId,initialAsOfDate,initialBucket,onOpen,onOpenCredit,onScopeChange,onOpenJournal}) {
  const [activeBucket,setActiveBucket] = useState(initialBucket || 'ALL');
  const [asOfDate,setAsOfDate] = useState(initialAsOfDate || DEFAULT_AP_AGING_AS_OF);
  const allEvidenceRows = localApAgingEvidenceRows(bills, journals, bankTransactions, asOfDate, vendorCredits);
  const allRows = allEvidenceRows.filter(bill=>bill.included && (!entityId || bill.evidence?.apJournal?.entity_id===entityId));
  const rows = allRows.filter(bill=>vendorId==='ALL' || String(bill.vendor_id)===String(vendorId));
  const groups = LOCAL_AGING_BUCKETS.map(g=>({g, items:rows.filter(b=>b.aging_bucket===g)}));
  const control = localAgingControl(rows, '291001');
  const glControl = localAgingGlReconciliation({rows:allRows,journals,accountCode:'291001',entityId,asOfDate,normalSide:'CREDIT'});
  const controlEvidence = localAgingControlDifferenceEvidence({reportType:'AP',rows:allRows,allRows:allEvidenceRows,journals,accountCode:'291001',entityId,asOfDate,normalSide:'CREDIT'});
  const visible = activeBucket==='ALL' ? rows : rows.filter(b=>b.aging_bucket===activeBucket);
  const agingReturnScope = {vendorId,asOfDate,agingBucket:activeBucket};
  useEffect(() => { onScopeChange?.(agingReturnScope); }, [vendorId,asOfDate,activeBucket]);
  return <div className="ap-aging-shell"><p className="muted sm" style={{margin:'0 0 10px'}}>POSTED local AP only · {control.state} · detail {money(control.detailTotal)} / source control {money(control.sourceControlTotal)}. Only same-entity, retained, explicitly applied vendor-credit evidence reduces a bill; draft/pending/paid/void bills, unallocated credits, partial allocations, missing dimensions, trust/deposit funds, and cross-entity balances remain excluded or reviewed.</p><section className="report-workbench" aria-label="AP aging GL control reconciliation" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>AP Aging → GL control reconciliation</b><div className="page-subtitle">Whole retained AP scope through {asOfDate}; vendor filtering never rewrites the GL control total.</div></div><Badge tone={glControl.state==='LOCAL_AGING_GL_TIED'?'ok':'warn'}>{glControl.state}</Badge></div><div className="qbo-toolgrid"><span><i>Aging detail</i><b>{money(glControl.detailTotal)}</b></span><span><i>Source AP control</i><b>{money(glControl.sourceControlTotal)}</b></span><span><i>Posted GL 291001</i><b>{money(glControl.postedControlTotal)}</b></span></div>{glControl.differenceRows.map(row=><p className="muted sm" key={row.key} style={{margin:'6px 0 0'}}><Badge tone={row.state==='TIED'?'ok':'warn'}>{row.state}</Badge> {row.label}: {money(row.amount)}</p>)}</section>{controlEvidence.issues.length>0&&<section className="report-workbench" aria-label="AP control difference evidence" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>AP control difference evidence</b><div className="page-subtitle">Local review rows only; no adjustment is created.</div></div><Badge tone="warn">{controlEvidence.state}</Badge></div><Table rowKey="key" cols={[{h:'Category',render:r=><Badge tone="warn">{r.category}</Badge>},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},{h:'Reason',k:'reason'},{h:'JE',render:r=>r.journal?<Btn size="sm" variant="ghost" onClick={()=>onOpenJournal?.(r.journal.je_number,agingReturnScope)}>{r.journal.je_number}</Btn>:<span className="muted">No retained drill</span>}]} rows={controlEvidence.issues}/></section>}<div className="kpi-row ap-aging-kpis">
    {groups.map(({g,items})=><KPI key={g} label={g+' days'} value={money(sum(items,b=>b.amount))} sub={items.length+' bills'} tone={g==='60+'&&items.length?'bad':undefined}/>)}
  </div><div className="ap-aging-head"><div><b>Aging detail</b><span>{activeBucket==='ALL'?'All open bills':activeBucket} · as of {asOfDate}</span></div><label className="muted sm">As of <input aria-label="AP aging as of date" type="date" value={asOfDate} onChange={event=>setAsOfDate(event.target.value)} /></label><span className="result-count"><b>{visible.length}</b> bills</span></div>{visible.length?<Table exportName="ap-aging-detail" rowKey="bill_id" onRow={r=>onOpen?.(r.bill_id)} cols={[{h:'Bill #',k:'bill_no'},{h:'Vendor',render:r=>r.vendor_name},{h:'Due date',k:'due_date'},{h:'Bucket',render:r=><Badge tone={r.aging_bucket==='60+'?'bad':'muted'}>{r.aging_bucket}</Badge>},{h:'Bill amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},{h:'Paid',num:true,render:r=><Money v={r.paid_amount}/>,sortVal:r=>r.paid_amount},{h:'Payment proof',render:r=><Badge tone={r.payment_evidence.state==='PAYMENT_REVERSED_EVIDENCE'?'warn':r.payment_evidence.state==='PAYMENT_REVERSAL_BANK_REVIEW'?'bad':'muted'}>{r.payment_evidence.state}</Badge>},{h:'Applied credit',num:true,render:r=><span className="row-acts"><Money v={r.applied_credit_amount}/>{r.applied_credits?.[0]&&<Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();onOpenCredit?.(r.applied_credits[0].journal.je_number,agingReturnScope);}}>Credit evidence</Btn>}</span>,sortVal:r=>r.applied_credit_amount},{h:'Open amount',num:true,render:r=><Money v={r.outstanding_amount}/>,sortVal:r=>r.outstanding_amount},{h:'Status',render:r=><Badge>{r.aging_state}</Badge>}]} rows={visible}/>:<div className="empty-state ap-aging-empty">No open bills in this aging bucket.</div>}<p className="muted sm" style={{margin:'10px 0 0'}}>Local AP Aging uses the selected report date and only retained unpaid local bill evidence. Selecting a row opens the existing local Bill detail; QBO aging report controls remain unverified.</p></div>;
}
