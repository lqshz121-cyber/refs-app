import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { ENTITIES } from './data.js';
import { money, sum } from './engine.js';

// ============ Auto Bank Reconciliation (WBS 4-step pipeline) ============
const STEPS = ['1 Company Screening','2 Data Processing & Release','3 Incur','4 Incurred List'];
const AB_SEED = ENTITIES.map((e,i)=>({entity_id:e.entity_id, company:e.entity_name, preparer:['HazelDong','Judy Zhang','Cathy Gao','Meyer Liu','Mia Man'][i%5], auditor:'auditor'+((i%3)+1),
  m:'07/2026', r:i<2?'07/2026':'06/2026', c:i<2?'06/2026':'03/2026', qty:[6,0,3,4,2][i%5], amount:[-198412.66,0,45210.00,12030.50,-820.00][i%5], released:i<2?[6,0][i]:0}));
export function AutoBankRec({ctx}) {
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState(AB_SEED);
  const [sel, setSel] = useState(null);
  const release = (id) => { setRows(rs=>rs.map(r=>r.entity_id===id?{...r, released:r.qty}:r)); ctx.toast('批次已 Release,进入 Incur 队列'); };
  const incur = (id) => { setRows(rs=>rs.map(r=>r.entity_id===id?{...r, r:'07/2026'}:r)); ctx.toast('已 Incur:生成银行流水 JE(见 Journal Entries)'); };
  return <div className="full-bleed">
    <h2 className="page-h">自动银行对账 Auto Bank Reconciliation</h2>
    <div className="stepper">{STEPS.map((s,i)=><button key={s} className={`step-chip ${step===i?'step-on':''} ${i<step?'step-done':''}`} onClick={()=>setStep(i)}>{s}</button>)}</div>
    {step===0 && <><SectionTitle>Company List(制单/审核分派 · M/R/C 完成度)</SectionTitle>
      <Table exportName="abr-companies" rowKey="entity_id" onRow={r=>{setSel(r.entity_id); setStep(1);}} cols={[
        {h:'Seq',render:(r)=>rows.indexOf(r)+1},
        {h:'Company',k:'company'},
        {h:'制单 Preparer',k:'preparer'},{h:'审核 Auditor',k:'auditor'},
        {h:'M (Monthly)',k:'m'},{h:'R (Recon)',render:r=><span className={r.r==='07/2026'?'':'muted'}>{r.r}</span>,csv:r=>r.r},{h:'C (Closing)',k:'c'},
        {h:'Quantity',num:true,k:'qty'},
        {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
        {h:'Released',num:true,k:'released'},
      ]} rows={rows}/></>}
    {step===1 && <><SectionTitle>Data Processing & Release(校验后放行)</SectionTitle>
      <Table rowKey="entity_id" cols={[
        {h:'Company',k:'company'},{h:'待处理笔数',num:true,k:'qty'},{h:'金额',num:true,render:r=><Money v={r.amount}/>},
        {h:'校验',render:r=> r.qty>0 ? <Badge tone="ok">去重 ✓ 实体匹配 ✓ 期间 ✓</Badge> : <Badge tone="muted">无数据</Badge>},
        {h:'操作',render:r=> r.qty>0 && r.released<r.qty ? <Btn size="sm" variant="primary" onClick={()=>release(r.entity_id)}>Release {r.qty} 笔</Btn> : <span className="muted sm">{r.qty?'已 Release':'—'}</span>},
      ]} rows={rows}/></>}
    {step===2 && <><SectionTitle>Incur(按映射规则生成分录)</SectionTitle>
      <Table rowKey="entity_id" cols={[
        {h:'Company',k:'company'},{h:'已 Release',num:true,k:'released'},
        {h:'规则',render:r=>'BANK→GL 映射 · Journal No 自动编号'},
        {h:'操作',render:r=> r.released>0 && r.r!=='07/2026' ? <Btn size="sm" variant="primary" onClick={()=>incur(r.entity_id)}>Incur → 生成 JE</Btn> : <span className="muted sm">{r.released?'本期已 Incur':'—'}</span>},
      ]} rows={rows}/></>}
    {step===3 && <><SectionTitle>Incurred List(已生成分录清单)</SectionTitle>
      <Table exportName="abr-incurred" cols={[
        {h:'Journal No.',k:'jn'},{h:'Posting Date',k:'pd'},{h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Payee',k:'payee'},{h:'Account',k:'acct'},{h:'金额',num:true,render:r=><Money v={r.amt}/>,csv:r=>r.amt},{h:'状态',render:r=><Badge>POSTED</Badge>},
      ]} rows={[
        {jn:'20260731000041', pd:'07/31/2026', src:'BANK', payee:'Pacific Bank', acct:'1000 Cash', amt:46000},
        {jn:'20260731000042', pd:'07/31/2026', src:'BANK', payee:'First National Bank', acct:'2500 Construction Loan', amt:500000},
        {jn:'20260731000043', pd:'07/31/2026', src:'BANK', payee:'Pacific Bank', acct:'6070 Bank Fee', amt:-85},
      ]}/></>}
    <p className="muted sm">复刻 WBS Auto Bank Reconciliation 四步流水线;人工对账见 Bank Rec 模块。</p>
  </div>;
}

// ============ Payment Confirmation / Check Management (WBS) ============
export function CheckMgmt({ctx}) {
  const [tab, setTab] = useState('Check Register');
  const [checks, setChecks] = useState([
    {no:'CHK-1086', date:'07/12/2026', payee:'Summit General Contractors', amount:42000, status:'CLEARED', bank:'BA-001'},
    {no:'CHK-1087', date:'07/20/2026', payee:'BluePeak Utilities', amount:3200, status:'CLEARED', bank:'BA-003'},
    {no:'CHK-1088', date:'07/29/2026', payee:'WanBridge Property Mgmt', amount:2400, status:'OUTSTANDING', bank:'BA-003'},
    {no:'CHK-1089', date:'07/30/2026', payee:'Apex Title LLC', amount:1500, status:'PENDING', bank:'BA-001'},
  ]);
  const voidChk = (no) => { setChecks(cs=>cs.map(c=>c.no===no?{...c, status:'VOID'}:c)); ctx.toast(`支票 ${no} 已作废,自动生成冲销分录`,'warn'); };
  const printChk = (no) => ctx.toast(`支票 ${no} 已发送打印队列`);
  return <div>
    <h2 className="page-h">付款确认 Payment Confirmation</h2>
    <div className="kpi-row">
      <KPI label="Outstanding Checks" value={checks.filter(c=>c.status==='OUTSTANDING').length} sub={money(sum(checks.filter(c=>c.status==='OUTSTANDING'),c=>c.amount))} tone="warn"/>
      <KPI label="Pending Print" value={checks.filter(c=>c.status==='PENDING').length}/>
      <KPI label="Cleared 本期" value={checks.filter(c=>c.status==='CLEARED').length} tone="ok"/>
      <KPI label="Void" value={checks.filter(c=>c.status==='VOID').length}/>
    </div>
    <Tabs tabs={['Check Register','Pending Payment']} active={tab} onChange={setTab}/>
    {tab==='Check Register' && <Table exportName="check-register" rowKey="no" cols={[
      {h:'Check No',k:'no'},{h:'日期',k:'date'},{h:'Payee',k:'payee'},{h:'银行账户',k:'bank'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
      {h:'状态',render:r=><Badge tone={r.status==='CLEARED'?'ok':r.status==='VOID'?'bad':'warn'}>{r.status}</Badge>,csv:r=>r.status},
      {h:'操作',render:r=><span className="row-acts">
        {r.status==='PENDING' && <Btn size="sm" onClick={()=>printChk(r.no)}>Print</Btn>}
        {['PENDING','OUTSTANDING'].includes(r.status) && <Btn size="sm" variant="danger" onClick={()=>voidChk(r.no)}>Void</Btn>}
      </span>},
    ]} rows={checks}/>}
    {tab==='Pending Payment' && <Table cols={[
      {h:'来源',render:r=><Badge tone="muted">AP</Badge>},{h:'Bill',k:'b'},{h:'Payee',k:'p'},{h:'金额',num:true,render:r=><Money v={r.a}/>},
      {h:'方式',k:'m'},{h:'状态',render:()=><Badge tone="warn">PENDING</Badge>},
    ]} rows={[{b:'BILL-2026-9002',p:'Summit General Contractors',a:185000,m:'ACH'}]} empty="无待付款"/>}
    <p className="muted sm">Void 生成红字分录并回写银行对账;支票号连续性校验;Print 走支票打印模板。</p>
  </div>;
}
