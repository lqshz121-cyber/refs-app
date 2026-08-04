import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { money, sum } from './engine.js';
import { SOURCE_DOCS } from './seed.js';
import { ENTITIES } from './data.js';

// Unit Cost Ledger: cost accumulation → sales → COGS → margin for each lot or unit.
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
    total:+(u.hard+u.capint+u.cogs).toFixed(2), // Add relieved COGS back for the displayed unit-cost basis.
    status: u.sales>0?'SOLD':'IN PROGRESS',
    margin: u.sales>0? +(u.sales-u.cogs).toFixed(2) : null,
  })).sort((a,b)=>b.sales-a.sales || b.hard-a.hard);
  const selLines = sel? lines.filter(l=>l.unit===sel) : [];
  const entName = id=> (ENTITIES.find(e=>e.entity_id===id)||{}).entity_code||id;
  return <div className="full-bleed">
    <h2 className="page-h">Unit Cost Ledger · By Lot</h2>
    <div className="kpi-row">
      <KPI label="Tracked units" value={list.length}/>
      <KPI label="CWIP in progress (unit basis)" value={money(sum(list.filter(u=>u.status!=='SOLD'),u=>u.hard+u.capint))}/>
      <KPI label="Units sold" value={list.filter(u=>u.status==='SOLD').length} tone="ok"/>
      <KPI label="Cumulative margin" value={money(sum(list.filter(u=>u.margin!=null),u=>u.margin))} tone="ok"/>
    </div>
    <SectionTitle>Unit cost accumulation and sales (select a lot to drill into journals and source documents)</SectionTitle>
    <Table exportName="unit-cost-ledger" rowKey="unit" onRow={r=>setSel(r.unit)} cols={[
      {h:'Unit / Lot',render:r=><b>{r.unit}</b>,csv:r=>r.unit},
      {h:'Entity',render:r=>entName(r.entity_id)},
      {h:'Hard Cost',num:true,render:r=><Money v={r.hard}/>,sortVal:r=>r.hard,csv:r=>r.hard},
      {h:'Cap. Interest',num:true,render:r=><Money v={r.capint}/>,csv:r=>r.capint},
      {h:'Sales',num:true,render:r=>r.sales?<Money v={r.sales}/>:'—',sortVal:r=>r.sales,csv:r=>r.sales},
      {h:'COGS',num:true,render:r=>r.cogs?<Money v={r.cogs}/>:'—',csv:r=>r.cogs},
      {h:'Margin',num:true,render:r=>r.margin!=null?<Money v={r.margin} bold/>:'—',csv:r=>r.margin||''},
      {h:'Status',render:r=><Badge tone={r.status==='SOLD'?'ok':'warn'}>{r.status}</Badge>,csv:r=>r.status},
    ]} rows={list} empty="No posted unit-dimension entries for the selected entity."/>
    {sel && <><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setSel(null)}>Close</Btn>}>{sel} · Journal and source-document detail</SectionTitle>
      <Table cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},
        {h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>},
        {h:'Account',k:'acct'},{h:'Memo',k:'memo'},
        {h:'Dr',num:true,render:r=><Money v={r.dr}/>},{h:'Cr',num:true,render:r=><Money v={r.cr}/>},
        {h:'Source document',render:r=> r.sd && SOURCE_DOCS[r.sd] ? <span className="link-btn" title={JSON.stringify(SOURCE_DOCS[r.sd])}>{SOURCE_DOCS[r.sd].type==='CLOSING_STATEMENT'?'📄 '+SOURCE_DOCS[r.sd].doc_no:'🧾 '+SOURCE_DOCS[r.sd].doc_no+' · '+SOURCE_DOCS[r.sd].po_no}</span> : '—'},
      ]} rows={selLines}/></>}
  </div>;
}
