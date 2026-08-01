import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Drawer, Field, SectionTitle, Tabs, ApprovalTimeline } from './ui.jsx';
import { VENDORS, PROPERTIES, PROJECTS, COA } from './data.js';
import { acct, money, sum } from './engine.js';

// AP closed loop: Bill(lines) -> duplicate check -> approval -> JE(Dr Exp/CIP, Cr AP) -> Payment run -> JE(Dr AP, Cr Cash) -> aging
export function APWorkspace({ctx}) {
  const {ap, actions, toast, can, user} = ctx;             // ap: {bills:[...]}
  const [tab, setTab] = useState('Bills');
  const [showNew, setShowNew] = useState(false);
  const [sel, setSel] = useState(null);
  const bills = ap.bills;
  const open = bills.filter(b=>!['PAID','VOID'].includes(b.status));
  const bill = bills.find(b=>b.bill_id===sel);

  const kpis = <div className="kpi-row">
    <KPI label="未付 Bills" value={open.length} sub={money(sum(open,b=>b.amount))} tone={open.length?'warn':'ok'} />
    <KPI label="待审批" value={bills.filter(b=>b.status==='PENDING_APPROVAL').length} />
    <KPI label="已付(本期)" value={bills.filter(b=>b.status==='PAID').length} sub={money(sum(bills.filter(b=>b.status==='PAID'),b=>b.amount))} tone="ok" />
    <KPI label="重复拦截" value={ap.dupBlocked||0} tone={ap.dupBlocked?'bad':'ok'} />
  </div>;

  return <div>
    <h2 className="page-h">应付管理 Accounts Payable</h2>
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
    {tab==='账龄 Aging' && <Aging bills={open} />}
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
  const [f, setF] = useState({vendor_id:'', invoice_no:'', bill_date:'2026-07-31', due_date:'2026-08-30', account_code:'612900', property_id:'', amount:''});
  const set=(k,v)=>setF(s=>({...s,[k]:v}));
  const submit = () => {
    if(!f.vendor_id||!f.invoice_no||!f.amount||+f.amount<=0){ toast('供应商/发票号/金额必填','bad'); return; }
    const r = actions.addBill({...f, vendor_id:+f.vendor_id, amount:+f.amount, property_id:f.property_id?+f.property_id:null});
    if (r.dup) { toast(`重复发票拦截 [4004]：${r.dup} 已存在同供应商+同发票号`,'bad'); return; }
    toast('Bill 已创建并提交审批'); onClose();
  };
  return <Drawer open={open} onClose={onClose} title="录入 Bill" width={520}
    actions={<><Btn onClick={onClose}>取消</Btn><Btn variant="primary" onClick={submit}>创建 Bill</Btn></>}>
    <Field label="供应商" required><select value={f.vendor_id} onChange={e=>set('vendor_id',e.target.value)}>
      <option value="">— 选择 —</option>{VENDORS.map(v=><option key={v.vendor_id} value={v.vendor_id}>{v.vendor_name}{v.is_related_party?' (RP)':''}</option>)}</select></Field>
    <Field label="发票号 Invoice #" required hint="同供应商+同发票号将被重复拦截"><input value={f.invoice_no} onChange={e=>set('invoice_no',e.target.value)}/></Field>
    <div className="two-col">
      <Field label="Bill 日期"><input type="date" value={f.bill_date} onChange={e=>set('bill_date',e.target.value)}/></Field>
      <Field label="到期日"><input type="date" value={f.due_date} onChange={e=>set('due_date',e.target.value)}/></Field>
    </div>
    <Field label="费用科目"><select value={f.account_code} onChange={e=>set('account_code',e.target.value)}>
      {COA.filter(a=>['EXPENSE','ASSET'].includes(a.account_type)).map(a=><option key={a.account_code} value={a.account_code}>{a.account_code} {a.account_name}</option>)}</select></Field>
    <Field label="物业 (维度)"><select value={f.property_id} onChange={e=>set('property_id',e.target.value)}>
      <option value="">—</option>{PROPERTIES.map(p=><option key={p.property_id} value={p.property_id}>{p.property_code} {p.property_name}</option>)}</select></Field>
    <Field label="金额" required><input type="number" value={f.amount} onChange={e=>set('amount',e.target.value)}/></Field>
  </Drawer>;
}

function BillDetail({bill, onClose, ctx}) {
  const {actions, toast, can, user} = ctx;
  if (!bill) return null;
  const steps = [
    {label:'创建 Maker', done:true, who:bill.created_by},
    {label:'审批 Approver', done:['APPROVED','PAID'].includes(bill.status), who:bill.approved_by},
    {label:'入账 Dr 费用 / Cr AP', done:!!bill.je_number, who:bill.je_number},
    {label:'付款 Dr AP / Cr Cash', done:bill.status==='PAID', who:bill.pay_je_number},
  ];
  const approve = () => {
    if (bill.created_by===user.user_id && user.role_code!=='CONTROLLER'){ toast('SoD 拦截 [4009]：创建人不可审批本单','bad'); return; }
    actions.approveBill(bill.bill_id); toast('已审批并生成 AP 分录');
  };
  return <Drawer open onClose={onClose} title={bill.bill_no+' · '+bill.vendor_name} width={520}
    actions={bill.status==='PENDING_APPROVAL' && can('AP.INVOICE.APPROVE') ? <Btn variant="primary" onClick={approve}>审批 + 生成分录</Btn> : null}>
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
  const selIds = Object.keys(checked).filter(k=>checked[k]).map(Number);
  const total = sum(ap.bills.filter(b=>selIds.includes(b.bill_id)), b=>b.amount);
  const run = () => {
    if (!selIds.length){ toast('先勾选要付款的 Bill','warn'); return; }
    actions.payBills(selIds); toast(`付款批次完成：${selIds.length} 张，${money(total)}（Dr AP / Cr Cash）`);
    setChecked({});
  };
  return <div>
    <Table rowKey="bill_id" cols={[
      {h:'',w:36,render:r=><input type="checkbox" checked={!!checked[r.bill_id]} onClick={e=>e.stopPropagation()} onChange={e=>setChecked(c=>({...c,[r.bill_id]:e.target.checked}))}/>},
      {h:'Bill #',k:'bill_no'},{h:'供应商',render:r=>r.vendor_name},{h:'到期',k:'due_date'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount},
    ]} rows={payable} empty="无已审批待付 Bill" />
    <div style={{marginTop:12,display:'flex',alignItems:'center',gap:14}}>
      <Btn variant="primary" onClick={run} disabled={!can('AP.PAYMENT.CREATE')||!selIds.length}>执行付款批次 ({selIds.length} 张 · {money(total)})</Btn>
      <span className="muted sm">生成 Dr 2000 AP / Cr 1000 Cash 分录并回写银行流水</span>
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
