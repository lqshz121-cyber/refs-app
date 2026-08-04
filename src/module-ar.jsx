import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, Drawer, Field } from './ui.jsx';
import { CUSTOMERS, PROPERTIES } from './data.js';
import { money, sum } from './engine.js';
import { nextAuthoritativeWorkflowAction } from './authoritative-workflow.js';

// Real AR: Invoices -> Receive Payment -> Aging (mirrors AP loop)
export const arAgingDocuments = invoices => invoices.filter(i=>['OPEN','PAYMENT_PENDING'].includes(i.status));
const journalWorkflowAction=nextAuthoritativeWorkflowAction;
export function ARWorkspace({ctx}) {
  const {ar, actions, toast, can, authoritativeMode, apiStatus} = ctx;
  const [tab, setTab] = useState('Invoices');
  const [showNew, setShowNew] = useState(false);
  const [showCredit, setShowCredit] = useState(false);
  const [refundCredit, setRefundCredit] = useState(null);
  const [applyCredit, setApplyCredit] = useState(null);
  const [bankMember,setBankMember] = useState('Operating Cash_BA-003');
  const [receiptDate,setReceiptDate] = useState('2026-07-31');
  const emptyInvoice=()=>({client_request_id:`ARFORM-${Date.now()}-${Math.random()}`,customer_id:'',memo:'',inv_date:'2026-07-31',due_date:'2026-08-30',amount:''});
  const [f, setF] = useState(emptyInvoice);
  const open = arAgingDocuments(ar.invoices);
  const submit = async () => {
    if(!f.customer_id||!f.amount||+f.amount<=0){toast('客户/金额必填','bad');return;}
    const result=await actions.addInvoice({...f, customer_id:+f.customer_id, amount:+f.amount});
    if(!result?.ok){toast(result?.message||'Invoice 创建被拦截','bad');return;}
    toast('Invoice 已保存，Draft JE 已进入复核队列');setShowNew(false);setF(emptyInvoice());
  };
  const bucket=i=>{const d=Math.floor((new Date('2026-07-31')-new Date(i.due_date))/86400000); return d<=0?'Current':d<=30?'1-30':d<=60?'31-60':'60+';};
  return <div>
    <h2 className="page-h">Sales & Receivables</h2>
    {authoritativeMode&&apiStatus!=='READY'&&<div className="empty">Authoritative AR data is unavailable ({apiStatus}); no browser-local Invoices are shown.</div>}
    <div className="kpi-row">
      <KPI label="Open Invoices" value={open.length} sub={money(sum(open,i=>i.amount))} tone={open.length?'warn':'ok'}/>
      <KPI label="Paid 本期" value={ar.invoices.filter(i=>i.status==='PAID').length} tone="ok"/>
      <KPI label="逾期 60+" value={money(sum(open.filter(i=>bucket(i)==='60+'),i=>i.amount))} tone="bad"/>
      <KPI label="Customers" value={CUSTOMERS.length}/>
    </div>
    <Tabs tabs={['Invoices','Credits & Refunds','AR Aging','Customers']} active={tab} onChange={setTab}/>
    {tab==='Invoices' && <>
      <div style={{marginBottom:12,display:'flex',gap:10,alignItems:'center'}}><Btn variant="primary" onClick={()=>setShowNew(true)} disabled={!can('AR.INVOICE.CREATE')}>+ Create Invoice</Btn><select value={bankMember} onChange={e=>setBankMember(e.target.value)} aria-label="Receipt bank account"><option value="Operating Cash_BA-003">Deposit to BA-003</option><option value="Operating Cash_BA-001">Deposit to BA-001</option></select><input type="date" value={receiptDate} onChange={e=>setReceiptDate(e.target.value)} aria-label="Receipt date" /></div>
      <Table exportName="ar-invoices" rowKey="inv_id" cols={[
        {h:'Invoice #',k:'inv_no'},{h:'Customer',k:'customer_name'},{h:'Date',k:'inv_date'},{h:'Due',k:'due_date'},
        {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
        {h:'Status',render:r=><Badge tone={r.status==='PAID'?'ok':'warn'}>{r.status}</Badge>,csv:r=>r.status},
        {h:'JE',k:'je_number'},
        {h:'Action',render:r=>journalWorkflowAction(r.journal_status)&&r.journal_entry_id?<Btn size="sm" variant="primary" onClick={async()=>{const result=await actions.transitionDocumentJournal(r.journal_entry_id,r.journal_revision,journalWorkflowAction(r.journal_status));toast(result?.ok?`${journalWorkflowAction(r.journal_status)} accepted.`:result?.message||'Workflow blocked',result?.ok?'ok':'bad');}}>{journalWorkflowAction(r.journal_status)}</Btn>:r.status==='OPEN'?<Btn size="sm" variant="primary" disabled={!can('AR.PAYMENT.CREATE')} onClick={async()=>{const result=await actions.receivePayment(r.inv_id,bankMember,receiptDate);toast(result?.ok?'Receipt Draft 已生成，Post 后才标记 Paid':result?.message||'收款被拦截',result?.ok?'ok':'bad');}}>Receive Payment</Btn>:<span className="muted sm">{r.pay_je_number||r.status}</span>},
      ]} rows={ar.invoices} empty="暂无 Invoice"/>
    </>}
    {tab==='AR Aging' && <div className="kpi-row">{['Current','1-30','31-60','60+'].map(g=>{const items=open.filter(i=>bucket(i)===g);
      return <KPI key={g} label={g} value={money(sum(items,i=>i.amount))} sub={items.length+' 张'} tone={g==='60+'&&items.length?'bad':undefined}/>;})}</div>}
    {tab==='Credits & Refunds' && <><div style={{marginBottom:12}}><Btn variant="primary" onClick={()=>setShowCredit(true)} disabled={!authoritativeMode||apiStatus!=='READY'||!can('AR.CREDIT_MEMO.CREATE')}>+ Create Credit Memo</Btn></div><Table exportName="ar-adjustments" rowKey="business_adjustment_id" cols={[
      {h:'Adjustment #',k:'business_adjustment_id'},{h:'Type',k:'adjustment_kind'},{h:'Date',k:'accounting_date'},
      {h:'Amount',num:true,render:r=><Money v={Number(r.amount)}/>,sortVal:r=>Number(r.amount)},{h:'Status',render:r=><Badge>{r.status}</Badge>},
      {h:'Journal',k:'journal_entry_id'},
      {h:'Action',render:r=>journalWorkflowAction(r.journal_status)&&r.journal_entry_id?<Btn size="sm" variant="primary" onClick={async()=>{const action=journalWorkflowAction(r.journal_status);const result=await actions.transitionDocumentJournal(r.journal_entry_id,r.journal_revision,action);toast(result?.ok?`${action} accepted.`:result?.message||'Workflow blocked',result?.ok?'ok':'bad');}}>{journalWorkflowAction(r.journal_status)}</Btn>:r.adjustment_kind==='AR_CREDIT_MEMO'&&r.status==='POSTED'?<span style={{display:'inline-flex',gap:6}}><Btn size="sm" disabled={!authoritativeMode||apiStatus!=='READY'||!can('AR.CREDIT_MEMO.APPLY')} onClick={()=>setApplyCredit(r)}>Apply</Btn><Btn size="sm" disabled={!authoritativeMode||apiStatus!=='READY'||!can('AR.REFUND.CREATE')} onClick={()=>setRefundCredit(r)}>Refund</Btn></span>:<span className="muted sm">{r.journal_status||r.status}</span>}
    ]} rows={ar.adjustments||[]} empty="No authoritative AR credits or refunds available." /></>}
    {tab==='Customers' && <Table rowKey="customer_id" cols={[
      {h:'Customer',k:'customer_name'},{h:'Type',render:r=><Badge tone="muted">{r.customer_type}</Badge>},
      {h:'Related Party',render:r=>r.is_related_party?<Badge tone="warn">RP</Badge>:'—'},
      {h:'Open Balance',num:true,render:r=><Money v={sum(open.filter(i=>i.customer_id===r.customer_id),i=>i.amount)}/>},
    ]} rows={CUSTOMERS}/>}
    <Drawer open={showNew} onClose={()=>setShowNew(false)} title="Create Invoice" width={520}
      actions={<><Btn onClick={()=>setShowNew(false)}>Cancel</Btn><Btn variant="primary" onClick={submit}>Save Invoice</Btn></>}>
      <Field label="Customer" required><select value={f.customer_id} onChange={e=>setF(s=>({...s,customer_id:e.target.value}))}>
        <option value="">— Select —</option>{CUSTOMERS.map(c=><option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}</select></Field>
      <div className="two-col">
        <Field label="Invoice Date"><input type="date" value={f.inv_date} onChange={e=>setF(s=>({...s,inv_date:e.target.value}))}/></Field>
        <Field label="Due Date"><input type="date" value={f.due_date} onChange={e=>setF(s=>({...s,due_date:e.target.value}))}/></Field>
      </div>
      <Field label="Memo"><input value={f.memo} onChange={e=>setF(s=>({...s,memo:e.target.value}))} placeholder="Rent billing / service..."/></Field>
      <Field label="Amount" required><input type="number" value={f.amount} onChange={e=>setF(s=>({...s,amount:e.target.value}))}/></Field>
    </Drawer>
    <CreditMemo open={showCredit} onClose={()=>setShowCredit(false)} ctx={ctx}/>
    <ApplyCredit open={!!applyCredit} credit={applyCredit} invoices={open} onClose={()=>setApplyCredit(null)} ctx={ctx}/>
    <RefundCredit open={!!refundCredit} credit={refundCredit} onClose={()=>setRefundCredit(null)} ctx={ctx}/>
  </div>;
}

function CreditMemo({open,onClose,ctx}){
  const {actions,toast}=ctx;
  const empty=()=>({client_request_id:`AR-CREDIT-${Date.now()}-${Math.random()}`,customer_id:'',memo_number:'',memo_date:'2026-07-31',amount:'',account_code:'411100',reason:''});
  const [f,setF]=useState(empty);const set=(key,value)=>setF(old=>({...old,[key]:value}));
  const submit=async()=>{if(!f.customer_id||!f.memo_number||!f.reason||!(+f.amount>0)){toast('Customer, memo number, amount and reason are required.','bad');return;}const result=await actions.createArCreditMemo({...f,customer_id:+f.customer_id,amount:+f.amount});if(!result?.ok){toast(result?.message||'Credit memo was rejected.','bad');return;}toast('Credit memo Draft was persisted. Advance its linked JE through the authoritative workflow.','ok');setF(empty());onClose();};
  return <Drawer open={open} onClose={onClose} title="Create Credit Memo" width={520} actions={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit}>Create Draft</Btn></>}>
    <Field label="Customer" required><select value={f.customer_id} onChange={e=>set('customer_id',e.target.value)}><option value="">— Select —</option>{CUSTOMERS.map(c=><option key={c.customer_id} value={c.customer_id}>{c.customer_name}</option>)}</select></Field>
    <div className="two-col"><Field label="Memo #" required><input value={f.memo_number} onChange={e=>set('memo_number',e.target.value)}/></Field><Field label="Memo Date"><input type="date" value={f.memo_date} onChange={e=>set('memo_date',e.target.value)}/></Field></div>
    <div className="two-col"><Field label="Offset Account"><input value={f.account_code} onChange={e=>set('account_code',e.target.value)}/></Field><Field label="Amount" required><input type="number" min="0.0001" value={f.amount} onChange={e=>set('amount',e.target.value)}/></Field></div>
    <Field label="Reason" required><input value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>
    <p className="muted sm">This creates only a server-side Draft adjustment and linked Draft JE; it does not allocate, approve, or post.</p>
  </Drawer>;
}

function RefundCredit({open,credit,onClose,ctx}){
  const {actions,toast}=ctx;
  const empty=()=>({client_request_id:`AR-REFUND-${Date.now()}-${Math.random()}`,refund_number:'',refund_date:'2026-07-31',amount:'',reason:''});
  const [f,setF]=useState(empty);const set=(key,value)=>setF(old=>({...old,[key]:value}));
  const submit=async()=>{if(!credit?.business_adjustment_id||!f.refund_number||!f.reason||!(+f.amount>0)){toast('Refund number, amount and reason are required.','bad');return;}const result=await actions.createArRefund({...f,source_adjustment_id:credit.business_adjustment_id,amount:+f.amount});if(!result?.ok){toast(result?.message||'Refund was rejected.','bad');return;}toast('Refund Draft was persisted. Advance its linked JE through the authoritative workflow.','ok');setF(empty());onClose();};
  return <Drawer open={open} onClose={onClose} title="Create Customer Refund" width={520} actions={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit}>Create Draft</Btn></>}>
    <p className="muted sm">Source credit: {credit?.business_adjustment_id||'—'}. The server enforces posted status and available balance.</p>
    <div className="two-col"><Field label="Refund #" required><input value={f.refund_number} onChange={e=>set('refund_number',e.target.value)}/></Field><Field label="Refund Date"><input type="date" value={f.refund_date} onChange={e=>set('refund_date',e.target.value)}/></Field></div>
    <Field label="Amount" required><input type="number" min="0.0001" value={f.amount} onChange={e=>set('amount',e.target.value)}/></Field>
    <Field label="Reason" required><input value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>
    <p className="muted sm">This creates only a server-side Draft refund and linked Draft JE; it does not post cash.</p>
  </Drawer>;
}

function ApplyCredit({open,credit,invoices,onClose,ctx}){
  const {actions,toast}=ctx;
  const empty=()=>({client_request_id:`AR-CREDIT-APPLY-${Date.now()}-${Math.random()}`,business_document_id:'',amount:'',reason:''});
  const [f,setF]=useState(empty);const set=(key,value)=>setF(old=>({...old,[key]:value}));
  const eligible=(invoices||[]).filter(invoice=>invoice.status==='OPEN');
  const submit=async()=>{if(!credit?.business_adjustment_id||!f.business_document_id||!f.reason||!(+f.amount>0)){toast('Invoice, amount and reason are required.','bad');return;}const result=await actions.applyArCreditMemo({...f,business_adjustment_id:credit.business_adjustment_id,amount:+f.amount});if(!result?.ok){toast(result?.message||'Credit allocation was rejected.','bad');return;}toast('Credit allocation was applied in the authoritative transaction and the Invoice was refreshed.','ok');setF(empty());onClose();};
  return <Drawer open={open} onClose={onClose} title="Apply Credit Memo" width={520} actions={<><Btn onClick={onClose}>Cancel</Btn><Btn variant="primary" onClick={submit}>Create Draft Allocation</Btn></>}>
    <p className="muted sm">Only an authoritative, posted Credit Memo may be applied. The server validates the customer, open invoice and available credit.</p>
    <Field label="Open Invoice" required><select value={f.business_document_id} onChange={e=>set('business_document_id',e.target.value)}><option value="">— Select —</option>{eligible.map(invoice=><option key={invoice.inv_id} value={invoice.inv_id}>{invoice.inv_no} · {invoice.customer_name} · {money(invoice.open_balance)}</option>)}</select></Field>
    <Field label="Amount" required><input type="number" min="0.0001" value={f.amount} onChange={e=>set('amount',e.target.value)}/></Field>
    <Field label="Reason" required><input value={f.reason} onChange={e=>set('reason',e.target.value)}/></Field>
  </Drawer>;
}
