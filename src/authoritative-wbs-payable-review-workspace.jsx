import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeWbsPayableReviewCandidates,reviewAuthoritativeWbsPayable} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const compact=value=>value??'Unavailable';
const immutableCandidate=row=>JSON.stringify(row);

export function AuthoritativeWbsPayableReviewWorkspace({config,fetcher=globalThis.fetch,onReviewed=()=>{}}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [selected,setSelected]=useState(null);
  const [attachmentIds,setAttachmentIds]=useState([]);
  const [reason,setReason]=useState('Review the exact admitted WBS Payable evidence for AP Draft readiness');
  const [command,setCommand]=useState({phase:'IDLE',error:null,data:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeWbsPayableReviewCandidates({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  const open=async row=>{
    setCommand({phase:'IDLE',error:null,data:null});setSelected(null);setAttachmentIds([]);
    const result=await refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId:row.wbs_inbound_row_id,fetcher});
    if(!result.ok||immutableCandidate(result.row)!==immutableCandidate(row)){setCommand({phase:'BLOCKED',data:null,error:result.ok?{code:'WBS_PAYABLE_REVIEW_SCOPE_CHANGED',message:'The server-derived review candidate changed. Refresh the list before reviewing.'}:result});return;}
    setSelected(result.row);setAttachmentIds(result.row.can_review?result.row.attachment_choices.map(choice=>choice.attachment_id):[]);
  };
  const review=async event=>{
    event.preventDefault();if(!selected)return;setCommand({phase:'LOADING',error:null,data:null});
    const latest=await refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId:selected.wbs_inbound_row_id,fetcher});
    if(!latest.ok||immutableCandidate(latest.row)!==immutableCandidate(selected)){setCommand({phase:'BLOCKED',data:null,error:latest.ok?{code:'WBS_PAYABLE_REVIEW_SCOPE_CHANGED',message:'The candidate changed before review. Refresh and inspect the latest server evidence.'}:latest});return;}
    const idempotencyKey=`wbs-payable-review-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`;
    const result=await reviewAuthoritativeWbsPayable({config,candidate:latest.row,attachmentIds,reason,idempotencyKey,fetcher});
    if(!result.ok){setCommand({phase:'BLOCKED',data:null,error:result});return;}
    setCommand({phase:'READY',data:result.data,error:null});setSelected(null);setAttachmentIds([]);await load();onReviewed();
  };
  return <section className="report-workbench authoritative-wbs-payable-review" aria-label="Admitted WBS Payable review readiness">
    <div className="report-workbench-head"><div><b>Admitted WBS Payables awaiting review</b><div className="page-subtitle">Server-derived, signed production evidence only. Review retains immutable evidence; it never creates a Bill or Journal Draft.</div></div><button type="button" className="btn" disabled={state.phase==='LOADING'||command.phase==='LOADING'} onClick={load}>Refresh review readiness</button></div>
    <div className="report-shelf" aria-label="WBS Payable review boundary"><span className="report-shelf-chip report-shelf-chip-on">SIGNED + ADMITTED</span><span className="report-shelf-chip">SERVER DERIVED</span><span className="report-shelf-chip">REVIEW ONLY</span><span className="report-shelf-chip">NO DRAFT</span></div>
    {state.phase==='LOADING'&&<StateBlock tone="loading" title="Loading admitted WBS Payables">Checking exact production receipt, entity, currency, period, approved mapping, local master data, SoD, and verified attachments.</StateBlock>}
    {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_PAYABLE_REVIEW_CANDIDATES_BLOCKED'}>{state.error?.message}</StateBlock>}
    {state.phase==='READY'&&state.rows.length===0&&<StateBlock tone="empty" title="No admitted Payables awaiting review">The authenticated API returned a valid empty result. Unsigned pilot rows are never included.</StateBlock>}
    {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Admitted WBS Payables awaiting review; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Document</th><th>Accounting date</th><th>Vendor</th><th>Currency</th><th>Gross amount</th><th>Readiness</th><th>Review</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.wbs_inbound_row_id}><td>{compact(row.document_number)}</td><td>{compact(row.accounting_date)}</td><td>{compact(row.vendor_name)}</td><td>{compact(row.currency)}</td><td>{compact(row.gross_amount)}</td><td><span className={`badge ${row.can_review?'badge-success':'badge-muted'}`}>{row.review_readiness}</span></td><td><button type="button" className="linklike" disabled={!row.can_review||command.phase==='LOADING'} onClick={()=>open(row)}>{row.can_review?'Inspect review evidence':'Unavailable'}</button></td></tr>)}</tbody></table></div>}
    {selected&&<form className="filterbar" onSubmit={review} aria-label="Review admitted WBS Payable">
      <div className="qbo-toolgrid"><span><i>Document</i><b>{compact(selected.document_number)}</b></span><span><i>Invoice date</i><b>{selected.invoice_date}</b></span><span><i>Period</i><b>{selected.period_id}</b></span><span><i>Evidence</i><b>{selected.evidence_hash}</b></span></div>
      <fieldset><legend>Verified-clean support evidence</legend>{selected.attachment_choices.map(choice=><label key={choice.attachment_id}><input type="checkbox" checked={attachmentIds.includes(choice.attachment_id)} onChange={event=>setAttachmentIds(current=>event.target.checked?[...current,choice.attachment_id]:current.filter(id=>id!==choice.attachment_id))}/>{choice.name} · {choice.media_type} · verified {choice.verified_at}</label>)}</fieldset>
      <label htmlFor="wbs-payable-review-reason">Reviewer reason<textarea id="wbs-payable-review-reason" required minLength="8" maxLength="2000" rows="3" value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <button type="submit" className="btn" disabled={command.phase==='LOADING'||attachmentIds.length===0}>{command.phase==='LOADING'?'Reviewing exact evidence...':'Review evidence only'}</button>
    </form>}
    {command.phase==='BLOCKED'&&<StateBlock tone="blocked" title={command.error?.code||'WBS_PAYABLE_REVIEW_BLOCKED'}>{command.error?.message} No Bill or Journal Draft was created.</StateBlock>}
    {command.phase==='READY'&&<StateBlock tone="success" title="WBS Payable evidence reviewed">Immutable review evidence is ready for the separate maker step. Nothing was submitted, approved, or posted, and no Draft was created by this action.</StateBlock>}
  </section>;
}
