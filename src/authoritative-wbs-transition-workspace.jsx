import React,{useState} from 'react';
import {verifyAuthoritativeWbsTransitionContract} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

export function AuthoritativeWbsTransitionWorkspace({config,fetcher=globalThis.fetch}){
  const [rawContract,setRawContract]=useState('');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const verify=async event=>{
    event.preventDefault();
    let contract;try{contract=JSON.parse(rawContract);}catch{setState(current=>({phase:'BLOCKED',data:current.data,error:{code:'WBS_TRANSITION_CONTRACT_JSON_INVALID',message:'Paste one valid signed WBS transition-contract JSON document.'}}));return;}
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await verifyAuthoritativeWbsTransitionContract({config,contract,fetcher});
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  const data=state.data;
  return <div className="stack authoritative-wbs-transition-workspace"><header className="accounting-page-head"><div><div className="page-eyebrow">AUTHORITATIVE · WBS EVIDENCE</div><h1 className="page-h">WBS AutoRec transition evidence</h1><p className="page-subtitle">Verify provider-signed cancellation and reopen contract evidence for the configured entity. This surface cannot read WBS directly, create a Draft, reserve or release funds, approve, post, reverse, or write to WBS.</p></div><span className="badge badge-muted">EVIDENCE ONLY</span></header>
    <section className="card" aria-label="Signed WBS transition contract verification"><div className="card-head"><div><h2>Signed external contract</h2><p className="muted sm">Paste a provider-issued signed contract only when it has been supplied through the approved evidence path. The accounting API verifies its pinned signature and rejects every contract that grants REFS action authority.</p></div><span className="badge badge-muted">NO ACCOUNTING WRITE</span></div>
      <form className="stack" onSubmit={verify}><label>Signed provider contract JSON<textarea required rows="9" maxLength="200000" value={rawContract} onChange={event=>setRawContract(event.target.value)} placeholder="Provider-signed WBS transition contract JSON" aria-label="Signed provider contract JSON"/></label><div><button type="submit" className="btn" disabled={state.phase==='LOADING'}>Verify signed contract evidence</button></div></form>
      {state.phase==='LOADING'&&<StateBlock tone="loading">Verifying pinned signature and all no-action guards...</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_TRANSITION_CONTRACT_BLOCKED'}>{state.error?.message}{data&&' Previously verified evidence remains below.'}</StateBlock>}
      {!data&&state.phase==='IDLE'&&<StateBlock tone="blocked" title="BLOCKED — signed provider evidence required">No signed provider contract has been supplied for this entity. REFS will not infer WBS cancellation, reopen, separation-of-duties, or accounting authority.</StateBlock>}
    </section>
    {data&&<section className="card" aria-label="Verified WBS transition contract"><div className="card-head"><div><h2>Verified external evidence</h2><p className="muted sm">Signature verification succeeded. This remains WBS evidence only; every REFS action flag is false.</p></div><span className="badge badge-ok">VERIFIED</span></div><div className="qbo-toolgrid"><span><i>Contract hash</i><b>{data.contract_hash}</b></span><span><i>Valid from</i><b>{data.valid_from}</b></span><span><i>Valid until</i><b>{data.valid_until}</b></span><span><i>Companies</i><b>{data.scope.company_keys.length}</b></span></div><p className="muted sm">Dictionary {data.scope.dictionary_version}. Contract {data.contract_id}. Key {data.signature.key_id}; algorithm {data.signature.algorithm}.</p><div className="table-wrap" role="region" tabIndex={0} aria-label="Verified WBS transition evidence; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Transition</th><th>Operation</th><th>Observed state path</th><th>Reason</th><th>Required roles</th><th>Accounting guard</th></tr></thead><tbody>{data.transitions.map(row=><tr key={row.transition_id}><td>{row.transition_id}</td><td>{row.operation}</td><td>{row.from_state} → {row.to_state}</td><td>{row.requires_reason?'Required':'Not admitted'}</td><td>{row.required_actor_roles.join(', ')}</td><td>Reviewed {row.accounting_guard.blocks_when_accounting_reviewed?'blocks':'not supplied'} · Approved {row.accounting_guard.blocks_when_accounting_approved?'blocks':'not supplied'} · Posted {row.accounting_guard.blocks_when_accounting_posted?'blocks':'not supplied'}</td></tr>)}</tbody></table></div></section>}
  </div>;
}
