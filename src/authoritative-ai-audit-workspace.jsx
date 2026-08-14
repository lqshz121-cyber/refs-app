import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAiWbsExceptionFindings} from './accounting-api.js';
import {AuthoritativeDemoView,AuthoritativeDemoWorkspaceHeader} from './authoritative-demo-view.jsx';
import {StateBlock} from './ui.jsx';

const shortHash=value=>typeof value==='string'&&value.length>22?`${value.slice(0,18)}…${value.slice(-4)}`:'Unavailable';
const timestamp=value=>typeof value==='string'?value.replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):value;

export function AuthoritativeAiAuditWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAiWbsExceptionFindings({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  return <AuthoritativeDemoView area="AI Audit Center">
    <AuthoritativeDemoWorkspaceHeader eyebrow="AUTHORITATIVE - AI ACCOUNTING" title="AI Audit Center" description="Server-materialized WBS exception findings with immutable source hashes. This workspace is evidence only: it cannot create a Draft JE, review, approve, post, or write WBS." status="READ ONLY"/>
    <section className="report-workbench" aria-label="Persisted AI Audit findings">
      <div className="report-workbench-head"><div><b>Open exception findings</b><div className="page-subtitle">The API returns only findings retained for this signed-in entity. A valid empty result is not a claim that accounting is complete or free of exceptions.</div></div><button type="button" className="btn" disabled={state.phase==='LOADING'} onClick={load}>{state.phase==='LOADING'?'Refreshing findings...':'Refresh findings'}</button></div>
      <div className="report-shelf" aria-label="AI Audit authority boundary"><span className="report-shelf-chip report-shelf-chip-on">SERVER MATERIALIZED</span><span className="report-shelf-chip">IMMUTABLE TRACE</span><span className="report-shelf-chip">HUMAN ASSIGNMENT REQUIRED</span><span className="report-shelf-chip">NO DRAFT OR POST</span></div>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Loading persisted AI findings">Reading only immutable, entity-scoped exception evidence from the accounting API.</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'AI_FINDING_READ_BLOCKED'}>{state.error?.message} No substitute, browser-stored, or demonstration findings are shown.</StateBlock>}
      {state.phase==='READY'&&state.rows.length===0&&<StateBlock tone="empty" title="No persisted AI findings returned">The authoritative API returned an empty scoped list. This does not prove that no accounting, source, or reconciliation exceptions exist outside this retained WBS exception contract.</StateBlock>}
      {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Persisted AI Audit findings; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Risk</th><th>Rule and reason</th><th>Suggested human action</th><th>Owner / due date</th><th>Source trace</th><th>Authority</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.ai_finding_id}><td><span className={`badge ${row.risk_level==='HIGH'?'badge-danger':row.risk_level==='MEDIUM'?'badge-warning':'badge-muted'}`}>{row.risk_level}</span><div className="muted sm">Confidence {(row.confidence*100).toFixed(2)}%</div></td><td><b>{row.rule_id}</b><div className="muted sm">{row.reason}</div></td><td>{row.suggested_action}</td><td><b>{row.suggested_owner}</b><div className="muted sm">{row.due_date===null?'Due date requires human assignment':row.due_date}</div></td><td><details><summary>{row.source_record_id} / {row.source_version}</summary><dl className="muted sm"><dt>Evidence row</dt><dd>{row.source_evidence_row_id}</dd><dt>Source row hash</dt><dd title={row.source_row_hash}>{shortHash(row.source_row_hash)}</dd><dt>Provider content hash</dt><dd title={row.provider_content_hash}>{shortHash(row.provider_content_hash)}</dd><dt>Observation hash</dt><dd title={row.observation_hash}>{shortHash(row.observation_hash)}</dd><dt>Materialized</dt><dd>{timestamp(row.created_at)}</dd></dl></details></td><td><span className="badge badge-muted">EVIDENCE ONLY</span><div className="muted sm">Draft / review / approve / post: disabled</div></td></tr>)}</tbody></table></div>}
    </section>
  </AuthoritativeDemoView>;
}
