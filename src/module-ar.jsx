import { useEffect, useRef, useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, Drawer, Field } from './ui.jsx';
import { CUSTOMERS } from './data.js';
import { money, sum } from './engine.js';
import { RECEIVABLES_BUSINESS_SCOPE } from './receivables-business-scope.js';
import { AR_AGING_BUCKETS, DEFAULT_AR_AGING_AS_OF } from './ar-aging.js';
import { localInvoiceReceiptEvidence } from './invoice-receipt-evidence.js';
import { localInvoicePaymentLifecycle } from './invoice-payment-lifecycle.js';
import { localCustomerPaymentRows, localCustomerPaymentView } from './customer-payment-evidence.js';
import { localUnappliedCustomerPayments, localUnappliedPaymentView } from './unapplied-customer-payment-evidence.js';
import { localInvoiceVoidEvidence } from './invoice-void-evidence.js';
import { LOCAL_AGING_BUCKETS, localArAgingEvidenceRows, localAgingControl, localAgingGlReconciliation, localAgingControlDifferenceEvidence } from './aging-local-evidence.js';
import { localReportReturnScopeLabel } from './report-return-context.js';
import { localReconciliationJournalReturnScopeLabel } from './reconciliation-journal-return.js';

// Local property receivables: evidence, receipt, bank proof, then aging.
export function ARWorkspace({ctx}) {
  const {ar, actions, toast, navContext, jes, bank, goto, entity} = ctx;
  const [tab, setTab] = useState('Invoices');
  const [selectedInvoiceId, setSelectedInvoiceId] = useState(null);
  const [invoiceReturnScope, setInvoiceReturnScope] = useState(null);
  const priorTabRef = useRef('Invoices');
  const [receiptView, setReceiptView] = useState('All');
  const [unappliedView, setUnappliedView] = useState('Unapplied');
  const [asOfDate, setAsOfDate] = useState(DEFAULT_AR_AGING_AS_OF);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({customer_id:'',memo:'',inv_date:'2026-07-31',due_date:'2026-08-30',amount:''});
  const bankTransactions = Object.entries(bank?.accounts || {}).flatMap(([bank_account_code, account]) => (account.txns || []).map(transaction => ({...transaction, bank_account_code})));
  const invoices = ar.invoices.map(invoice => {
    const lifecycle = localInvoicePaymentLifecycle(invoice, jes || [], bankTransactions);
    return {...invoice, localEvidence:lifecycle.evidence, lifecycle, voidEvidence:localInvoiceVoidEvidence(invoice, jes || [], bankTransactions)};
  });
  const allArAgingRows = localArAgingEvidenceRows(invoices, jes || [], bankTransactions, asOfDate);
  const agingRows = allArAgingRows.filter(row=>row.included && (!entity || row.evidence?.sourceJournal?.entity_id===entity));
  const agingControl = localAgingControl(agingRows, '120200');
  const agingGlControl = localAgingGlReconciliation({rows:agingRows,journals:jes || [],accountCode:'120200',entityId:entity || null,asOfDate,normalSide:'DEBIT'});
  const arControlEvidence = localAgingControlDifferenceEvidence({reportType:'AR',rows:agingRows,allRows:allArAgingRows,journals:jes || [],accountCode:'120200',entityId:entity || null,asOfDate,normalSide:'DEBIT'});
  const customerPayments = localCustomerPaymentRows(invoices, jes || [], bankTransactions);
  const visibleCustomerPayments = localCustomerPaymentView(customerPayments, receiptView);
  const unappliedPayments = localUnappliedCustomerPayments(invoices, jes || [], bankTransactions).filter(row => !entity || row.entity_id === entity);
  const visibleUnappliedPayments = localUnappliedPaymentView(unappliedPayments, unappliedView);
  const selectedInvoice = invoices.find(invoice => invoice.inv_id === selectedInvoiceId) || null;
  const open = agingRows;
  const openInvoiceDetail = (invoiceId, returnScope = {tab,asOfDate}) => {
    setInvoiceReturnScope(returnScope);
    setSelectedInvoiceId(invoiceId);
  };
  useEffect(() => {
    if (selectedInvoice && !invoiceReturnScope) setInvoiceReturnScope({tab:priorTabRef.current,asOfDate});
    priorTabRef.current = tab;
  }, [selectedInvoice, invoiceReturnScope, tab, asOfDate]);

  useEffect(() => {
    if (navContext?.route !== 'ar') return;
    if (navContext.tab === 'AR Aging') setTab('AR Aging');
    if (navContext.tab === 'Invoices') setTab('Invoices');
    if (navContext.tab === 'Receipts') setTab('Receipts');
    if (['All','Bank matched','Posted unmatched','Review'].includes(navContext.receiptView)) setReceiptView(navContext.receiptView);
    if (navContext.asOfDate) setAsOfDate(navContext.asOfDate);
    const invoice = invoices.find(item => item.inv_id === navContext.invoiceId || item.je_number === navContext.jeNumber || item.pay_je_number === navContext.jeNumber);
    if (invoice) {
      const retainedScope = navContext.invoiceReturn || {tab:navContext.tab || 'Invoices',receiptView:navContext.receiptView || receiptView,asOfDate:navContext.asOfDate || asOfDate};
      setInvoiceReturnScope(retainedScope);
      if (['All','Bank matched','Posted unmatched','Review'].includes(retainedScope.receiptView)) setReceiptView(retainedScope.receiptView);
      setSelectedInvoiceId(invoice.inv_id); setTab(navContext.tab || 'Invoices');
    }
  }, [navContext?.route, navContext?.tab, navContext?.receiptView, navContext?.asOfDate, navContext?.invoiceId, navContext?.jeNumber, navContext?.invoiceReturn, ar.invoices]);

  const submit = () => {
    if (!form.customer_id || !form.amount || +form.amount <= 0) { toast('Customer and amount are required.','bad'); return; }
    actions.addInvoice({...form,customer_id:+form.customer_id,amount:+form.amount});
    toast('Local invoice created with the existing AR posting workflow.');
    setShowNew(false); setForm({customer_id:'',memo:'',inv_date:'2026-07-31',due_date:'2026-08-30',amount:''});
  };
  const sourceStateTone = state => state === 'VALID_POSTED_AR_SOURCE' || state === 'BANK_MATCHED' ? 'ok' : state === 'NO_LOCAL_RECEIPT' ? 'muted' : 'warn';
  const closeInvoiceDetail = () => {
    const restore = invoiceReturnScope || {tab:'Invoices',asOfDate};
    setSelectedInvoiceId(null);
    setInvoiceReturnScope(null);
    setTab(restore.tab || 'Invoices');
    if (['All','Bank matched','Posted unmatched','Review'].includes(restore.receiptView)) setReceiptView(restore.receiptView);
    if (restore.asOfDate) setAsOfDate(restore.asOfDate);
  };
  if (selectedInvoice) return <InvoiceDetail invoice={selectedInvoice} onClose={closeInvoiceDetail} goto={goto} sourceStateTone={sourceStateTone} returnScope={invoiceReturnScope} />;

  return <div>
    {navContext?.reportCenterReturn?.route==='reports' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('reports')}>Back to reports</button><span>{navContext.reportCenterReturn.reportName || 'A/R Aging Summary'}</span></div>}
    {navContext?.reportReturn?.route==='gl' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('gl',navContext.reportReturn)}>Back to {navContext.reportReturn.tab || 'report'}</button><span>{localReportReturnScopeLabel(navContext.reportReturn)}</span></div>}
    {navContext?.reconciliationReturn?.route==='bankrec' && <div className="qbo-report-back"><button type="button" onClick={()=>goto('bankrec',navContext.reconciliationReturn)}>Back to reconciliation</button><span>{localReconciliationJournalReturnScopeLabel(navContext.reconciliationReturn)}</span></div>}
    <h2 className="page-h">Receivables · local close</h2>
    <p className="muted sm" style={{margin:'0 0 12px'}}>Tenant, owner, and related-party receivables only. QBO online payment processing, sales channels, payment links, and external sync are excluded.</p>
    <section className="report-workbench" aria-label="Receivables business-fit scope" style={{marginBottom:12}}>
      <div className="report-workbench-head"><div><b>Business-fit invoice and receipt scope</b><div className="page-subtitle">Local invoice → posted receipt → exact local bank credit → aging.</div></div></div>
      <div className="qbo-toolgrid"><div><b>Included</b>{RECEIVABLES_BUSINESS_SCOPE.included.map(item=><div className="muted sm" key={item}>{item}</div>)}</div><div><b>Excluded</b>{RECEIVABLES_BUSINESS_SCOPE.excluded.map(item=><div className="muted sm" key={item}>{item}</div>)}</div></div>
    </section>
    <div className="kpi-row">
      <KPI label="Open receivables" value={open.length} sub={money(sum(open,row=>row.amount))} tone={open.length?'warn':'ok'}/>
      <KPI label="Paid local invoices" value={invoices.filter(row=>row.status==='PAID').length} tone="ok"/>
      <KPI label="Overdue 90+" value={money(sum(open.filter(row=>row.aging_bucket==='90+'),row=>row.outstanding_amount))} tone="bad"/>
      <KPI label="Counterparties" value={CUSTOMERS.length}/>
    </div>
    <Tabs tabs={['Invoices','Receipts','AR Aging','Counterparties']} active={tab} onChange={setTab}/>
    {tab === 'Invoices' && <>
      <div style={{marginBottom:12}}><Btn variant="primary" onClick={()=>setShowNew(true)}>+ Create local invoice</Btn></div>
      <Table rowKey="inv_id" features={{exportable:false}} onRow={row=>openInvoiceDetail(row.inv_id, {tab:'Invoices',asOfDate})} cols={[
        {h:'Invoice #',k:'inv_no'}, {h:'Counterparty',k:'customer_name'}, {h:'Date',k:'inv_date'}, {h:'Due',k:'due_date'},
        {h:'Amount',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},
        {h:'Invoice',render:row=><Badge tone={row.lifecycle.invoiceState.startsWith('POSTED')?'ok':'warn'}>{row.lifecycle.invoiceState}</Badge>},
        {h:'AR source',render:row=>row.localEvidence.sourceJournal?<Btn size="sm" variant="ghost" onClick={event=>{event.stopPropagation();goto('je',{jeNumber:row.je_number});}}>{row.je_number}</Btn>:<Badge tone="bad">{row.localEvidence.sourceState}</Badge>},
        {h:'Payment',render:row=><Badge tone={row.lifecycle.paymentState==='RECORDED_POSTED'?'ok':'muted'}>{row.lifecycle.paymentState}</Badge>},
        {h:'Bank',render:row=><Badge tone={sourceStateTone(row.localEvidence.receiptState)}>{row.lifecycle.bankState}</Badge>},
        {h:'Receipt evidence',render:row=>row.status==='OPEN'?<Btn size="sm" variant="ghost" disabled title={row.localEvidence.receivePaymentAllowed?'Receipt recording is unavailable here; review retained receipt or bank evidence.':`Blocked: ${row.localEvidence.sourceState}`}>Receipt unavailable</Btn>:<span className="muted sm">{row.pay_je_number || row.localEvidence.receiptState}</span>},
      ]} rows={invoices} empty="No retained local invoices."/>
      {selectedInvoice && <section className="report-workbench" aria-label="Selected local invoice evidence" style={{marginTop:12}}>
        <div className="report-workbench-head"><div><b>Selected local invoice evidence</b><div className="page-subtitle">{selectedInvoice.inv_no} · {selectedInvoice.customer_name}</div></div><Btn size="sm" variant="ghost" onClick={()=>setSelectedInvoiceId(null)}>Clear</Btn></div>
        <div className="qbo-toolgrid"><span><i>Invoice lifecycle</i><b>{selectedInvoice.lifecycle.invoiceState}</b></span><span><i>Due date</i><b>{selectedInvoice.due_date}</b></span><span><i>Amount</i><b>{money(selectedInvoice.amount)}</b></span><span><i>AR source</i><b>{selectedInvoice.localEvidence.sourceState}</b></span><span><i>Payment lifecycle</i><b>{selectedInvoice.lifecycle.paymentState}</b></span><span><i>Bank lifecycle</i><b>{selectedInvoice.lifecycle.bankState}</b></span><span><i>Exact bank credits</i><b>{selectedInvoice.localEvidence.exactBankCredits.length}</b></span><span><i>Void/reversal</i><b>{selectedInvoice.voidEvidence.state}</b></span></div>
        <div className="row-acts" style={{marginTop:10}}>{selectedInvoice.localEvidence.sourceJournal&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:selectedInvoice.je_number})}>Open source JE</Btn>}{selectedInvoice.localEvidence.paymentJournal&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:selectedInvoice.pay_je_number})}>Open receipt JE</Btn>}{selectedInvoice.localEvidence.exactBankCredits[0]&&<Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:selectedInvoice.localEvidence.exactBankCredits[0].bank_account_code,bankTxnId:selectedInvoice.localEvidence.exactBankCredits[0].bank_txn_id})}>Open bank evidence</Btn>}{selectedInvoice.voidEvidence.sourceReversals[0]&&<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:selectedInvoice.voidEvidence.sourceReversals[0].je_number})}>Open reversal JE</Btn>}</div>
        <p className="muted sm" style={{margin:'10px 0 0'}}>Void/reversal is evidence-only. {selectedInvoice.voidEvidence.canRequest ? 'A posted, unpaid local source may enter a controller review request, but this UI cannot create it.' : 'Receipts, matched bank items, missing/ambiguous reversal evidence, prepayments, deposits, cross-period or cross-entity cases require exception/reopen review; no invoice/payment is deleted or refunded.'}</p>
        <p className="muted sm" style={{margin:'10px 0 0'}}>This is retained local evidence only. It does not send, collect, settle, or synchronize a QBO invoice. Deposit and restricted-funds treatment must remain a liability/availability review, not inferred rent revenue.</p>
      </section>}
    </>}
    {tab === 'Receipts' && <section className="ap-aging-shell" aria-label="Local customer payment evidence">
      <div className="ap-aging-head"><div><b>Customer payments</b><span>Invoice → posted receipt JE → exact local bank credit</span></div><span className="result-count"><b>{visibleCustomerPayments.length}</b> retained receipt rows</span></div>
      <div role="tablist" aria-label="Customer payment evidence views" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>
        {['All','Bank matched','Posted unmatched','Review'].map(view=><button key={view} type="button" role="tab" aria-selected={receiptView===view} className={receiptView===view?'btn btn-sm':'btn btn-ghost btn-sm'} onClick={()=>setReceiptView(view)}>{view}</button>)}
      </div>
      {visibleCustomerPayments.length ? <Table rowKey="payment_id" features={{exportable:false}} cols={[
        {h:'Invoice #',render:row=><Btn size="sm" variant="ghost" onClick={()=>openInvoiceDetail(row.invoice_id, {tab:'Receipts',receiptView,asOfDate})}>{row.invoice_no}</Btn>},
        {h:'Counterparty',k:'customer_name'}, {h:'Entity',render:row=>row.entity_id == null?<Badge tone="warn">Missing entity</Badge>:row.entity_id},
        {h:'Receipt date',k:'received_date'}, {h:'Received',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},
        {h:'Receipt JE',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.payment_journal})}>{row.payment_journal}</Btn>},
        {h:'Bank status',render:row=><Badge tone={sourceStateTone(row.state)}>{row.state}</Badge>},
        {h:'Bank evidence',render:row=>row.exact_bank_credits[0]?<Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:row.exact_bank_credits[0].bank_account_code,bankTxnId:row.exact_bank_credits[0].bank_txn_id,arReturn:{route:'ar',tab:'Receipts',receiptView,asOfDate}})}>Open bank item</Btn>:<span className="muted">No exact local credit</span>},
      ]} rows={visibleCustomerPayments}/>:<div className="empty-state">No retained customer receipts match this view.</div>}
      <p className="muted sm" style={{margin:'10px 0 0'}}>A payment is visible only when its retained receipt JE is linked to a local invoice. Bank matched requires the same posted receipt JE, CREDIT direction, and exact amount. The present local action supports full-invoice receipts only; partial, split/combined, deposit-versus-rent, cross-property/entity, and unmatched receipts remain review work, not automatic allocations.</p>
      <section className="report-workbench" aria-label="Unapplied customer payment exceptions" style={{marginTop:14}}><div className="report-workbench-head"><div><b>Unapplied / prepayment receipt exceptions</b><div className="page-subtitle">Unapplied cash never reduces AR until an explicit retained allocation exists.</div></div><Badge tone={unappliedPayments.some(row=>row.state.startsWith('UNAPPLIED'))?'warn':'ok'}>{unappliedPayments.filter(row=>row.state.startsWith('UNAPPLIED')).length + ' unapplied'}</Badge></div><div role="tablist" aria-label="Unapplied customer receipt views" style={{display:'flex',gap:8,flexWrap:'wrap',margin:'0 0 12px'}}>{['All','Unapplied','Partial review','Allocated'].map(view=><button key={view} type="button" role="tab" aria-selected={unappliedView===view} className={unappliedView===view?'btn btn-sm':'btn btn-ghost btn-sm'} onClick={()=>setUnappliedView(view)}>{view}</button>)}</div>{visibleUnappliedPayments.length?<Table rowKey="payment_id" features={{exportable:false}} cols={[
        {h:'Receipt JE',render:row=><Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:row.journal_number})}>{row.journal_number}</Btn>},{h:'Date',k:'date'},{h:'Entity',render:row=>row.entity_id || 'Missing'},
        {h:'Counterparty',k:'counterparty'},{h:'Invoice',render:row=>row.invoice_no || <Badge tone="warn">No retained allocation</Badge>},{h:'Cash',num:true,render:row=><Money v={row.cash_amount}/>},{h:'Applied',num:true,render:row=><Money v={row.applied_amount}/>},{h:'Unapplied',num:true,render:row=><Money v={row.unapplied_amount}/>},
        {h:'State',render:row=><Badge tone={row.state==='ALLOCATED'?'ok':'warn'}>{row.state}</Badge>},{h:'Bank',render:row=>row.bank_matches[0]?<Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:row.bank_matches[0].bank_account_code,bankTxnId:row.bank_matches[0].bank_txn_id})}>Open bank item</Btn>:<span className="muted">No exact bank credit</span>},
      ]} rows={visibleUnappliedPayments}/>:<div className="empty-state">No retained local receipt exceptions in this view.</div>}<p className="muted sm" style={{margin:'10px 0 0'}}>This queue is read-only. It does not auto-claim a tenant/owner receipt, create a prepayment entry, or move deposits/escrow/trust funds. Cross-entity or duplicate candidates remain blocked for manual accounting review.</p></section>
    </section>}
    {tab === 'AR Aging' && <div className="ap-aging-shell"><section className="report-workbench" aria-label="AR aging GL control reconciliation" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>AR Aging → GL control reconciliation</b><div className="page-subtitle">One local entity and report date; customer rows cannot silently reset the control account.</div></div><Badge tone={agingGlControl.state==='LOCAL_AGING_GL_TIED'?'ok':'warn'}>{agingGlControl.state}</Badge></div><div className="qbo-toolgrid"><span><i>Aging detail</i><b>{money(agingGlControl.detailTotal)}</b></span><span><i>Source AR control</i><b>{money(agingGlControl.sourceControlTotal)}</b></span><span><i>Posted GL 120200</i><b>{money(agingGlControl.postedControlTotal)}</b></span></div>{agingGlControl.differenceRows.map(row=><p className="muted sm" key={row.key} style={{margin:'6px 0 0'}}><Badge tone={row.state==='TIED'?'ok':'warn'}>{row.state}</Badge> {row.label}: {money(row.amount)}</p>)}</section>{arControlEvidence.issues.length>0&&<section className="report-workbench" aria-label="AR control difference evidence" style={{marginBottom:12}}><div className="report-workbench-head"><div><b>AR control difference evidence</b><div className="page-subtitle">Local review rows only; no adjustment is created.</div></div><Badge tone="warn">{arControlEvidence.state}</Badge></div><Table rowKey="key" features={{exportable:false}} cols={[{h:'Category',render:r=><Badge tone="warn">{r.category}</Badge>},{h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},{h:'Reason',k:'reason'},{h:'JE',render:r=>r.journal?<Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:r.journal.je_number,arReturn:{route:'ar',tab:'AR Aging',asOfDate}})}>{r.journal.je_number}</Btn>:<span className="muted">No retained drill</span>}]} rows={arControlEvidence.issues}/></section>}<div className="kpi-row">{AR_AGING_BUCKETS.map(bucket=>{const items=agingRows.filter(row=>row.aging_bucket===bucket); return <KPI key={bucket} label={bucket+' days'} value={money(sum(items,row=>row.outstanding_amount))} sub={items.length+' invoices'} tone={bucket==='60+'&&items.length?'bad':undefined}/>;})}</div><div className="ap-aging-head"><div><b>Aging detail</b><span>All open local invoices · as of {asOfDate}</span></div><label className="muted sm">As of <input aria-label="AR aging as of date" type="date" value={asOfDate} onChange={event=>setAsOfDate(event.target.value)} /></label><span className="result-count"><b>{agingRows.length}</b> invoices</span></div>{agingRows.length?<Table rowKey="inv_id" features={{exportable:false}} onRow={row=>openInvoiceDetail(row.inv_id,{tab:'AR Aging',asOfDate})} cols={[{h:'Invoice #',k:'inv_no'},{h:'Counterparty',k:'customer_name'},{h:'Due date',k:'due_date'},{h:'Bucket',render:row=><Badge tone={row.aging_bucket==='60+'?'bad':'muted'}>{row.aging_bucket}</Badge>},{h:'Invoice amount',num:true,render:row=><Money v={row.amount}/>,sortVal:row=>row.amount},{h:'Received',num:true,render:row=><Money v={row.received_amount}/>,sortVal:row=>row.received_amount},{h:'Receipt proof',render:row=><Badge tone={row.receipt_evidence.state==='RECEIPT_REVERSED_EVIDENCE'?'warn':row.receipt_evidence.state==='RECEIPT_REVERSAL_BANK_REVIEW'?'bad':'muted'}>{row.receipt_evidence.state}</Badge>},{h:'Open amount',num:true,render:row=><Money v={row.outstanding_amount}/>,sortVal:row=>row.outstanding_amount},{h:'Status',render:row=><Badge>{row.aging_state}</Badge>}]} rows={agingRows}/>:<div className="empty-state">No open local invoices for this report date.</div>}<p className="muted sm" style={{margin:'10px 0 0'}}>Local AR Aging uses the selected report date and retained OPEN invoices. Selecting a row opens local evidence and retains its aging scope; QBO aging controls remain unverified.</p></div>}
    {tab === 'Counterparties' && <Table rowKey="customer_id" features={{exportable:false}} cols={[{h:'Counterparty',k:'customer_name'},{h:'Type',render:row=><Badge tone="muted">{row.customer_type}</Badge>},{h:'Related party',render:row=>row.is_related_party?<Badge tone="warn">RP</Badge>:'—'},{h:'Open balance',num:true,render:row=><Money v={sum(open.filter(invoice=>invoice.customer_id===row.customer_id),invoice=>invoice.amount)}/>}]} rows={CUSTOMERS}/>}
    {tab === 'AR Aging' && <p className="muted sm" style={{margin:'10px 0 0'}}>Proof gate: only retained OPEN invoices with a single POSTED AR source JE are included. Local detail total {money(agingControl.detailTotal)} · source-control total {money(agingControl.sourceControlTotal)} · {agingControl.state}. Partial allocations, void/reversals, missing entity/property/project tags, deposits, and cross-entity balances remain excluded until retained source evidence exists.</p>}
    <Drawer open={showNew} onClose={()=>setShowNew(false)} title="Create local invoice" width={520} actions={<><Btn onClick={()=>setShowNew(false)}>Cancel</Btn><Btn variant="primary" onClick={submit}>Save local invoice</Btn></>}>
      <Field label="Counterparty" required><select value={form.customer_id} onChange={event=>setForm(value=>({...value,customer_id:event.target.value}))}><option value="">— Select —</option>{CUSTOMERS.map(customer=><option key={customer.customer_id} value={customer.customer_id}>{customer.customer_name}</option>)}</select></Field>
      <div className="two-col"><Field label="Invoice date"><input type="date" value={form.inv_date} onChange={event=>setForm(value=>({...value,inv_date:event.target.value}))}/></Field><Field label="Due date"><input type="date" value={form.due_date} onChange={event=>setForm(value=>({...value,due_date:event.target.value}))}/></Field></div>
      <Field label="Memo"><input value={form.memo} onChange={event=>setForm(value=>({...value,memo:event.target.value}))} placeholder="Rent billing / management fee / related-party charge"/></Field>
      <Field label="Amount" required><input type="number" value={form.amount} onChange={event=>setForm(value=>({...value,amount:event.target.value}))}/></Field>
      <p className="muted sm">This local form has no payment link, card/ACH collection, recurring billing, sales order, channel, or external sync capability.</p>
    </Drawer>
  </div>;
}

function InvoiceDetail({invoice, onClose, goto, sourceStateTone, returnScope}) {
  const backLabel = returnScope?.tab === 'AR Aging' ? 'Back to AR Aging' : `Back to ${returnScope?.tab || 'Invoices'}`;
  const invoiceEvidenceReturn = {route:'ar', tab:returnScope?.tab || 'Invoices', receiptView:returnScope?.receiptView || '', asOfDate:returnScope?.asOfDate || '', invoiceId:invoice.inv_id, invoiceReturn:returnScope || {tab:'Invoices'}};
  return <div className="full-bleed qbo-transaction-report">
    <div className="qbo-report-back"><button type="button" onClick={onClose}>{backLabel}</button><span>{returnScope?.tab === 'AR Aging' ? `Retained AR scope · as of ${returnScope.asOfDate || '—'}` : 'Local invoice evidence'}</span></div>
    <div className="gl-drill-head"><div><div className="gl-drill-crumb">Receivables · retained local evidence</div><h2 className="page-h">Invoice detail</h2><div className="gl-drill-account">{invoice.inv_no} · {invoice.customer_name}</div></div><Badge tone={invoice.lifecycle.invoiceState.startsWith('POSTED')?'ok':'warn'}>{invoice.lifecycle.invoiceState}</Badge></div>
    <div className="qbo-drill-summary"><span><i>Due date</i><b>{invoice.due_date}</b></span><span><i>Amount</i><b><Money v={invoice.amount}/></b></span><span><i>AR source</i><b>{invoice.localEvidence.sourceState}</b></span><span><i>Receipt lifecycle</i><b>{invoice.lifecycle.paymentState}</b></span><span><i>Bank lifecycle</i><b>{invoice.lifecycle.bankState}</b></span><span><i>Exact bank credits</i><b>{invoice.localEvidence.exactBankCredits.length}</b></span><span><i>Void / reversal</i><b>{invoice.voidEvidence.state}</b></span></div>
    <div className="row-acts" style={{marginTop:12}}>
      {invoice.localEvidence.sourceJournal ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:invoice.je_number,arReturn:invoiceEvidenceReturn})}>Open source JE</Btn> : <Btn size="sm" variant="ghost" disabled>No retained AR JE</Btn>}
      {invoice.localEvidence.paymentJournal ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:invoice.pay_je_number,arReturn:invoiceEvidenceReturn})}>Open receipt JE</Btn> : <Btn size="sm" variant="ghost" disabled>No retained receipt JE</Btn>}
      {invoice.localEvidence.exactBankCredits[0] ? <Btn size="sm" variant="ghost" onClick={()=>goto('banktx',{route:'banktx',acctCode:invoice.localEvidence.exactBankCredits[0].bank_account_code,bankTxnId:invoice.localEvidence.exactBankCredits[0].bank_txn_id,arReturn:invoiceEvidenceReturn})}>Open bank evidence</Btn> : <Btn size="sm" variant="ghost" disabled>No exact bank credit</Btn>}
      {invoice.voidEvidence.sourceReversals[0] ? <Btn size="sm" variant="ghost" onClick={()=>goto('je',{jeNumber:invoice.voidEvidence.sourceReversals[0].je_number,arReturn:invoiceEvidenceReturn})}>Open reversal JE</Btn> : null}
    </div>
    <p className="report-drill-hint">Bank status: {sourceStateTone(invoice.localEvidence.receiptState)}. This is retained local evidence only: it cannot send, collect, settle, refund, delete, or synchronize an invoice.</p>
    <p className="muted sm">Deposit and restricted-fund treatment remains a liability/availability review, not inferred rent revenue. Missing or cross-entity/property/project evidence, partial allocations, and void/reversal cases remain review items.</p>
  </div>;
}
