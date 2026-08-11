import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAging,refreshAuthoritativeControlTotals} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeReadFailure,authoritativeReadFailurePhase} from './authoritative-read-state.jsx';

// This is a read-only reporting surface.  The configured entity and period are
// accounting scope supplied by the authoritative runtime; the only reader
// choice supported by the API contract is the as-of date.
const BUCKETS=[['current_amount','Current'],['days_1_30','1–30 days'],['days_31_60','31–60 days'],['days_61_90','61–90 days'],['days_91_plus','91+ days'],['total_open_balance','Total open']];
const money=value=>{const m=/^(-?)([0-9]+)\.([0-9]{2})[0-9]{2}$/.exec(String(value??'0.0000'));if(!m)return String(value??'');const whole=m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',');return `${m[1]}$${whole}.${m[3]}`;};
const defaultAsOf=()=>{try{return new Date().toISOString().slice(0,10);}catch{return '2026-07-31';}};

export function AuthoritativeAgingWorkspace({config,side,fetcher=globalThis.fetch,onBack}){
  const label=side==='ap'?'AP':'AR';
  const businessLabel=side==='ap'?'Accounts payable':'Accounts receivable';
  const [asOf,setAsOf]=useState(defaultAsOf());
  const [state,setState]=useState({phase:'LOADING',aging:[],control:[],error:null});
  const load=async date=>{
    setState(current=>({...current,phase:'LOADING',error:null}));
    const [aging,control]=await Promise.all([
      refreshAuthoritativeAging({config,side,asOfDate:date,fetcher}),
      refreshAuthoritativeControlTotals({config,side,fetcher}),
    ]);
    if(!aging.ok||!control.ok){const failure=!aging.ok?aging:control;setState({phase:authoritativeReadFailurePhase(failure),aging:[],control:[],error:failure});return;}
    setState({phase:'READY',aging:aging.rows,control:control.rows,error:null});
  };
  useEffect(()=>{void load(asOf);},[config?.entityId,side]);
  const submit=event=>{event.preventDefault();void load(asOf);};
  return <section className="authoritative-aging-workspace stack" aria-label={`${label} aging and control totals`}>
    <header className="authoritative-aging-heading">
      <div>
        <div className="authoritative-eyebrow">{businessLabel} / aging report</div>
        <h2>{label} aging &amp; control totals</h2>
        <p className="page-subtitle">OIDC-authenticated, entity-scoped report facts from the accounting API. Browser seed data and local storage are not used.</p>
      </div>
      <div className="authoritative-aging-actions">
        {typeof onBack==='function'&&<button type="button" className="btn btn-sm" onClick={onBack}>Back to invoices &amp; receipts</button>}
        <span className="badge badge-muted">READ ONLY</span>
      </div>
    </header>
    <form className="authoritative-aging-controls" aria-label={`${label} aging report scope`} onSubmit={submit}>
      <output className="authoritative-aging-scope"><i>Entity reporting scope</i><b>{config.entityId}</b></output>
      <output className="authoritative-aging-scope"><i>Configured period</i><b>{config.periodId}</b></output>
      <label><span>As-of date</span><input type="date" aria-label={`${label} aging as-of date`} value={asOf} onChange={event=>setAsOf(event.target.value)}/></label>
      <button type="submit" className="btn btn-sm">Refresh evidence</button>
    </form>
    <section className="authoritative-aging-context" aria-label="Immutable evidence scope">
      <b>Evidence scope</b><span>Entity {config.entityId} · configured period {config.periodId} · as of {asOf}</span><span>GET-only refresh; no accounting record can be changed from this report.</span>
    </section>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative {label} aging…</StateBlock>}
    <AuthoritativeReadFailure state={state} onRetry={()=>void load(asOf)}/>
    {state.phase==='READY'&&<>
      <section className="card" aria-label={`${label} control totals`}>
        <div className="card-head"><div><h3>Control totals</h3><p className="muted sm">Subledger open balance compared with the retained GL control account.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.control.length?<StateBlock tone="empty" title="No control totals returned">No control-total evidence was returned for this entity. This scoped result is not proof of a zero control balance.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} control totals; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Currency</th><th className="ta-r">Subledger open</th><th className="ta-r">GL control</th><th>Status</th></tr></thead><tbody>{state.control.map(row=><tr key={row.currency}><td>{row.currency}</td><td className="num">{money(row.open_balance)}</td><td className="num">{money(row.control_balance)}</td><td><span className={row.in_balance?'badge badge-ok':'badge badge-warn'}>{row.in_balance?'In balance':'Out of balance'}</span></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card" aria-label={`${label} aging buckets`}>
        <div className="card-head"><div><h3>{businessLabel} aging as of {asOf}</h3><p className="muted sm">{state.aging.length} currency row(s) returned in retained evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.aging.length?<StateBlock tone="empty" title="No aging evidence returned">No open {label} balances were returned for this entity as of {asOf}. Change the as-of date and load the report again. This is not evidence of zero invoices, receipts, bills, payments, or ledger activity.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} aging buckets; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Currency</th>{BUCKETS.map(([,l])=><th key={l} className="ta-r">{l}</th>)}</tr></thead><tbody>{state.aging.map(row=><tr key={row.currency}><td>{row.currency}</td>{BUCKETS.map(([k,l])=><td key={l} className="num">{money(row[k])}</td>)}</tr>)}</tbody></table></div>}
      </section>
    </>}
  </section>;
}
