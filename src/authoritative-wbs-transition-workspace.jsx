import React,{useState} from 'react';
import {refreshAuthoritativeWbsAutoRecReview,refreshAuthoritativeWbsControlReconciliation,verifyAuthoritativeWbsTransitionContract} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeDemoView,AuthoritativeDemoWorkspaceHeader} from './authoritative-demo-view.jsx';

const scopeValue=value=>value||'Configured authoritative scope';

export function AuthoritativeWbsTransitionWorkspace({config,fetcher=globalThis.fetch}){
  const [rawContract,setRawContract]=useState('');
  const [state,setState]=useState({phase:'IDLE',data:null,error:null});
  const [reviewInput,setReviewInput]=useState({companyKey:'',sourceRecordIds:''});
  const [reviewState,setReviewState]=useState({phase:'IDLE',data:null,error:null});
  const [controlInput,setControlInput]=useState({sourceType:'COST_GENERAL_LEDGER',companyKey:'',period:'',currency:'USD',propertyRef:'',periodStart:'',periodEnd:'',bankAccountRef:''});
  const [controlState,setControlState]=useState({phase:'IDLE',data:null,error:null});
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
  const readReview=async event=>{
    event.preventDefault();setReviewState(current=>({...current,phase:'LOADING',error:null}));
    const sourceRecordIds=reviewInput.sourceRecordIds.split(/[\n,]+/).map(value=>value.trim()).filter(Boolean);
    const result=await refreshAuthoritativeWbsAutoRecReview({config,companyKey:reviewInput.companyKey,sourceRecordIds,fetcher});
    setReviewState(current=>result.ok&&result.data.status!=='BLOCKED'?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result.ok?{code:result.data.code,message:'Persisted WBS evidence is not complete for this exact selection.'}:result});
  };
  const readControl=async event=>{
    event.preventDefault();setControlState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeWbsControlReconciliation({config,...controlInput,fetcher});
    setControlState(current=>result.ok&&result.data.status!=='BLOCKED'?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result.ok?{code:result.data.code,message:'Receipt-backed WBS and REFS control evidence is incomplete for this exact scope.'}:result});
  };
  const data=state.data;
  const review=reviewState.data,control=controlState.data;
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

    <section className="report-workbench" aria-label="Persisted WBS AutoRec review evidence">
      <div className="report-workbench-head"><div><b>Persisted AutoRec review evidence</b><div className="page-subtitle">Read a bounded company/source selection already retained in PostgreSQL. This request never calls WBS and cannot match, allocate, dispatch a Draft, or post.</div></div><span className="badge badge-muted">GET ONLY</span></div>
      <form className="filterbar" onSubmit={readReview}>
        <label htmlFor="wbs-review-company">WBS company key<input id="wbs-review-company" required maxLength="128" value={reviewInput.companyKey} onChange={event=>setReviewInput(current=>({...current,companyKey:event.target.value}))} placeholder="Exact retained company key"/></label>
        <label htmlFor="wbs-review-sources">Immutable source record IDs<textarea id="wbs-review-sources" required rows="4" maxLength="25600" value={reviewInput.sourceRecordIds} onChange={event=>setReviewInput(current=>({...current,sourceRecordIds:event.target.value}))} placeholder="One to 50 IDs, separated by lines or commas"/></label>
        <button type="submit" className="btn" disabled={reviewState.phase==='LOADING'}>{reviewState.phase==='LOADING'?'Reading retained evidence...':'Load AutoRec review evidence'}</button>
      </form>
      {reviewState.phase==='LOADING'&&<StateBlock tone="loading" title="Reading persisted AutoRec evidence">Loading only receipt-backed rows for the exact company and source IDs.</StateBlock>}
      {reviewState.phase==='BLOCKED'&&<StateBlock tone="blocked" title={reviewState.error?.code||'WBS_AUTOREC_REVIEW_BLOCKED'}>{reviewState.error?.message}{review&&' Previously retained review evidence remains below.'}</StateBlock>}
      {reviewState.phase==='IDLE'&&<StateBlock tone="empty" title="No AutoRec selection loaded">Enter the exact WBS company key and persisted source IDs. REFS will not list, search, or infer external WBS records.</StateBlock>}
      {review?.status==='READ_ONLY_PROJECTED'&&<>
        <div className="qbo-toolgrid"><span><i>Status</i><b>{review.status}</b></span><span><i>Review candidates</i><b>{review.candidates.length}</b></span><span><i>Exceptions</i><b>{review.exceptions.length}</b></span><span><i>Action authority</i><b>None</b></span></div>
        {review.candidates.length===0?<StateBlock tone="empty" title="No retained review candidates">The authenticated API returned a valid empty result for this exact selection.</StateBlock>:<div className="table-wrap authoritative-wbs-review-table" role="region" tabIndex={0} aria-label="WBS AutoRec review candidates; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Candidate</th><th>Side</th><th>Source type</th><th>Source record</th><th>Version</th><th>Date</th><th>Currency</th><th>Amount</th><th>Bank scope</th><th>Mapping</th></tr></thead><tbody>{review.candidates.map(row=><tr key={row.review_candidate_id}><td>{row.review_candidate_id}</td><td>{row.side}</td><td>{row.source_type}</td><td>{row.source_record_id}</td><td>{row.source_version}</td><td>{row.accounting_date}</td><td>{row.currency}</td><td>{row.amount}</td><td>{row.bank_account_ref}</td><td>{row.mapping.mapping_id} / {row.mapping.version}</td></tr>)}</tbody></table></div>}
      </>}
    </section>

    <section className="report-workbench" aria-label="WBS and REFS control reconciliation evidence">
      <div className="report-workbench-head"><div><b>WBS / REFS control reconciliation</b><div className="page-subtitle">Compare persisted signed WBS metrics with an immutable REFS metric snapshot through one approved mapping. Differences remain evidence only.</div></div><span className="badge badge-muted">GET ONLY</span></div>
      <form className="filterbar" onSubmit={readControl}>
        <label htmlFor="wbs-control-type">Control source<select id="wbs-control-type" value={controlInput.sourceType} onChange={event=>setControlInput(current=>({...current,sourceType:event.target.value}))}><option value="COST_GENERAL_LEDGER">Cost General Ledger</option><option value="PROPERTY_COMPARISON">Property comparison</option></select></label>
        <label htmlFor="wbs-control-company">WBS company key<input id="wbs-control-company" required maxLength="128" value={controlInput.companyKey} onChange={event=>setControlInput(current=>({...current,companyKey:event.target.value}))}/></label>
        <label htmlFor="wbs-control-currency">Currency<input id="wbs-control-currency" required maxLength="3" pattern="[A-Z]{3}" value={controlInput.currency} onChange={event=>setControlInput(current=>({...current,currency:event.target.value.toUpperCase()}))}/></label>
        {controlInput.sourceType==='COST_GENERAL_LEDGER'?<label htmlFor="wbs-control-period">Accounting period<input id="wbs-control-period" required type="month" value={controlInput.period} onChange={event=>setControlInput(current=>({...current,period:event.target.value}))}/></label>:<>
          <label htmlFor="wbs-control-property">Property reference<input id="wbs-control-property" required maxLength="128" value={controlInput.propertyRef} onChange={event=>setControlInput(current=>({...current,propertyRef:event.target.value}))}/></label>
          <label htmlFor="wbs-control-start">Period start<input id="wbs-control-start" required type="date" value={controlInput.periodStart} onChange={event=>setControlInput(current=>({...current,periodStart:event.target.value}))}/></label>
          <label htmlFor="wbs-control-end">Period end<input id="wbs-control-end" required type="date" value={controlInput.periodEnd} onChange={event=>setControlInput(current=>({...current,periodEnd:event.target.value}))}/></label>
          <label htmlFor="wbs-control-bank">Bank account reference<input id="wbs-control-bank" required maxLength="128" value={controlInput.bankAccountRef} onChange={event=>setControlInput(current=>({...current,bankAccountRef:event.target.value}))}/></label>
        </>}
        <button type="submit" className="btn" disabled={controlState.phase==='LOADING'}>{controlState.phase==='LOADING'?'Reading control evidence...':'Load control reconciliation'}</button>
      </form>
      {controlState.phase==='LOADING'&&<StateBlock tone="loading" title="Reading immutable control snapshots">Checking the exact WBS receipt, approved mapping, and REFS metric snapshot.</StateBlock>}
      {controlState.phase==='BLOCKED'&&<StateBlock tone="blocked" title={controlState.error?.code||'WBS_CONTROL_RECONCILIATION_BLOCKED'}>{controlState.error?.message}{control&&' Previously retained control evidence remains below.'}</StateBlock>}
      {controlState.phase==='IDLE'&&<StateBlock tone="empty" title="No control scope loaded">Choose an exact Cost GL or Property control scope. Missing receipts or mappings remain BLOCKED, never zero.</StateBlock>}
      {control&&control.status!=='BLOCKED'&&<>
        <div className="qbo-toolgrid"><span><i>Status</i><b>{control.reconciliation.status}</b></span><span><i>Metrics</i><b>{control.reconciliation.control_totals.metric_count}</b></span><span><i>Differences</i><b>{control.reconciliation.control_totals.difference_count}</b></span><span><i>Action authority</i><b>None</b></span></div>
        <div className="table-wrap authoritative-wbs-control-table" role="region" tabIndex={0} aria-label="WBS control reconciliation; scroll horizontally to view every column"><table className="tbl"><thead><tr><th>Metric</th><th>WBS source</th><th>REFS target</th><th>Difference</th><th>Result</th></tr></thead><tbody>{control.reconciliation.comparisons.map(row=><tr key={row.metric_key}><td>{row.metric_key}</td><td>{row.source_amount}</td><td>{row.target_amount}</td><td>{row.difference}</td><td>{row.matched?'MATCHED':'DIFFERENCE'}</td></tr>)}</tbody></table></div>
      </>}
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
