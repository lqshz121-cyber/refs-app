import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Drawer, Field, SectionTitle, Tabs, ApprovalTimeline } from './ui.jsx';
import { VENDORS, PROPERTIES, PROJECTS, COA } from './data.js';
import { acct, money, sum } from './engine.js';

// AP closed loop: Bill(lines) -> duplicate check -> approval -> JE(Dr Exp/CIP, Cr AP) -> Payment run -> JE(Dr AP, Cr Cash) -> aging
export const apAgingDocuments = bills => bills.filter(b=>['APPROVED','PAYMENT_PENDING'].includes(b.status));
const journalWorkflowAction=status=>({DRAFT:'SUBMIT',PENDING_REVIEW:'REVIEW',APPROVED:'POST'})[status]||null;
const journalWorkflowLabel=action=>({SUBMIT:'Submit for review',REVIEW:'Review',POST:'Post journal'})[action]||'';
export function APWorkspace({ctx}) {
  const {ap, actions, toast, can, user, authoritativeMode, apiStatus} = ctx;             // ap: {bills:[...]}
  const [tab, setTab] = useState('Bills');
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState(null);
  const bills = ap.bills;
  const open = bills.filter(b=>!['PAID','VOID'].includes(b.status));
  const aging = apAgingDocuments(bills);
  const bill = bills.find(b=>b.bill_id===sel);

  const kpis = <div className="kpi-row">
    <KPI label="未付 Bills" value={open.length} sub={money(sum(open,b=>b.amount))} tone={open.length?'warn':'ok'} />
    <KPI label="待审批" value={bills.filter(b=>b.status==='PENDING_APPROVAL').length} />
    <KPI label="已付(本期)" value={bills.filter(b=>b.status==='PAID').length} sub={money(sum(bills.filter(b=>b.status==='PAID'),b=>b.amount))} tone="ok" />
    <KPI label="重复拦截" value={ap.dupBlocked||0} tone={ap.dupBlocked?'bad':'ok'} />
  </div>;

  return <div>
    <h2 className="page-h">应付管理 Accounts Payable</h2>
    {authoritativeMode&&apiStatus!=='READY'&&<div className="empty">Authoritative AP data is unavailable ({apiStatus}); no browser-local Bills are shown.</div>}
    {kpis}
    <Tabs tabs={['Bills','付款 Payments','账龄 Aging','供应商 Vendors']} active={tab} onChange={setTab} />
    {tab==='Bills' && <>
      <div style={{marginBottom:12}}><Btn variant="primary" onClick={()=>setShowNew(true)} disabled={!can('AP.INVOICE.CREATE')}>+ 录入 Bill</Btn></div>
      <Table exportName="ap-bills" rowKey="bill_id" onRow={r=>setSel(r.bill_id)} cols={[
        {h:'Bill #',k:'bill_no'},
        {h:'供应商',render:r=>r.vendor_name, csv:r=>r.vendor_name},
        {h:'发票号',k:'invoice_no'},
        {h:'日期',k:'bill_date'},
        {h:'到期',k:'due_date'},
        {h:'金额',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
        {h:'状态',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status},
        {h:'JE',render:r=>r.je_number||'—'},
      ]} rows={bills} empty="暂无 Bill" />
    </>}
    {tab==='付款 Payments' && <PaymentRun ctx={ctx} />}
    {tab==='账龄 Aging' && <Aging bills={aging} />}
    {tab==='供应商 Vendors' && <Table exportName="vendors" rowKey="vendor_id" cols={[
      {h:'编码',k:'vendor_code'},{h:'名称',k:'vendor_name'},
      {h:'关联方',render:r=>r.is_related_party?<Badge tone="warn">RP</Badge>:'—',csv:r=>r.is_related_party?'RP':''},
      {h:'1099',render:r=>r.is_1099?'✓':'—'},{h:'W-9',render:r=>'✓'},
    ]} rows={VENDORS} />}
    <NewBill open={showNew} onClose={()=>setShowNew(false)} ctx={ctx} />
    <BillDetail bill={bill} onClose={()=>setSel(null)} ctx={ctx} />
  </div>;
}

function NewBill({open, onClose, ctx}) {
  const {actions, toast} = ctx;
  const emptyForm=()=>({client_request_id:`AP-BILL-${Date.now()}-${Math.random()}`,vendor_id:'', invoice_no:'', bill_date:'2026-07-31', due_date:'2026-08-30', property_id:''});
  const [f, setF] = useState(emptyForm);
  const [lines, setLines] = useState([{account_code:'612900', description:'', amount:'', cost_code:''}]);
  const set=(k,v)=>setF(s=>({...s,[k]:v}));
  const setL=(i,k,v)=>setLines(ls=>ls.map((l,x)=>x===i?{...l,[k]:v}:l));
  const total = lines.reduce((s,l)=>s+(+l.amount||0),0);
  const submit = async () => {
    if(!f.vendor_id||!f.invoice_no||total<=0){ toast('供应商/发票号/行金额必填','bad'); return; }
    if(lines.some(l=>!l.account_code)){ toast('每行必须选科目','bad'); return; }
    const r = await actions.addBill({...f, vendor_id:+f.vendor_id, amount:total, account_code:lines[0].account_code,
      property_id:f.property_id?+f.property_id:null, lines: lines.map(l=>({...l, amount:+l.amount||0}))});
    if (r.dup) { toast(`重复发票拦截 [4004]：${r.dup} 已存在同供应商+同发票号`,'bad'); return; }
    if (!r.ok) { toast(r.message||'Bill 创建被拦截','bad'); return; }
    toast(`Bill 已创建(${lines.length} 行,合计 $${total.toLocaleString()})并提交审批`); onClose();
    setF(emptyForm());
    setLines([{account_code:'612900', description:'', amount:'', cost_code:''}]);
  };
  return <Drawer open={open} onClose={onClose} title="录入 Bill · Category Details" width={640}
    actions={<><Btn onClick={onClose}>取消</Btn><Btn variant="primary" onClick={submit}>创建 Bill (${total.toLocaleString()})</Btn></>}>
    <div className="two-col">
      <Field label="供应商" required><select value={f.vendor_id} onChange={e=>set('vendor_id',e.target.value)}>
        <option value="">— 选择 —</option>{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}{v.is_related_party?' (RP)':''}</option>)}</select></Field>
      <Field label="发票号 Invoice #" required><input value={f.invoice_no} onChange={e=>set('invoice_no',e.target.value)}/></Field>
    </div>
    <div className="two-col">
      <Field label="Bill 日期"><input type="date" value={f.bill_date} onChange={e=>set('bill_date',e.target.value)}/></Field>
      <Field label="到期日"><input type="date" value={f.due_date} onChange={e=>set('due_date',e.target.value)}/></Field>
    </div>
    <SectionTitle right={<Btn size="sm" onClick={()=>setLines(ls=>[...ls,{account_code:'',description:'',amount:'',cost_code:''}])}>+ 加行</Btn>}>Category Details({lines.length} 行)</SectionTitle>
    <table className="tbl tbl-dense"><thead><tr><th>#</th><th>Category / 科目</th><th>Description</th><th>Cost Code</th><th className="ta-r">Amount</th><th></th></tr></thead>
      <tbody>{lines.map((l,i)=><tr key={i}>
        <td className="muted">{i+1}</td>
        <td><select value={l.account_code} onChange={e=>setL(i,'account_code',e.target.value)} style={{maxWidth:210}}>
          <option value="">选择科目</option>{COA.filter(a=>['EXPENSE','ASSET'].includes(a.account_type)).map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}</select></td>
        <td><input className="desc-line" value={l.description} onChange={e=>setL(i,'description',e.target.value)}/></td>
        <td><input className="date-in" style={{width:80}} placeholder="2HD…" value={l.cost_code} onChange={e=>setL(i,'cost_code',e.target.value)}/></td>
        <td className="ta-r"><input className="num-in" type="number" value={l.amount} onChange={e=>setL(i,'amount',e.target.value)}/></td>
        <td>{lines.length>1&&<button className="x-sm" onClick={()=>setLines(ls=>ls.filter((_,x)=>x!==i))}>×</button>}</td>
      </tr>)}</tbody>
      <tfoot><tr><td colSpan={4}>Total</td><td className="ta-r"><b>${total.toLocaleString()}</b></td><td/></tr></tfoot>
    </table>
    <p className="muted sm">审批后逐行 Dr(科目+Cost Code) / Cr 291001_Payee 一笔挂账;Cost Code 影响 CWIP/费用判定。</p>
  </Drawer>;
}

function BillDetail({bill, onClose, ctx}) {
  const {actions, toast, can, user} = ctx;
  if (!bill) return null;
  const steps = [
    {label:'创建 Maker', done:true, who:bill.created_by},
    {label:'审批并创建 Draft JE', done:['APPROVED_PENDING_POST','APPROVED','PAYMENT_PENDING','PAID'].includes(bill.status), who:bill.approved_by},
    {label:'AP JE Posted · Dr 费用 / Cr AP', done:['APPROVED','PAYMENT_PENDING','PAID'].includes(bill.status), who:bill.je_number},
    {label:'付款 Dr AP / Cr Cash', done:bill.status==='PAID', who:bill.pay_je_number},
  ];
  const workflowAction=journalWorkflowAction(bill.journal_status);
  const approve = async () => {
    const result=workflowAction&&bill.journal_entry_id?await actions.transitionDocumentJournal(bill.journal_entry_id,bill.journal_revision,workflowAction):actions.approveBill(bill.bill_id);
    toast(result?.ok?'审批完成：Draft JE 已进入复核队列':result?.message||'Bill 审批被拦截',result?.ok?'ok':'bad');
  };
  return <Drawer open onClose={onClose} title={bill.bill_no+' · '+bill.vendor_name} width={520}
    actions={workflowAction&&bill.journal_entry_id ? <Btn variant="primary" onClick={approve}>{journalWorkflowLabel(workflowAction)}</Btn> : bill.status==='PENDING_APPROVAL' && can('AP.INVOICE.APPROVE') ? <Btn variant="primary" onClick={approve}>审批 + 生成分录</Btn> : null}>
    <div className="kv"><span>发票号</span><b>{bill.invoice_no}</b></div>
    <div className="kv"><span>金额</span><Money v={bill.amount} bold/></div>
    <div className="kv"><span>科目</span><b>{bill.account_code} {acct(bill.account_code).account_name}</b></div>
    <div className="kv"><span>状态</span><Badge>{bill.status}</Badge></div>
    <SectionTitle>处理链路</SectionTitle>
    <ApprovalTimeline steps={steps} />
  </Drawer>;
}

function PaymentRun({ctx}) {
  const {ap, actions, toast, can} = ctx;
  const payable = ap.bills.filter(b=>b.status==='APPROVED');
  const [checked, setChecked] = useState({});
  const [bankMember,setBankMember] = useState('Operating Cash_BA-003');
  const [paymentDate,setPaymentDate] = useState('2026-07-31');
  const selIds = Object.keys(checked).filter(k=>checked[k]).map(k=>{const numeric=Number(k);return Number.isSafeInteger(numeric)&&String(numeric)===k?numeric:k;});
  const total = sum(ap.bills.filter(b=>selIds.includes(b.bill_id)), b=>b.amount);
  const run = async () => {
    if (!selIds.length){ toast('先勾选要付款的 Bill','warn'); return; }
    const result=await actions.payBills(selIds,bankMember,paymentDate);toast(`${result.created||0} 张付款 Draft 已生成 · ${result.blocked||0} 张被拦截`,result.blocked?'warn':'ok');
    setChecked({});
  };
  return <div>
    <Table rowKey="bill_id" cols={[
      {h:'',w:36,render:r=><input type="checkbox" checked={!!checked[r.bill_id]} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(c=>({...c,[r.bill_id]:e.target.checked}))}/>},
      {h:'Bill #',k:'bill_no'},{h:'供应商',render:r=>r.vendor_name},{h:'到期',k:'due_date'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},
    ]} rows={payable} empty="无已审批待付 Bill" />
    <div style={{marginTop:12,display:'flex',alignItems:'center',gap:14}}>
      <select value={bankMember} onChange={e=>setBankMember(e.target.value)} aria-label="Payment bank account">
        <option value="Operating Cash_BA-003">Operating Cash · BA-003</option>
        <option value="Operating Cash_BA-001">Operating Cash · BA-001</option>
      </select>
      <input type="date" value={paymentDate} onChange={e=>setPaymentDate(e.target.value)} aria-label="Payment date" />
      <Btn variant="primary" onClick={run} disabled={!can('AP.PAYMENT.CREATE')||!selIds.length}>执行付款批次 ({selIds.length} 张 · {money(total)})</Btn>
      <span className="muted sm">仅生成 Dr 291001 / Cr 111000 Draft；完成复核、审批和 Post 后才标记 Paid</span>
    </div>
  </div>;
}

function Aging({bills}) {
  const today = new Date('2026-07-31');
  const bucket = (b) => { const d=Math.floor((today-new Date(b.due_date))/86400000); return d<=0?'未到期':d<=30?'1-30':d<=60?'31-60':'60+'; };
  const groups = ['未到期','1-30','31-60','60+'].map(g=>({g, items:bills.filter(b=>bucket(b)===g)}));
  return <div className="kpi-row">
    {groups.map(({g,items})=><KPI key={g} label={g+' 天'} value={money(sum(items,b=>b.amount))} sub={items.length+' 张'} tone={g==='60+'&&items.length?'bad':undefined}/>)}
  </div>;
}
