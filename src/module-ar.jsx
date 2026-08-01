import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, Drawer, Field } from './ui.jsx';
import { CUSTOMERS, PROPERTIES } from './data.js';
import { money, sum } from './engine.js';

// Real AR: Invoices -> Receive Payment -> Aging (mirrors AP loop)
export const arAgingDocuments = invoices => invoices.filter(i=>['OPEN','PAYMENT_PENDING'].includes(i.status));
export function ARWorkspace({ctx}) {
  const {ar, actions, toast, can} = ctx;
  const [tab, setTab] = useState('Invoices');
  const [showNew, setShowNew] = useState(false);
  const [bankMember,setBankMember] = useState('Operating Cash_BA-003');
  const emptyInvoice=()=>({client_request_id:`ARFORM-${Date.now()}-${Math.random()}`,customer_id:'',memo:'',inv_date:'2026-07-31',due_date:'2026-08-30',amount:''});
  const [f, setF] = useState(emptyInvoice);
  const open = arAgingDocuments(ar.invoices);
  const submit = () => {
    if(!f.customer_id||!f.amount||+f.amount<=0){toast('客户/金额必填','bad');return;}
    const result=actions.addInvoice({...f, customer_id:+f.customer_id, amount:+f.amount});
    if(!result?.ok){toast(result?.message||'Invoice 创建被拦截','bad');return;}
    toast('Invoice 已保存，Draft JE 已进入复核队列');setShowNew(false);setF(emptyInvoice());
  };
  const bucket=i=>{const d=Math.floor((new Date('2026-07-31')-new Date(i.due_date))/86400000); return d<=0?'Current':d<=30?'1-30':d<=60?'31-60':'60+';};
  return <div>
    <h2 className="page-h">Sales & Receivables</h2>
    <div className="kpi-row">
      <KPI label="Open Invoices" value={open.length} sub={money(sum(open,i=>i.amount))} tone={open.length?'warn':'ok'}/>
      <KPI label="Paid 本期" value={ar.invoices.filter(i=>i.status==='PAID').length} tone="ok"/>
      <KPI label="逾期 60+" value={money(sum(open.filter(i=>bucket(i)==='60+'),i=>i.amount))} tone="bad"/>
      <KPI label="Customers" value={CUSTOMERS.length}/>
    </div>
    <Tabs tabs={['Invoices','AR Aging','Customers']} active={tab} onChange={setTab}/>
    {tab==='Invoices' && <>
      <div style={{marginBottom:12,display:'flex',gap:10,alignItems:'center'}}><Btn variant="primary" onClick={()=>setShowNew(true)} disabled={!can('AR.INVOICE.CREATE')}>+ Create Invoice</Btn><select value={bankMember} onChange={e=>setBankMember(e.target.value)} aria-label="Receipt bank account"><option value="Operating Cash_BA-003">Deposit to BA-003</option><option value="Operating Cash_BA-001">Deposit to BA-001</option></select></div>
      <Table exportName="ar-invoices" rowKey="inv_id" cols={[
        {h:'Invoice #',k:'inv_no'},{h:'Customer',k:'customer_name'},{h:'Date',k:'inv_date'},{h:'Due',k:'due_date'},
        {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
        {h:'Status',render:r=><Badge tone={r.status==='PAID'?'ok':'warn'}>{r.status}</Badge>,csv:r=>r.status},
        {h:'JE',k:'je_number'},
        {h:'Action',render:r=>r.status==='OPEN'?<Btn size="sm" variant="primary" disabled={!can('AR.PAYMENT.CREATE')} onClick={()=>{const result=actions.receivePayment(r.inv_id,bankMember);toast(result?.ok?'Receipt Draft 已生成，Post 后才标记 Paid':result?.message||'收款被拦截',result?.ok?'ok':'bad');}}>Receive Payment</Btn>:<span className="muted sm">{r.pay_je_number||r.status}</span>},
      ]} rows={ar.invoices} empty="暂无 Invoice"/>
    </>}
    {tab==='AR Aging' && <div className="kpi-row">{['Current','1-30','31-60','60+'].map(g=>{const items=open.filter(i=>bucket(i)===g);
      return <KPI key={g} label={g} value={money(sum(items,i=>i.amount))} sub={items.length+' 张'} tone={g==='60+'&&items.length?'bad':undefined}/>;})}</div>}
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
  </div>;
}
