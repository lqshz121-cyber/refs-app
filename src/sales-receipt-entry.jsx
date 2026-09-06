import React,{useEffect,useId,useRef,useState} from 'react';
import {salesReceiptEntryAccess,readSalesReceiptOptions,validateSalesReceiptDraft,uploadSalesReceiptSupport,prepareSalesReceipt,sendSalesReceipt} from './sales-receipt-entry.js';
import {recoverSalesReceipt,retainSalesReceipt,releaseSalesReceipt,beginSalesReceiptAttempt,currentSalesReceiptAttempt} from './sales-receipt-recovery.js';
const labels={CUSTOMER:'Customer',BANK:'Bank',CASH_ACCOUNT:'Cash account',CATEGORY_ACCOUNT:'Category'};
export function SalesReceiptEntry({config,access,scope,fetcher=globalThis.fetch,onOpenDraft,onSaved}){
 const [open,setOpen]=useState(false),trigger=useRef(null),wasOpen=useRef(false),id=useId();
 useEffect(()=>{if(wasOpen.current&&!open)trigger.current?.focus();wasOpen.current=open;},[open]);
 const pending=recoverSalesReceipt({config,actorId:access?.actor_id});
 if(!salesReceiptEntryAccess(config,access)||scope?.entity_id!==config?.entityId||scope?.period_id!==config?.periodId||scope?.period_status!=='OPEN'&&!pending)return null;
 return <section className="card native-document-entry" aria-label="Sales receipt entry"><button className="btn" type="button" ref={trigger} disabled={open} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)}>{pending?'Resume pending sales receipt':'New sales receipt'}</button>
 {open&&<SalesReceiptForm key={`${config.baseUrl}:${config.entityId}:${config.periodId}:${access.actor_id}`} id={id} config={config} access={access} scope={scope} fetcher={fetcher} onOpenDraft={onOpenDraft} onClose={saved=>{setOpen(false);if(saved)onSaved?.();}}/>}</section>;
}
function OptionPicker({config,kind,value,onChange,fetcher,disabled}){
 const [query,setQuery]=useState(''),[page,setPage]=useState(value?{rows:[value],next_ref:null}:null),[busy,setBusy]=useState(false),[message,setMessage]=useState(null),mounted=useRef(false),serial=useRef(0);
 const search=async(afterRef=null)=>{const request=++serial.current;setBusy(true);setMessage(null);setPage(null);
  try{const result=await readSalesReceiptOptions({config,optionKind:kind,query:query.trim(),afterRef,fetcher});if(!mounted.current||request!==serial.current)return;if(result.ok)setPage(result.data);else setMessage(result.message);}
  catch{if(mounted.current&&request===serial.current)setMessage('Choices could not be loaded. Retry the search.');}
  finally{if(mounted.current&&request===serial.current)setBusy(false);}
 };
 useEffect(()=>{mounted.current=true;if(!value&&!disabled)search();return()=>{mounted.current=false;serial.current++;};},[]);
 return <fieldset disabled={disabled||busy} className="native-document-search"><legend>{labels[kind]}</legend>
 <label>Find {labels[kind].toLowerCase()}<input value={query} maxLength={128} onChange={event=>{serial.current++;setQuery(event.target.value);setPage(null);onChange(null);}} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();search();}}}/></label>
 <button type="button" className="btn btn-sm" onClick={()=>{onChange(null);search();}}>Search {labels[kind].toLowerCase()}</button>
 {page&&<><label>{labels[kind]}<select value={value?.ref||''} required onChange={event=>onChange(page.rows.find(row=>row.ref===event.target.value)||null)}><option value="">{page.rows.length?'Choose '+labels[kind].toLowerCase():'No matching choices'}</option>{page.rows.map(row=><option key={row.ref} value={row.ref}>{row.label} · {row.ref}</option>)}</select></label><button type="button" className="btn btn-sm btn-ghost" disabled={!page.next_ref} onClick={()=>{onChange(null);search(page.next_ref);}}>More {labels[kind].toLowerCase()} choices</button></>}
 {busy&&<p role="status">Loading {labels[kind].toLowerCase()} choices…</p>}{message&&<p role="alert">{message}</p>}
 </fieldset>;
}
export function SalesReceiptForm({id,config,access,scope,fetcher=globalThis.fetch,onOpenDraft,onClose}){
 const recoveryScope={config,actorId:access.actor_id},recovered=useRef(recoverSalesReceipt(recoveryScope)),uncertain=useRef(!!recovered.current);
 const [command,setCommand]=useState(recovered.current),[draft,setDraft]=useState(recovered.current?.draft||{number:'',date:'',amount:'',currency:scope.base_currency||'',reason:''}),[choices,setChoices]=useState(recovered.current?.choices||{});
 const [file,setFile]=useState(null),[support,setSupport]=useState(recovered.current?{ok:true,attachmentId:recovered.current.attachmentId}:null),[receipt,setReceipt]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(null),[uploadAttempt,setUploadAttempt]=useState(0),[uploadClosed,setUploadClosed]=useState(false);
 const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null),locked=!!command;
 useEffect(()=>{mounted.current=true;heading.current?.focus();return()=>{mounted.current=false;};},[]);
 const run=async action=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);setMessage(null);try{await action();}catch{if(mounted.current)setMessage('The result could not be confirmed. Retry the same request.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
 const create=()=>run(async()=>{let pending=command;
  if(!pending){
   const valid=validateSalesReceiptDraft({config,scope,draft,choices,attachmentId:support?.attachmentId});if(!valid.ok&&valid.code!=='ATTACHMENT_REQUIRED'){setMessage(valid.message);return;}
   let attachment=support;
   if(!attachment){const attempt=uploadAttempt+(uploadClosed?1:0);setUploadAttempt(attempt);setUploadClosed(false);setMessage('Uploading supporting document…');attachment=await uploadSalesReceiptSupport({config,file,expectedActorId:access.actor_id,uploadAttempt:attempt,fetcher});if(!mounted.current)return;if(!attachment.ok){setUploadClosed(attachment.code==='ATTACHMENT_RESERVATION_CLOSED');setMessage(attachment.message);return;}setSupport(attachment);}
   const prepared=await prepareSalesReceipt({config,draft,choices,attachmentId:attachment.attachmentId,expectedActorId:access.actor_id,fetcher});if(!mounted.current)return;if(!prepared.ok){setMessage(prepared.message);return;}
   pending=prepared.command;retainSalesReceipt(recoveryScope,pending);setCommand(pending);
  }
  const attempt=beginSalesReceiptAttempt(recoveryScope,pending),result=await sendSalesReceipt({config,command:pending,fetcher});
  if(result.ok){releaseSalesReceipt(recoveryScope,pending);if(mounted.current){setReceipt(result.data);setMessage('Sales receipt saved as a draft. Open its journal to continue review and approval.');}return;}
  if(!uncertain.current&&!result.unconfirmed&&currentSalesReceiptAttempt(recoveryScope,attempt)){releaseSalesReceipt(recoveryScope,pending);if(mounted.current)setCommand(null);}else uncertain.current=true;
  if(mounted.current)setMessage(result.message);
 });
 const update=(field,value)=>{setDraft(previous=>({...previous,[field]:value}));setMessage(null);};
 return <div id={id} className="native-document-form"><h3 ref={heading} tabIndex={-1}>New sales receipt</h3><p className="muted sm">{scope.entity_name} · {scope.period_code}</p>
 {recovered.current&&!receipt&&<p role="status">An earlier receipt is awaiting confirmation. Retry the same request.</p>}
 <form aria-busy={busy} onSubmit={event=>{event.preventDefault();create();}}><fieldset disabled={busy||locked}><legend>Receipt details</legend><div className="native-document-grid">
 <label>Receipt number<input required maxLength={128} value={draft.number} onChange={event=>update('number',event.target.value)}/></label>
 <label>Accounting date<input required type="date" min={scope.period_start} max={scope.period_end} value={draft.date} onChange={event=>update('date',event.target.value)}/></label>
 <label>Amount<input required inputMode="decimal" value={draft.amount} onChange={event=>update('amount',event.target.value)}/></label>
 <label>Currency<input required maxLength={3} value={draft.currency} onChange={event=>update('currency',event.target.value.toUpperCase())}/></label></div>
 {Object.keys(labels).map(kind=><OptionPicker key={kind} config={config} kind={kind} value={choices[kind]} onChange={value=>setChoices(previous=>({...previous,[kind]:value}))} fetcher={fetcher} disabled={busy||locked}/>)}
 <label>Description<textarea required minLength={8} maxLength={2000} value={draft.reason} onChange={event=>update('reason',event.target.value)}/></label>
 <label>Supporting document<input type="file" accept=".pdf,.png,.jpg,.jpeg,.csv" onChange={event=>{setFile(event.target.files?.[0]||null);setSupport(null);setUploadAttempt(0);setUploadClosed(false);}}/></label><p className="muted sm">PDF, PNG, JPEG or CSV, up to 50 MB. Uploaded when you save.</p>
 </fieldset>{message&&<p role="status" aria-live="polite">{message}</p>}<div className="native-document-actions">
 {!receipt&&<button className="btn" type="submit" disabled={busy||!file&&!support}>{busy?'Working…':locked?'Retry same sales receipt':'Create sales receipt'}</button>}
 {receipt&&<button className="btn" type="button" disabled={busy||!onOpenDraft} onClick={()=>run(()=>onOpenDraft(receipt))}>Open saved draft</button>}
 <button className="btn btn-ghost" type="button" disabled={busy||locked&&!receipt} onClick={()=>onClose?.(!!receipt)}>{receipt?'Close and refresh receipts':'Close'}</button>
 </div></form></div>;
}
