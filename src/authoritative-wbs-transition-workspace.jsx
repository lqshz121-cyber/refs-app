import React,{useState} from 'react';
import {verifyAuthoritativeWbsTransitionContract} from './accounting-api.js';
import {StateBlock} from './ui.jsx';

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
  return <section className="authoritative-workbench-shell authoritative-wbs-transition-workspace" aria-labelledby="wbs-transition-title">
    <header className="accounting-page-head authoritative-wbs-transition-header">
      <div>
        <p className="authoritative-eyebrow">Auto reconciliation · provider evidence</p>
        <h1 className="page-h" id="wbs-transition-title">WBS AutoRec transition evidence</h1>
        <p className="page-subtitle">Review a provider-signed cancellation and reopen contract for the configured accounting scope. This page verifies evidence; it never operates WBS or accounting.</p>
      </div>
      <div className="authoritative-wbs-transition-status"><span className="badge badge-muted">EVIDENCE ONLY</span><span className="authoritative-readonly-chip">READ ONLY</span></div>
    </header>

    <div className="authoritative-workbench-rail" aria-label="WBS evidence reading path"><span><b>1</b> Signed provider contract</span><span><b>2</b> Pinned signature verification</span><span><b>3</b> No-action guard</span><span><b>4</b> Read-only evidence</span></div>

    <section className="authoritative-wbs-transition-scope" aria-label="Current WBS evidence scope">
      <span className="authoritative-wbs-transition-scope-mark" aria-hidden="true">W</span>
      <div><small>Entity scope</small><strong>{scopeValue(config?.entityId)}</strong></div>
      <div><small>Accounting period</small><strong>{scopeValue(config?.periodId)}</strong></div>
      <p>The provider contract must be verified by the accounting API before any transition facts are displayed.</p>
    </section>

    <section className="authoritative-wbs-transition-boundaries" aria-label="WBS evidence boundaries">
      <article><span className="authoritative-wbs-transition-boundary-mark">S</span><div><strong>Signed contract required</strong><p>Unsigned, inferred, or browser-created transition facts are not admitted.</p></div></article>
      <article><span className="authoritative-wbs-transition-boundary-mark">P</span><div><strong>Pinned provider verification</strong><p>The API validates the supplied contract and its declared provider signature.</p></div></article>
      <article><span className="authoritative-wbs-transition-boundary-mark">0</span><div><strong>Zero REFS action authority</strong><p>Every reserve, release, incur, Draft, approve, post, reverse, and write flag must be false.</p></div></article>
    </section>

    <section className="authoritative-wbs-transition-verifier card" aria-label="Signed WBS transition contract verification">
      <div className="authoritative-wbs-transition-verifier-copy">
        <p className="authoritative-eyebrow">Verification input</p>
        <h2>Signed external contract</h2>
        <p className="muted">Paste only a provider-issued contract supplied through the approved evidence path. The accounting API verifies its pinned signature and rejects any contract that grants REFS action authority.</p>
        <ul className="authoritative-wbs-transition-rule-list">
          <li>No direct WBS read or provider request occurs from this browser page.</li>
          <li>No WBS ingress, REFS write, Draft, approval, posting, reversal, reserve, or release is available here.</li>
          <li>A rejected document remains BLOCKED; previously verified evidence remains visible for review.</li>
        </ul>
      </div>
      <form className="authoritative-wbs-transition-form" onSubmit={verify}>
        <label htmlFor="wbs-signed-contract">Signed provider contract JSON<textarea id="wbs-signed-contract" required rows="10" maxLength="200000" value={rawContract} onChange={event=>setRawContract(event.target.value)} placeholder="Provider-signed WBS transition contract JSON" aria-label="Signed provider contract JSON"/></label>
        <div className="authoritative-wbs-transition-form-actions"><button type="submit" className="btn" disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Verifying signed evidence…':'Verify signed contract evidence'}</button><span>Validation is a single authenticated API verification request.</span></div>
      </form>
      {state.phase==='LOADING'&&<StateBlock tone="loading" title="Verifying signed transition evidence">Checking the pinned signature and every no-action guard…</StateBlock>}
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'WBS_TRANSITION_CONTRACT_BLOCKED'}>{state.error?.message}{data&&' Previously verified evidence remains below.'}</StateBlock>}
      {!data&&state.phase==='IDLE'&&<StateBlock tone="blocked" title="BLOCKED — signed provider evidence required">No signed provider contract has been supplied for this entity. REFS will not infer WBS cancellation, reopen, separation-of-duties, or accounting authority.</StateBlock>}
    </section>

    {data&&<section className="authoritative-wbs-transition-verified card" aria-label="Verified WBS transition contract">
      <div className="card-head"><div><p className="authoritative-eyebrow">Accepted evidence</p><h2>Verified external evidence</h2><p className="muted sm">Signature verification succeeded. These are WBS transition facts only; every REFS action flag is false.</p></div><span className="badge badge-ok">VERIFIED</span></div>
      <div className="authoritative-wbs-transition-evidence-grid"><span><i>Contract hash</i><b>{data.contract_hash}</b></span><span><i>Valid from</i><b>{data.valid_from}</b></span><span><i>Valid until</i><b>{data.valid_until}</b></span><span><i>Company scope</i><b>{data.scope.company_keys.length} approved companies</b></span></div>
      <div className="authoritative-wbs-transition-metadata"><span><b>Dictionary</b>{data.scope.dictionary_version}</span><span><b>Contract ID</b>{data.contract_id}</span><span><b>Signature key</b>{data.signature.key_id} · {data.signature.algorithm}</span></div>
      <div className="table-wrap authoritative-wbs-transition-table" role="region" tabIndex={0} aria-label="Verified WBS transition evidence; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Transition</th><th>Operation</th><th>Observed state path</th><th>Reason</th><th>Required roles</th><th>Accounting guard</th></tr></thead><tbody>{data.transitions.map(row=><tr key={row.transition_id}><td>{row.transition_id}</td><td>{row.operation}</td><td>{row.from_state} → {row.to_state}</td><td>{row.requires_reason?'Required':'Not admitted'}</td><td>{row.required_actor_roles.join(', ')}</td><td>Reviewed {row.accounting_guard.blocks_when_accounting_reviewed?'blocks':'not supplied'} · Approved {row.accounting_guard.blocks_when_accounting_approved?'blocks':'not supplied'} · Posted {row.accounting_guard.blocks_when_accounting_posted?'blocks':'not supplied'}</td></tr>)}</tbody></table></div>
    </section>}
  </section>;
}
