import { useState } from 'react';
import { Btn, Badge, Money, Table, SectionTitle } from './ui.jsx';
import { acct, money } from './engine.js';

// QBO-style Account Register with running balance
export function AccountRegister({ctx}) {
  const {jes, coa, entity, goto} = ctx;
  const [code, setCode] = useState('111000');
  const a = coa.find(x=>x.account_code===code) || {};
  const rows = [];
  jes.filter(j=>j.posting_status==='POSTED' && (!entity||j.entity_id===entity))
     .slice().sort((x,y)=>x.je_date.localeCompare(y.je_date))
     .forEach(j=>j.lines.forEach(l=>{ if(l.account_code===code) rows.push({date:j.je_date, ref:j.je_number, type:j.je_type, src:j.source_system, memo:j.description,
        pay: l.credit_amount||0, dep: l.debit_amount||0, je:j}); }));
  const sign = ['ASSET','EXPENSE'].includes(a.account_type)?1:-1;
  let bal=0; rows.forEach(r=>{ bal += sign*(r.dep-r.pay); r.balance=bal; });
  return <div className="full-bleed">
    <h2 className="page-h">Account Register</h2>
    <div style={{display:'flex',gap:12,alignItems:'center',marginBottom:14}}>
      <select value={code} onChange={e=>setCode(e.target.value)} style={{padding:'9px 12px',borderRadius:8,border:'1px solid #d4d7dc',fontSize:14}}>
        {coa.map(x=><option key={x.account_code} value={x.account_code}>{x.account_code} {x.account_name}</option>)}
      </select>
      <Badge tone="muted">{a.account_type}</Badge>
      <span className="muted sm">Ending Balance</span><Money v={bal} bold/>
      <span style={{flex:1}}/>
      <Btn size="sm" variant="ghost" onClick={()=>goto('gl')}>Run Report</Btn>
      <Btn size="sm" variant="ghost" onClick={()=>goto('bankrec')}>Reconcile</Btn>
    </div>
    <Table exportName={'register-'+code} onRow={r=>goto('je')} cols={[
      {h:'Date',k:'date'},{h:'Ref No.',k:'ref'},{h:'Type',render:r=><Badge tone="muted">{r.src}</Badge>,csv:r=>r.src},
      {h:'Memo',k:'memo'},
      {h:'Payment (Cr)',num:true,render:r=>r.pay?<Money v={r.pay}/>:'',csv:r=>r.pay||''},
      {h:'Deposit (Dr)',num:true,render:r=>r.dep?<Money v={r.dep}/>:'',csv:r=>r.dep||''},
      {h:'Balance',num:true,render:r=><Money v={r.balance} bold/>,csv:r=>r.balance},
      {h:'✓',render:r=><Badge tone="ok">R</Badge>},
    ]} rows={rows} empty="该科目本期无过账记录"/>
  </div>;
}
