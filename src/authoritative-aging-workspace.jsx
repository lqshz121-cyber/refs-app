import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAging,refreshAuthoritativeControlTotals} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

// Read-only AP/AR aging + control totals from the authoritative accounting API.
// It manages its own read lifecycle and fails closed exactly like the other
// authoritative workspaces: browser seed data and local storage are never an
// accounting authority here. Amounts arrive as fixed-4 strings (or numbers,
// normalised by the client) and are only formatted for display.
const BUCKETS=[['current_amount','Current'],['days_1_30','1-30 days'],['days_31_60','31-60 days'],['days_61_90','61-90 days'],['days_91_plus','91+ days'],['total_open_balance','Total open']];
const money=value=>{const m=/^(-?)([0-9]+)\.([0-9]{2})[0-9]{2}$/.exec(String(value??'0.0000'));if(!m)return String(value??'');const whole=m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',');return `${m[1]}$${whole}.${m[3]}`;};
const defaultAsOf=()=>{try{return new Date().toISOString().slice(0,10);}catch{return '2026-07-31';}};

export function AuthoritativeAgingWorkspace({config,side,fetcher=globalThis.fetch}){
  const label=side==='ap'?'AP':'AR';
  const [asOf,setAsOf]=useState(defaultAsOf());
  const [state,setState]=useState({phase:'LOADING',aging:[],control:[],error:null});
  const load=async date=>{
    setState(current=>({...current,phase:'LOADING',error:null}));
    const [aging,control]=await Promise.all([
      refreshAuthoritativeAging({config,side,asOfDate:date,fetcher}),
      refreshAuthoritativeControlTotals({config,side,fetcher}),
    ]);
    if(!aging.ok||!control.ok){const failure=!aging.ok?aging:control;setState({phase:'ERROR',aging:[],control:[],error:failure});return;}
    setState({phase:'READY',aging:aging.rows,control:control.rows,error:null});
  };
  useEffect(()=>{load(asOf);},[config?.entityId,side]);
  return <section className="stack" aria-label={`${label} aging and control totals`} style={{marginTop:18}}>
    <div><h2>{label} aging &amp; control totals</h2><p className="page-subtitle">OIDC-authenticated, entity-scoped read from the accounting API. Browser seed data and local storage are not used.</p></div>
    <div className="filter-bar"><label className="muted sm">As of <input type="date" aria-label={`${label} aging as-of date`} value={asOf} onChange={event=>{const next=event.target.value;setAsOf(next);load(next);}}/></label><span className="muted sm">Entity {config.entityId} · Read only</span></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative {label} aging…</StateBlock>}
    {state.phase==='ERROR'&&<StateBlock tone="error" title={state.error?.code} actions={<button type="button" className="btn btn-sm" onClick={()=>load(asOf)}>Retry read</button>}><p>{state.error?.message}</p></StateBlock>}
    {state.phase==='READY'&&<>
      <section className="card" aria-label={`${label} control totals`}>
        <div className="card-head"><div><h3>Control totals</h3><p className="muted sm">Subledger open balance tied to the GL control account.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.control.length?<StateBlock tone="empty" title="No control totals returned">No control-total evidence was returned for this entity.</StateBlock>:<div className="table-wrap"><table className="tbl"><thead><tr><th>Currency</th><th className="ta-r">Subledger open</th><th className="ta-r">GL control</th><th>Status</th></tr></thead><tbody>{state.control.map(row=><tr key={row.currency}><td>{row.currency}</td><td className="num">{money(row.open_balance)}</td><td className="num">{money(row.control_balance)}</td><td><span className={row.in_balance?'badge badge-ok':'badge badge-warn'}>{row.in_balance?'In balance':'Out of balance'}</span></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card" aria-label={`${label} aging buckets`}>
        <div className="card-head"><div><h3>Aging as of {asOf}</h3><p className="muted sm">{state.aging.length} currency row(s) in retained evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.aging.length?<StateBlock tone="empty" title="No aging evidence returned">No open {label} balances were returned as of {asOf}.</StateBlock>:<div className="table-wrap"><table className="tbl"><thead><tr><th>Currency</th>{BUCKETS.map(([,l])=><th key={l} className="ta-r">{l}</th>)}</tr></thead><tbody>{state.aging.map(row=><tr key={row.currency}><td>{row.currency}</td>{BUCKETS.map(([k,l])=><td key={l} className="num">{money(row[k])}</td>)}</tr>)}</tbody></table></div>}
      </section>
    </>}
  </section>;
}
