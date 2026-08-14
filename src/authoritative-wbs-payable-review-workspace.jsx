import React,{useEffect,useRef,useState} from 'react';
import {bindAuthoritativeWbsPayableUploadedAttachment,refreshAuthoritativeWbsPayableAttachmentUploads,refreshAuthoritativeWbsPayableReviewCandidates,reviewAuthoritativeWbsPayable} from './accounting-api.js';
import {uploadVerifiedAttachment} from './attachment-api.js';
import {StateBlock} from './ui.jsx';

const compact=value=>value??'Unavailable';
const immutableCandidate=row=>JSON.stringify(row);

const ReviewCandidateReadBlocked=({error,onRetry})=>{
  const denied=error?.code==='AUTHORIZATION_DENIED';
  return <StateBlock tone="blocked" title={denied?'NO_PERMISSION — WBS Payable reviewer access required':error?.code||'WBS_PAYABLE_REVIEW_CANDIDATES_BLOCKED'}
    actions={<button type="button" className="btn btn-sm" onClick={onRetry}>Retry review readiness</button>}>
    {denied?<>
      <p>The current session cannot read signed WBS Payables for this entity.</p>
      <p>Next step: an administrator must assign the <b>WBS_PAYABLE_REVIEWER</b> role for this entity. That role supplies <code>WBS.PAYABLE.REVIEW</code> and <code>AP.VIEW</code>; it does not grant import, Draft creation, approval, or posting.</p>
      <p>Unsigned Pilot observations remain excluded even after this read permission is assigned.</p>
    </>:<p>{error?.message||'The authoritative review-candidate read is unavailable for this entity.'}</p>}
  </StateBlock>;
};

export function AuthoritativeWbsPayableReviewWorkspace({config,fetcher=globalThis.fetch,onReviewed=()=>{}}){
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const [selected,setSelected]=useState(null);
  const [attachmentIds,setAttachmentIds]=useState([]);
  const [reason,setReason]=useState('Review the exact admitted WBS Payable evidence for AP Draft readiness');
  const [command,setCommand]=useState({phase:'IDLE',error:null,data:null});
  const [uploads,setUploads]=useState({phase:'IDLE',data:null,error:null});
  const [file,setFile]=useState(null);
  const [bindReason,setBindReason]=useState('Bind this verified support document to the exact admitted WBS Payable');
  const uploadIntent=useRef({signature:null,key:null});const bindIntent=useRef({signature:null,key:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeWbsPayableReviewCandidates({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'BLOCKED',rows:[],error:result});};
  useEffect(()=>{void load();},[config?.entityId]);
  const open=async row=>{
    setCommand({phase:'IDLE',error:null,data:null});setUploads({phase:'LOADING',data:null,error:null});setSelected(null);setAttachmentIds([]);setFile(null);
    const result=await refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId:row.wbs_inbound_row_id,fetcher});
    if(!result.ok||immutableCandidate(result.row)!==immutableCandidate(row)){setUploads({phase:'IDLE',data:null,error:null});setCommand({phase:'BLOCKED',data:null,error:result.ok?{code:'WBS_PAYABLE_REVIEW_SCOPE_CHANGED',message:'The server-derived review candidate changed. Refresh the list before reviewing.'}:result});return;}
    setSelected(result.row);setAttachmentIds(result.row.can_review?result.row.attachment_choices.map(choice=>choice.attachment_id):[]);
    const uploadResult=await refreshAuthoritativeWbsPayableAttachmentUploads({config,wbsInboundRowId:result.row.wbs_inbound_row_id,fetcher});
    setUploads(uploadResult.ok?{phase:'READY',data:uploadResult.data,error:null}:{phase:'BLOCKED',data:null,error:uploadResult});
  };
  const refreshUploads=async()=>{if(!selected)return;setUploads({phase:'LOADING',data:null,error:null});const result=await refreshAuthoritativeWbsPayableAttachmentUploads({config,wbsInboundRowId:selected.wbs_inbound_row_id,fetcher});setUploads(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});};
  const upload=async event=>{event.preventDefault();if(!selected||!file)return;const signature=`${selected.wbs_inbound_row_id}:${file.name}:${file.size}:${file.lastModified}`;if(uploadIntent.current.signature!==signature)uploadIntent.current={signature,key:`wbs-payable-upload-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`};setCommand({phase:'LOADING',error:null,data:null});const result=await uploadVerifiedAttachment({config,file,wbsInboundRowId:selected.wbs_inbound_row_id,idempotencyKey:uploadIntent.current.key,fetcher});if(!result.ok){setCommand({phase:'BLOCKED',error:result,data:null});return;}uploadIntent.current={signature:null,key:null};setFile(null);setCommand({phase:'READY',error:null,data:{kind:'UPLOADED'}});await refreshUploads();};
  const bind=async attachment=>{if(!selected||!attachment?.can_bind||!globalThis.confirm?.(`Bind ${attachment.name} to WBS Payable ${compact(selected.document_number)}? This does not Review or create a Draft.`))return;const signature=`${selected.wbs_inbound_row_id}:${attachment.attachment_id}:${selected.revision}:${bindReason.trim()}`;if(bindIntent.current.signature!==signature)bindIntent.current={signature,key:`wbs-payable-bind-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`};setCommand({phase:'LOADING',error:null,data:null});const latest=await refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId:selected.wbs_inbound_row_id,fetcher});if(!latest.ok){setCommand({phase:'BLOCKED',error:latest,data:null});return;}const result=await bindAuthoritativeWbsPayableUploadedAttachment({config,candidate:latest.row,attachmentId:attachment.attachment_id,reason:bindReason,idempotencyKey:bindIntent.current.key,fetcher});if(!result.ok){setCommand({phase:'BLOCKED',error:result,data:null});return;}bindIntent.current={signature:null,key:null};const refreshed=await refreshAuthoritativeWbsPayableReviewCandidates({config,wbsInboundRowId:selected.wbs_inbound_row_id,fetcher});if(!refreshed.ok){setCommand({phase:'BLOCKED',error:refreshed,data:null});return;}setSelected(refreshed.row);setAttachmentIds(refreshed.row.attachment_choices.map(choice=>choice.attachment_id));setCommand({phase:'READY',error:null,data:{kind:'BOUND'}});await refreshUploads();await load();};
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
    {state.phase==='BLOCKED'&&<ReviewCandidateReadBlocked error={state.error} onRetry={load}/>}
    {state.phase==='READY'&&state.rows.length===0&&<StateBlock tone="empty" title="No admitted Payables awaiting review">The authenticated API returned a valid empty result. Unsigned pilot rows are never included.</StateBlock>}
    {state.phase==='READY'&&state.rows.length>0&&<div className="table-wrap" role="region" tabIndex={0} aria-label="Admitted WBS Payables awaiting review; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Document</th><th>Accounting date</th><th>Vendor</th><th>Currency</th><th>Gross amount</th><th>Readiness</th><th>Evidence</th></tr></thead><tbody>{state.rows.map(row=><tr key={row.wbs_inbound_row_id}><td>{compact(row.document_number)}</td><td>{compact(row.accounting_date)}</td><td>{compact(row.vendor_name)}</td><td>{compact(row.currency)}</td><td>{compact(row.gross_amount)}</td><td><span className={`badge ${row.can_review?'badge-success':'badge-muted'}`}>{row.review_readiness}</span></td><td><button type="button" className="linklike" disabled={!row.can_review&&row.review_readiness!=='VERIFIED_ATTACHMENT_REQUIRED'||command.phase==='LOADING'} onClick={()=>open(row)}>{row.can_review?'Inspect review evidence':row.review_readiness==='VERIFIED_ATTACHMENT_REQUIRED'?'Add support evidence':'Unavailable'}</button></td></tr>)}</tbody></table></div>}
    {selected&&<div className="filterbar" aria-label="Exact WBS Payable support evidence">
      <div className="qbo-toolgrid"><span><i>Document</i><b>{compact(selected.document_number)}</b></span><span><i>Invoice date</i><b>{selected.invoice_date}</b></span><span><i>Period</i><b>{selected.period_id}</b></span><span><i>Evidence</i><b>{selected.evidence_hash}</b></span></div>
      {uploads.phase==='LOADING'&&<StateBlock tone="loading" title="Loading row-bound attachments">Only support evidence reserved for this exact Payable is read.</StateBlock>}
      {uploads.phase==='BLOCKED'&&<StateBlock tone="blocked" title={uploads.error?.code||'ATTACHMENT_ACCESS_BLOCKED'}>{uploads.error?.message}</StateBlock>}
      {uploads.phase==='READY'&&<>
        {uploads.data.can_upload&&<form onSubmit={upload} aria-label="Upload support evidence for this WBS Payable"><label htmlFor="wbs-payable-support-file">Support document<input id="wbs-payable-support-file" type="file" required accept="application/pdf,image/png,image/jpeg,text/csv" onChange={event=>setFile(event.target.files?.[0]||null)}/><small>PDF, PNG, JPEG, or CSV; maximum 50 MB. Upload only—another authorised user must bind it.</small></label><button type="submit" className="btn" disabled={!file||command.phase==='LOADING'}>{command.phase==='LOADING'?'Uploading and scanning...':'Upload for this Payable'}</button></form>}
        <ul className="wbs-attachment-cards" aria-label="Attachments reserved for this WBS Payable">{uploads.data.attachments.map(item=><li key={item.attachment_id}><b>{item.name}</b><span>{item.media_type} · {item.status}</span><button type="button" className="btn" aria-label={`Bind exact evidence ${item.name}`} disabled={!item.can_bind||command.phase==='LOADING'} onClick={()=>bind(item)}>{item.can_bind?'Bind exact evidence':item.status==='BOUND'?'Bound':'Independent binder required'}</button></li>)}</ul>
        {uploads.data.attachments.some(item=>item.can_bind)&&<label htmlFor="wbs-payable-bind-reason">Binding reason<textarea id="wbs-payable-bind-reason" required minLength="8" maxLength="2000" rows="3" value={bindReason} onChange={event=>setBindReason(event.target.value)}/></label>}
      </>}
    </div>}
    {selected&&selected.can_review&&<form className="filterbar" onSubmit={review} aria-label="Review admitted WBS Payable">
      <fieldset><legend>Verified-clean support evidence</legend>{selected.attachment_choices.map(choice=><label key={choice.attachment_id}><input type="checkbox" checked={attachmentIds.includes(choice.attachment_id)} onChange={event=>setAttachmentIds(current=>event.target.checked?[...current,choice.attachment_id]:current.filter(id=>id!==choice.attachment_id))}/>{choice.name} · {choice.media_type} · verified {choice.verified_at}</label>)}</fieldset>
      <label htmlFor="wbs-payable-review-reason">Reviewer reason<textarea id="wbs-payable-review-reason" required minLength="8" maxLength="2000" rows="3" value={reason} onChange={event=>setReason(event.target.value)}/></label>
      <button type="submit" className="btn" disabled={command.phase==='LOADING'||attachmentIds.length===0}>{command.phase==='LOADING'?'Reviewing exact evidence...':'Review evidence only'}</button>
    </form>}
    {command.phase==='BLOCKED'&&<StateBlock tone="blocked" title={command.error?.code||'WBS_PAYABLE_REVIEW_BLOCKED'}>{command.error?.message} No Bill or Journal Draft was created.</StateBlock>}
    {command.phase==='READY'&&command.data?.kind==='UPLOADED'&&<StateBlock tone="success" title="Support evidence verified clean">The attachment is limited to this Payable. A different authorised user must bind it. Nothing was reviewed or created.</StateBlock>}
    {command.phase==='READY'&&command.data?.kind==='BOUND'&&<StateBlock tone="success" title="Support evidence bound">The exact verified object version is now eligible for Review. Review did not run, and no Draft, Journal, or posting was created.</StateBlock>}
    {command.phase==='READY'&&command.data?.kind!=='UPLOADED'&&command.data?.kind!=='BOUND'&&<StateBlock tone="success" title="WBS Payable evidence reviewed">Immutable review evidence is ready for the separate maker step. Nothing was submitted, approved, or posted, and no Draft was created by this action.</StateBlock>}
  </section>;
}
