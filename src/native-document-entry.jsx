import React,{useEffect,useId,useRef,useState} from 'react';
import {createNativeDocumentDraft,nativeDocumentEntryAccess,readNativeDocumentCounterparties,uploadNativeDocumentSupport,validateNativeDocumentDraft} from './native-document-entry.js';

export function NativeDocumentEntry({config,kind,access,scope,accounts=[],fetcher=globalThis.fetch,onOpenDraft,onRefresh}) {
  const [open,setOpen]=useState(false);
  const trigger=useRef(null),wasOpen=useRef(false),id=useId();
  useEffect(()=>{if(wasOpen.current&&!open)trigger.current?.focus();wasOpen.current=open;},[open]);
  const allowed=nativeDocumentEntryAccess(config,kind,access)&&scope?.entity_id===config?.entityId&&scope?.period_id===config?.periodId&&scope?.period_status==='OPEN';
  if(!allowed)return null;
  return <section className="card native-document-entry" aria-label={kind==='AP_BILL'?'Bill entry':'Invoice entry'}>
    <button ref={trigger} className="btn" type="button" aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)} disabled={open}>New {kind==='AP_BILL'?'bill':'invoice'}</button>
    {open&&<NativeDocumentEntryForm key={`${config.entityId}:${config.periodId}:${kind}:${access.actor_id}`} id={id} config={config} kind={kind} access={access} scope={scope} accounts={accounts} fetcher={fetcher} onOpenDraft={onOpenDraft} onClose={saved=>{setOpen(false);if(saved)onRefresh?.();}}/>}
  </section>;
}

export function NativeDocumentEntryForm({id,config,kind,access,scope,accounts=[],fetcher=globalThis.fetch,onOpenDraft,onClose}) {
  const bill=kind==='AP_BILL',partyLabel=bill?'Vendor':'Customer';
  const [draft,setDraft]=useState({documentNumber:'',accountingDate:'',dueDate:'',amount:'',currency:scope?.base_currency||'',offsetAccountCode:'',description:''});
  const [query,setQuery]=useState(''),[page,setPage]=useState(null),[counterparty,setCounterparty]=useState(null);
  const [file,setFile]=useState(null),[attachment,setAttachment]=useState(null),[receipt,setReceipt]=useState(null);
  const [uploadAttempt,setUploadAttempt]=useState(0),[uploadClosed,setUploadClosed]=useState(false);
  const [busy,setBusy]=useState(false),[locked,setLocked]=useState(false),[message,setMessage]=useState(null);
  const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null);
  useEffect(()=>{mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
  useEffect(()=>{if(!locked||receipt)return;const warn=event=>{event.preventDefault();event.returnValue='';};globalThis.addEventListener?.('beforeunload',warn);return()=>globalThis.removeEventListener?.('beforeunload',warn);},[locked,receipt]);
  const run=async(action)=>{
    if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage(null);
    try{await action();}catch{if(mounted.current)setMessage('The result could not be confirmed. Retry the same request.');}
    finally{busyRef.current=false;if(mounted.current)setBusy(false);}
  };
  const search=afterRef=>run(async()=>{
    const result=await readNativeDocumentCounterparties({config,kind,query:query.trim(),afterRef,fetcher});
    if(!mounted.current)return;
    if(result.ok){setPage(result.data);setCounterparty(null);}else setMessage(result.message);
  });
  const create=()=>run(async()=>{
    const valid=validateNativeDocumentDraft({config,kind,draft,counterparty,attachmentId:attachment?.attachmentId,scope,accounts});
    if(!valid.ok&&valid.code!=='ATTACHMENT_REQUIRED'){setMessage(valid.message);return;}
    let support=attachment;
    if(!support){
      setMessage('Uploading supporting document…');
      const attempt=uploadAttempt+(uploadClosed?1:0);setUploadAttempt(attempt);setUploadClosed(false);
      support=await uploadNativeDocumentSupport({config,kind,file,expectedActorId:access.actor_id,uploadAttempt:attempt,fetcher});
      if(!mounted.current)return;
      if(!support.ok){setUploadClosed(support.code==='ATTACHMENT_RESERVATION_CLOSED');setMessage(support.message);return;}
      setAttachment(support);
    }
    setMessage('Saving draft…');
    const result=await createNativeDocumentDraft({config,kind,draft,counterparty,attachmentId:support.attachmentId,expectedActorId:access.actor_id,fetcher});
    if(!mounted.current)return;
    if(result.ok){setReceipt(result.data);setLocked(true);setMessage('Draft saved. Open the draft to review its journal and continue the approval workflow.');}
    else{if(result.unconfirmed)setLocked(true);setMessage(result.unconfirmed?'The draft could not be confirmed. Keep these details and retry the same draft. Check saved drafts before leaving this page.':result.message);}
  });
  const update=(field,value)=>{setDraft(current=>({...current,[field]:value}));setMessage(null);};
  const eligible=[...new Map(accounts.filter(row=>row.active===true&&row.requires_member===false&&row.period_id===config.periodId&&(!row.entity_id||row.entity_id===config.entityId)).map(row=>[row.account_code,row])).values()];
  return <div id={id} className="native-document-form">
    <h3 ref={heading} tabIndex={-1}>New {bill?'bill':'invoice'}</h3>
    <p className="muted sm">{scope.entity_name} · {scope.period_code} · Creates a draft with one category amount and verified support.</p>
    <form aria-busy={busy} onSubmit={event=>{event.preventDefault();create();}}>
      <fieldset disabled={busy||locked}>
        <legend>Document details</legend>
        <div className="native-document-grid">
          <label>{bill?'Bill':'Invoice'} number<input value={draft.documentNumber} maxLength={128} required onChange={event=>update('documentNumber',event.target.value)}/></label>
          <label>Accounting date<input type="date" min={scope.period_start} max={scope.period_end} required value={draft.accountingDate} onChange={event=>update('accountingDate',event.target.value)}/></label>
          <label>Due date<input type="date" min={draft.accountingDate||scope.period_start} value={draft.dueDate} onChange={event=>update('dueDate',event.target.value)}/></label>
          <label>Amount<input inputMode="decimal" required value={draft.amount} onChange={event=>update('amount',event.target.value)}/></label>
          <label>Currency<input value={draft.currency} maxLength={3} required onChange={event=>update('currency',event.target.value.toUpperCase())}/></label>
          <label>Category<select value={draft.offsetAccountCode} required onChange={event=>update('offsetAccountCode',event.target.value)}><option value="">Choose a category</option>{eligible.map(row=><option key={row.account_code} value={row.account_code}>{row.account_code} · {row.account_name}</option>)}</select></label>
        </div>
        <div className="native-document-search">
          <label>Find {partyLabel.toLowerCase()}<input value={query} maxLength={128} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();search(null);}}} onChange={event=>{setQuery(event.target.value);setPage(null);setCounterparty(null);}}/></label>
          <button type="button" className="btn btn-sm" onClick={()=>search(null)}>Search {bill?'vendors':'customers'}</button>
          {page&&<><label>{partyLabel}<select value={counterparty?.member_ref||''} required onChange={event=>setCounterparty(page.rows.find(row=>row.member_ref===event.target.value)||null)}><option value="">{page.rows.length?'Choose a counterparty':'No matching counterparties'}</option>{page.rows.map(row=><option key={row.member_ref} value={row.member_ref}>{row.display_name} · {row.member_ref}</option>)}</select></label><button type="button" className="btn btn-sm btn-ghost" disabled={!page.next_ref} onClick={()=>search(page.next_ref)}>Next results</button></>}
        </div>
        <label>Description<textarea maxLength={2000} value={draft.description} onChange={event=>update('description',event.target.value)}/></label>
        <label>Supporting document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.csv" onChange={event=>{setFile(event.target.files?.[0]||null);setAttachment(null);setUploadAttempt(0);setUploadClosed(false);}}/></label>
        <p className="muted sm">PDF, PNG, JPEG or CSV, up to 50 MB. Uploaded when you save.</p>
      </fieldset>
      {message&&<p role="status" aria-live="polite">{message}</p>}
      <div className="native-document-actions">
        {!receipt&&<button className="btn" type="submit" disabled={busy||!file&&!attachment||!counterparty}>{busy?'Working…':locked?'Retry same draft':'Create draft'}</button>}
        {receipt&&<button className="btn" type="button" disabled={busy||!onOpenDraft} onClick={()=>run(()=>onOpenDraft(receipt))}>Open saved draft</button>}
        <button className="btn btn-ghost" type="button" disabled={busy||locked&&!receipt} onClick={()=>onClose?.(!!receipt)}>{receipt?'Close and refresh list':'Close'}</button>
      </div>
    </form>
  </div>;
}
