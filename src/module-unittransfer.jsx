import { useState } from 'react';
import { KPI, Btn, Badge, Money, Table, SectionTitle, Field } from './ui.jsx';
import { money, sum, acct } from './engine.js';
import { ENTITIES } from './data.js';

// Unit Transfer Accounting Workspace — paired A-out/B-in journals, cost bridge, and evidence.
const EVIDENCE = ['Deed / Title','WBS Transfer Screenshot','Accounting Memo','A-B Agreement','Wan Pacific Cutoff Settlement','FAST Cost Export','Loan Draw Package','Lender Consent','Tax / Legal Memo'];
export function UnitTransfer({ctx}) {
  const {jes, actions, toast, can} = ctx;
  const [fromId, setFromId] = useState(5);
  const [toId, setToId] = useState(9);
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [ev, setEv] = useState({});
  const [result, setResult] = useState(null);
  const unitsOf = (eid)=>{ const m={}; jes.filter(j=>j.posting_status==='POSTED'&&j.entity_id===eid).forEach(j=>j.lines.forEach(l=>{ if(l.unit_code&&['164100','164200','164400','164500'].includes(l.account_code)) m[l.unit_code]=(m[l.unit_code]||0)+(l.debit_amount||0)-(l.credit_amount||0); })); return m; };
  const A = ENTITIES.find(e=>e.entity_id===+fromId), B = ENTITIES.find(e=>e.entity_id===+toId);
  const unitsA = unitsOf(+fromId);
  const carrying = unit? +(unitsA[unit]||0).toFixed(2) : 0;
  const p = +price||carrying;
  const gain = +(p - carrying).toFixed(2);
  const evDone = EVIDENCE.filter(e=>ev[e]).length;
  const missing = EVIDENCE.filter(e=>!ev[e]);
  const doTransfer = ()=>{
    if (!unit){ toast('Select a unit first.','bad'); return; }
    if (carrying<=0){ toast('The selected unit has no carrying cost.','bad'); return; }
    if (evDone < 4){ toast(`Insufficient evidence (${evDone}/9): select Deed, WBS, Memo, and Agreement at minimum.`,'bad'); return; }
    const pair = 'UT-'+Date.now().toString().slice(-6);
    // A transfer-out: Dr Due from B (price) / Cr CWIP (carrying) / gain or loss.
    const aLines=[{account_code:'125000',debit_amount:p,credit_amount:0,member:B.entity_name,description:'Due from_'+B.entity_name,unit_code:unit},
                  {account_code:'164400',debit_amount:0,credit_amount:carrying,unit_code:unit}];
    if (gain>0.005) aLines.push({account_code:'787001',debit_amount:0,credit_amount:gain,description:'Gain on transfer',unit_code:unit});
    if (gain<-0.005) aLines.push({account_code:'787001',debit_amount:-gain,credit_amount:0,description:'Loss on transfer',unit_code:unit});
    actions.newJEFromRule({entity_id:A.entity_id, source_system:'INTERNAL', payee:B.entity_name, je_type:'AUTO', rule_code:'R-UT-OUT-01',
      description:`Unit Transfer OUT ${unit} → ${B.entity_code} [${pair}]`, lines:aLines});
    // B transfer-in: Dr CWIP (price=opening basis) / Cr Due to A
    actions.newJEFromRule({entity_id:B.entity_id, source_system:'INTERNAL', payee:A.entity_name, je_type:'AUTO', rule_code:'R-UT-IN-01',
      description:`Unit Transfer IN ${unit} ← ${A.entity_code} [${pair}]`,
      lines:[{account_code:'164400',debit_amount:p,credit_amount:0,unit_code:unit},
             {account_code:'291000',debit_amount:0,credit_amount:p,member:A.entity_name,description:'Due to/from_'+A.entity_name,unit_code:unit}]});
    setResult({pair, carrying, p, gain, missing});
    toast(`Paired draft journals created (${pair}); they enter the approval workflow and IC is balanced by the paired entries.`);
  };
  return <div className="full-bleed">
    <h2 className="page-h">Unit Transfer Accounting</h2>
    <div className="filter-bar">
      <label>From <select value={fromId} onChange={e=>{setFromId(e.target.value); setUnit('');}}>{ENTITIES.filter(e=>['Vertical','ProjectCo','LandCo'].includes(e.entity_type)).map(e=><option key={e.entity_id} value={e.entity_id}>{e.entity_code} {e.entity_name}</option>)}</select></label>
      <label>To <select value={toId} onChange={e=>setToId(e.target.value)}>{ENTITIES.filter(e=>e.entity_id!==+fromId).map(e=><option key={e.entity_id} value={e.entity_id}>{e.entity_code} {e.entity_name}</option>)}</select></label>
      <label>Unit <select value={unit} onChange={e=>setUnit(e.target.value)}><option value="">— Select —</option>{Object.keys(unitsA).map(u=><option key={u}>{u}</option>)}</select></label>
      <label>Transfer Price <input className="date-in" style={{width:110}} type="number" placeholder={carrying||''} value={price} onChange={e=>setPrice(e.target.value)}/></label>
    </div>
    <div className="qbo-grid" style={{gridTemplateColumns:'repeat(3,1fr)'}}>
      <div className="qbo-card"><h4>Unit Cost Bridge</h4>
        <div className="kv"><span>A Carrying Cost ({A&&A.entity_code})</span><Money v={carrying}/></div>
        <div className="kv"><span>Transfer Price</span><Money v={p}/></div>
        <div className="kv"><span>Gain / (Loss) @A</span><Money v={gain}/></div>
        <div className="kv tot"><span>B Opening Basis</span><Money v={p} bold/></div>
      </div>
      <div className="qbo-card"><h4>Paired journal preview</h4>
        <p className="muted sm" style={{margin:'4px 0'}}><b>{A&&A.entity_code} OUT:</b> Dr 125000 Due from_{B&&B.entity_code} {money(p)} / Cr 164400 CWIP {money(carrying)}{Math.abs(gain)>0.005?` / ${gain>0?'Cr':'Dr'} 787001 ${money(Math.abs(gain))}`:''}</p>
        <p className="muted sm" style={{margin:'4px 0'}}><b>{B&&B.entity_code} IN:</b> Dr 164400 CWIP {money(p)} / Cr 291000 Due to_{A&&A.entity_code} {money(p)}</p>
        <p className="muted sm">The pair is linked by its immutable pair reference; cutoff follows the accounting effective date.</p>
      </div>
      <div className="qbo-card"><h4>Evidence Checklist ({evDone}/9)</h4>
        {EVIDENCE.map(e=><label key={e} style={{display:'flex',gap:8,fontSize:12.5,margin:'3px 0'}}><input type="checkbox" checked={!!ev[e]} onChange={x=>setEv(s=>({...s,[e]:x.target.checked}))}/>{e}</label>)}
      </div>
    </div>
    <div style={{marginTop:14}}>
      <Btn variant="primary" onClick={doTransfer} disabled={!can('GL.JE.CREATE')}>Create A/B paired draft JEs</Btn>
      {evDone<9 && <span className="muted sm" style={{marginLeft:12}}>Evidence missing: {missing.slice(0,3).join(' · ')}{missing.length>3?` and ${missing.length} more`:''}</span>}
    </div>
    {result && <div className="src-card" style={{marginTop:14}}>
      <div className="src-chain"><span className="chip">WBS Transfer</span>→<span className="chip chip-on">Pair {result.pair}</span>→<span className="chip">A OUT JE</span>→<span className="chip">B IN JE</span>→<span className="chip">IC Matching</span></div>
      <div className="src-grid"><span><i>Cost Bridge</i><b>{money(result.carrying)} → {money(result.p)}</b></span><span><i>Gain/(Loss)</i><b>{money(result.gain)}</b></span><span><i>Missing evidence</i><b>{result.missing.length} items</b></span></div>
    </div>}
  </div>;
}
