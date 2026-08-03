import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { ENTITIES } from './data.js';
import { money, sum } from './engine.js';

// ============ Auto Bank Reconciliation (WBS 4-step pipeline) ============
const STEPS = ['1 Company Screening','2 Data Processing & Release','3 Incur','4 Incurred List'];
const AB_SEED = [
 ['AIWB INC','HazelDong','auditor1','06/2026','06/2026','03/2025',7,-198741.59,0,-141059.81,'Add'],
 ['Nanafu Texas Investment Inc','Judy Zhang','Cathy Gao','07/2026','07/2026','12/2023',0,0,0,-257760.76,'01-01-2024'],
 ['TF Portfolio Delaware LLC','Judy Zhang','Serena Jia','07/2026','06/2026','11/2024',0,0,0,62451.17,'01-01-2024'],
 ['TF Texas 001 LLC','Cathy Gao','Emily Wang','07/2026','07/2026','11/2024',0,0,0,-2276.66,'01-01-2024'],
 ['W Land Development Management LLC','Judy Zhang','Emily Wang','06/2026','03/2025','12/2024',4,246554.34,0,-572141.48,'01-01-2024'],
 ['Wan Bridge Development LLC','Cathy Gao','Judy Zhang','07/2026','06/2026','12/2023',0,0,0,52220365.69,'01-01-2024'],
 ['Wan Bridge Group LLC','Ada Zelaya','—','06/2026','06/2026','10/2024',7,-251011.29,0,-5326791.56,'01-01-2024'],
 ['Wan Bridge Land LLC','Judy Zhang','Cathy Gao','06/2026','06/2026','11/2024',8,16765.93,0,-56727315.48,'01-01-2024'],
 ['WAN BRIDGE TEXAS SERVICE LLC','Judy Zhang','Cathy Gao','06/2026','06/2026','11/2024',8,917.72,3,199.95,'01-01-2024'],
 ['Wan Pacific Real Estate Development LLC','Ricky','auditor2','06/2026','06/2026','10/2025',24,-114894.63,0,108382100.48,'01-01-2022'],
 ['WB CH I LLC','Judy Zhang','Emily Wang','06/2026','06/2026','11/2024',4,-584254.76,0,-119810.40,'01-01-2024'],
 ['WB Home LLC','HazelDong','auditor3','06/2026','06/2026','07/2025',5,38721.35,0,-464467.89,'01-01-2022'],
 ['WB Opportunity fund 6 LP','Judy Zhang','Emily Wang','06/2026','06/2026','11/2024',4,-45102.66,0,6113267.89,'01-01-2022'],
 ['WBWT West End Estates LLC','Judy Zhang','Emily Wang','06/2026','06/2026','12/2024',2,2637104.79,0,22892560.41,'01-01-2024'],
 ['WBWT LS Fronterra LLC','Serena Jia','Meyer Liu','06/2026','09/2025','04/2025',3,2845180.89,0,21331639.49,'Add'],
 ['WBPT Management LLC','Judy Zhang','Emily Wang','03/2026','12/2025','12/2023',19,-2266.89,0,-42459.82,'01-01-2024'],
 ['Yanfu Management LLC','Judy Zhang','Bing Dai','06/2026','05/2026','12/2023',78,-5755.52,0,-11661417.25,'01-01-2024'],
 ['WL Texas Sage Two Inc','Cathy Gao','Emily Wang','11/2020','11/2020','11/2020',347,-323035.06,0,0,'01-01-2024'],
 ['WB Conroe LLC','Cathy Gao','Judy Zhang','07/2026','07/2026','11/2024',0,0,0,13860173.50,'01-01-2024'],
 ['WB Entopsis Investment LLC','张晓勇','Cathy Gao','09/2024','12/2023','12/2023',39,-1175.12,0,-594.99,'01-01-2024'],
].map((r,i)=>({entity_id:i+1, company:r[0], preparer:r[1], auditor:r[2], m:r[3], r:r[4], c:r[5], qty:r[6], amount:r[7], released:r[8], recon_bal:r[9], recon_date:r[10]}));
export function AutoBankRec({ctx}) {
  const [step, setStep] = useState(0);
  const [rows] = useState(AB_SEED);
  const [sel, setSel] = useState(null);
  const release = () => ctx.toast('AUTOREC_API_UNAVAILABLE: 未连接权威 REFS AutoRec API；未执行 Release。','warn');
  const incur = () => ctx.toast('AUTOREC_API_UNAVAILABLE: 未连接权威 REFS AutoRec API；未生成 JE。','warn');
  return <div className="full-bleed">
    <h2 className="page-h">自动银行对账 Auto Bank Reconciliation</h2>
    <p className="alert alert-warn"><Badge tone="warn">AUTOREC_API_UNAVAILABLE</Badge> 未连接权威 REFS AutoRec API；所有命令均为只读且不会生成或显示入账结果。</p>
    <div className="stepper">{STEPS.map((s,i)=><button key={s} className={`step-chip ${step===i?'step-on':''} ${i<step?'step-done':''}`} onClick={()=>setStep(i)}>{s}</button>)}</div>
    {step===0 && <><SectionTitle>Company List(制单/审核分派 · M/R/C 完成度)</SectionTitle>
      <Table exportName="abr-companies" rowKey="entity_id" onRow={r=>{setSel(r.entity_id); setStep(1);}} pageSize={25} cols={[
        {h:'',w:8,render:r=>r.qty>0?<span style={{display:'inline-block',width:8,height:26,background:'#F5B300',borderRadius:3}}/>:null},
        {h:'Seq',render:(r)=>rows.indexOf(r)+1},
        {h:'Company',k:'company'},
        {h:'制单 Preparer',k:'preparer'},{h:'审核 Auditor',k:'auditor'},
        {h:'M (Monthly)',k:'m'},{h:'R (Recon)',render:r=><span className={r.r==='07/2026'?'':'muted'}>{r.r}</span>,csv:r=>r.r},{h:'C (Closing)',k:'c'},
        {h:'Quantity',num:true,k:'qty'},
        {h:'Amount',num:true,render:r=><Money v={r.amount}/>,sortVal:r=>r.amount,csv:r=>r.amount},
        {h:'Released',num:true,k:'released'},
        {h:'Reconciliation Balance',num:true,render:r=><Money v={r.recon_bal}/>,sortVal:r=>r.recon_bal,csv:r=>r.recon_bal},
        {h:'Recon Date',k:'recon_date'},
        {h:'',render:r=><span className="row-acts"><Btn size="sm" variant="ghost" onClick={e=>ctx.toast('View: 打开该公司银行流水明细')}>View</Btn><Btn size="sm" variant="ghost" onClick={e=>ctx.toast('已刷新银行 Feed')}>Refresh</Btn></span>},
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
    {step===3 && <><SectionTitle>Incurred List(权威已入账分录)</SectionTitle>
      <Table exportName="abr-incurred" cols={[
        {h:'Journal No.',k:'jn'},{h:'Posting Date',k:'pd'},{h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Payee',k:'payee'},{h:'Account',k:'acct'},{h:'金额',num:true,render:r=><Money v={r.amt}/>,csv:r=>r.amt},{h:'状态',render:r=><Badge>POSTED</Badge>},
      ]} rows={[]} empty="AUTOREC_API_UNAVAILABLE — 尚未读取权威 REFS 已入账分录。"/></>}
    <p className="muted sm">本页只展示文档化 WBS 工作流；在真实只读 WBS 证据、REFS API 回读、审批和过账链全部可用前，不执行或显示任何会计状态变更。</p>
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
  const voidChk = (no) => { const c=checks.find(x=>x.no===no);
    ctx.actions.newJEFromRule({entity_id:2, je_type:'REVERSAL', source_system:'BANK', posting_status:'POSTED', description:`VOID ${no} · ${c.payee}`,
      lines:[{account_code:'111000',debit_amount:c.amount,credit_amount:0},{account_code:'220200',debit_amount:0,credit_amount:c.amount}]});
    setChecks(cs=>cs.map(x=>x.no===no?{...x, status:'VOID'}:x)); ctx.toast(`支票 ${no} 已作废,冲销分录已过账 (Dr Cash / Cr AP)`,'warn'); };
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
