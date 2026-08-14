import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAiWbsExceptionFindings} from './accounting-api.js';
import {AuthoritativeDemoView,AuthoritativeDemoWorkspaceHeader} from './authoritative-demo-view.jsx';
import {StateBlock} from './ui.jsx';

const shortHash=value=>typeof value==='string'&&value.length>22?`${value.slice(0,18)}…${value.slice(-4)}`:'Not recorded';
const timestamp=value=>typeof value==='string'?value.replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):value;
const findingLabel=rule=>({WBS_UNSIGNED_SOURCE:'Source verification needed',WBS_ENTITY_SCOPE_EXCEPTION:'Company scope needs review'})[rule]||'Accounting exception';

export function AuthoritativeAiAuditWorkspace({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeAiWbsExceptionFindings({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  return <AuthoritativeDemoView area="Accounting review">
    <AuthoritativeDemoWorkspaceHeader eyebrow="ACCOUNTING REVIEW" title="Review accounting exceptions" description="Review source issues that need a finance decision. Suggestions help with triage; entries still require the standard accounting review and approval workflow." status="FOR REVIEW"/>
    <section className="report-workbench" aria-label="Accounting review items">
      <div className="report-workbench-head"><div><b>Items needing attention</b><div className="page-subtitle">These review items are saved for the current company. Use the source details to decide the appropriate next step.</div></div><button type="button" className="btn" disabled={state.phase==='LOADING'} onClick={load}>{state.phase==='LOADING'?'Refreshing…':'Refresh'}</button></div>
      <div className="report-shelf" aria-label="Accounting review safeguards"><span className="report-shelf-chip report-shelf-chip-on">SAVED EVIDENCE</span><span className="report-shelf-chip">SOURCE HISTORY</span><span className="report-shelf-chip">FINANCE REVIEW REQUIRED</span><span className="report-shelf-chip">NO AUTOMATIC POSTING</span></div>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Loading review items">Getting the saved review items for this company.</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title="Review items are temporarily unavailable">Try again shortly. Your accounting records have not been changed.</StateBlock>}
      {state.phase==='READY'&&state.rows.length===0&&<StateBlock tone="empty" title="No review items right now">There are no saved exception items for the current company and period.</StateBlock>}
      {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Accounting review items; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Priority</th><th>What needs review</th><th>Recommended next step</th><th>Owner / due date</th><th>Source details</th><th>Workflow</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.ai_finding_id}><td><span className={`badge ${row.risk_level==='HIGH'?'badge-danger':row.risk_level==='MEDIUM'?'badge-warning':'badge-muted'}`}>{row.risk_level}</span><div className="muted sm">Suggestion confidence {(row.confidence*100).toFixed(0)}%</div></td><td><b>{findingLabel(row.rule_id)}</b><div className="muted sm">{row.reason}</div></td><td>{row.suggested_action}</td><td><b>{row.suggested_owner}</b><div className="muted sm">{row.due_date===null?'Set a due date during review':row.due_date}</div></td><td><details><summary>{row.source_record_id} / {row.source_version}</summary><dl className="muted sm"><dt>Evidence row</dt><dd>{row.source_evidence_row_id}</dd><dt>Source row hash</dt><dd title={row.source_row_hash}>{shortHash(row.source_row_hash)}</dd><dt>Provider content hash</dt><dd title={row.provider_content_hash}>{shortHash(row.provider_content_hash)}</dd><dt>Observation hash</dt><dd title={row.observation_hash}>{shortHash(row.observation_hash)}</dd><dt>Recorded</dt><dd>{timestamp(row.created_at)}</dd></dl></details></td><td><span className="badge badge-muted">FINANCE REVIEW</span><div className="muted sm">No entry or posting is created automatically.</div></td></tr>)}</tbody></table></div>}
    </section>
  </AuthoritativeDemoView>;
}
