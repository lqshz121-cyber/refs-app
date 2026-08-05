import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { acct, money, sum } from './engine.js';
import { SUBSIDIARY, subsidiaryOf, memberOf } from './coa-wbs.js';

// Subsidiary ledger: balances and details by account and tracked member.
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
    const m = memberOf(l) || '(Unassigned member)';
    rows[m] = rows[m]||{member:m, dr:0, cr:0, n:0};
    rows[m].dr += l.debit_amount||0; rows[m].cr += l.credit_amount||0; rows[m].n++;
    lines.push({member:m, je:j.je_number, date:j.je_date, src:j.source_system, memo:j.description, dr:l.debit_amount||0, cr:l.credit_amount||0});
  }));
  const list = Object.values(rows).map(r=>({...r, net:+(r.dr-r.cr).toFixed(2)})).sort((a,b)=>Math.abs(b.net)-Math.abs(a.net));
  const selLines = sel ? lines.filter(l=>l.member===sel) : [];
  return <div className="full-bleed">
    <h2 className="page-h">Subsidiary Ledger</h2>
    <div className="filter-bar">
      <label>Account <select value={code} onChange={e=>{setCode(e.target.value); setSel(null);}}>
        {codes.map(c=><option key={c} value={c}>{c} {acct(c).account_name} · {SUBSIDIARY[c]}</option>)}</select></label>
      <Badge tone="muted">Tracking type: {stype}</Badge>
      <span className="muted sm">{list.length} tracked members · Net {money(sum(list,r=>r.net))}</span>
    </div>
    <div className="kpi-row">
      <KPI label="Tracked members" value={list.length}/>
      <KPI label="Total debits" value={money(sum(list,r=>r.dr))}/>
      <KPI label="Total credits" value={money(sum(list,r=>r.cr))}/>
      <KPI label="Net" value={money(sum(list,r=>r.net))} tone={Math.abs(sum(list,r=>r.net))<0.01?'ok':undefined}/>
    </div>
    <SectionTitle>Balances by tracked member (select a member to view journal details)</SectionTitle>
    <Table exportName={'subledger-'+code} className="table-journal-entries" rowKey="member" onRow={r=>setSel(r.member)} cols={[
      {h:stype+' · Member',k:'member'},
      {h:'Entries',num:true,k:'n'},
      {h:'Debits',num:true,render:r=><Money v={r.dr}/>,sortVal:r=>r.dr,csv:r=>r.dr},
      {h:'Credits',num:true,render:r=><Money v={r.cr}/>,sortVal:r=>r.cr,csv:r=>r.cr},
      {h:'Net',num:true,render:r=><Money v={r.net} bold/>,sortVal:r=>r.net,csv:r=>r.net},
      {h:'Direction',render:r=> r.net>0.005?<Badge tone="warn">Due from / Dr</Badge>: r.net<-0.005?<Badge tone="ok">Due to / Cr</Badge>:<Badge tone="muted">Balanced</Badge>},
    ]} rows={list} empty="No subsidiary-ledger entries for this account in the selected period."/>
    {sel && <><SectionTitle right={<Btn size="sm" variant="ghost" onClick={()=>setSel(null)}>Close</Btn>}>{sel} · Details ({selLines.length} entries)</SectionTitle>
      <Table exportName={'subledger-'+code+'-detail'} className="table-journal-entries" onRow={(r)=>goto('je',{jeNumber:r.je})} cols={[
        {h:'Journal No.',k:'je'},{h:'Date',k:'date'},
        {h:'Source',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
        {h:'Memo',k:'memo'},
        {h:'Dr',num:true,render:r=><Money v={r.dr}/>,csv:r=>r.dr},
        {h:'Cr',num:true,render:r=><Money v={r.cr}/>,csv:r=>r.cr},
      ]} rows={selLines}/></>}
    <p className="muted sm">Accounts with subsidiary tracking (Bank, Vendor, Customer, Affiliate, or Loan) require a tracked member on every journal line. Account 291 is netted by counterparty; 111000 is maintained by bank account.</p>
  </div>;
}
