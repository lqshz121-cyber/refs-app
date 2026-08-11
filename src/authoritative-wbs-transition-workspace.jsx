import React,{useState} from 'react';
import {verifyAuthoritativeWbsTransitionContract} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeDemoView,AuthoritativeDemoWorkspaceHeader} from './authoritative-demo-view.jsx';

const scopeValue=value=>value||'Configured authoritative scope';

export function AuthoritativeWbsTransitionWorkspace({config,fetcher=globalThis.fetch}){
  const [rawContract,setRawContract]=useState('');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const verify=async event=>{
    event.preventDefault();
    let contract;
    try{contract=JSON.parse(rawContract);}catch{
      setState(current=>({phase:'BLOCKED',data:current.data,error:{code:'WBS_TRANSITION_CONTRACT_JSON_INVALID',message:'Paste one valid signed WBS transition-contract JSON document.'}}));
      return;
    }
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await verifyAuthoritativeWbsTransitionContract({config,contract,fetcher});
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  const data=state.data;
  return <AuthoritativeDemoView area="WBS transition evidence" className="stack authoritative-wbs-transition-workspace">
    <AuthoritativeDemoWorkspaceHeader eyebrow="AUTO RECONCILIATION / PROVIDER EVIDENCE" title="WBS AutoRec transition evidence" description="Review a provider-signed cancellation and reopen contract for the configured accounting scope. This page verifies evidence; it never operates WBS or accounting." status="EVIDENCE ONLY"/>

    <div className="report-shelf" aria-label="WBS evidence reading path"><span className="report-shelf-chip report-shelf-chip-on">1 Signed provider contract</span><span className="report-shelf-chip">2 Pinned signature verification</span><span className="report-shelf-chip">3 No-action guard</span><span className="report-shelf-chip">4 Read-only evidence</span></div>

    <section className="report-workbench" aria-label="Current WBS evidence scope">
      <div className="report-workbench-head"><div><b>Provider evidence scope</b><div className="page-subtitle">The provider contract must be verified by the accounting API before any transition facts are displayed.</div></div><span className="badge badge-muted">READ ONLY</span></div>
      <div className="qbo-toolgrid"><span><i>Entity scope</i><b>{scopeValue(config?.entityId)}</b></span><span><i>Accounting period</i><b>{scopeValue(config?.periodId)}</b></span><span><i>Authority</i><b>Evidence only</b></span></div>
    </section>

    <section className="qbo-grid" aria-label="WBS evidence boundaries">
      <div className="qbo-card"><h4>Signed contract required</h4><div className="qbo-sub">Unsigned, inferred, or browser-created transition facts are not admitted.</div></div>
      <div className="qbo-card"><h4>Pinned provider verification</h4><div className="qbo-sub">The API validates the supplied contract and its declared provider signature.</div></div>
      <div className="qbo-card"><h4>Zero REFS action authority</h4><div className="qbo-sub">Every reserve, release, incur, Draft, approve, post, reverse, and write flag must be false.</div></div>
    </section>

    <section className="report-workbench" aria-label="Signed WBS transition contract verification">
      <div className="report-workbench-head"><div><b>Signed external contract</b><div className="page-subtitle">Paste only a provider-issued contract supplied through the approved evidence path. The accounting API verifies its pinned signature and rejects any contract that grants REFS action authority.</div></div><span className="badge badge-muted">VERIFY</span></div>
      <ul className="muted sm"><li>No direct WBS read or provider request occurs from this browser page.</li><li>No WBS ingress, REFS write, Draft, approval, posting, reversal, reserve, or release is available here.</li><li>A rejected document remains BLOCKED; previously verified evidence remains visible for review.</li></ul>
      <form className="filterbar" onSubmit={verify}>
        <label htmlFor="wbs-signed-contract">Signed provider contract JSON<textarea id="wbs-signed-contract" required rows="10" maxLength="200000" value={rawContract} onChange={event=>setRawContract(event.target.value)} placeholder="Provider-signed WBS transition contract JSON" aria-label="Signed provider contract JSON"/></label>
        <button type="submit" className="btn" disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Verifying signed evidence...':'Verify signed contract evidence'}</button>
      </form>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Verifying signed transition evidence">Checking the pinned signature and every no-action guard.</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_TRANSITION_CONTRACT_BLOCKED'}>{state.error?.message}{data&&' Previously verified evidence remains below.'}</StateBlock>}
      {!data&&state.phase==='IDLE'&&<StateBlock tone="blocked" title="BLOCKED - signed provider evidence required">No signed provider contract has been supplied for this entity. REFS will not infer WBS cancellation, reopen, separation-of-duties, or accounting authority.</StateBlock>}
    </section>

    {data&&<section className="report-workbench" aria-label="Verified WBS transition contract">
      <div className="report-workbench-head"><div><b>Verified external evidence</b><div className="page-subtitle">Signature verification succeeded. These are WBS transition facts only; every REFS action flag is false.</div></div><span className="badge badge-ok">VERIFIED</span></div>
      <div className="qbo-toolgrid"><span><i>Contract hash</i><b>{data.contract_hash}</b></span><span><i>Valid from</i><b>{data.valid_from}</b></span><span><i>Valid until</i><b>{data.valid_until}</b></span><span><i>Company scope</i><b>{data.scope.company_keys.length} approved companies</b></span></div>
      <div className="report-shelf"><span className="report-shelf-chip">Dictionary {data.scope.dictionary_version}</span><span className="report-shelf-chip">Contract {data.contract_id}</span><span className="report-shelf-chip">Signature {data.signature.key_id} / {data.signature.algorithm}</span></div>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="Verified WBS transition evidence; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Transition</th><th>Operation</th><th>Observed state path</th><th>Reason</th><th>Required roles</th><th>Accounting guard</th></tr></thead><tbody>{data.transitions.map(row=><tr key={row.transition_id}><td>{row.transition_id}</td><td>{row.operation}</td><td>{row.from_state} -&gt; {row.to_state}</td><td>{row.requires_reason?'Required':'Not admitted'}</td><td>{row.required_actor_roles.join(', ')}</td><td>Reviewed {row.accounting_guard.blocks_when_accounting_reviewed?'blocks':'not supplied'} / Approved {row.accounting_guard.blocks_when_accounting_approved?'blocks':'not supplied'} / Posted {row.accounting_guard.blocks_when_accounting_posted?'blocks':'not supplied'}</td></tr>)}</tbody></table></div>
    </section>}
  </AuthoritativeDemoView>;
}
