import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeWbsH1ImportInventory,refreshAuthoritativeWbsH1AccountingSettingsProposal,readAuthoritativeWbsH1AccountingSettingsDecision,decideAuthoritativeWbsH1AccountingSettings} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeWorkspaceView,AuthoritativeWorkspaceHeader} from './authoritative-workbench-view.jsx';

const PAGE_SIZE=50;
const label=value=>value===null?'Not available':value;
const mappingLabel=value=>({MAPPING_MISSING:'Mapping missing',MAPPING_READY_FOR_REVIEW:'Ready for mapping review',MAPPING_AMBIGUOUS:'Mapping ambiguous',FORMAL_MAPPING_POSTED:'Formally mapped and posted'}[value]||value);
const importLabel=value=>value==='CONTROLLED_TEST_POSTED'?'Controlled test posted':'Imported source only';

export function AuthoritativeWbsH1ImportWorkspace({config,fetcher=globalThis.fetch}){
  const [offset,setOffset]=useState(0);
  const [state,setState]=useState({phase:'LOADING',data:null,error:null});
  const [settings,setSettings]=useState({phase:'LOADING',data:null,error:null});
  const [decision,setDecision]=useState({phase:'IDLE',data:null,error:null});
  const [decisionReason,setDecisionReason]=useState('');
  const load=async nextOffset=>{
    setState(current=>({...current,phase:'LOADING',error:null}));
    const result=await refreshAuthoritativeWbsH1ImportInventory({config,limit:PAGE_SIZE,offset:nextOffset,fetcher});
    setState(current=>result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:current.data,error:result});
  };
  const loadSettings=async()=>{setSettings(current=>({...current,phase:'LOADING',error:null}));setDecision({phase:'LOADING',data:null,error:null});const result=await refreshAuthoritativeWbsH1AccountingSettingsProposal({config,fetcher});setSettings(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});if(!result.ok){setDecision({phase:'IDLE',data:null,error:null});return;}const existing=await readAuthoritativeWbsH1AccountingSettingsDecision({config,proposalHash:result.data.proposal_hash,fetcher});setDecision(existing.ok?{phase:'READY',data:existing.data,error:null}:{phase:'BLOCKED',data:null,error:existing});};
  const decide=async outcome=>{const proposal=settings.data;if(!proposal)return;setDecision(current=>({...current,phase:'SAVING',error:null}));const key=`wbs-h1-settings-${globalThis.crypto?.randomUUID?.()||Date.now()}`;const result=await decideAuthoritativeWbsH1AccountingSettings({config,proposalHash:proposal.proposal_hash,outcome,reason:decisionReason,idempotencyKey:key,fetcher});setDecision(result.ok?{phase:'READY',data:result.data,error:null}:{phase:'BLOCKED',data:null,error:result});if(result.ok)setDecisionReason('');};
  useEffect(()=>{setOffset(0);void load(0);void loadSettings();},[config.entityId,config.periodId]);
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
      <section className="report-workbench" aria-label="WBS exact account Settings">
        <div className="report-workbench-head"><div><b>WBS account Settings</b><div className="page-subtitle">Exact Payable debit rules for {data.company_code} and {config.scopePresentation?.periodLabel||'the selected period'}.</div></div><button type="button" className="btn" onClick={loadSettings} disabled={settings.phase==='LOADING'}>{settings.phase==='LOADING'?'Refreshing…':'Refresh'}</button></div>
        {settings.phase==='LOADING'&&!settings.data&&<StateBlock tone="loading" title="Loading WBS account Settings">Reading the selected company's exact account rules.</StateBlock>}
        {settings.phase==='BLOCKED'&&<StateBlock tone="blocked" title={settings.error?.code||'WBS_SETTINGS_BLOCKED'}>{settings.error?.message}</StateBlock>}
        {settings.data&&<><div className="qbo-toolgrid" aria-label="WBS account Settings totals"><span><i>Source rules</i><b>{settings.data.source_setting_count}</b></span><span><i>Ready to review</i><b>{settings.data.ready_rule_count}</b></span><span><i>Blocked defaults</i><b>{settings.data.blocked_rule_count}</b></span><span><i>Exceptions</i><b>{settings.data.exception_count}</b></span></div>{settings.data.rules.length===0?<StateBlock tone="empty" title="No WBS account Settings found">This company has no staged Payable debit rules covering the selected period.</StateBlock>:<div className="table-wrap" role="region" tabIndex={0} aria-label="WBS exact account Settings"><table className="tbl"><thead><tr><th>WBS rule</th><th>Cost code</th><th>Account</th><th>Required dimension</th><th>Decision</th></tr></thead><tbody>{settings.data.rules.map(rule=><tr key={rule.rule_id}><td title={rule.source_setting_hash}>{rule.wbs_setting_id}</td><td>{rule.detail||'Default'}</td><td>{rule.account_code===null?'Not assigned':`${rule.account_code} · ${rule.account_name}`}</td><td>{rule.supplementary||'None'}</td><td>{rule.decision==='READY_FOR_HUMAN_REVIEW'?'Ready for review':rule.decision==='BLOCKED_DEFAULT'?'Blocked default':rule.decision==='MAPPING_AMBIGUOUS'?'Mapping ambiguous':rule.decision==='ACCOUNT_NOT_READY'?'Account not ready':'Mapping missing'}</td></tr>)}</tbody></table></div>}<div className="page-subtitle">Proposal {settings.data.proposal_hash.slice(0,18)}… · A Controller decision approves Settings only; it never creates or posts a Journal.</div>
          {decision.phase==='BLOCKED'&&<StateBlock tone="blocked" title={decision.error?.code||'SETTINGS_DECISION_BLOCKED'}>{decision.error?.message}</StateBlock>}
          {decision.data?<StateBlock tone="empty" title={`Controller ${decision.data.outcome==='APPROVED'?'approved':'rejected'} these Settings`}>{decision.data.outcome==='APPROVED'?`${decision.data.approved_rule_count} exact WBS rules are approved for this period.`:'The proposal remains unavailable for accounting use.'} Decision {decision.data.decision_hash.slice(0,18)}… No Draft or posting action was created.</StateBlock>:<div className="stack" aria-label="Controller Settings decision"><label>Review reason<textarea value={decisionReason} onChange={event=>setDecisionReason(event.target.value)} minLength={8} maxLength={2000} rows={3} placeholder="Explain why these exact WBS account rules should be approved or rejected."/></label><div className="row"><button type="button" className="btn btn-primary" disabled={decision.phase==='SAVING'||decisionReason.trim().length<8||settings.data.status!=='READY_FOR_HUMAN_REVIEW'||settings.data.ready_rule_count<1} onClick={()=>void decide('APPROVED')}>Approve Settings</button><button type="button" className="btn" disabled={decision.phase==='SAVING'||decisionReason.trim().length<8} onClick={()=>void decide('REJECTED')}>Reject</button><span className="badge badge-muted">SETTINGS ONLY</span></div></div>}
        </>}
      </section>
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
