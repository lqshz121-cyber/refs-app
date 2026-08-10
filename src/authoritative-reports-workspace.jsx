import React,{useEffect,useMemo,useState} from 'react';
import {refreshAuthoritativeFinancialStatements} from './accounting-api.js';
import {StateBlock} from './ui.jsx';
import {DEFAULT_AUTHORITATIVE_LIST_VIEW,createAuthoritativeReturnContext,restoreAuthoritativeReturnContext} from './authoritative-list-context.js';

const REPORTS=[
  ['TRIAL_BALANCE','Trial Balance'],
  ['BALANCE_SHEET','Balance Sheet'],
  ['INCOME_STATEMENT','Income Statement'],
  ['CASH_FLOW','Cash movement evidence'],
];
const fixed4=value=>{const match=/^(-?)([0-9]+)\.([0-9]{4})$/.exec(String(value??'0.0000'));if(!match)return 0n;return BigInt(`${match[1]}${match[2]}${match[3]}`);};
const fixed4String=value=>{const negative=value<0n,absolute=negative?-value:value,digits=absolute.toString().padStart(5,'0');return `${negative?'-':''}${digits.slice(0,-4)}.${digits.slice(-4)}`;};
const add=(...values)=>fixed4String(values.reduce((sum,value)=>sum+fixed4(value),0n));
const subtract=(left,right)=>fixed4String(fixed4(left)-fixed4(right));
const money=value=>{const units=fixed4(value),negative=units<0n,absolute=negative?-units:units,cents=(absolute+50n)/100n,whole=(cents/100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g,','),fraction=(cents%100n).toString().padStart(2,'0');return `${negative?'-':''}$${whole}.${fraction}`;};
const sumRows=(rows,sections=null)=>fixed4String(rows.reduce((sum,row)=>sections&&!sections.includes(row.statement_section)?sum:sum+fixed4(row.display_balance),0n));

export const FinancialStatementSummary=({report,rows})=>{
  if(report==='BALANCE_SHEET'){
    const assets=sumRows(rows,['ASSETS']),liabilities=sumRows(rows,['LIABILITIES']),equity=sumRows(rows,['EQUITY','CURRENT_EARNINGS']),right=add(liabilities,equity),difference=subtract(assets,right);
    return <div className="qbo-toolgrid" aria-label="Balance Sheet equation"><span><i>Assets</i><b>{money(assets)}</b></span><span><i>Liabilities</i><b>{money(liabilities)}</b></span><span><i>Equity and current earnings</i><b>{money(equity)}</b></span><span><i>Assets - liabilities - equity</i><b>{money(difference)}</b></span></div>;
  }
  if(report==='INCOME_STATEMENT'){
    const revenue=sumRows(rows,['REVENUE']),expense=sumRows(rows,['EXPENSES']);
    return <div className="qbo-toolgrid" aria-label="Income Statement equation"><span><i>Revenue</i><b>{money(revenue)}</b></span><span><i>Expenses</i><b>{money(expense)}</b></span><span><i>Net income</i><b>{money(subtract(revenue,expense))}</b></span></div>;
  }
  if(report==='CASH_FLOW')return <div className="qbo-toolgrid" aria-label="Direct cash movement evidence"><span><i>Direct cash-account movement</i><b>{money(sumRows(rows))}</b></span><span><i>Classification boundary</i><b>Not classified as operating, investing, or financing</b></span></div>;
  return <div className="qbo-toolgrid" aria-label="Trial Balance control"><span><i>Net debit balance</i><b>{money(sumRows(rows))}</b></span></div>;
};

const EvidenceIds=({label,ids=[]})=><div><b>{label}</b>{ids.length?<ul className="evidence-id-list">{ids.map(id=><li key={id}><code>{id}</code></li>)}</ul>:<p className="muted sm">No retained identifier.</p>}</div>;

const ReportDetail=({row,returnContext,onBack})=><section className="full-bleed qbo-transaction-report" aria-label="Financial statement account evidence">
  <div className="qbo-report-back"><button type="button" className="btn btn-sm btn-ghost" onClick={onBack}>Back to financial statement</button><span>Entity {returnContext?.entityId} · Period {returnContext?.periodId} · {returnContext?.report}</span></div>
  <div className="card-head"><div><h2>{row.account_code} - {row.account_name}</h2><p className="muted sm">{row.statement_type} / {row.statement_section}</p></div><span className="badge badge-muted">POSTED EVIDENCE</span></div>
  <div className="qbo-toolgrid">
    <span><i>Opening debits</i><b>{money(row.opening_debit)}</b></span><span><i>Opening credits</i><b>{money(row.opening_credit)}</b></span>
    <span><i>Period debits</i><b>{money(row.period_debit)}</b></span><span><i>Period credits</i><b>{money(row.period_credit)}</b></span>
    <span><i>Statement balance</i><b>{money(row.display_balance)}</b></span>
  </div>
  <p className="muted sm">Classification basis: {row.classification_basis}. Period {row.period_code}, {row.period_start} through {row.period_end}.</p>
  <div className="detail-grid">
    <EvidenceIds label="Journal entries" ids={row.journal_entry_ids}/><EvidenceIds label="Journal lines" ids={row.journal_line_ids}/>
    <EvidenceIds label="Ledger lines" ids={row.ledger_line_ids}/><EvidenceIds label="Source documents" ids={row.source_document_ids}/>
  </div>
</section>;

export function AuthoritativeReportsWorkspace({config,fetcher=globalThis.fetch,environment=globalThis}){
  const [report,setReport]=useState('TRIAL_BALANCE');
  const [selected,setSelected]=useState(null);
  const [state,setState]=useState({phase:'LOADING',rows:[],error:null});
  const load=async()=>{setState(current=>({...current,phase:'LOADING',error:null}));const result=await refreshAuthoritativeFinancialStatements({config,fetcher});setState(result.ok?{phase:'READY',rows:result.rows,error:null}:{phase:'ERROR',rows:[],error:result});};
  useEffect(()=>{load();},[config?.entityId,config?.periodId]);
  const rows=useMemo(()=>state.rows.filter(row=>row.statement_type===report),[state.rows,report]);
  const openEvidence=(row,focusId)=>{
    const base=createAuthoritativeReturnContext({config,view:DEFAULT_AUTHORITATIVE_LIST_VIEW,focusId,scrollY:Number(environment?.scrollY)||0});
    if(base)setSelected({row,returnContext:{...base,report}});
  };
  const closeEvidence=()=>{
    const context=selected?.returnContext;
    if(context?.report)setReport(context.report);
    setSelected(null);
    restoreAuthoritativeReturnContext(environment,config,context);
  };
  if(selected)return <ReportDetail row={selected.row} returnContext={selected.returnContext} onBack={closeEvidence}/>;
  return <div className="stack"><div><h1>Financial statements</h1><p className="page-subtitle">OIDC-authenticated, entity-and-period-scoped POSTED ledger evidence. Browser seed data and local storage are not used.</p></div>
    <div className="tabs" role="tablist" aria-label="Financial statements">{REPORTS.map(([key,label])=><button type="button" role="tab" aria-selected={report===key} className={report===key?'tab active':'tab'} key={key} onClick={()=>{setReport(key);setSelected(null);}}>{label}</button>)}</div>
    <p className="muted sm">Entity {config.entityId} | Period {config.periodId} | Read only</p>
    {state.phase==='LOADING'&&<StateBlock tone="loading">Loading authoritative financial statements...</StateBlock>}
    {state.phase==='ERROR'&&<StateBlock tone="error" title={state.error?.code} actions={<button type="button" className="btn btn-sm" onClick={load}>Retry read</button>}><p>{state.error?.message}</p></StateBlock>}
    {state.phase==='READY'&&<section className="card" aria-label={`${REPORTS.find(item=>item[0]===report)?.[1]} rows`}>
      <div className="card-head"><div><h2>{REPORTS.find(item=>item[0]===report)?.[1]}</h2><p className="muted sm">{rows.length} accounts in retained evidence.</p></div><span className="badge badge-muted">READ ONLY</span></div>
      {!!rows.length&&<FinancialStatementSummary report={report} rows={rows}/>}
      {report==='CASH_FLOW'&&<p className="muted sm">This view is direct cash-account movement evidence only. It is not a statement of cash flows and does not infer operating, investing, or financing activities.</p>}
      {!rows.length?<StateBlock tone="empty" title="No POSTED ledger evidence returned">No POSTED ledger evidence was returned for this statement and period.</StateBlock>:<div className="table-wrap"><table className="tbl"><thead><tr><th>Section</th><th>Account</th><th>Period debit</th><th>Period credit</th><th>Balance</th><th>Evidence</th></tr></thead><tbody>{rows.map(row=>{const focusId=`authoritative-report-${row.statement_type}-${row.account_code}`;return <tr key={`${row.statement_type}:${row.account_code}`}><td>{row.statement_section}</td><td><b>{row.account_code}</b><div className="muted sm">{row.account_name}</div></td><td className="num">{money(row.period_debit)}</td><td className="num">{money(row.period_credit)}</td><td className="num">{money(row.display_balance)}</td><td><button id={focusId} type="button" className="btn btn-sm" onClick={()=>openEvidence(row,focusId)}>Open evidence</button></td></tr>;})}</tbody></table></div>}
    </section>}
  </div>;
}
