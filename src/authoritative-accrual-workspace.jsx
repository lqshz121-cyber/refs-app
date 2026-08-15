import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAiAccrualCandidates} from './accounting-api.js';
import {AuthoritativeWorkspaceHeader,AuthoritativeWorkspaceView} from './authoritative-workbench-view.jsx';
import {StateBlock} from './ui.jsx';

const idle={phase:'LOADING',data:null,error:null};
const amount=(value,currency)=>{const number=Number(value);return Number.isFinite(number)?new Intl.NumberFormat('en-US',{style:'currency',currency}).format(number):String(value||'');};
const sourceLabel=trace=>`${trace.period_key} - ${trace.service_period_start} to ${trace.service_period_end}`;

export function AuthoritativeAccrualWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState(idle);
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAiAccrualCandidates({config,fetcher});setState(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});};
  useEffect(()=>{void load();},[config?.entityId,config?.periodId]);
  const candidates=state.data?.candidates||[];
  return <AuthoritativeWorkspaceView area="Accrual Center">
    <AuthoritativeWorkspaceHeader eyebrow="AUTHORITATIVE - AI ACCOUNTING" title="Accrual Center" description="Deterministic recurring-obligation analysis over retained, signed source evidence. A candidate is a review task, never an automatic journal." status="REVIEW REQUIRED"/>
    <section className="report-workbench" aria-label="Authoritative accrual analysis">
      <div className="report-workbench-head"><div><b>Recurring accrual review candidates</b><div className="page-subtitle">The API requires three exact consecutive closed-period source records and no current-period retained or posted source before it exposes a candidate.</div></div><button type="button" className="btn" disabled={state.phase==='LOADING'} onClick={load}>{state.phase==='LOADING'?'Refreshing analysis...':'Refresh analysis'}</button></div>
      <div className="report-shelf" aria-label="Accrual authority boundary"><span className="report-shelf-chip report-shelf-chip-on">SIGNED SOURCE TRACE</span><span className="report-shelf-chip">DETERMINISTIC RULE</span><span className="report-shelf-chip">HUMAN REVIEW REQUIRED</span><span className="report-shelf-chip">NO DRAFT OR POST</span></div>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Loading authoritative accrual analysis">Reading only the configured entity and accounting period from the accounting API.</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'AI_ACCRUAL_ANALYSIS_BLOCKED'}>{state.error?.message} No browser-stored, substitute, or demonstration candidates are shown.</StateBlock>}
      {state.phase==='READY'&&candidates.length===0&&<StateBlock tone="empty" title="No review-required accrual candidates">No recurring-obligation candidate met the complete evidence rule for this entity and period. This does not prove that all accruals are complete.</StateBlock>}
      {state.phase==='READY'&&candidates.length>0&&<section className="card" aria-label="Review-required accrual candidates"><div className="card-head"><div><h2>Human review queue</h2><p className="muted sm">Each candidate still needs an owner, due date, accrual basis, account mapping, member trace, and reversing-entry decision before any separate Draft workflow may be considered.</p></div><span className="badge badge-warning">{candidates.length} REVIEW REQUIRED</span></div><div className="table-wrap" role="region" tabIndex={0} aria-label="Accrual candidates; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Obligation</th><th>Current period</th><th>Historical basis</th><th>Required human fields</th><th>Source evidence</th><th>Authority</th></tr></thead><tbody>{candidates.map(candidate=><tr key={candidate.recurring_obligation_id}><td><b>{candidate.recurring_obligation_id}</b><div className="muted sm">{candidate.service_frequency} - {candidate.currency}</div></td><td><b>{candidate.period_key}</b><div className="muted sm">{candidate.rule_id.replaceAll('_',' ')}</div></td><td>{candidate.historical_amounts.map((value,index)=><div key={`${candidate.recurring_obligation_id}-${index}`}>{amount(value,candidate.currency)}</div>)}</td><td>{candidate.required_human_fields.map(field=><span key={field} className="badge badge-muted">{field.replaceAll('_',' ')}</span>)}</td><td><details><summary>Three retained source records</summary><ul className="muted sm">{candidate.prior_source_trace.map(trace=><li key={trace.source_document_line_id}><b>{sourceLabel(trace)}</b><br/>{trace.source_document_id}<br/>{trace.source_payload_hash}</li>)}</ul></details></td><td><span className="badge badge-muted">NO DRAFT OR POST</span><div className="muted sm">Review only</div></td></tr>)}</tbody></table></div></section>}
    </section>
  </AuthoritativeWorkspaceView>;
}
