import React,{useEffect,useState} from 'react';
import {refreshAuthoritativeAging,refreshAuthoritativeAgingSnapshotDetail,refreshAuthoritativeAgingSnapshotSummary,refreshAuthoritativeControlTotals} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {AuthoritativeReadFailure,authoritativeReadFailurePhase} from './authoritative-read-state.jsx';

// This is a read-only reporting surface.  The configured entity and period are
// accounting scope supplied by the authoritative runtime; the only reader
// choice supported by the API contract is the as-of date.
const BUCKETS=[['current_amount','Current'],['days_1_30','1–30 days'],['days_31_60','31–60 days'],['days_61_90','61–90 days'],['days_91_plus','91+ days'],['total_open_balance','Total open']];
const AGING_MONTHS=Object.freeze(['January','February','March','April','May','June','July','August','September','October','November','December']);
const money=value=>{const m=/^(-?)([0-9]+)\.([0-9]{2})[0-9]{2}$/.exec(String(value??'0.0000'));if(!m)return String(value??'');const whole=m[2].replace(/\B(?=(\d{3})+(?!\d))/g,',');return `${m[1]}$${whole}.${m[3]}`;};
const defaultAsOf=config=>/^\d{4}-\d{2}-\d{2}$/.test(config?.scopePresentation?.periodEnd||'')?config.scopePresentation.periodEnd:'';
export const authoritativeAgingAsOfCaption=value=>{const match=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value||'');if(!match)return '';const instant=new Date(`${value}T00:00:00.000Z`);if(!Number.isFinite(instant.getTime())||instant.toISOString().slice(0,10)!==value)return '';return `As of ${AGING_MONTHS[Number(match[2])-1]} ${Number(match[3])}, ${match[1]}`;};

const agingContextMatches=(config,side,returnContext,expectedOrigin)=>!returnContext||(
  returnContext.entityId===config?.entityId
  && returnContext.periodId===config?.periodId
  && returnContext.agingSide===String(side||'').toUpperCase()
  && (!expectedOrigin||returnContext.agingOrigin===expectedOrigin)
);

export function AuthoritativeAgingWorkspace({config,side,fetcher=globalThis.fetch,onBack,backLabel='Back to invoices & receipts',returnContext,expectedOrigin}){
  const label=side==='ap'?'AP':'AR';
  const businessLabel=side==='ap'?'Accounts payable':'Accounts receivable';
  const entityLabel=config?.scopePresentation?.entityLabel||'Configured entity';
  const periodLabel=config?.scopePresentation?.periodLabel||'Configured period';
  const scopeMatches=agingContextMatches(config,side,returnContext,expectedOrigin);
  const [asOf,setAsOf]=useState(()=>defaultAsOf(config));
  const [state,setState]=useState({phase:'LOADING',aging:[],summary:[],snapshot:null,control:[],error:null});
  const [detail,setDetail]=useState(null);
  const [documentEvidence,setDocumentEvidence]=useState(null);
  const load=async date=>{
    setDetail(null);setDocumentEvidence(null);setState(current=>({...current,phase:'LOADING',error:null}));
    const [aging,summary,control]=await Promise.all([
      refreshAuthoritativeAging({config,side,asOfDate:date,fetcher}),
      refreshAuthoritativeAgingSnapshotSummary({config,side,asOfDate:date,fetcher}),
      refreshAuthoritativeControlTotals({config,side,fetcher}),
    ]);
    if(!aging.ok||!summary.ok||!control.ok){const failure=!aging.ok?aging:!summary.ok?summary:control;setState({phase:authoritativeReadFailurePhase(failure),aging:[],summary:[],snapshot:null,control:[],error:failure});return;}
    setState({phase:'READY',aging:aging.rows,summary:summary.rows,snapshot:summary.scope,control:control.rows,error:null});
  };
  useEffect(()=>{const scopedAsOf=defaultAsOf(config);setAsOf(scopedAsOf);if(scopedAsOf)void load(scopedAsOf);else setState({phase:'BLOCKED',aging:[],summary:[],snapshot:null,control:[],error:{ok:false,code:'ACCOUNTING_API_SCOPE_INVALID',message:'The authoritative API did not return the selected period end date.'}});},[config?.entityId,config?.periodId,config?.scopePresentation?.periodEnd,side]);
  const submit=event=>{event.preventDefault();void load(asOf);};
  const restoreFocus=id=>{if(typeof document==='undefined')return;queueMicrotask(()=>document.getElementById(id)?.focus());};
  const loadDetail=async(selection,offset=0)=>{
    setDetail({...selection,phase:'LOADING',rows:[],scope:null,error:null,offset});setDocumentEvidence(null);
    const result=await refreshAuthoritativeAgingSnapshotDetail({config,side,asOfDate:selection.asOf,counterpartyRef:selection.row.counterparty_ref,counterpartyName:selection.row.counterparty_name,currency:selection.row.currency,snapshot:selection.snapshot,limit:25,offset,fetcher});
    if(!result.ok){setDetail({...selection,phase:authoritativeReadFailurePhase(result),rows:[],scope:null,error:result,offset});return;}
    setDetail({...selection,phase:'READY',rows:result.rows,scope:result.scope,error:null,offset});
  };
  const openDetail=(row,index)=>{const selection={row,snapshot:state.snapshot,asOf,focusId:`aging-party-${index}`};void loadDetail(selection,0);};
  const closeDetail=()=>{const focusId=detail?.focusId;setDetail(null);setDocumentEvidence(null);restoreFocus(focusId);};
  const closeDocumentEvidence=()=>{const focusId=documentEvidence?.focusId;setDocumentEvidence(null);restoreFocus(focusId);};
  if(documentEvidence)return <section className="authoritative-aging-workspace stack" aria-label={`${label} aging document evidence`}>
    <header className="authoritative-aging-heading"><div><div className="authoritative-eyebrow">{businessLabel} / aging detail</div><h2>{side==='ap'?'Bill':'Invoice'} {documentEvidence.row.document_number}</h2><p className="page-subtitle">Read-only document evidence retained by the selected historical aging snapshot.</p></div><div className="authoritative-aging-actions"><button type="button" className="btn btn-sm" onClick={closeDocumentEvidence}>Back to aging detail</button><span className="badge badge-muted">READ ONLY</span></div></header>
    <section className="card" aria-label="Aging document evidence scope"><div className="card-head"><div><h3>Evidence scope</h3><p className="muted sm">As of {detail.asOf} · snapshot version {detail.snapshot.snapshot_version}</p></div></div><dl className="evidence-grid"><div><dt>Document ID</dt><dd>{documentEvidence.row.business_document_id}</dd></div><div><dt>Revision at as-of</dt><dd>{documentEvidence.row.document_revision}</dd></div><div><dt>Accounting date</dt><dd>{documentEvidence.row.accounting_date}</dd></div><div><dt>Due date</dt><dd>{documentEvidence.row.due_date||'Not available'}</dd></div><div><dt>Gross amount</dt><dd>{money(documentEvidence.row.gross_amount)} {documentEvidence.row.currency}</dd></div><div><dt>Open balance</dt><dd>{money(documentEvidence.row.open_balance)} {documentEvidence.row.currency}</dd></div><div><dt>Source document</dt><dd>{documentEvidence.row.source_document_id||'Not available'}</dd></div><div><dt>Posted journal</dt><dd>{documentEvidence.row.posted_journal_entry_id}</dd></div></dl></section>
    <details className="card"><summary>Immutable trace</summary><dl className="evidence-grid"><div><dt>Snapshot ID</dt><dd>{detail.snapshot.snapshot_id}</dd></div><div><dt>Snapshot hash</dt><dd>{detail.snapshot.snapshot_hash}</dd></div><div><dt>Source payload hash</dt><dd>{documentEvidence.row.source_payload_hash||'Not available'}</dd></div><div><dt>Posted journal revision</dt><dd>{documentEvidence.row.posted_journal_revision}</dd></div><div><dt>Aging bucket</dt><dd>{documentEvidence.row.aging_bucket}</dd></div></dl></details>
  </section>;
  if(detail)return <section className="authoritative-aging-workspace stack" aria-label={`${label} aging detail`}>
    <header className="authoritative-aging-heading"><div><div className="authoritative-eyebrow">{businessLabel} / historical aging</div><h2>{detail.row.counterparty_name}</h2><p className="page-subtitle">Open {label} documents as of {detail.asOf} · {detail.row.currency}.</p></div><div className="authoritative-aging-actions"><button type="button" className="btn btn-sm" onClick={closeDetail}>Back to aging summary</button><span className="badge badge-muted">READ ONLY</span></div></header>
    <section className="card"><div className="card-head"><div><h3>Snapshot documents</h3><p className="muted sm">{detail.scope?.total_count??detail.row.document_count} document(s) · snapshot version {detail.snapshot.snapshot_version}</p></div></div>
      {detail.phase==='LOADING'&&<StateBlock tone="loading">Loading historical aging detail…</StateBlock>}
      <AuthoritativeReadFailure state={detail} onRetry={()=>void loadDetail(detail,detail.offset)}/>
      {detail.phase==='READY'&&(!detail.rows.length?<StateBlock tone="empty" title="No documents on this page">This page contains no documents in the selected immutable snapshot.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} historical aging documents`}><table className="tbl"><thead><tr><th>Date</th><th>Type</th><th>Number</th><th>Due date</th><th className="ta-r">Past due</th><th className="ta-r">Amount</th><th className="ta-r">Open balance</th><th>Details</th></tr></thead><tbody>{detail.rows.map((row,index)=><tr key={row.business_document_id}><td>{row.accounting_date}</td><td>{side==='ap'?'Bill':'Invoice'}</td><td>{row.document_number}</td><td>{row.due_date||'Not available'}</td><td className="num">{row.days_past_due} days</td><td className="num">{money(row.gross_amount)}</td><td className="num">{money(row.open_balance)}</td><td><button id={`aging-document-${index}`} type="button" className="btn btn-sm" onClick={()=>setDocumentEvidence({row,focusId:`aging-document-${index}`})}>View details</button></td></tr>)}</tbody></table></div>)}
      {detail.phase==='READY'&&<div className="pagination"><span>Showing {detail.scope.total_count?detail.offset+1:0}–{Math.min(detail.offset+detail.rows.length,detail.scope.total_count)} of {detail.scope.total_count}</span><button type="button" className="btn btn-sm" disabled={detail.offset===0} onClick={()=>void loadDetail(detail,Math.max(0,detail.offset-25))}>Previous</button><button type="button" className="btn btn-sm" disabled={detail.offset+detail.rows.length>=detail.scope.total_count} onClick={()=>void loadDetail(detail,detail.offset+25)}>Next</button></div>}
      <details><summary>Snapshot evidence</summary><dl className="evidence-grid"><div><dt>Snapshot ID</dt><dd>{detail.snapshot.snapshot_id}</dd></div><div><dt>Snapshot hash</dt><dd>{detail.snapshot.snapshot_hash}</dd></div></dl></details>
    </section>
  </section>;
  return <section className="authoritative-aging-workspace stack" aria-label={`${label} aging and control totals`}>
    <header className="authoritative-aging-heading">
      <div>
        <div className="authoritative-eyebrow">{businessLabel}</div>
        <h2>{businessLabel} aging summary</h2>
        {authoritativeAgingAsOfCaption(asOf)&&<p className="authoritative-report-period-caption">{authoritativeAgingAsOfCaption(asOf)}</p>}
        <p className="page-subtitle">Review aging and control totals.</p>
      </div>
      <div className="authoritative-aging-actions">
        {typeof onBack==='function'&&<button type="button" className="btn btn-sm" onClick={onBack}>{backLabel}</button>}
        <span className="badge badge-muted">READ ONLY</span>
      </div>
    </header>
    <form className="authoritative-aging-controls" aria-label={`${label} aging report scope`} onSubmit={submit}>
      <output className="authoritative-aging-scope" title={`Entity ID: ${config.entityId}`}><i>Entity reporting scope</i><b>{entityLabel}</b></output>
      <output className="authoritative-aging-scope" title={`Period ID: ${config.periodId}`}><i>Accounting period</i><b>{periodLabel}</b></output>
      <label><span>As-of date</span><input type="text" inputMode="numeric" pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}" placeholder="YYYY-MM-DD" aria-label={`${label} aging as-of date`} value={asOf} onChange={event=>setAsOf(event.target.value)}/></label>
      <button type="submit" className="btn btn-sm">Refresh</button>
    </form>
    {!scopeMatches&&<StateBlock tone="blocked" title="BLOCKED — immutable aging scope mismatch">The full-page aging report no longer matches the entity, configured period, AP/AR side, or parent route retained by its return context. Return to the parent report; no aging result is asserted from this mismatched scope.</StateBlock>}
    {scopeMatches&&<>
      {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative {label} aging…</StateBlock>}
      <AuthoritativeReadFailure state={state} onRetry={()=>void load(asOf)}/>
      {state.phase==='READY'&&<>
      <section className="card" aria-label={`${label} counterparty aging snapshot`}>
        <div className="card-head"><div><h3>{side==='ap'?'Vendor':'Customer'} aging as of {asOf}</h3><p className="muted sm">{state.snapshot.detail_count} open document(s) · snapshot version {state.snapshot.snapshot_version}</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.summary.length?<StateBlock tone="empty" title={`No open ${label} documents`}>No open documents were returned in this exact entity, period and as-of snapshot. This result does not assert activity outside the selected scope.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} counterparty aging snapshot`}><table className="tbl"><thead><tr><th>{side==='ap'?'Vendor':'Customer'}</th><th>Currency</th>{BUCKETS.map(([,l])=><th key={l} className="ta-r">{l}</th>)}<th>Documents</th><th>Details</th></tr></thead><tbody>{state.summary.map((row,index)=><tr key={`${row.counterparty_ref}:${row.currency}`}><td>{row.counterparty_name}</td><td>{row.currency}</td>{BUCKETS.map(([k,l])=><td key={l} className="num">{money(row[k])}</td>)}<td className="num">{row.document_count}</td><td><button id={`aging-party-${index}`} type="button" className="btn btn-sm" onClick={()=>openDetail(row,index)}>View details</button></td></tr>)}</tbody></table></div>}
        <details><summary>Snapshot evidence</summary><dl className="evidence-grid"><div><dt>Snapshot ID</dt><dd>{state.snapshot.snapshot_id}</dd></div><div><dt>Snapshot hash</dt><dd>{state.snapshot.snapshot_hash}</dd></div></dl></details>
      </section>
      <section className="card" aria-label={`${label} control totals`}>
        <div className="card-head"><div><h3>Control totals</h3><p className="muted sm">Subledger open balance compared with the retained GL control account.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.control.length?<StateBlock tone="empty" title="No control totals returned">No control-total evidence was returned for this entity. This scoped result is not proof of a zero control balance.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} control totals; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Currency</th><th className="ta-r">Subledger open</th><th className="ta-r">GL control</th><th>Status</th></tr></thead><tbody>{state.control.map(row=><tr key={row.currency}><td>{row.currency}</td><td className="num">{money(row.open_balance)}</td><td className="num">{money(row.control_balance)}</td><td><span className={row.in_balance?'badge badge-ok':'badge badge-warn'}>{row.in_balance?'In balance':'Out of balance'}</span></td></tr>)}</tbody></table></div>}
      </section>
      <section className="card" aria-label={`${label} aging currency control view`}>
        <div className="card-head"><div><h3>Currency control view</h3><p className="muted sm">{state.aging.length} aggregate currency row(s). These totals do not infer which documents belong to a vendor or customer.</p></div><span className="badge badge-muted">READ ONLY</span></div>
        {!state.aging.length?<StateBlock tone="empty" title="No aging evidence returned">No open {label} balances were returned for this entity as of {asOf}. Change the as-of date and load the report again. This is not evidence of zero invoices, receipts, bills, payments, or ledger activity.</StateBlock>:<div className="table-wrap authoritative-aging-table" tabIndex={0} aria-label={`${label} aging buckets; scroll horizontally to view every column`}><table className="tbl"><thead><tr><th>Currency</th>{BUCKETS.map(([,l])=><th key={l} className="ta-r">{l}</th>)}</tr></thead><tbody>{state.aging.map(row=><tr key={row.currency}><td>{row.currency}</td>{BUCKETS.map(([k,l])=><td key={l} className="num">{money(row[k])}</td>)}</tr>)}</tbody></table></div>}
      </section>
      </>}
    </>}
  </section>;
}
