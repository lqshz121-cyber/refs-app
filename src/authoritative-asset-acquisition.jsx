import React,{useEffect,useRef,useState} from 'react';
import {readAuthoritativeAcquisitionOptions,createAuthoritativeAssetAcquisition} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

const attachmentMessages={MISSING:'Add the invoice attachment to the source document before recording this acquisition.',UNVERIFIED:'The source attachment has not finished verification.',AMBIGUOUS:'The source attachment association needs correction.',TOO_MANY:'This source has more than 25 attachments. Review its attachment associations before continuing.'};
export function AuthoritativeAssetAcquisition({config,assetId,fetcher=globalThis.fetch,onOpenJournalWorkflow}){
 const [newDraft,setNewDraft]=useState(false);
 const [open,setOpen]=useState(false),[state,setState]=useState({phase:'IDLE'}),[number,setNumber]=useState(''),[date,setDate]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(null),[saving,setSaving]=useState(false),[saved,setSaved]=useState(null);
 const generation=useRef(0),pending=useRef(false),launch=useRef(null),heading=useRef(null),resultHeading=useRef(null);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(open)heading.current?.focus();},[open]);
 useEffect(()=>{if(saved)resultHeading.current?.focus();},[saved]);
 const load=async()=>{if(pending.current)return;const token=++generation.current;setOpen(true);setState({phase:'LOADING'});setError(null);const result=await readAuthoritativeAcquisitionOptions({config,assetId,fetcher});if(token!==generation.current)return;
  if(!result.ok){setState({phase:'ERROR',message:result.message});return;}
  setState({phase:'READY',data:result.data});setNewDraft(false);setNumber(current=>current||('FA-'+result.data.asset_tag).slice(0,100));setDate(current=>current||result.data.source.accounting_date);
 };
 const close=()=>{if(pending.current)return;generation.current++;setOpen(false);launch.current?.focus();};
 const submit=async event=>{event.preventDefault();if(pending.current||state.phase!=='READY'||saved)return;pending.current=true;setSaving(true);setError(null);const token=generation.current;
  try{const result=await createAuthoritativeAssetAcquisition({config,options:state.data,journalNumber:number.trim(),journalDate:date,reason:reason.trim(),fetcher});if(token!==generation.current)return;if(result.ok)setSaved(result.data);else setError(result.message);}
  finally{pending.current=false;if(token===generation.current)setSaving(false);}
 };
 const options=state.phase==='READY'?state.data:null;
 const blocking=options?(options.acquisition_posted?'This asset acquisition has already been posted.':options.disposal_recorded?'This asset has a disposal record.':!options.original_evidence?'The original invoice evidence must be retained before recording this acquisition.':options.period.status!=='OPEN'?'The source accounting period is not open.':options.source.source_document_version<1?'Refresh the source document before recording this acquisition.':attachmentMessages[options.attachment_status]||null):null;
 return <section aria-label="Asset acquisition">
  <button type="button" className="btn" ref={launch} onClick={()=>{if(saved)setOpen(true);else void load();}} disabled={open}>Record acquisition</button>
  {open?<div className="report-workbench"><div className="report-workbench-head"><h3 ref={heading} tabIndex={-1}>Record acquisition</h3><button type="button" className="btn" onClick={close} disabled={saving}>Close acquisition</button></div>
   {saved?<div role="status"><h4 ref={resultHeading} tabIndex={-1}>Acquisition draft saved</h4><p>The invoice and attachments are linked to the journal. Continue with its review and approval.</p>{onOpenJournalWorkflow?<button type="button" className="btn" onClick={()=>onOpenJournalWorkflow(saved,options.period.period_id)}>Open journal</button>:null}</div>:<>
   {state.phase==='LOADING'?<StateBlock tone="loading" title="Loading invoice and attachments">Reading the acquisition information.</StateBlock>:null}
   {state.phase==='ERROR'?<StateBlock tone="error" title="Could not load acquisition">{state.message}<button type="button" onClick={()=>void load()}>Try again</button></StateBlock>:null}
   {options?<><dl className="fixed-assets-detail-grid">{[['Asset',options.asset_tag],['Invoice',options.source.document_no||'Source invoice'],['Original cost',options.currency+' '+options.cost_basis],['Accounting period',options.period.period_code],['Placed in service',options.placed_in_service_date],['Asset account',options.asset_account_code],['Liability account',options.liability_account_code],['Vendor',options.vendor_ref||'Not recorded']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {options.pending_journals.length?<section aria-label="Existing acquisition journals"><h4>Continue an existing journal</h4><ul>{options.pending_journals.map(j=><li key={j.journal_entry_id}><button type="button" className="btn-link" disabled={!onOpenJournalWorkflow||saving} onClick={()=>onOpenJournalWorkflow({journal_entry_id:j.journal_entry_id,period_id:j.period_id})}>{j.journal_number}</button> · {{DRAFT:'Draft',PENDING_REVIEW:'Awaiting review',PENDING_APPROVAL:'Awaiting approval',APPROVED:'Approved'}[j.status]} · {j.journal_date}</li>)}</ul>{options.more_pending_journals?<p>More acquisition journals are available in Journals.</p>:null}</section>:null}
    <h4>Invoice attachments</h4>{options.attachments.length?<ul>{options.attachments.map(a=><li key={a.attachment_id}>{a.name}</li>)}</ul>:<p>No invoice attachment is available.</p>}
    {blocking?<StateBlock tone="error" title="Acquisition needs attention">{blocking}</StateBlock>:options.pending_journals.length&&!newDraft?<button type="button" className="btn" onClick={()=>setNewDraft(true)}>Create another draft</button>:<form onSubmit={submit} aria-label="Acquisition journal"><fieldset disabled={saving}><legend>Journal details</legend><label>Journal number<input value={number} maxLength={100} required onChange={e=>setNumber(e.target.value)}/></label><label>Accounting date<input type="date" value={date} min={options.period.starts_on} max={options.period.ends_on} required onChange={e=>setDate(e.target.value)}/></label><label>Explanation<textarea value={reason} minLength={8} maxLength={2000} required onChange={e=>setReason(e.target.value)}/></label><p>Creates a draft for review and approval.</p><button type="submit" className="btn primary">{saving?'Saving…':'Save acquisition draft'}</button></fieldset></form>}
    {error?<StateBlock tone="error" title="Could not confirm the save">{error}</StateBlock>:null}
    <button type="button" className="btn" disabled={saving} onClick={()=>void load()}>Refresh invoice and attachments</button>
   </>:null}</>}
  </div>:null}
 </section>;
}
