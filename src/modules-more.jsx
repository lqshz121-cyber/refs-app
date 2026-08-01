import { useState } from 'react';
import { Card, KPI, Btn, Badge, Money, Table, Tabs, SectionTitle } from './ui.jsx';
import { COA, ENTITIES, VENDORS, CUSTOMERS, LOANS, BANK_ACCOUNTS, MAPPINGS, PROPERTIES, PROJECTS } from './data.js';
import { LOAN_TXNS, IC_TXNS, CLOSINGS, PM_ROWS } from './seed.js';
import { acct, money, sum, jeTotals, trialBalance, statements, downloadCSV } from './engine.js';

export function GLTrialBalance({ctx}) {
  const {jes, entity} = ctx;
  const [tab, setTab] = useState('Trial Balance');
  const [fromP, setFromP] = useState('2026-01');
  const [toP, setToP] = useState('2026-07');
  const posted = jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity) && j.period_code>=fromP && j.period_code<=toP);
  const [drill, setDrill] = useState(null);
  const MONTHS=['2026-01','2026-02','2026-03','2026-04','2026-05','2026-06','2026-07'];
  const tb = trialBalance(jes, entity, fromP, toP);
  const st = statements(jes, entity, fromP, toP);
  const ORDER=['ASSET','LIABILITY','EQUITY','REVENUE','EXPENSE'];
  const CN={ASSET:'资产 Assets',LIABILITY:'负债 Liabilities',EQUITY:'权益 Equity',REVENUE:'收入 Revenue',EXPENSE:'费用 Expenses'};
  const groups = ORDER.map(t=>({t, rows: tb.rows.filter(r=>r.type===t)})).filter(g=>g.rows.length);
  const secRows = [];
  groups.forEach(g=>{ secRows.push({_sec:g.t});
    g.rows.forEach(r=>secRows.push(r));
    secRows.push({_sub:g.t, debit:sum(g.rows,r=>r.debit), credit:sum(g.rows,r=>r.credit), balance:sum(g.rows,r=>r.balance)}); });
  const periodBar = <div className="filter-bar">
    <label>From <select value={fromP} onChange={e=>setFromP(e.target.value)}>{MONTHS.map(m=><option key={m}>{m}</option>)}</select></label>
    <label>To <select value={toP} onChange={e=>setToP(e.target.value)}>{MONTHS.filter(m=>m>=fromP).map(m=><option key={m}>{m}</option>)}</select></label>
    <span className="muted sm">Accrual basis · {tb.rows.length} accounts with activity</span>
  </div>;
  return <div className="full-bleed">
    <h2 className="page-h">General Ledger</h2>
    <Tabs tabs={['Trial Balance','GL Detail','Balance Sheet','Income Statement','Cash Flow']} active={tab} onChange={t=>{setTab(t); setDrill(null);}} />
    {periodBar}
    {tab==='Trial Balance' && <>
      <div style={{textAlign:'right',marginBottom:8}}><Btn size="sm" onClick={()=>downloadCSV('trial-balance-'+fromP+'_'+toP+'.csv',[['Account','Name','Type','Debit','Credit','Balance'],...tb.rows.map(r=>[r.account_code,r.name,r.type,r.debit,r.credit,r.balance])])}>导出 CSV</Btn></div>
      <div className="table-wrap"><table className="tbl stmt-tbl">
        <thead><tr><th>Account</th><th className="ta-r" style={{width:150}}>Debit</th><th className="ta-r" style={{width:150}}>Credit</th><th className="ta-r" style={{width:160}}>Balance</th></tr></thead>
        <tbody>{secRows.map((r,i)=> r._sec ?
          <tr key={i} className="sec-row"><td colSpan={4}>{CN[r._sec]}</td></tr>
          : r._sub ?
          <tr key={i} className="sub-row"><td>Total {CN[r._sub]}</td><td className="ta-r"><Money v={r.debit} bold/></td><td className="ta-r"><Money v={r.credit} bold/></td><td className="ta-r"><Money v={r.balance} bold/></td></tr>
          :
          <tr key={i} className="tr-click" onClick={()=>setDrill(r.account_code)}><td><span className="acct-code">{r.account_code}</span> {r.name}</td><td className="ta-r"><Money v={r.debit}/></td><td className="ta-r"><Money v={r.credit}/></td><td className="ta-r"><Money v={r.balance}/></td></tr>)}
        </tbody>
        <tfoot><tr className="grand-row"><td>TOTAL</td><td className="ta-r"><Money v={tb.totalDebit} bold/></td><td className="ta-r"><Money v={tb.totalCredit} bold/></td>
          <td className="ta-r"><Badge tone={Math.abs(tb.totalDebit-tb.totalCredit)<0.01?'ok':'bad'}>{Math.abs(tb.totalDebit-tb.totalCredit)<0.01?'✓ 平衡':'✗ 不平'}</Badge></td></tr></tfoot>
      </table></div>
    </>}
    {tab==='Balance Sheet' && (()=>{ const rhs=st.liabilities+st.equity+st.netIncome; const ok=Math.abs(st.assets-rhs)<0.01;
      const sec=(t)=>tb.rows.filter(r=>r.type===t);
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Balance Sheet · As of {toP} <span className="muted sm">(activity {fromP} ~ {toP})</span></div>
        <div className="stmt-sec">Assets</div>
        {sec('ASSET').map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={r.balance}/></div>)}
        <div className="stmt-row tot"><span>Total Assets</span><Money v={st.assets} bold/></div>
        <div className="stmt-sec">Liabilities</div>
        {sec('LIABILITY').map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={-r.balance}/></div>)}
        <div className="stmt-row tot"><span>Total Liabilities</span><Money v={st.liabilities} bold/></div>
        <div className="stmt-sec">Equity</div>
        {sec('EQUITY').map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={-r.balance}/></div>)}
        <div className="stmt-row"><span>Current Period Earnings ({fromP}~{toP})</span><Money v={st.netIncome}/></div>
        <div className="stmt-row tot"><span>Total Liabilities & Equity</span><Money v={rhs} bold/></div>
        <div className="stmt-row" style={{borderBottom:0}}><span>Check: Assets = L + E</span><Badge tone={ok?'ok':'bad'}>{ok?'✓ Balanced':'✗ Off by $'+Math.abs(st.assets-rhs).toLocaleString()}</Badge></div>
      </div>; })()}
    {tab==='Income Statement' && (()=>{ const rev=tb.rows.filter(r=>r.type==='REVENUE'); const exp=tb.rows.filter(r=>r.type==='EXPENSE');
      const cogs=exp.filter(r=>r.account_code.startsWith('51')); const opex=exp.filter(r=>!r.account_code.startsWith('51'));
      const revT=sum(rev,r=>-r.balance), cogsT=sum(cogs,r=>r.balance), opexT=sum(opex,r=>r.balance);
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Income Statement · {fromP} ~ {toP}</div>
        <div className="stmt-sec">Income</div>
        {rev.map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={-r.balance}/></div>)}
        <div className="stmt-row tot"><span>Total Income</span><Money v={revT} bold/></div>
        {cogs.length>0 && <><div className="stmt-sec">Cost of Goods Sold</div>
        {cogs.map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={r.balance}/></div>)}
        <div className="stmt-row tot"><span>Gross Profit</span><Money v={revT-cogsT} bold/></div></>}
        <div className="stmt-sec">Expenses</div>
        {opex.map(r=><div key={r.account_code} className="stmt-row"><span><span className="acct-code">{r.account_code}</span> {r.name}</span><Money v={r.balance}/></div>)}
        <div className="stmt-row tot"><span>Total Expenses</span><Money v={opexT} bold/></div>
        <div className="stmt-row tot" style={{fontSize:16}}><span>Net Income</span><Money v={revT-cogsT-opexT} bold/></div>
      </div>; })()}
    {tab==='GL Detail' && (()=>{ const lines=[]; posted.forEach(j=>j.lines.forEach(l=>lines.push({je:j.je_number, date:j.je_date, entity_id:j.entity_id, src:j.source_system, acct:l.account_code, name:acct(l.account_code).account_name, memo:l.description||j.description, member:l.member||'', dr:l.debit_amount||0, cr:l.credit_amount||0})));
      return <Table exportName={'gl-detail-'+fromP+'_'+toP} pageSize={30} cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},{h:'Entity',render:r=>'E'+r.entity_id},
        {h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Account',render:r=><span><span className="acct-code">{r.acct}</span> {r.name}</span>,csv:r=>r.acct},
        {h:'Memo / 核算对象',render:r=><span>{r.memo}{r.member?<Badge tone="muted" >{r.member.slice(0,18)}</Badge>:null}</span>,csv:r=>r.memo},
        {h:'Debit',num:true,render:r=>r.dr?<Money v={r.dr}/>:'',sortVal:r=>r.dr,csv:r=>r.dr||''},
        {h:'Credit',num:true,render:r=>r.cr?<Money v={r.cr}/>:'',csv:r=>r.cr||''},
      ]} rows={lines}/>; })()}
    {tab==='Cash Flow' && (()=>{ // 简化间接法: 111000 对手方分类
      const buckets={Operating:0, Investing:0, Financing:0};
      posted.forEach(j=>{ const cash=j.lines.filter(l=>l.account_code==='111000');
        if(!cash.length) return; const net=sum(cash,l=>(l.debit_amount||0)-(l.credit_amount||0));
        const others=j.lines.filter(l=>l.account_code!=='111000').map(l=>l.account_code);
        const cls = others.some(a=>a.startsWith('27')||a.startsWith('26')||a.startsWith('38')||a.startsWith('291')||a.startsWith('289')) ? 'Financing'
                  : others.some(a=>a.startsWith('16')||a.startsWith('15')) ? 'Investing' : 'Operating';
        buckets[cls]+=net; });
      const total=buckets.Operating+buckets.Investing+buckets.Financing;
      return <div className="stmt stmt-wide">
        <div className="stmt-h">Statement of Cash Flows · {fromP} ~ {toP} <span className="muted sm">(简化分类:融资=贷款/权益/往来,投资=CWIP/资产,其余经营)</span></div>
        <div className="stmt-row"><span>Cash from Operating Activities</span><Money v={buckets.Operating}/></div>
        <div className="stmt-row"><span>Cash from Investing Activities</span><Money v={buckets.Investing}/></div>
        <div className="stmt-row"><span>Cash from Financing Activities</span><Money v={buckets.Financing}/></div>
        <div className="stmt-row tot"><span>Net Change in Cash (111000)</span><Money v={total} bold/></div>
      </div>; })()}
    {drill && tab==='Trial Balance' && (()=>{ const lines=[]; jes.filter(j=>j.posting_status==='POSTED'&&(!entity||j.entity_id===entity)&&j.period_code>=fromP&&j.period_code<=toP).forEach(j=>j.lines.forEach(l=>{ if(l.account_code===drill) lines.push({je:j.je_number, date:j.je_date, desc:j.description, src:j.source_system, dr:l.debit_amount, cr:l.credit_amount}); }));
      return <div style={{marginTop:16}}><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setDrill(null)}>关闭</Btn>}>Drill-down · {drill} {acct(drill).account_name}（{lines.length} 行）</SectionTitle>
      <Table exportName={'gl-'+drill} cols={[{h:'JE',k:'je'},{h:'日期',k:'date'},{h:'描述',k:'desc'},{h:'来源',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},{h:'借方',num:true,render:r=><Money v={r.dr}/>,csv:r=>r.dr},{h:'贷方',num:true,render:r=><Money v={r.cr}/>,csv:r=>r.cr}]} rows={lines}/></div>; })()}
  </div>;
}

export function Reports({ctx}) {
  const {jes, exceptions, entity} = ctx;
  const [open, setOpen] = useState(null);
  const st = statements(jes, entity);
  const posted = jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity));
  const REPORTS = {
    'Construction Loan Rollforward': () => { const rows = LOANS.map(l=>{ const draws=sum(LOAN_TXNS.filter(t=>t.loan_id===l.loan_id&&t.txn_type==='DRAW'),t=>t.amount); const rep=sum(LOAN_TXNS.filter(t=>t.loan_id===l.loan_id&&t.txn_type==='REPAYMENT'),t=>t.amount);
        return {loan:l.loan_code, lender:l.lender_name, begin:l.current_principal-draws+rep, draws, repayments:rep, end:l.current_principal, avail:l.commitment_amount-l.current_principal}; });
      return <Table exportName="loan-rollforward" cols={[{h:'贷款',k:'loan'},{h:'Lender',k:'lender'},{h:'期初本金',num:true,render:r=><Money v={r.begin}/>,csv:r=>r.begin},{h:'+ Draws',num:true,render:r=><Money v={r.draws}/>,csv:r=>r.draws},{h:'− Repayments',num:true,render:r=><Money v={r.repayments}/>,csv:r=>r.repayments},{h:'期末本金',num:true,render:r=><Money v={r.end}/>,csv:r=>r.end},{h:'剩余额度',num:true,render:r=><Money v={r.avail}/>,csv:r=>r.avail}]} rows={rows}/>; },
    'Manual JE Report': () => <Table exportName="manual-je" cols={[{h:'JE',k:'je_number'},{h:'日期',k:'je_date'},{h:'描述',k:'description'},{h:'金额',num:true,render:r=><Money v={jeTotals(r).dr}/>,csv:r=>jeTotals(r).dr},{h:'创建人',k:'created_by'},{h:'附件',render:r=>r.has_attachment?'✓':'✗ 缺失',csv:r=>r.has_attachment?'Y':'N'},{h:'状态',render:r=><Badge>{r.posting_status}</Badge>,csv:r=>r.posting_status}]} rows={jes.filter(j=>j.je_type==='MANUAL')}/>,
    'Exception Aging': () => <Table exportName="exception-aging" cols={[{h:'类型',k:'exception_type'},{h:'严重度',render:r=><Badge>{r.severity}</Badge>,csv:r=>r.severity},{h:'对象',k:'object_ref'},{h:'Aging(天)',num:true,k:'aging_days'},{h:'Owner',k:'owner'},{h:'状态',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status}]} rows={[...exceptions].sort((a,b)=>b.aging_days-a.aging_days)}/>,
    'Data Sync Report': () => <Table cols={[{h:'来源',k:'s'},{h:'批次',k:'b'},{h:'记录',k:'n'},{h:'成功率',k:'r'},{h:'状态',render:r=><Badge tone={r.r==='100%'?'ok':'warn'}>{r.r==='100%'?'COMPLETED':'PARTIAL'}</Badge>}]} rows={[{s:'WBS_CL',b:'CL-20260731-007',n:4,r:'100%'},{s:'PM',b:'PM-202607-P0020',n:5,r:'80%'},{s:'BANK',b:'BANK-20260731',n:4,r:'100%'}]}/>,
    'Inventory Rollforward': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo'].includes(e.entity_type)).map(en=>{
        let inAdd=0, cogs=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>j.lines.forEach(l=>{
          if(l.account_code==='163000') inAdd+=(l.debit_amount||0)-(l.credit_amount||0);
          if(l.account_code==='510000') cogs+=(l.debit_amount||0);
        }));
        return {e:en.entity_code, name:en.entity_name, beg:0, xfer:inAdd+cogs, cogs:-cogs, end:inAdd};
      }).filter(r=>r.xfer||r.cogs);
      return <Table exportName="inventory-rollforward" cols={[
        {h:'Entity',render:r=><b>{r.e}</b>},{h:'Company',k:'name'},
        {h:'Beginning',num:true,render:r=><Money v={r.beg}/>},
        {h:'+ CWIP→Inventory',num:true,render:r=><Money v={r.xfer}/>},
        {h:'− COGS',num:true,render:r=><Money v={r.cogs}/>},
        {h:'Ending Inventory',num:true,render:r=><Money v={r.end} bold/>},
      ]} rows={rows} empty="当前口径 CWIP 直接结转 COGS(163000 未启用);启用 Inventory 流转后此表出数"/>; },
    'Cost GL Reconciliation': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo','LandCo'].includes(e.entity_type)).slice(0,20).map(en=>{
        let glCost=0, srcCost=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>{
          j.lines.forEach(l=>{ if(['164100','164200','164400','164500','510000'].includes(l.account_code)) glCost+=(l.debit_amount||0)-(l.credit_amount||0); });
          if(['PAYABLE','CLOSING','WBS_CL'].includes(j.source_system)) j.lines.forEach(l=>{ if(['164100','164200','164400','164500','510000'].includes(l.account_code)) srcCost+=(l.debit_amount||0)-(l.credit_amount||0); });
        });
        return {e:en.entity_code, gl:glCost, src:srcCost, diff:+(glCost-srcCost).toFixed(2)};
      }).filter(r=>r.gl||r.src);
      return <Table exportName="cost-gl-recon" cols={[
        {h:'Entity',render:r=><b>{r.e}</b>},
        {h:'GL 成本科目净额',num:true,render:r=><Money v={r.gl}/>},
        {h:'源单据口径(PAYABLE/CLOSING/WBS_CL)',num:true,render:r=><Money v={r.src}/>},
        {h:'差异',num:true,render:r=><Money v={r.diff} bold/>},
        {h:'状态',render:r=><Badge tone={Math.abs(r.diff)<0.01?'ok':'bad'}>{Math.abs(r.diff)<0.01?'✓ 对平':'✗ 需查'}</Badge>},
      ]} rows={rows}/>; },
    'CWIP Rollforward': () => { const rows = ENTITIES.filter(e=>['Vertical','ProjectCo','LandCo'].includes(e.entity_type)).map(en=>{
        let add=0, capint=0, rel=0, tout=0;
        jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).forEach(j=>j.lines.forEach(l=>{
          if(['164100','164200','164400'].includes(l.account_code)){ add+=(l.debit_amount||0); if(j.source_system==='CLOSING') rel+=(l.credit_amount||0); else if(j.rule_code==='R-UT-OUT-01') tout+=(l.credit_amount||0); else rel+= (j.source_system==='CLOSING'?0:0); }
          if(l.account_code==='164500') capint+=(l.debit_amount||0)-(l.credit_amount||0);
        }));
        const other = jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===en.entity_id).reduce((s,j)=>s+j.lines.reduce((x,l)=>['164100','164200','164400'].includes(l.account_code)&&j.source_system!=='CLOSING'&&j.rule_code!=='R-UT-OUT-01'?x+(l.credit_amount||0):x,0),0);
        const end = add+capint-rel-tout-other;
        return {e:en.entity_code, name:en.entity_name, beg:0, add, capint, rel:-rel, tout:-tout, other:-other, end};
      }).filter(r=>r.add||r.end);
      const T=k=>sum(rows,r=>r[k]);
      return <Table exportName="cwip-rollforward" pageSize={30} cols={[
        {h:'Entity',render:r=><b>{r.e}</b>,csv:r=>r.e},{h:'Company',k:'name'},
        {h:'Beginning',num:true,render:r=><Money v={r.beg}/>,csv:r=>r.beg},
        {h:'+ Additions',num:true,render:r=><Money v={r.add}/>,csv:r=>r.add},
        {h:'+ Cap. Interest',num:true,render:r=><Money v={r.capint}/>,csv:r=>r.capint},
        {h:'− COGS Relief',num:true,render:r=><Money v={r.rel}/>,csv:r=>r.rel},
        {h:'− Transfer Out',num:true,render:r=><Money v={r.tout}/>,csv:r=>r.tout},
        {h:'− Other',num:true,render:r=><Money v={r.other}/>,csv:r=>r.other},
        {h:'Ending CWIP',num:true,render:r=><Money v={r.end} bold/>,sortVal:r=>r.end,csv:r=>r.end},
      ]} rows={rows}/>; },
    'INTER COMPANY Balance Report': () => <Table exportName="ic-balance" cols={[{h:'IC Pair',k:'ic_pair_id'},{h:'发起方',k:'initiator_entity'},{h:'对手方',k:'counterparty_entity'},{h:'Due to/from 金额',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'Match',render:r=><Badge tone={r.match_status==='MATCHED'?'ok':'bad'}>{r.match_status}</Badge>,csv:r=>r.match_status}]} rows={IC_TXNS}/>,
    'SREO Report': () => <Table exportName="sreo" cols={[{h:'Property',k:'p'},{h:'Entity',k:'e'},{h:'Loan',k:'l'},{h:'Lender',k:'ld'},{h:'Principal',num:true,render:r=><Money v={r.pr}/>,csv:r=>r.pr},{h:'Est. Value',num:true,render:r=><Money v={r.v}/>,csv:r=>r.v},{h:'Equity',num:true,render:r=><Money v={r.v-r.pr}/>,csv:r=>r.v-r.pr}]} rows={LOANS.map((l,i)=>({p:['Cedar Ridge','Maple Court','Palm Bay'][i%3], e:'E'+l.entity_id, l:l.loan_code, ld:l.lender_name, pr:l.current_principal, v:l.commitment_amount*1.4}))}/>,
    'Draw Request Report': () => <Table exportName="draw-requests" cols={[{h:'Draw',k:'wbs_txn_id'},{h:'日期',k:'transaction_date'},{h:'类型',render:r=><Badge tone="muted">{r.txn_type}</Badge>,csv:r=>r.txn_type},{h:'金额',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'状态',render:()=><Badge tone="ok">FUNDED</Badge>}]} rows={LOAN_TXNS.filter(t=>t.txn_type==='DRAW')}/>,
    'Payable Report': () => <Table exportName="payable-report" cols={[{h:'Bill',k:'bill_no'},{h:'Payee',k:'vendor_name'},{h:'到期',k:'due_date'},{h:'金额',num:true,render:r=><Money v={r.amount}/>,csv:r=>r.amount},{h:'状态',render:r=><Badge>{r.status}</Badge>,csv:r=>r.status}]} rows={ctx.ap.bills}/>,
    'Property Operating Statement': () => { const rev=sum(PM_ROWS.filter(r=>r.kind==='REVENUE'),r=>r.amount); const exp=sum(PM_ROWS.filter(r=>r.kind==='EXPENSE'),r=>r.amount);
      return <div className="stmt"><div className="stmt-row"><span>运营收入 (PM Pickup)</span><Money v={rev} bold/></div><div className="stmt-row"><span>运营费用</span><Money v={-exp}/></div><div className="stmt-row tot"><span>NOI</span><Money v={rev-exp} bold/></div></div>; },
  };
  const reports = [
    ['Trial Balance','GL','gl'],['Balance Sheet','GL','gl'],['Income Statement','GL','gl'],
    ['Construction Loan Rollforward','贷款',null],['Manual JE Report','管理',null],['Exception Aging','管理',null],
    ['Data Sync Report','管理',null],['Property Operating Statement','物业',null],
    ['Budget vs Actual','项目','cost'],['Cost to Complete','项目','cost'],['AP Aging','交易','ap'],['对账历史','交易','bankrec'],
    ['CWIP Rollforward','房地产',null],['Inventory Rollforward','房地产',null],['Cost GL Reconciliation','房地产',null],['INTER COMPANY Balance Report','WBS',null],['SREO Report','WBS',null],['Draw Request Report','WBS',null],['Payable Report','WBS',null],
    ['Cost General Ledger','WBS','gl'],['Unit CWIP and EM Report','WBS','cost'],['Budget and Execution Report','WBS','cost'],['Project Cost Reconciliation','WBS','cost'],
  ];
  return <div>
    <h2 className="page-h">报表中心 Reports</h2>
    <div className="kpi-row">
      <KPI label="总资产" value={money(st.assets)} />
      <KPI label="本期收入" value={money(st.revenue)} tone="ok" />
      <KPI label="本期净利" value={money(st.netIncome)} tone={st.netIncome>=0?'ok':'bad'} />
      <KPI label="已过账 JE" value={posted.length} />
    </div>
    <SectionTitle>报表清单（点击查看 · 均可导出 CSV）</SectionTitle>
    <div className="rep-grid">{reports.map(([n,g,route])=>
      <Card key={n} hover className={`rep-card ${open===n?'rep-on':''}`} onClick={()=>route?ctx.goto(route):setOpen(open===n?null:n)}>
        <div className="rep-name">{n}</div><div className="rep-tag"><Badge tone="muted">{g}</Badge>{route&&<span className="muted sm"> → 模块</span>}</div>
      </Card>)}</div>
    {open && REPORTS[open] && <div style={{marginTop:18}}><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setOpen(null)}>关闭</Btn>}>{open}</SectionTitle>{REPORTS[open]()}</div>}
  </div>;
}

function SimpleList({title, cols, rows, note}) {
  return <div><h2 className="page-h">{title}</h2>{note&&<p className="muted sm">{note}</p>}<Table cols={cols} rows={rows} /></div>;
}

export function ARModule() {
  return <SimpleList title="Accounts Receivable" note="客户/Owner/Tenant/关联方、账单、收款、账龄。"
    cols={[{h:'客户',render:r=>r.customer_name},{h:'类型',render:r=><Badge tone="muted">{r.customer_type}</Badge>},{h:'关联方',render:r=>r.is_related_party?'RP':'—'}]} rows={CUSTOMERS} />;
}
export function CashModule() {
  return <SimpleList title="Cash Management" note="银行账户主数据、Bank Feed、对账、划转。对账详见 Bank Reconciliation。"
    cols={[{h:'账户',k:'bank_account_code'},{h:'银行',k:'bank_name'},{h:'类型',render:r=><Badge tone="muted">{r.account_type}</Badge>},{h:'实体',render:r=>'E'+r.entity_id}]} rows={BANK_ACCOUNTS} />;
}
export function LoanRegister() {
  return <SimpleList title="Loan Register" note="贷款台账（与 WBS Loan Master 对齐）。提款/利息见 Construction Loan Workspace。"
    cols={[{h:'贷款',k:'loan_code'},{h:'类型',render:r=><Badge tone="muted">{r.loan_type}</Badge>},{h:'Lender',k:'lender_name'},{h:'Commitment',num:true,render:r=><Money v={r.commitment_amount}/>},{h:'当前本金',num:true,render:r=><Money v={r.current_principal}/>},{h:'利率',num:true,render:r=>(r.interest_rate*100).toFixed(2)+'%'}]} rows={LOANS} />;
}
export function ProjectCost() {
  const CC = [
    {cc:'01-100 Land Acquisition', budget:900000, commit:900000, actual:900000},
    {cc:'02-200 Sitework', budget:450000, commit:430000, actual:392000},
    {cc:'03-300 Vertical Construction', budget:2600000, commit:2450000, actual:1585000},
    {cc:'04-400 Capitalized Interest', budget:120000, commit:0, actual:29200},
    {cc:'05-500 Soft Costs / A&E', budget:310000, commit:285000, actual:198500},
    {cc:'06-600 Contingency', budget:150000, commit:0, actual:0},
  ].map(r=>({...r, ctc:Math.max(0,r.budget-r.actual), fac:Math.max(r.budget, r.commit>r.budget?r.commit:r.budget), var:r.budget-Math.max(r.budget,r.commit)}));
  const T = k => sum(CC, r=>r[k]);
  return <div className="full-bleed">
    <h2 className="page-h">项目成本 Project Cost · PRJ-CEDAR</h2>
    <div className="kpi-row">
      <KPI label="总预算 Budget" value={money(T('budget'))} />
      <KPI label="已承诺 Committed" value={money(T('commit'))} sub={(T('commit')/T('budget')*100).toFixed(0)+'% of budget'} />
      <KPI label="实际发生 Actual" value={money(T('actual'))} sub={(T('actual')/T('budget')*100).toFixed(0)+'% complete'} tone="ok" />
      <KPI label="完工尚需 CTC" value={money(T('ctc'))} tone="warn" />
    </div>
    <SectionTitle>Budget → Commitment → Actual → Forecast（按 Cost Code）</SectionTitle>
    <Table exportName="project-cost" cols={[
      {h:'Cost Code',k:'cc'},
      {h:'Original Budget',num:true,render:r=><Money v={r.budget}/>,sortVal:r=>r.budget,csv:r=>r.budget},
      {h:'Committed',num:true,render:r=><Money v={r.commit}/>,csv:r=>r.commit},
      {h:'Actual to Date',num:true,render:r=><Money v={r.actual}/>,csv:r=>r.actual},
      {h:'% Spent',num:true,render:r=>r.budget?((r.actual/r.budget*100).toFixed(1)+'%'):'—',csv:r=>r.budget?(r.actual/r.budget*100).toFixed(1):''},
      {h:'Cost to Complete',num:true,render:r=><Money v={r.ctc}/>,csv:r=>r.ctc},
      {h:'超支预警',render:r=> r.commit>r.budget ? <Badge tone="bad">Commitment 超预算</Badge> : r.actual>r.budget ? <Badge tone="bad">Actual 超预算</Badge> : <Badge tone="ok">在控</Badge>,csv:r=>r.commit>r.budget||r.actual>r.budget?'OVER':'OK'},
    ]} rows={CC} />
    <p className="muted sm">Actual 来自 AP/FAST/Faster PO 发票按 Cost Code 进 164xxx CWIP(Draw 是融资:Dr Cash/Cr Loan,不进成本);Commitment 来自合同/PO;CTC = Budget − Actual;超支即产生异常。</p>
  </div>;
}
export function Assets() {
  const rows = [{c:'Land',code:'161000',v:900000},{c:'Building',code:'163000',v:2100000}];
  return <SimpleList title="Fixed Asset & Property" note="Land/Building/折旧/处置（原型：来自 Closing 的资产入账）。"
    cols={[{h:'资产类',k:'c'},{h:'科目',render:r=>r.code+' '+acct(r.code).account_name},{h:'成本',num:true,render:r=><Money v={r.v}/>}]} rows={rows} />;
}
export function Intercompany({ctx}) {
  const [ic, setIc] = useState(IC_TXNS.map(t=>({...t})));
  const mirror = (r) => { ctx.actions.newJEFromRule({entity_id:3, je_type:'AUTO', source_system:'MAN', posting_status:'POSTED',
      description:`IC mirror ${r.ic_pair_id}: Due to ${r.initiator_entity}`,
      lines:[{account_code:'125000',debit_amount:r.amount,credit_amount:0},{account_code:'291000',debit_amount:0,credit_amount:r.amount}]});
    setIc(xs=>xs.map(x=>x.ic_txn_id===r.ic_txn_id?{...x, match_status:'MATCHED'}:x));
    ctx.toast(`已生成对手方镜像分录并 Match: ${r.ic_pair_id}`); };
  return <div><h2 className="page-h">Intercompany</h2>
    <p className="muted sm">Due to/from、镜像自动生成、Matching；不平进入异常。</p>
    <Table cols={[
      {h:'IC Pair',k:'ic_pair_id'},{h:'类型',render:r=><Badge tone="muted">{r.ic_type}</Badge>},
      {h:'发起方',k:'initiator_entity'},{h:'对手方',k:'counterparty_entity'},
      {h:'金额',num:true,render:r=><Money v={r.amount}/>},
      {h:'匹配',render:r=><Badge tone={r.match_status==='MATCHED'?'ok':'bad'}>{r.match_status}</Badge>},
      {h:'操作',render:r=> r.match_status!=='MATCHED' ? <Btn size="sm" variant="primary" onClick={()=>mirror(r)}>生成镜像分录</Btn> : <span className="muted sm">—</span>},
    ]} rows={ic} rowKey="ic_txn_id" /></div>;
}
export function IntegrationHub({ctx}) {
  const [batches, setBatches] = useState([
    {batch_id:'CL-20260731-007', src:'WBS_CL', status:'COMPLETED', n:4, ok:4, err:null},
    {batch_id:'PM-202607-P0020', src:'PM', status:'PARTIAL', n:5, ok:4, err:'行5: PET_FEE 缺 GL 映射 [3020]'},
    {batch_id:'BANK-20260731', src:'BANK', status:'COMPLETED', n:4, ok:4, err:null},
  ]);
  const retry = (id) => { setBatches(bs=>bs.map(b=>b.batch_id===id?{...b, status:'RETRYING'}:b));
    setTimeout(()=>setBatches(bs=>bs.map(b=>b.batch_id===id?{...b, status:'PARTIAL'}:b)), 900);
    ctx.toast('重试完成：映射仍缺失，需先在 Mapping Center 配置 PET_FEE','warn'); };
  const FEEDS = [
    ['PAYABLE','上游 AP 发票(Contract & Invoice / Budget & Purchasing 审批完成)','Dr 费用科目(带 Cost Code/Class/Payable No GUID/Unit) / Cr 291001 Due to/from_按Payee挂账','两行一组,Journal No=YYYYMMDD+序号'],
    ['EXPA','银行流水 Feed 自动匹配付款(Auto Payments Reconciliation)','Dr 291001 Due to/from_Payee(清账) / Cr 111000 Operating Cash_公司_银行_账号尾号','memo 保留原始 ACH/CCD 银行描述全文'],
    ['AUTOC','公司卡/银行采购流水自动清账(PURCHASE 描述)','Dr 291001 Due to/from_Vendor / Cr 111000 Operating Cash','与 PAYABLE 成对出现,卡消费即清'],
    ['DIVIDEND','业主分红发放批次(按 Lot/Unit)','Dr 291000 Due to/from_业主(按 Lot 多行) / Cr 111000 现金 + Cr 220204 Tax Payable(代扣税)','WBLD 实测模式'],
    ['NOT_MATCH','银行流水无法自动匹配','暂挂,人工处理 → 转 Match 或 Exception','对应 REFS Bank Transactions For Review'],
    ['REIMB / Reimbursement Invoice','员工上传报销发票(Upload Reimbursement Invoices)','审批后 Dr 费用 / Cr 291001 Due to/from_员工','Auto Reimbursement=自动生成分录'],
    ['AUTO_BANK_REIMB','银行扣款自动清报销挂账','Dr 291001 / Cr 111000','与 EXPA 同机制,来源为报销'],
    ['INTERNAL_TRANSFER','自有银行账户间划转','Dr 111000(收方账户) / Cr 111000(付方账户)','两侧银行 feed 各自对账'],
    ['INTERNAL / INDIVIDUAL','内部调整 / 手工单笔(Type=Manual)','任意借贷,走 Review(Yes/No)+Approve(三态)','绿色高亮=已 Review 行'],
  ];
  return <div className="full-bleed"><h2 className="page-h">集成中心 Integration Hub</h2>
    <p className="muted sm">外部数据先入 Staging，禁止直写 GL。批次幂等去重、Retry、失败补偿。</p>
    <SectionTitle>WBS 数据来源规则(与 WBS 生产系统逐条对齐)</SectionTitle>
    <Table cols={[
      {h:'Source',render:r=><Badge tone="muted">{r[0]}</Badge>},
      {h:'业务数据来源',render:r=>r[1]},
      {h:'记账规则',render:r=>r[2]},
      {h:'备注',render:r=><span className="muted sm">{r[3]}</span>},
    ]} rows={FEEDS} />
    <SectionTitle>批次监控</SectionTitle>
    <Table rowKey="batch_id" cols={[
      {h:'批次',k:'batch_id'},{h:'来源',render:r=><Badge tone="muted">{r.src}</Badge>},
      {h:'记录',num:true,render:r=>r.ok+'/'+r.n},
      {h:'状态',render:r=><Badge tone={r.status==='COMPLETED'?'ok':'warn'}>{r.status}</Badge>},
      {h:'错误明细',render:r=>r.err||'—'},
      {h:'操作',render:r=> r.status!=='COMPLETED' ? <span className="row-acts"><Btn size="sm" onClick={()=>retry(r.batch_id)}>Retry</Btn><Btn size="sm" variant="ghost" onClick={()=>ctx.goto('mapping')}>去配映射</Btn></span> : <span className="muted sm">—</span>},
    ]} rows={batches} /></div>;
}
export function MasterData() {
  const [tab,setTab] = useState('Entity');
  const map = {Entity:[ENTITIES,[{h:'编码',k:'entity_code'},{h:'名称',k:'entity_name'},{h:'类型',render:r=><Badge tone="muted">{r.entity_type}</Badge>}]],
    Project:[PROJECTS,[{h:'编码',k:'project_code'},{h:'名称',k:'project_name'},{h:'建设状态',render:r=><Badge tone={r.construction_status==='UNDER_CONSTRUCTION'?'warn':'ok'}>{r.construction_status}</Badge>}]],
    Property:[PROPERTIES,[{h:'编码',k:'property_code'},{h:'名称',k:'property_name'},{h:'状态',render:r=><Badge tone="muted">{r.property_status}</Badge>}]]};
  const [rows,cols] = map[tab];
  return <div><h2 className="page-h">Master Data Center</h2>
    <p className="muted sm">编码唯一、版本化、历史锁定；修改不覆盖历史。</p>
    <Tabs tabs={Object.keys(map)} active={tab} onChange={setTab} />
    <Table cols={cols} rows={rows} /></div>;
}
export function MappingCenter({ctx}) {
  const FAMILIES = [
    ['Bank Detail → Account','Account Setting · Bank','银行账号→现金科目(111000子账)','setting'],
    ['Construction Loan Detail → Account','Account Setting · Contruction Loan','Draw/Repayment/Interest/Escrow×7→科目+Project','setting'],
    ['Cost Code Group → Account','Account Setting · Cost','0LD/2HD/24E/21E/9AM 码组→CWIP/费用','setting'],
    ['Cost Code × Dr/Cr → Account','Cost Setting','Cost General Ledger 按单码借贷映射','setting'],
    ['Payable Cost Code → Dr Account','Payable Setting','按码定借方+归属公司;Credit行=291001','setting'],
    ['Batch Template → Dr/Cr Pair','Batch Setting','计提模板+Sequential+Reverse Next Month','setting'],
    ['PM Charge Code → Owner GL','下表','RENT/LATE_FEE/SEC_DEPOSIT/UTILITIES/MGMT_FEE','pm'],
    ['Project Status → Capitalization','Rule Center','在建→164500资本化;完工→795000费用化','rules'],
    ['Unit Status → Inventory/COGS','Rule Center','在建CWIP→完工Inventory→售出COGS','rules'],
    ['Company → Rule Profile','Company Setting','每公司独立四大Setting+Copy','setting'],
  ];
  return <div className="full-bleed"><h2 className="page-h">Mapping Center · 全映射索引</h2>
    <p className="muted sm">所有外部 code → 会计维度/科目的映射家族;明细在对应 Setting/Rule 页维护(版本化+审批)。</p>
    <Table cols={[
      {h:'Mapping 家族',render:r=><b>{r[0]}</b>},
      {h:'维护位置',render:r=><Badge tone="muted">{r[1]}</Badge>},
      {h:'规则说明',render:r=>r[2]},
      {h:'',render:r=><Btn size="sm" variant="ghost" onClick={()=>ctx.goto(r[3]==='pm'?'mapping':r[3]==='rules'?'rules':'setting')}>打开 →</Btn>},
    ]} rows={FAMILIES}/>
    <SectionTitle>PM Charge Code → Owner GL(本页维护)</SectionTitle>
    <Table cols={[{h:'类型',render:r=><Badge tone="muted">{r.mapping_type}</Badge>},{h:'Charge Code',k:'source_code'},{h:'Owner GL',render:r=>r.owner_gl_account_code+' '+acct(r.owner_gl_account_code).account_name},{h:'收/支',k:'rev_exp_flag'},{h:'现/权',k:'cash_accrual_flag'}]} rows={MAPPINGS} />
  </div>;
}
export function RuleCenter() {
  const rules = [
    ['R-LOAN-01','LOAN.DRAW','Dr 111000 Cash / Cr 270100 Loan Payable(资金流入≠成本)','LIVE'],
    ['R-LOAN-03','LOAN.INTEREST · 在建','Dr 164500 CWIP-Cap Interest / Cr 220410','LIVE'],
    ['R-LOAN-04','LOAN.INTEREST · 完工','Dr 795000 Interest Expense / Cr 220410','LIVE'],
    ['R-LOAN-05','LOAN.REPAYMENT','Dr 270100 / Cr 111000(或按公司Setting→291001)','LIVE'],
    ['R-AP-STD-01','PAYABLE(按Payee挂账)','Dr 费用/CWIP(按Cost Setting) / Cr 291001_Payee','LIVE'],
    ['R-EXPA-01','银行Feed自动清账','Dr 291001_Payee / Cr 111000(EXPA/AUTOC)','LIVE'],
    ['R-COST-2HD','Hard Cost × 在建','Dr 164400 CWIP / Cr 220300','LIVE'],
    ['R-COST-2HD-DONE','Hard Cost × 完工','Dr 510000 COGS / Cr 220300(状态驱动)','LIVE'],
    ['R-PM-11','PM RENT(权责)','Dr 120200 AR / Cr 421803 Rental Income','LIVE'],
    ['R-PM-16','SEC_DEPOSIT','Dr 111000 / Cr 225000 押金负债(禁入收入)','LIVE'],
    ['R-CLS-SALE-01','Closing · Confirmed amount','Dr 111000 / Cr 491800;Title Withholding→220205','LIVE'],
    ['R-CLS-COGS-01','Closing · 成本结转','Dr 510000 / Cr 164400(≤累计CWIP)','LIVE'],
    ['R-DIV-01','Dividend 批次','Dr 291000_业主(按Lot) / Cr 111000 + Cr 220204代扣','LIVE'],
    ['R-UT-OUT-01','Unit Transfer A转出','Dr 125000 Due from_B / Cr 164400 + 787001损益','LIVE'],
    ['R-UT-IN-01','Unit Transfer B转入','Dr 164400(B Opening Basis) / Cr 291000 Due to_A','LIVE'],
    ['R-IC-01','跨公司付款镜像','付方 Dr 125000/Cr 111000;受益方 Dr 成本/Cr 291000','LIVE'],
  ];
  return <div><h2 className="page-h">Accounting Rule Center</h2>
    <p className="muted sm">规则独立管理、版本化、沙箱测试；未 TESTED 不可 LIVE。</p>
    <Table cols={[{h:'Rule',k:0,render:r=>r[0]},{h:'Trigger',render:r=>r[1]},{h:'借贷逻辑',render:r=>r[2]},{h:'状态',render:r=><Badge tone={r[3]==='LIVE'?'ok':'warn'}>{r[3]}</Badge>}]} rows={rules} rowKey={0} /></div>;
}
export function AdminModule({ctx}) {
  return <div><h2 className="page-h">System Admin</h2>
    <p className="muted sm">RBAC、审批配置、期间管理。角色与权限来自登录身份,页面内不可切换;无权限模块直接隐藏。</p>
    <SectionTitle>职责分离 (SoD) 硬规则</SectionTitle>
    <ul className="sod-list">
      <li>建 Vendor 且付款 · 建 JE 且最终审批（Maker≠Approver）</li>
      <li>改银行信息且付款 · 改 Mapping 且批 Mapping</li>
      <li>上传外部数据且直接 Posting · 建主数据且批主数据</li>
    </ul>
    <p className="muted sm">本原型对「Maker≠Approver」做了实时拦截：用创建该分录的账号去审批/过账会被阻止。</p>
  </div>;
}
