import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeWbsH1ImportInventory} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

const PAGE_SIZE=50;
const label=value=>value===null?'Not available':value;
const mappingLabel=value=>({MAPPING_MISSING:'Mapping missing',MAPPING_READY_FOR_REVIEW:'Ready for mapping review',MAPPING_AMBIGUOUS:'Mapping ambiguous',FORMAL_MAPPING_POSTED:'Formally mapped and posted'}[value]||value);
const importLabel=value=>value==='CONTROLLED_TEST_POSTED'?'Controlled test posted':'Imported source only';

export function AuthoritativeWbsH1ImportWorkspace({config,fetcher=globalThis.fetch}){
  const [offset,setOffset]=useState(0);
  const [state,setState]=useState({phase:'LOADING',data:null,error:null});
  const load=async nextOffset=>{
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeWbsH1ImportInventory({config,limit:PAGE_SIZE,offset:nextOffset,fetcher});
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  useEffect(()=>{setOffset(0);void load(0);},[config.entityId]);
  const data=state.data,total=data?.totals.source_record_count||0,page=Math.floor(offset/PAGE_SIZE)+1,pageCount=Math.max(1,Math.ceil(total/PAGE_SIZE));
  const move=next=>{setOffset(next);void load(next);};
  return <AuthoritativeWorkspaceView area="WBS Data Import" className="stack authoritative-wbs-h1-import-workspace">
    <AuthoritativeWorkspaceHeader eyebrow="WBS DATA IMPORT" title="2026 H1 business data" description="Real WBS business rows are shown under the selected company before formal accounting mapping." status="READ ONLY"/>
    {state.phase==='LOADING'&&!data&&<StateBlock tone="loading" title="Loading WBS business data">Reading the selected company's January–June import inventory.</StateBlock>}
    {state.phase==='BLOCKED'&&!data&&<StateBlock tone="blocked" title={state.error?.code||'WBS_H1_IMPORT_INVENTORY_BLOCKED'}>{state.error?.message}</StateBlock>}
    {data&&<>
      {state.phase==='BLOCKED'&&<StateBlock tone="blocked" title={state.error?.code||'Refresh failed'}>{state.error?.message} The previously loaded inventory remains below.</StateBlock>}
      <div className="qbo-toolgrid" aria-label="WBS H1 import totals">
        <span><i>Company</i><b>{data.company_code}</b></span><span><i>Imported rows</i><b>{data.totals.source_record_count}</b></span><span><i>Source amount</i><b>{data.currency} {data.totals.source_amount}</b></span><span><i>Formal postings</i><b>{data.totals.formal_mapping_posted_count}</b></span>
      </div>
      <StateBlock tone={data.totals.mapping_missing_count||data.totals.mapping_ambiguous_count?'blocked':'empty'} title={data.totals.source_record_count?'Imported business data is available':'No H1 business data found'}>
        {data.totals.source_record_count?`${data.totals.controlled_test_posted_count} rows have controlled test postings; ${data.totals.mapping_ready_count} are ready for mapping review; ${data.totals.mapping_missing_count} have no matching WBS mapping. Imported source rows are not formal ledger entries.`:'No January–June WBS Payables have been staged for this company.'}
      </StateBlock>
      <section className="report-workbench" aria-label="Monthly WBS import summary">
        <div className="report-workbench-head"><div><b>January–June population</b><div className="page-subtitle">The counts and amounts come from retained company-scoped WBS source facts.</div></div><button type="button" className="btn" onClick={()=>load(offset)} disabled={state.phase==='LOADING'}>{state.phase==='LOADING'?'Refreshing…':'Refresh'}</button></div>
        <div className="table-wrap" role="region" tabIndex={0} aria-label="Monthly WBS import summary"><table className="tbl"><thead><tr><th>Period</th><th>Rows</th><th>Source amount</th><th>Test posted</th><th>Mapping ready</th><th>Mapping missing</th><th>Formal posted</th></tr></thead><tbody>{data.months.map(month=><tr key={month.period_code}><td>{month.period_code}</td><td>{month.source_record_count}</td><td>{data.currency} {month.source_amount}</td><td>{month.controlled_test_posted_count}</td><td>{month.mapping_ready_count}</td><td>{month.mapping_missing_count+month.mapping_ambiguous_count}</td><td>{month.formal_mapping_posted_count}</td></tr>)}</tbody></table></div>
      </section>
      <section className="report-workbench" aria-label="Imported WBS business rows">
        <div className="report-workbench-head"><div><b>Imported business rows</b><div className="page-subtitle">Page {page} of {pageCount}. Source hashes are immutable REFS evidence identities.</div></div><span className="badge badge-muted">NO ACCOUNTING ACTION</span></div>
        {data.rows.length===0?<StateBlock tone="empty" title="No rows on this page">Return to the previous page or import the company's source population.</StateBlock>:<div className="table-wrap" role="region" tabIndex={0} aria-label="Imported WBS business rows"><table className="tbl"><thead><tr><th>Date</th><th>Amount</th><th>Project</th><th>Cost code</th><th>Payee reference</th><th>Import state</th><th>Mapping state</th><th>Source evidence</th></tr></thead><tbody>{data.rows.map(row=><tr key={row.source_record_hash}><td>{row.accounting_date}</td><td>{data.currency} {row.amount}</td><td>{label(row.project_code)}</td><td>{label(row.cost_code)}</td><td>{label(row.vendor_no)}</td><td>{importLabel(row.import_state)}</td><td>{mappingLabel(row.mapping_state)}</td><td title={row.source_record_hash}>{row.source_record_hash.slice(0,18)}…</td></tr>)}</tbody></table></div>}
        <div className="pagination"><button type="button" className="btn" disabled={offset===0||state.phase==='LOADING'} onClick={()=>move(Math.max(0,offset-PAGE_SIZE))}>Previous</button><span>Rows {total===0?0:offset+1}–{Math.min(offset+data.rows.length,total)} of {total}</span><button type="button" className="btn" disabled={offset+PAGE_SIZE>=total||state.phase==='LOADING'} onClick={()=>move(offset+PAGE_SIZE)}>Next</button></div>
      </section>
    </>}
  </AuthoritativeWorkspaceView>;
}
