import React,{useEffect,useRef,useState} from 'react';
import {StateBlock} from './ui.jsx';
import {readAuthoritativeDepreciationOptions,createAuthoritativeAssetDepreciation} from './accounting-api.js';

const journalStatuses={DRAFT:'Draft',PENDING_REVIEW:'Awaiting review',PENDING_APPROVAL:'Awaiting approval',APPROVED:'Approved'};
const readinessMessages={
 BLOCKED_ASSET_INACTIVE:'This asset is not active. Review its register status before recording depreciation.',
 BLOCKED_PERIOD_NOT_OPEN:'The selected accounting period is not open.',
 BLOCKED_ACQUISITION_NOT_POSTED:'Post the asset acquisition before recording depreciation.',
 BLOCKED_ACQUISITION_EVIDENCE:'The acquisition source or attachment evidence has changed. Review the acquisition before continuing.',
 BLOCKED_POST_IMPAIRMENT_POLICY_REQUIRED:'This asset has an impairment assessment. A reviewed revised depreciation schedule is required.',
 BLOCKED_ASSET_DISPOSED:'This asset has a disposal record. Review its depreciation cut-off before continuing.',
 BLOCKED_NOT_DUE:'No depreciation is due for this asset in the selected period.',
 BLOCKED_COST_RECONCILIATION:'The posted asset cost differs from the registered cost. Review the asset activity before continuing.',
 BLOCKED_PRIOR_DEPRECIATION_RECONCILIATION:'Prior posted depreciation differs from the schedule. Review the earlier periods before continuing.',
 BLOCKED_ALREADY_POSTED:'Depreciation has already been posted for this asset and period. Review the posted activity before preparing a correction.'
};

// The API adapter supplies validated evidence and a durable idempotent command.
export function AuthoritativeAssetDepreciation(props){
 const {config,assetId}=props;
 const scope=[config?.baseUrl,config?.tenantId,config?.entityId,config?.periodId,assetId].join('|');
 return <DepreciationForm key={scope} {...props}/>;
}

function DepreciationForm({config,assetId,readOptions=readAuthoritativeDepreciationOptions,createDraft=createAuthoritativeAssetDepreciation,fetcher=globalThis.fetch,onOpenJournalWorkflow}){
 const [open,setOpen]=useState(false),[state,setState]=useState({phase:'IDLE'});
 const [number,setNumber]=useState(''),[reason,setReason]=useState(''),[error,setError]=useState(null);
 const [saving,setSaving]=useState(false),[saved,setSaved]=useState(null),[another,setAnother]=useState(false);
 const generation=useRef(0),pending=useRef(false),launch=useRef(null),heading=useRef(null),resultHeading=useRef(null),numberField=useRef(null),wasOpen=useRef(false);
 useEffect(()=>()=>{generation.current++;},[]);
 useEffect(()=>{if(open)heading.current?.focus();else if(wasOpen.current)launch.current?.focus();wasOpen.current=open;},[open]);
 useEffect(()=>{if(saved)resultHeading.current?.focus();},[saved]);
 useEffect(()=>{if(another)numberField.current?.focus();},[another]);

 const load=async()=>{
  if(pending.current)return;
  const token=++generation.current;setOpen(true);setState({phase:'LOADING'});setError(null);setAnother(false);
  try{
   const result=await readOptions({config,assetId,fetcher});
   if(token!==generation.current)return;
   if(!result.ok){setState({phase:'ERROR',message:result.message});return;}
   setState({phase:'READY',data:result.data});
   setNumber(current=>current||('DEP-'+result.data.asset_tag+'-'+result.data.period.period_code).slice(0,100));
  }catch{if(token===generation.current)setState({phase:'ERROR',message:'Depreciation information could not be loaded. Try again.'});}
 };
 const close=()=>{if(pending.current)return;generation.current++;setOpen(false);};
 const options=state.phase==='READY'?state.data:null;
 const ready=options?.readiness_status==='READY';
 const submit=async event=>{
  event.preventDefault();if(pending.current||!ready||saved)return;
  pending.current=true;setSaving(true);setError(null);const token=generation.current;
  try{
   const result=await createDraft({config,options,journalNumber:number.trim(),journalDate:options.period.ends_on,reason:reason.trim(),fetcher});
   if(token!==generation.current)return;
   if(result.ok)setSaved(result.data);else setError(result.message);
  }catch{if(token===generation.current)setError('The save could not be confirmed. Retry with the same details or refresh to check existing journals.');}
  finally{pending.current=false;if(token===generation.current)setSaving(false);}
 };
 const attention=readinessMessages[options?.readiness_status]||'The current schedule and posted balances do not permit a new depreciation draft. Refresh the information and review the asset activity.';

 return <section className="asset-depreciation-form" aria-label="Asset depreciation">
  <button type="button" className="btn" ref={launch} disabled={open} onClick={()=>saved?setOpen(true):void load()}>Record depreciation</button>
  {open?<div className="report-workbench">
   <div className="report-workbench-head"><h3 ref={heading} tabIndex={-1}>Record depreciation</h3><button type="button" className="btn" disabled={saving} onClick={close}>Close depreciation</button></div>
   {saved?<div role="status"><h4 ref={resultHeading} tabIndex={-1}>Depreciation draft saved</h4><p>Continue with journal review and approval.</p>{onOpenJournalWorkflow?<button type="button" className="btn" onClick={()=>onOpenJournalWorkflow(saved,saved.period_id)}>Open journal</button>:null}</div>:<>
    {state.phase==='LOADING'?<StateBlock tone="loading" title="Loading depreciation">Reading the schedule and posted balances.</StateBlock>:null}
    {state.phase==='ERROR'?<StateBlock tone="error" title="Could not load depreciation">{state.message}<button type="button" onClick={()=>void load()}>Try again</button></StateBlock>:null}
    {options?<>
     <dl className="fixed-assets-detail-grid">{[['Asset',options.asset_tag],['Accounting period',options.period.period_code],['Project',options.member_trace.project_ref||'Not assigned'],['Property',options.member_trace.property_ref||'Not assigned'],['Policy version',options.policy.policy_version],['Accounting date',options.period.ends_on],['Period depreciation',options.currency+' '+options.schedule.expected_period_depreciation],['Prior accumulated depreciation',options.currency+' '+options.actual_prior_accumulated_depreciation],['Debit · depreciation expense',options.depreciation_expense_account_code],['Credit · accumulated depreciation',options.accumulated_depreciation_account_code],['Acquisition source',options.source?.source_document_id||'Not available'],['Acquisition journal',options.acquisition?.journal_entry_id||'Not available']].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
     {options.pending_journals.length?<section aria-label="Existing depreciation journals"><h4>Continue an existing journal</h4><ul>{options.pending_journals.map(j=><li key={j.journal_entry_id}><button type="button" className="btn-link" disabled={saving||!onOpenJournalWorkflow} onClick={()=>onOpenJournalWorkflow(j,j.period_id)}>{j.journal_number}</button> · {journalStatuses[j.status]} · {j.journal_date}</li>)}</ul>{options.more_pending_journals?<p>More depreciation journals are available in Journals.</p>:null}</section>:null}
     {!ready?<StateBlock tone="error" title="Depreciation needs attention">{attention}</StateBlock>:options.pending_journals.length&&!another?<button type="button" className="btn" onClick={()=>setAnother(true)}>Create another draft</button>:<form aria-label="Depreciation journal" onSubmit={submit}><fieldset disabled={saving}><legend>Journal details</legend><label>Journal number<input ref={numberField} value={number} maxLength={100} required onChange={e=>setNumber(e.target.value)}/></label><label>Explanation<textarea value={reason} minLength={8} maxLength={2000} required onChange={e=>setReason(e.target.value)}/></label><p>Creates a draft for review and approval using the displayed schedule.</p><button type="submit" className="btn primary">{saving?'Saving…':'Save depreciation draft'}</button></fieldset></form>}
     {error?<StateBlock tone="error" title="Could not confirm the save">{error}</StateBlock>:null}
     <button type="button" className="btn" disabled={saving} onClick={()=>void load()}>Refresh depreciation information</button>
    </>:null}
   </>}
  </div>:null}
 </section>;
}
