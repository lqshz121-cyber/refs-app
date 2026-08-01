import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { acct, money, sum } from './engine.js';
import { SUBSIDIARY, subsidiaryOf, memberOf } from './coa-wbs.js';

// 辅助核算台账: 科目 × 核算对象 的余额与明细 (WBS Subsidiary Accounting)
export function SubsidiaryLedger({ctx}) {
  const {jes, entity, goto} = ctx;
  const codes = Object.keys(SUBSIDIARY).sort();
  const [code, setCode] = useState('291001');
  const [sel, setSel] = useState(null);
  const stype = subsidiaryOf(code);
  const rows = {};
  const lines = [];
  jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity)).forEach(j=>j.lines.forEach(l=>{
    if (l.account_code!==code) return;
    const m = memberOf(l) || '(未指定对象)';
    rows[m] = rows[m]||{member:m, dr:0, cr:0, n:0};
    rows[m].dr += l.debit_amount||0; rows[m].cr += l.credit_amount||0; rows[m].n++;
    lines.push({member:m, je:j.je_number, date:j.je_date, src:j.source_system, memo:j.description, dr:l.debit_amount||0, cr:l.credit_amount||0});
  }));
  const list = Object.values(rows).map(r=>({...r, net:+(r.dr-r.cr).toFixed(2)})).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
  const selLines = sel ? lines.filter(l=>l.member===sel) : [];
  return <div className="full-bleed">
    <h2 className="page-h">辅助核算 Subsidiary Ledger</h2>
    <div className="filter-bar">
      <label>科目 <select value={code} onChange={e=>{setCode(e.target.value); setSel(null);}}>
        {codes.map(c=><option key={c} value={c}>{c} {acct(c).account_name} · {SUBSIDIARY[c]}</option>)}</select></label>
      <Badge tone="muted">核算类型: {stype}</Badge>
      <span className="muted sm">{list.length} 个核算对象 · 净额 {money(sum(list,r=>r.net))}</span>
    </div>
    <div className="kpi-row">
      <KPI label="核算对象数" value={list.length}/>
      <KPI label="借方合计" value={money(sum(list,r=>r.dr))}/>
      <KPI label="贷方合计" value={money(sum(list,r=>r.cr))}/>
      <KPI label="净额 Net" value={money(sum(list,r=>r.net))} tone={Math.abs(sum(list,r=>r.net))<0.01?'ok':undefined}/>
    </div>
    <SectionTitle>按核算对象余额（点击对象查看明细分录）</SectionTitle>
    <Table exportName={'subledger-'+code} rowKey="member" onRow={r=>setSel(r.member)} cols={[
      {h:stype+' · 核算对象',k:'member'},
      {h:'笔数',num:true,k:'n'},
      {h:'借方 Dr',num:true,render:r=><Money v={r.dr}/>,sortVal:r=>r.dr,csv:r=>r.dr},
      {h:'贷方 Cr',num:true,render:r=><Money v={r.cr}/>,sortVal:r=>r.cr,csv:r=>r.cr},
      {h:'净额 Net',num:true,render:r=><Money v={r.net} bold/>,sortVal:r=>r.net,csv:r=>r.net},
      {h:'方向',render:r=> r.net>0.005?<Badge tone="warn">Due from / Dr</Badge>: r.net<-0.005?<Badge tone="ok">Due to / Cr</Badge>:<Badge tone="muted">平</Badge>},
    ]} rows={list} empty="该科目本期无辅助核算记录"/>
    {sel && <><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setSel(null)}>关闭</Btn>}>{sel} · 明细（{selLines.length} 行）</SectionTitle>
      <Table exportName={'subledger-'+code+'-detail'} onRow={()=>goto('je')} cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},
        {h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Memo',k:'memo'},
        {h:'Dr',num:true,render:r=><Money v={r.dr}/>,csv:r=>r.dr},
        {h:'Cr',num:true,render:r=><Money v={r.cr}/>,csv:r=>r.cr},
      ]} rows={selLines}/></>}
    <p className="muted sm">与 WBS 一致：科目挂辅助核算类型(Bank/Vendor/Customer/Affiliate/Loan)，每行分录必须带核算对象；291 系按往来方出净额即 IC Balance，111000 按银行账户即现金台账。</p>
  </div>;
}
