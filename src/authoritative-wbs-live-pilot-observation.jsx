import React,{useState} from 'react';
import {WBS_LIVE_PILOT_VIEWS,refreshAuthoritativeWbsLivePilot} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

export const WBS_LIVE_PILOT_SURFACE_TOOLS=Object.freeze({
  dashboard:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
  payables:Object.freeze(['list_payables']),
  bank:Object.freeze(['list_bank_transactions']),
  journal:Object.freeze(['list_journal_entries']),
  wbs:Object.freeze(['list_payables','list_bank_transactions','list_autorec_details','list_autorec_banks','list_journal_entries']),
});

const columnLabels=Object.freeze({source_record_hash:'Sanitized source hash',accounting_date:'Accounting date',currency:'Currency',amount:'Observed amount',direction:'Provider direction',status:'Provider status',payment_amount:'Observed payment',deposit_amount:'Observed deposit',match_status:'Provider match status',pay_amount:'Observed pay amount',debit_amount:'Observed debit',quantity:'Observed quantity',released_amount:'Observed released amount',released_quantity:'Observed released quantity',incurred_amount:'Observed incurred amount',credit_amount:'Observed credit',review_status:'Provider review status'});

const approvedTools=tools=>{
  const unique=[...new Set(Array.isArray(tools)?tools:[])];
  return unique.filter(tool=>Object.hasOwn(WBS_LIVE_PILOT_VIEWS,tool));
};

export function AuthoritativeWbsLivePilotObservation({config,fetcher=globalThis.fetch,tools=WBS_LIVE_PILOT_SURFACE_TOOLS.wbs,title='Production WBS provider observation',showRows=true}){
  const availableTools=approvedTools(tools);
  const [tool,setTool]=useState(availableTools[0]||'');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const view=WBS_LIVE_PILOT_VIEWS[tool];
  const observation=state.data;
  if(!view)return null;
  const read=async event=>{
    event.preventDefault();
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeWbsLivePilot({config,tool,limit:10,fetcher});
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  return <section className="report-workbench authoritative-wbs-live-pilot-observation" aria-label={title}>
    <div className="report-workbench-head"><div><b>{title}</b><div className="page-subtitle">Sanitized provider observations only. These rows are not REFS accounting records and are excluded from every accounting total, queue, Match, Reconcile, Draft, approval, and posting workflow.</div></div><div className="authoritative-wbs-live-pilot-status" aria-label="Production WBS observation boundary"><span className="badge badge-warn">UNSIGNED PILOT</span><span className="badge badge-muted">GET ONLY</span><span className="badge badge-muted">NOT ADMITTED</span><span className="badge badge-muted">NOT POSTABLE</span></div></div>
    <form className="filterbar authoritative-wbs-live-pilot-controls" onSubmit={read}>
      {availableTools.length>1?<label>WBS read-only view<select aria-label="WBS read-only view" value={tool} onChange={event=>{setTool(event.target.value);setState({phase:'IDLE',data:null,error:null});}}>{availableTools.map(name=><option key={name} value={name}>{WBS_LIVE_PILOT_VIEWS[name].label}</option>)}</select></label>:<span className="muted sm"><b>WBS read-only view:</b> {view.label}</span>}
      <button type="submit" className="btn" disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Reading WBS observation...':'Load WBS observation (GET only)'}</button>
    </form>
    {state.phase==='LOADING'&&<StateBlock tone="loading" title="Reading production WBS observation">The accounting API is requesting at most ten sanitized rows from this fixed GET-only view.</StateBlock>}
    {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_LIVE_PILOT_BLOCKED'}>WBS observation unavailable. Authoritative accounting data and workflows are unchanged.{observation&&' The previous validated WBS observation remains below.'}</StateBlock>}
    {state.phase==='IDLE'&&<StateBlock tone="empty" title="No WBS observation loaded">Use the GET-only reader to inspect sanitized provider facts. No credential, raw business identifier, accounting record, or action is exposed.</StateBlock>}
    {observation&&<>
      <div className="qbo-toolgrid"><span><i>Admission</i><b>{observation.status}</b></span><span><i>Provider signature</i><b>Not supplied</b></span><span><i>Provider captured at</i><b>{observation.captured_at}</b></span><span><i>Observed provider rows</i><b>{observation.record_count}</b></span><span><i>Provider content hash</i><b>{observation.provider_content_sha256}</b></span><span><i>Action authority</i><b>None</b></span></div>
      {showRows&&(observation.rows.length===0?<StateBlock tone="empty" title="No WBS rows were observed in this bounded read">This does not mean zero accounting activity or zero WBS activity.</StateBlock>:<div className="table-wrap authoritative-wbs-live-pilot-table" role="region" tabIndex={0} aria-label={`${view.label} unsigned production observation; scroll horizontally to view every column`}><table className="tbl"><thead><tr>{view.fields.map(field=><th scope="col" key={field}>{columnLabels[field]}</th>)}</tr></thead><tbody>{observation.rows.map(row=><tr key={row.source_record_hash}>{view.fields.map(field=><td key={field}>{row[field]===null?'Unavailable':row[field]}</td>)}</tr>)}</tbody></table></div>)}
    </>}
  </section>;
}
