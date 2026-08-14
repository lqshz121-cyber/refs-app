import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAiWbsExceptionFindings} from './accounting-api.js';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';
import {StateBlock} from './ui.jsx';

const shortHash=value=>typeof value==='string'&&value.length>22?`${value.slice(0,18)}…${value.slice(-4)}`:'Not available';
const timestamp=value=>typeof value==='string'?value.replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):value;

export function AuthoritativeAiAuditWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAiWbsExceptionFindings({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  return <AuthoritativeWorkspaceView area="Review center">
    <AuthoritativeWorkspaceHeader eyebrow="ACCOUNTING INSIGHTS" title="Review center" description="Review exceptions that need a finance decision. Each item is linked to its supporting evidence." status="VIEW ONLY"/>
    <section className="report-workbench" aria-label="Accounting review items">
      <div className="report-workbench-head"><div><b>Items to review</b><div className="page-subtitle">Use the supporting evidence to decide the next step, then complete it in the appropriate accounting workflow.</div></div><button type="button" className="btn" disabled={state.phase==='LOADING'} onClick={load}>{state.phase==='LOADING'?'Refreshing items...':'Refresh items'}</button></div>
      <div className="report-shelf" aria-label="Review center safeguards"><span className="report-shelf-chip report-shelf-chip-on">SOURCE VERIFIED</span><span className="report-shelf-chip">AUDIT TRAIL</span><span className="report-shelf-chip">ASSIGN A REVIEWER</span><span className="report-shelf-chip">NO AUTOMATIC POSTING</span></div>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Loading review items">Reading the current review items for this company and period.</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title="Review items are not available">{state.error?.message||'The review service could not return items for this company and period.'} No substitute or browser-stored data is shown.</StateBlock>}
      {state.phase==='READY'&&state.rows.length===0&&<StateBlock tone="empty" title="No items need attention">There are no review items for this company and period.</StateBlock>}
      {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Accounting review items; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Risk</th><th>Reason</th><th>Recommended next step</th><th>Owner / due date</th><th>Supporting evidence</th><th>Available here</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.ai_finding_id}><td><span className={`badge ${row.risk_level==='HIGH'?'badge-danger':row.risk_level==='MEDIUM'?'badge-warning':'badge-muted'}`}>{row.risk_level}</span><div className="muted sm">Confidence {(row.confidence*100).toFixed(2)}%</div></td><td><b>{row.rule_id}</b><div className="muted sm">{row.reason}</div></td><td>{row.suggested_action}</td><td><b>{row.suggested_owner}</b><div className="muted sm">{row.due_date===null?'Assign a due date':row.due_date}</div></td><td><details><summary>View source details</summary><dl className="muted sm"><dt>Evidence row</dt><dd>{row.source_evidence_row_id}</dd><dt>Source record</dt><dd>{row.source_record_id} / {row.source_version}</dd><dt>Source row hash</dt><dd title={row.source_row_hash}>{shortHash(row.source_row_hash)}</dd><dt>Provider content hash</dt><dd title={row.provider_content_hash}>{shortHash(row.provider_content_hash)}</dd><dt>Observation hash</dt><dd title={row.observation_hash}>{shortHash(row.observation_hash)}</dd><dt>Captured</dt><dd>{timestamp(row.created_at)}</dd></dl></details></td><td><span className="badge badge-muted">REVIEW ONLY</span><div className="muted sm">This screen never creates or posts entries.</div></td></tr>)}</tbody></table></div>}
    </section>
  </AuthoritativeWorkspaceView>;
}
