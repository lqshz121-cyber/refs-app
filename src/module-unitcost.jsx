import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { money, sum } from './engine.js';
import { SOURCE_DOCS } from './seed.js';
import { ENTITIES } from './data.js';

// Unit Cost Ledger: 每个 Lot/Unit 的成本堆积 → 售价 → COGS → 毛利 (业务对象驱动的账)
export function UnitCostLedger({ctx}) {
  const {jes, entity, goto} = ctx;
  const [sel, setSel] = useState(null);
  const units = {};
  const lines = [];
  jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity)).forEach(j=>j.lines.forEach(l=>{
    if (!l.unit_code) return;
    const u = units[l.unit_code] = units[l.unit_code]||{unit:l.unit_code, entity_id:j.entity_id, hard:0, capint:0, sales:0, cogs:0, n:0};
    if (['164200','164400','164100'].includes(l.account_code)) u.hard += (l.debit_amount||0)-(l.credit_amount||0);
    if (l.account_code==='164500') u.capint += (l.debit_amount||0)-(l.credit_amount||0);
    if (l.account_code==='491800') u.sales += (l.credit_amount||0)-(l.debit_amount||0);
    if (l.account_code==='510000') u.cogs += (l.debit_amount||0)-(l.credit_amount||0);
    u.n++;
    lines.push({unit:l.unit_code, je:j.je_number, date:j.je_date, src:j.source_system, memo:j.description, acct:l.account_code, dr:l.debit_amount||0, cr:l.credit_amount||0, sd:j.source_doc_id});
  }));
  const list = Object.values(units).map(u=>({...u,
    total:+(u.hard+u.capint+u.cogs).toFixed(2), // hard 已被 COGS relief 冲减, 加回展示口径
    status: u.sales>0?'SOLD':'IN PROGRESS',
    margin: u.sales>0? +(u.sales-u.cogs).toFixed(2) : null,
  })).sort((a,b)=>b.sales-a.sales || b.hard-a.hard);
  const selLines = sel? lines.filter(l=>l.unit===sel) : [];
  const entName = id=> (ENTITIES.find(e=>e.entity_id===id)||{}).entity_code||id;
  return <div className="full-bleed">
    <h2 className="page-h">Unit Cost Ledger · 按 Lot 看账</h2>
    <div className="kpi-row">
      <KPI label="Units 追踪" value={list.length}/>
      <KPI label="在建 CWIP (Unit 口径)" value={money(sum(list.filter(u=>u.status!=='SOLD'),u=>u.hard+u.capint))}/>
      <KPI label="已售 Units" value={list.filter(u=>u.status==='SOLD').length} tone="ok"/>
      <KPI label="累计毛利" value={money(sum(list.filter(u=>u.margin!=null),u=>u.margin))} tone="ok"/>
    </div>
    <SectionTitle>Unit 成本堆积与销售（点击 Lot 钻取分录与源单据）</SectionTitle>
    <Table exportName="unit-cost-ledger" rowKey="unit" onRow={r=>setSel(r.unit)} cols={[
      {h:'Unit / Lot',render:r=><b>{r.unit}</b>,csv:r=>r.unit},
      {h:'Entity',render:r=>entName(r.entity_id)},
      {h:'Hard Cost',num:true,render:r=><Money v={r.hard}/>,sortVal:r=>r.hard,csv:r=>r.hard},
      {h:'Cap. Interest',num:true,render:r=><Money v={r.capint}/>,csv:r=>r.capint},
      {h:'Sales',num:true,render:r=>r.sales?<Money v={r.sales}/>:'—',sortVal:r=>r.sales,csv:r=>r.sales},
      {h:'COGS',num:true,render:r=>r.cogs?<Money v={r.cogs}/>:'—',csv:r=>r.cogs},
      {h:'Margin',num:true,render:r=>r.margin!=null?<Money v={r.margin} bold/>:'—',csv:r=>r.margin||''},
      {h:'Status',render:r=><Badge tone={r.status==='SOLD'?'ok':'warn'}>{r.status}</Badge>,csv:r=>r.status},
    ]} rows={list} empty="当前实体暂无 Unit 维度分录"/>
    {sel && <><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setSel(null)}>关闭</Btn>}>{sel} · 账务明细与源单据</SectionTitle>
      <Table cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},
        {h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>},
        {h:'Account',k:'acct'},{h:'Memo',k:'memo'},
        {h:'Dr',num:true,render:r=><Money v={r.dr}/>},{h:'Cr',num:true,render:r=><Money v={r.cr}/>},
        {h:'源单据',render:r=> r.sd && SOURCE_DOCS[r.sd] ? <span className="link-btn" title={JSON.stringify(SOURCE_DOCS[r.sd])}>{SOURCE_DOCS[r.sd].type==='CLOSING_STATEMENT'?'📄 '+SOURCE_DOCS[r.sd].doc_no:'🧾 '+SOURCE_DOCS[r.sd].doc_no+' · '+SOURCE_DOCS[r.sd].po_no}</span> : '—'},
      ]} rows={selLines}/></>}
  </div>;
}
