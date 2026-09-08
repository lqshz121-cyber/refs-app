import React,{useEffect,useRef,useState} from 'react';
import {readCounterpartyRegister} from './counterparty-register-api.js';
export function CounterpartyRegisterWorkspace({config,kind='VENDOR',fetcher=globalThis.fetch}){
  const [draft,setDraft]=useState(''),[query,setQuery]=useState(''),[status,setStatus]=useState('ACTIVE'),[cursors,setCursors]=useState([null]),[retry,setRetry]=useState(0);
  const [state,setState]=useState({key:null,phase:'LOADING',data:null}),sequence=useRef(0),heading=useRef(null);
  const scope=JSON.stringify([config?.baseUrl,config?.tenantId,config?.entityId,kind]);
  const afterRef=cursors.at(-1),key=JSON.stringify([scope,status,query,afterRef,retry]);
  useEffect(()=>{setDraft('');setQuery('');setStatus('ACTIVE');setCursors([null]);},[scope]);
  useEffect(()=>{
    const id=++sequence.current,controller=new AbortController();setState({key,phase:'LOADING',data:null});
    readCounterpartyRegister({config,kind,status,query,afterRef,fetcher,signal:controller.signal}).then(result=>{
      if(controller.signal.aborted||sequence.current!==id)return;
      setState(result.ok?{key,phase:'READY',data:result.data}:{key,phase:'ERROR',message:result.message});
    });
    return()=>{controller.abort();};
  },[key,fetcher,config?.getAccessToken]);
  const current=state.key===key?state:{phase:'LOADING'},rows=current.data?.rows||[],title=kind==='VENDOR'?'Vendors':'Customers';
  const changePage=next=>{setCursors(next);heading.current?.focus();};
  return <section className="card" aria-label={title} style={{padding:20,minWidth:0}}>
    <h1 ref={heading} tabIndex={-1}>{title}</h1>
    <p className="muted">{config?.scopePresentation?.entityLabel||'Current company'}</p>
    <form onSubmit={event=>{event.preventDefault();setQuery(draft.trim());setCursors([null]);setRetry(v=>v+1);}} style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'end',marginBottom:16}}>
      <label style={{flex:'1 1 220px'}}>Search by name or reference<input value={draft} onChange={e=>setDraft(e.target.value)} maxLength={128} style={{display:'block',width:'100%'}}/></label>
      <label>Status<select value={status} onChange={e=>{setStatus(e.target.value);setCursors([null]);}} style={{display:'block'}}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="ALL">All</option></select></label>
      <button className="btn" type="submit">Search</button><button className="btn" type="button" onClick={()=>setRetry(v=>v+1)}>Refresh</button>
    </form>
    {current.phase==='LOADING'&&<p role="status">Loading {title.toLowerCase()}…</p>}
    {current.phase==='ERROR'&&<div role="alert"><p>{current.message}</p><button className="btn" onClick={()=>setRetry(v=>v+1)}>Retry</button></div>}
    {current.phase==='READY'&&<><p role="status">{rows.length?`${rows.length} ${title.toLowerCase()} on this page`:'No matching contacts. Try another name or status.'}</p>
      <div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse'}}><thead><tr><th scope="col">Name</th><th scope="col">Reference</th><th scope="col">Status</th></tr></thead><tbody>{rows.map(row=><tr key={row.member_ref}><td style={{overflowWrap:'anywhere',padding:12}}>{row.display_name}</td><td style={{overflowWrap:'anywhere',padding:12}}>{row.member_ref}</td><td style={{padding:12}}>{row.active?'Active':'Inactive'}</td></tr>)}</tbody></table></div>
      <nav aria-label={`${title} pages`} style={{display:'flex',gap:8,marginTop:16}}><button className="btn" disabled={cursors.length===1} onClick={()=>changePage(cursors.slice(0,-1))}>Previous</button><span>Page {cursors.length}</span><button className="btn" disabled={!current.data.next_ref} onClick={()=>changePage([...cursors,current.data.next_ref])}>Next</button></nav></>}
  </section>;
}
