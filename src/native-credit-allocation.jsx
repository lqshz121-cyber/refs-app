import React,{useEffect,useId,useRef,useState} from 'react';
import {nativeCreditAllocationAccess,readNativeCreditTargets,validateNativeCreditAllocation,prepareNativeCreditAllocation,sendNativeCreditAllocation} from './native-credit-allocation.js';
import {recoverNativeCreditAllocation,retainNativeCreditAllocation,releaseNativeCreditAllocation} from './native-credit-allocation-recovery.js';

export function NativeCreditAllocationEntry({config,kind,sourceAdjustmentId,access,fetcher=globalThis.fetch,onRefresh}){
  const [open,setOpen]=useState(false),trigger=useRef(null),wasOpen=useRef(false),id=useId();
  useEffect(()=>{if(wasOpen.current&&!open)trigger.current?.focus();wasOpen.current=open;},[open]);
  if(!nativeCreditAllocationAccess(config,kind,access))return null;
  return <section className="card native-document-entry" aria-label="Apply posted credit"><button type="button" className="btn" ref={trigger} disabled={open} aria-expanded={open} aria-controls={id} onClick={()=>setOpen(true)}>Apply credit</button>
    {open&&<NativeCreditAllocationForm key={`${config.entityId}:${config.periodId}:${kind}:${sourceAdjustmentId}:${access.actor_id}`} id={id} config={config} kind={kind} sourceAdjustmentId={sourceAdjustmentId} access={access} fetcher={fetcher} onClose={saved=>{setOpen(false);if(saved)onRefresh?.();}}/>}
  </section>;
}

export function NativeCreditAllocationForm({id,config,kind,sourceAdjustmentId,access,fetcher=globalThis.fetch,onClose}){
  const scope={config,kind,sourceAdjustmentId,actorId:access.actor_id},recovered=useRef(recoverNativeCreditAllocation(scope));
  const [page,setPage]=useState(null),[query,setQuery]=useState('');
  const [targetId,setTargetId]=useState(()=>recovered.current?.command.body.businessDocumentId||'');
  const [amount,setAmount]=useState(()=>recovered.current?.command.body.amount||''),[reason,setReason]=useState(()=>recovered.current?.command.body.reason||'');
  const [command,setCommand]=useState(()=>recovered.current?.command||null),[receipt,setReceipt]=useState(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState('Loading available documents…');
  const mounted=useRef(false),busyRef=useRef(false),heading=useRef(null),uncertain=useRef(recovered.current?.uncertain===true);
  const run=async work=>{if(busyRef.current)return;busyRef.current=true;setBusy(true);try{await work();}catch{if(mounted.current)setMessage('The result could not be confirmed. Retry the same allocation.');}finally{busyRef.current=false;if(mounted.current)setBusy(false);}};
  const load=afterId=>run(async()=>{const result=await readNativeCreditTargets({config,kind,sourceAdjustmentId,query:query.trim(),afterId,fetcher});if(!mounted.current)return;if(result.ok){setPage(result.data);if(!command)setTargetId('');setMessage(result.data.rows.length?'':'No matching documents with an available balance.');}else setMessage(result.message);});
  useEffect(()=>{mounted.current=true;heading.current?.focus();load(null);return()=>{mounted.current=false;};},[]);
  const save=()=>run(async()=>{
    let prepared=command;
    if(!prepared){
      const input={config,kind,sourceAdjustmentId,page,targetId,amount,reason};
      const valid=validateNativeCreditAllocation(input);if(!valid.ok){setMessage(valid.message);return;}
      const result=await prepareNativeCreditAllocation({...input,expectedActorId:access.actor_id,fetcher});if(!mounted.current)return;if(!result.ok){setMessage(result.message);return;}prepared=result.command;setCommand(prepared);
    }
    retainNativeCreditAllocation(scope,prepared,{uncertain:uncertain.current});
    const result=await sendNativeCreditAllocation({config,command:prepared,fetcher});
    if(result.ok||!result.unconfirmed&&!uncertain.current)releaseNativeCreditAllocation(scope,prepared);else retainNativeCreditAllocation(scope,prepared,{uncertain:true});
    if(!mounted.current)return;
    if(result.ok){setReceipt(result.data);setMessage(`Applied ${prepared.body.amount} ${prepared.currency} to ${prepared.targetNumber}. The document balance has been updated.`);}
    else{if(result.unconfirmed)uncertain.current=true;if(!uncertain.current)setCommand(null);setMessage(result.message);}
  });
  const target=page?.rows.find(row=>row.business_document_id===targetId);
  return <div id={id} className="native-document-form"><h3 ref={heading} tabIndex={-1}>Apply posted credit</h3>
    {page&&<p>{page.context.credit.number} · {page.context.credit.counterparty_ref} · {page.context.credit.currency}<br/>Credit amount {page.context.credit.amount} · Already applied {page.context.allocated_amount} · Refunds {page.context.refund_amount} · Available {page.context.available_amount}</p>}
    <p>This applies existing posted credit immediately and reduces the selected document’s unpaid balance.</p>
    {recovered.current&&!receipt&&<p role="status">An earlier allocation is awaiting confirmation. Retry the same request below.</p>}
    <form onSubmit={event=>{event.preventDefault();save();}}>
      <fieldset disabled={busy||!!command||!!receipt}><legend>Choose a document and amount</legend>
        <div className="native-document-fields"><label>Search document number or description<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={128}/></label><button type="button" className="btn btn-ghost" onClick={()=>load(null)}>Search</button>
          <label>{kind==='AP_VENDOR_CREDIT'?'Bill':'Invoice'}<select value={targetId} onChange={event=>setTargetId(event.target.value)}><option value="">Choose a document</option>{page?.rows.map(row=><option key={row.business_document_id} value={row.business_document_id}>{row.document_number} · {row.accounting_date} · Available {row.available_amount} {row.currency}</option>)}</select></label>
          {page?.next_id&&<button type="button" className="btn btn-ghost" onClick={()=>load(page.next_id)}>Next documents</button>}
          {page?.after_id&&<button type="button" className="btn btn-ghost" onClick={()=>load(null)}>First documents</button>}
          <label>Amount<input inputMode="decimal" value={amount} onChange={event=>setAmount(event.target.value)} placeholder="0.0000"/></label>
          <label>Description<textarea value={reason} onChange={event=>setReason(event.target.value)} minLength={8} maxLength={2000}/></label>
        </div>
      </fieldset>
      {target&&!command&&<p>{target.document_number}: unpaid {target.open_balance}, reserved {target.pending_amount}, available {target.available_amount} {target.currency}.</p>}
      {command&&<p>Request: {command.targetNumber} · {command.body.amount} {command.currency}</p>}
      {message&&<p role="status" aria-live="polite">{message}</p>}
      <div className="native-document-actions">{!receipt&&<button type="submit" className="btn" disabled={busy||!command&&!page}>{busy?'Working…':command?'Retry same allocation':'Apply credit'}</button>}
        {!command&&!receipt&&<button type="button" className="btn btn-ghost" disabled={busy} onClick={()=>load(null)}>Refresh balances</button>}
        <button type="button" className="btn btn-ghost" disabled={busy||!!command&&!receipt} onClick={()=>onClose?.(!!receipt)}>{receipt?'Close and refresh':'Close'}</button>
      </div>
    </form></div>;
}
