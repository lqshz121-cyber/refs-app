import React,{useEffect,useRef,useState} from 'react';
import {readPreauthorizedBankAccess,activatePreauthorizedBankAccess} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

export function PreauthorizedBankAccess({config,fetcher=globalThis.fetch}){
  const [state,setState]=useState({phase:'LOADING',policy:null,error:null});
  const [confirmed,setConfirmed]=useState(false);
  const generation=useRef(0),retryKey=useRef(null),busy=useRef(false);
  useEffect(()=>{
    const current=++generation.current;retryKey.current=null;busy.current=false;setConfirmed(false);setState({phase:'LOADING',policy:null,error:null});
    readPreauthorizedBankAccess({config,fetcher}).then(result=>{if(current!==generation.current)return;setState(result.ok?{phase:'READY',policy:result.data,error:null}:{phase:'BLOCKED',policy:null,error:result});});
    return()=>{generation.current++;};
  },[config,fetcher]);
  const activate=async()=>{
    if(!confirmed||!state.policy||busy.current)return;
    busy.current=true;const current=generation.current,policy=state.policy;
    retryKey.current??=`approved-bank-read-${globalThis.crypto?.randomUUID?.()||Date.now().toString(36)}`;
    setConfirmed(false);setState({phase:'SAVING',policy,error:null});
    const result=await activatePreauthorizedBankAccess({config,fetcher,confirmed:true,idempotencyKey:retryKey.current});
    if(current!==generation.current)return;
    busy.current=false;
    setState(result.ok?{phase:'ACTIVE',policy,error:null}:{phase:'READY',policy,error:result});
  };
  return <section className="report-workbench" aria-label="Administrator-approved Bank request access" style={{minWidth:0,overflowWrap:'anywhere'}}>
    <b>Administrator-approved Bank request access</b>
    <p>Fixed company access: preserve accounting reads, add settings/mapping reads and Bank import request only. No service execution, reconciliation start, approval or posting permission.</p>
    {state.phase==='LOADING'&&<p role="status">Checking administrator authorization…</p>}
    {state.error&&<StateBlock tone="blocked" title={state.error.code}>{state.error.message}</StateBlock>}
    {state.policy&&<><p>Company: {config?.scopePresentation?.entityLabel||state.policy.entityId}. Valid until: {state.policy.validUntil}. Expected grant revision: {state.policy.expectedVersion}.</p>
      {state.phase!=='ACTIVE'&&<><label><input type="checkbox" checked={confirmed} disabled={state.phase==='SAVING'} onChange={event=>setConfirmed(event.target.checked)}/> I confirm this fixed finite access for my signed-in account.</label><button type="button" className="btn" disabled={!confirmed||state.phase==='SAVING'} onClick={activate}>{state.phase==='SAVING'?'Activating…':'Activate approved Bank request and read access'}</button></>}
    </>}
    {state.phase==='ACTIVE'&&<StateBlock tone="success" title="Access verified">All ten effective permissions were read back from the server. Refresh settings and retry the exact authorized Bank request. This does not import data or complete accounting acceptance.</StateBlock>}
  </section>;
}
